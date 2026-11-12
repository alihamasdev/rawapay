import {
	type Payment,
	type Result,
	BasePaymentDriver,
	RawaPayError,
	failure,
	phoneSchema,
	positiveAmountSchema,
	success,
	generateTxnRefNo,
} from "@rawapay/core";

import { mapEasyPaisaError } from "./errors";
import type { EasyPaisaConfig, EasyPaisaGetStatusParams, EasyPaisaMAParams, EasyPaisaRawMARequest, EasyPaisaRawResponse } from "./types";

export class EasyPaisaDriver extends BasePaymentDriver<EasyPaisaMAParams, EasyPaisaGetStatusParams, "easypaisa"> {
	readonly name = "easypaisa";
	readonly baseUrls = {
		sandbox: "https://easypaystg.easypaisa.com.pk/easypay-service/rest/v4",
		production: "https://easypay.easypaisa.com.pk/easypay-service/rest/v4",
	};
	readonly config: EasyPaisaConfig;

	constructor(config: EasyPaisaConfig) {
		super();

		if (!config.storeId) {
			throw new RawaPayError({
				code: "INVALID_CREDENTIALS",
				message: "EasyPaisa storeId is required.",
				provider: "easypaisa",
			});
		}

		this.config = config;
	}

	/**
	 * Initiates a direct Mobile Account (MA) payment from an EasyPaisa wallet.
	 */
	async createPayment(params: EasyPaisaMAParams): Promise<Result<Payment, RawaPayError>> {
		// 1. Validate Input Parameters
		const amountResult = positiveAmountSchema.safeParse(params.amount);
		if (!amountResult.success) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: amountResult.error.issues[0]?.message ?? "Invalid amount",
					provider: "easypaisa",
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
					provider: "easypaisa",
					statusCode: 400,
				}),
			);
		}

		const normalizedPhone = phoneResult.data;
		const id = generateTxnRefNo("T");
		const amountStr = amountResult.data.toFixed(2);
		const description = params.description || `Payment of PKR ${params.amount}`;

		// 2. Build Payload
		const payload: EasyPaisaRawMARequest = {
			orderId: id,
			storeId: this.config.storeId,
			transactionAmount: amountStr,
			transactionType: "MA",
			mobileAccountNo: normalizedPhone,
		};

		// 3. Headers & Credentials
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		if (this.config.username && this.config.password) {
			const token = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
			headers.Credentials = token;
			headers.Authorization = `Basic ${token}`;
		}

		// Note on hashKey / Request Integrity:
		// EasyPaisa integration specifications vary by merchant agreement. Standard REST v4 MA
		// transactions use HTTP Basic Auth. Some enterprise merchants receive an integration pack
		// specifying HMAC-SHA256 request body signing or RSA private-key signatures using hashKey.
		// TODO: If your EasyPaisa contract requires signed requests, confirm your integration pack
		// with EasyPaisa merchant integration support before enabling signature headers.

		// 4. Execute HTTP Request
		try {
			const res = await this.http.post<EasyPaisaRawResponse>("/initiate-ma-transaction", payload, {
				headers,
				retries: 0,
				validateStatus: () => true,
				context: { provider: "easypaisa", action: "createPayment" },
			});

			const rawJson = (res.data && typeof res.data === "object" ? res.data : null) as EasyPaisaRawResponse | null;

			// If gateway returned a structured responseCode (even on HTTP errors)
			if (rawJson && rawJson.responseCode) {
				const responseCode = String(rawJson.responseCode).trim();
				if (responseCode === "0000") {
					const payment: Payment = {
						id,
						provider: "easypaisa",
						status: "succeeded",
						amount: params.amount,
						rawAmount: amountStr,
						currency: "PKR",
						description,
						responseCode,
						responseMessage: rawJson.responseDesc || "SUCCESS",
						raw: rawJson as Record<string, unknown>,
						createdAt: new Date().toISOString(),
					};
					return success(payment);
				}

				return failure(mapEasyPaisaError(rawJson));
			}

			// Gateway returned non-JSON HTTP status
			if (!res.rawResponse.ok) {
				const errorText = typeof res.data === "string" ? res.data : "";
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `EasyPaisa gateway returned HTTP ${res.status}: ${errorText || res.statusText || "Request failed"}`,
						provider: "easypaisa",
						statusCode: res.status,
						isRetryable: res.status >= 500,
					}),
				);
			}

			return failure(
				new RawaPayError({
					code: "GATEWAY_ERROR",
					message: "EasyPaisa returned an unexpected empty or invalid response.",
					provider: "easypaisa",
					statusCode: 502,
					isRetryable: true,
				}),
			);
		} catch (err: unknown) {
			if (err instanceof RawaPayError) {
				return failure(
					new RawaPayError({
						code: err.code,
						message: err.message,
						provider: "easypaisa",
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
					message: `Failed to connect to EasyPaisa gateway: ${errMessage}`,
					provider: "easypaisa",
					statusCode: 502,
					isRetryable: true,
				}),
			);
		}
	}

	/**
	 * Checks the status of a previously initiated EasyPaisa transaction.
	 */
	async getStatus(params: EasyPaisaGetStatusParams): Promise<Result<Payment, RawaPayError>> {
		const paymentId = params.paymentId;
		if (!paymentId) {
			return failure(
				new RawaPayError({
					code: "INVALID_PARAMETER",
					message: "paymentId is required to check EasyPaisa status.",
					provider: "easypaisa",
					statusCode: 400,
				}),
			);
		}

		const payload = {
			orderId: paymentId,
			storeId: this.config.storeId!,
			transactionType: "MA",
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		if (this.config.username && this.config.password) {
			const token = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
			headers.Credentials = token;
			headers.Authorization = `Basic ${token}`;
		}

		try {
			const res = await this.http.post<EasyPaisaRawResponse>("/inquire-transaction", payload, {
				headers,
				retries: 2,
				validateStatus: () => true,
				context: { provider: "easypaisa", action: "getStatus" },
			});

			const rawJson = (res.data && typeof res.data === "object" ? res.data : null) as EasyPaisaRawResponse | null;

			if (rawJson && rawJson.responseCode) {
				const responseCode = String(rawJson.responseCode).trim();
				if (responseCode === "0000") {
					const payment: Payment = {
						id: paymentId,
						provider: "easypaisa",
						status: "succeeded",
						amount: 0,
						currency: "PKR",
						responseCode,
						responseMessage: rawJson.responseDesc || "SUCCESS",
						raw: rawJson as Record<string, unknown>,
						createdAt: new Date().toISOString(),
					};
					return success(payment);
				}

				return failure(mapEasyPaisaError(rawJson));
			}

			if (!res.rawResponse.ok) {
				const errorText = typeof res.data === "string" ? res.data : "";
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `EasyPaisa inquiry returned HTTP ${res.status}: ${errorText || res.statusText || "Request failed"}`,
						provider: "easypaisa",
						statusCode: res.status,
						isRetryable: res.status >= 500,
					}),
				);
			}

			return failure(
				new RawaPayError({
					code: "GATEWAY_ERROR",
					message: "EasyPaisa inquiry returned an unexpected empty or invalid response.",
					provider: "easypaisa",
					statusCode: 502,
					isRetryable: true,
				}),
			);
		} catch (err: unknown) {
			if (err instanceof RawaPayError) {
				return failure(
					new RawaPayError({
						code: err.code,
						message: err.message,
						provider: "easypaisa",
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
					message: `Failed to connect to EasyPaisa inquiry gateway: ${errMessage}`,
					provider: "easypaisa",
					statusCode: 502,
					isRetryable: true,
				}),
			);
		}
	}

	/**
	 * Verifies an incoming EasyPaisa IPN / callback request payload.
	 *
	 * Note: Standard EasyPaisa Mobile Account (MA) IPN notifications do not include
	 * a symmetric HMAC signature in the notify payload (unlike JazzCash pp_SecureHash).
	 * For EasyPaisa callbacks, merchants should verify transaction settlement status
	 * directly with EasyPaisa using payment.status() or allowlist EasyPaisa notification IPs.
	 *
	 * @param _body The callback request body
	 * @returns false as standard EasyPaisa MA callbacks do not use an HMAC signature
	 */
	verifyCallback(_body: Record<string, unknown>): boolean {
		return false;
	}
}

/**
 * Factory helper for EasyPaisa provider.
 */
export function easypaisa(config: EasyPaisaConfig): EasyPaisaDriver {
	return new EasyPaisaDriver(config);
}
