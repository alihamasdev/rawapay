import {
	type Payment,
	type PaymentDriver,
	type Result,
	RawaPayError,
	failure,
	success,
	formatToPaisa,
	formatDateTime,
	formatExpiryDateTime,
	generateTxnRefNo,
	phoneSchema,
	cnicSchema,
	positiveAmountSchema,
	assertServerEnv,
	DEFAULT_PAYMENT_ENVIRONMENT,
	DEFAULT_TIMEOUT_MS,
} from "@rawapay/core";

import type {
	JazzCashConfig,
	JazzCashGetStatusParams,
	JazzCashMWalletParams,
	JazzCashRawMWalletRequest,
	JazzCashRawResponse,
} from "./types";

import { calculateSecureHash, verifySecureHash } from "./crypto";
import { mapJazzCashError } from "./errors";

const JAZZCASH_SANDBOX_URL = "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction";
const JAZZCASH_PRODUCTION_URL = "https://payments.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction";
const JAZZCASH_SANDBOX_INQUIRY_URL = "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/PaymentInquiry";
const JAZZCASH_PRODUCTION_INQUIRY_URL = "https://payments.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/PaymentInquiry";

export class JazzCashDriver implements PaymentDriver<JazzCashMWalletParams, JazzCashGetStatusParams> {
	readonly name = "jazzcash";
	readonly config: JazzCashConfig;

	constructor(config: JazzCashConfig) {
		assertServerEnv("JazzCashDriver");

		if (!config.merchantId) {
			throw new RawaPayError({
				code: "INVALID_CREDENTIALS",
				message: "JazzCash merchantId (pp_MerchantID) is required.",
				provider: "jazzcash",
			});
		}
		if (!config.password) {
			throw new RawaPayError({
				code: "INVALID_CREDENTIALS",
				message: "JazzCash password (pp_Password) is required.",
				provider: "jazzcash",
			});
		}
		if (!config.integritySalt) {
			throw new RawaPayError({
				code: "INVALID_CREDENTIALS",
				message: "JazzCash integritySalt (Hash Key) is required.",
				provider: "jazzcash",
			});
		}

		this.config = {
			...config,
			options: {
				environment: config.options?.environment ?? DEFAULT_PAYMENT_ENVIRONMENT,
				timeoutMs: config.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			},
		};
	}

	/**
	 * Initiates a direct Mobile Wallet (MWALLET) transaction.
	 * Triggers a real-time USSD push prompt on the customer's mobile handset for MPIN entry.
	 */
	async createPayment(params: JazzCashMWalletParams): Promise<Result<Payment, RawaPayError>> {
		// 1. Validate Input Parameters
		const amountResult = positiveAmountSchema.safeParse(params.amount);
		if (!amountResult.success) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: amountResult.error.issues[0]?.message ?? "Invalid amount",
					provider: "jazzcash",
					statusCode: 400,
				}),
			);
		}

		const phoneResult = phoneSchema.safeParse(params.phone);
		if (!phoneResult.success) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: phoneResult.error.issues[0]?.message ?? "Invalid phone number",
					provider: "jazzcash",
					statusCode: 400,
				}),
			);
		}

		if (!params.cnic) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: "JazzCash mobile wallet payment requires customer CNIC (last 6 digits or full 13-digit CNIC).",
					provider: "jazzcash",
					statusCode: 400,
				}),
			);
		}

		const cnicResult = cnicSchema.safeParse(params.cnic);
		if (!cnicResult.success) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: cnicResult.error.issues[0]?.message ?? "Invalid CNIC",
					provider: "jazzcash",
					statusCode: 400,
				}),
			);
		}

		const normalizedPhone = phoneResult.data;
		const normalizedCnic = cnicResult.data;
		const amountInPaisa = formatToPaisa(amountResult.data);
		const id = generateTxnRefNo("T");
		const txnDateTime = formatDateTime();
		const txnExpiryDateTime = formatExpiryDateTime(1);
		const description = params.description || `Payment of PKR ${params.amount}`;

		// 2. Build Raw Payload (without hash first)
		const payloadWithoutHash: Record<string, string> = {
			pp_Version: "2.0",
			pp_TxnType: "MWALLET",
			pp_Language: "EN",
			pp_MerchantID: this.config.merchantId,
			pp_Password: this.config.password,
			pp_TxnRefNo: id,
			pp_Amount: amountInPaisa,
			pp_TxnCurrency: "PKR",
			pp_TxnDateTime: txnDateTime,
			pp_BillReference: id,
			pp_Description: description,
			pp_TxnExpiryDateTime: txnExpiryDateTime,
			pp_MobileNumber: normalizedPhone,
			pp_CNIC: normalizedCnic,
		};

		// 3. Compute pp_SecureHash
		const pp_SecureHash = calculateSecureHash(payloadWithoutHash, this.config.integritySalt);

		const fullPayload: JazzCashRawMWalletRequest = {
			...payloadWithoutHash,
			pp_SecureHash,
		} as JazzCashRawMWalletRequest;

		// 4. Select Gateway Endpoint
		const endpoint = this.config.options?.environment === "production" ? JAZZCASH_PRODUCTION_URL : JAZZCASH_SANDBOX_URL;
		const timeoutMs = this.config.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		// 5. Execute HTTP Request
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(fullPayload),
				signal: AbortSignal.timeout(timeoutMs),
			});

			if (!res.ok) {
				const errorText = await res.text().catch(() => "");
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `JazzCash server returned HTTP ${res.status}: ${errorText || res.statusText}`,
						provider: "jazzcash",
						statusCode: res.status,
						isRetryable: res.status >= 500,
					}),
				);
			}

			const rawJson = (await res.json()) as JazzCashRawResponse;

			// Verify response hash if present
			if (rawJson.pp_SecureHash && !verifySecureHash(rawJson as Record<string, unknown>, this.config.integritySalt!)) {
				return failure(
					new RawaPayError({
						code: "INVALID_SIGNATURE",
						message: "JazzCash response integrity hash verification failed.",
						provider: "jazzcash",
						statusCode: 400,
						rawResponse: rawJson,
					}),
				);
			}

			// 6. Handle Gateway Response Codes
			// For direct MWALLET payments, 000, 121, and 124 indicate that the push / USSD prompt
			// has been successfully dispatched to the customer's handset.
			// The transaction is NOT final until the customer enters their MPIN.
			// Therefore, createPayment returns status: "pending". Confirmation is achieved via
			// status inquiry (pay.payment.status) or a verified IPN callback (pay.verifyCallback).
			const responseCode = String(rawJson.pp_ResponseCode || "").trim();

			if (responseCode === "000" || responseCode === "121" || responseCode === "124") {
				const payment: Payment = {
					id,
					provider: "jazzcash",
					status: "pending",
					amount: params.amount,
					rawAmount: amountInPaisa,
					currency: "PKR",
					description,
					responseCode,
					responseMessage:
						rawJson.pp_ResponseMessage ||
						(responseCode === "000" ? "Transaction Accepted / Waiting for MPIN Authorization" : "Waiting for customer authorization"),
					retrievalRefNo: rawJson.pp_RetreivalReferenceNo,
					raw: rawJson as Record<string, unknown>,
					createdAt: new Date().toISOString(),
				};
				return success(payment);
			}

			// Map failure response code
			return failure(mapJazzCashError(rawJson));
		} catch (err: unknown) {
			if (err instanceof Error && err.name === "TimeoutError") {
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `JazzCash request timed out after ${timeoutMs}ms`,
						provider: "jazzcash",
						statusCode: 408,
						isRetryable: true,
					}),
				);
			}
			const errMessage = err instanceof Error ? err.message : String(err);
			return failure(
				new RawaPayError({
					code: "GATEWAY_ERROR",
					message: `Failed to connect to JazzCash gateway: ${errMessage}`,
					provider: "jazzcash",
					statusCode: 502,
					isRetryable: true,
				}),
			);
		}
	}

	/**
	 * Checks the status of a previously initiated JazzCash transaction.
	 */
	async getStatus(params: JazzCashGetStatusParams): Promise<Result<Payment, RawaPayError>> {
		const paymentId = params.paymentId;
		if (!paymentId) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: "paymentId is required to check JazzCash status.",
					provider: "jazzcash",
					statusCode: 400,
				}),
			);
		}

		const payloadWithoutHash: Record<string, string> = {
			pp_MerchantID: this.config.merchantId!,
			pp_Password: this.config.password!,
			pp_TxnRefNo: paymentId,
		};

		const pp_SecureHash = calculateSecureHash(payloadWithoutHash, this.config.integritySalt!);
		const fullPayload = {
			...payloadWithoutHash,
			pp_SecureHash,
		};

		const endpoint = this.config.options?.environment === "production" ? JAZZCASH_PRODUCTION_INQUIRY_URL : JAZZCASH_SANDBOX_INQUIRY_URL;
		const timeoutMs = this.config.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(fullPayload),
				signal: AbortSignal.timeout(timeoutMs),
			});

			if (!res.ok) {
				const errorText = await res.text().catch(() => "");
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `JazzCash inquiry server returned HTTP ${res.status}: ${errorText || res.statusText}`,
						provider: "jazzcash",
						statusCode: res.status,
						isRetryable: res.status >= 500,
					}),
				);
			}

			const rawJson = (await res.json()) as JazzCashRawResponse;

			if (rawJson.pp_SecureHash && !verifySecureHash(rawJson as Record<string, unknown>, this.config.integritySalt!)) {
				return failure(
					new RawaPayError({
						code: "INVALID_SIGNATURE",
						message: "JazzCash inquiry response integrity hash verification failed.",
						provider: "jazzcash",
						statusCode: 400,
						rawResponse: rawJson,
					}),
				);
			}

			const responseCode = String(rawJson.pp_ResponseCode || "").trim();
			const amount = rawJson.pp_Amount ? Number.parseFloat(rawJson.pp_Amount) / 100 : 0;
			const description = rawJson.pp_Description as string | undefined;

			if (responseCode === "000") {
				return success({
					id: paymentId,
					provider: "jazzcash",
					status: "succeeded",
					amount,
					rawAmount: rawJson.pp_Amount,
					currency: "PKR",
					description,
					responseCode,
					responseMessage: rawJson.pp_ResponseMessage || "Transaction Successful",
					retrievalRefNo: rawJson.pp_RetreivalReferenceNo,
					raw: rawJson as Record<string, unknown>,
					createdAt: new Date().toISOString(),
				});
			}

			if (responseCode === "121" || responseCode === "124") {
				return success({
					id: paymentId,
					provider: "jazzcash",
					status: "pending",
					amount,
					rawAmount: rawJson.pp_Amount,
					currency: "PKR",
					description,
					responseCode,
					responseMessage: rawJson.pp_ResponseMessage || "Waiting for customer authorization",
					retrievalRefNo: rawJson.pp_RetreivalReferenceNo,
					raw: rawJson as Record<string, unknown>,
					createdAt: new Date().toISOString(),
				});
			}

			return failure(mapJazzCashError(rawJson));
		} catch (err: unknown) {
			if (err instanceof Error && err.name === "TimeoutError") {
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `JazzCash inquiry timed out after ${timeoutMs}ms`,
						provider: "jazzcash",
						statusCode: 408,
						isRetryable: true,
					}),
				);
			}
			const errMessage = err instanceof Error ? err.message : String(err);
			return failure(
				new RawaPayError({
					code: "GATEWAY_ERROR",
					message: `Failed to connect to JazzCash inquiry gateway: ${errMessage}`,
					provider: "jazzcash",
					statusCode: 502,
					isRetryable: true,
				}),
			);
		}
	}

	/**
	 * Verifies an incoming JazzCash IPN / callback request payload.
	 * Recomputes HMAC-SHA256 signature using the merchant's integritySalt
	 * and verifies against pp_SecureHash using constant-time buffer comparison.
	 *
	 * @param body Callback request body payload
	 * @returns boolean true if signature is authentic, false otherwise
	 */
	verifyCallback(body: Record<string, unknown>): boolean {
		if (!this.config.integritySalt || !body) return false;
		return verifySecureHash(body, this.config.integritySalt);
	}
}
