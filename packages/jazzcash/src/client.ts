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
} from "@rawapay/core";

import type { JazzCashConfig, JazzCashMWalletParams, JazzCashRawMWalletRequest, JazzCashRawResponse } from "./types";

import { calculateSecureHash } from "./crypto";
import { mapJazzCashError } from "./errors";

const JAZZCASH_SANDBOX_URL = "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction";
const JAZZCASH_PRODUCTION_URL = "https://payments.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction";

export class JazzCashDriver implements PaymentDriver<JazzCashMWalletParams> {
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
			version: "2.0",
			language: "EN",
			environment: "sandbox",
			...config,
		};
	}

	/**
	 * Initiates a direct Mobile Wallet (MWALLET) transaction.
	 * Triggers a real-time USSD push prompt on the customer's mobile handset for MPIN entry.
	 */
	async createPayment(params: JazzCashMWalletParams): Promise<Result<Payment, RawaPayError>> {
		// 1. Validate Input Parameters with Zod
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
		const txnRefNo = params.txnRefNo || generateTxnRefNo("T");
		const txnDateTime = params.txnDateTime || formatDateTime();
		const txnExpiryDateTime = params.txnExpiryDateTime || formatExpiryDateTime(1);
		const billReference = params.billReference || `BILL-${txnRefNo}`;
		const description = params.description || `Payment of PKR ${params.amount}`;

		// 2. Build Raw Payload (without hash first)
		const payloadWithoutHash: Record<string, string> = {
			pp_Version: this.config.version ?? "2.0",
			pp_TxnType: "MWALLET",
			pp_Language: this.config.language ?? "EN",
			pp_MerchantID: this.config.merchantId!,
			pp_Password: this.config.password!,
			pp_TxnRefNo: txnRefNo,
			pp_Amount: amountInPaisa,
			pp_TxnCurrency: "PKR",
			pp_TxnDateTime: txnDateTime,
			pp_BillReference: billReference,
			pp_Description: description,
			pp_TxnExpiryDateTime: txnExpiryDateTime,
			pp_MobileNumber: normalizedPhone,
			pp_CNIC: normalizedCnic,
		};

		if (this.config.returnUrl) {
			payloadWithoutHash.pp_ReturnURL = this.config.returnUrl;
		}

		// 3. Compute pp_SecureHash
		const pp_SecureHash = calculateSecureHash(payloadWithoutHash, this.config.integritySalt!);

		const fullPayload: JazzCashRawMWalletRequest = {
			...payloadWithoutHash,
			pp_SecureHash,
		} as JazzCashRawMWalletRequest;

		// 4. Select Gateway Endpoint
		const endpoint = this.config.environment === "production" ? JAZZCASH_PRODUCTION_URL : JAZZCASH_SANDBOX_URL;

		// 5. Execute HTTP Request
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(fullPayload),
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

			// 6. Handle Gateway Response Codes
			const responseCode = String(rawJson.pp_ResponseCode || "").trim();

			if (responseCode === "000" || responseCode === "121") {
				const payment: Payment = {
					id: rawJson.pp_TxnRefNo || txnRefNo,
					provider: "jazzcash",
					status: "succeeded",
					amount: params.amount,
					ppAmount: amountInPaisa,
					currency: "PKR",
					billReference,
					description,
					responseCode,
					responseMessage: rawJson.pp_ResponseMessage || "Transaction Successful",
					retrievalRefNo: rawJson.pp_RetreivalReferenceNo,
					raw: rawJson as Record<string, unknown>,
					createdAt: new Date().toISOString(),
				};
				return success(payment);
			}

			if (responseCode === "124") {
				const payment: Payment = {
					id: rawJson.pp_TxnRefNo || txnRefNo,
					provider: "jazzcash",
					status: "pending",
					amount: params.amount,
					ppAmount: amountInPaisa,
					currency: "PKR",
					billReference,
					description,
					responseCode,
					responseMessage: rawJson.pp_ResponseMessage || "Waiting for customer authorization",
					retrievalRefNo: rawJson.pp_RetreivalReferenceNo,
					raw: rawJson as Record<string, unknown>,
					createdAt: new Date().toISOString(),
				};
				return success(payment);
			}

			// Map failure response code
			return failure(mapJazzCashError(rawJson));
		} catch (err: unknown) {
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
}
