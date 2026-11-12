import {
	type Payment,
	type Result,
	BasePaymentDriver,
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
} from "@rawapay/core";

import { calculateSecureHash, verifySecureHash } from "./crypto";
import { mapJazzCashError } from "./errors";
import type {
	JazzCashConfig,
	JazzCashGetStatusParams,
	JazzCashMWalletParams,
	JazzCashRawMWalletRequest,
	JazzCashRawResponse,
} from "./types";

export class JazzCashDriver extends BasePaymentDriver<JazzCashMWalletParams, JazzCashGetStatusParams, "jazzcash"> {
	readonly name = "jazzcash";
	readonly baseUrls = {
		sandbox: "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase",
		production: "https://payments.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase",
	};
	readonly config: JazzCashConfig;

	constructor(config: JazzCashConfig) {
		super();

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

		this.config = config;
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

		// 4. Execute HTTP Request
		try {
			const res = await this.http.post<JazzCashRawResponse>("/DoMWalletTransaction", fullPayload, {
				retries: 0,
				context: { provider: "jazzcash", action: "createPayment" },
			});

			const rawJson = res.data;

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
			if (err instanceof RawaPayError) {
				return failure(
					new RawaPayError({
						code: err.code,
						message: err.message,
						provider: "jazzcash",
						statusCode: err.statusCode,
						rawResponse: err.rawResponse,
						isRetryable: err.isRetryable,
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

		try {
			const res = await this.http.post<JazzCashRawResponse>("/PaymentInquiry", fullPayload, {
				retries: 2,
				context: { provider: "jazzcash", action: "getStatus" },
			});

			const rawJson = res.data;

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
			if (err instanceof RawaPayError) {
				return failure(
					new RawaPayError({
						code: err.code,
						message: err.message,
						provider: "jazzcash",
						statusCode: err.statusCode,
						rawResponse: err.rawResponse,
						isRetryable: err.isRetryable,
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

/**
 * Factory helper for JazzCash provider.
 * Allows adding JazzCash to `new RawaPay({ providers: [jazzcash(...)] })`.
 */
export function jazzcash(config: JazzCashConfig): JazzCashDriver {
	return new JazzCashDriver(config);
}
