import {
	type Payment,
	type PaymentDriver,
	type Result,
	RawaPayError,
	assertServerEnv,
	failure,
	phoneSchema,
	positiveAmountSchema,
	success,
	DEFAULT_PAYMENT_ENVIRONMENT,
	DEFAULT_TIMEOUT_MS,
	generateTxnRefNo,
} from "@rawapay/core";

import type { EasyPaisaConfig, EasyPaisaGetStatusParams, EasyPaisaMAParams, EasyPaisaRawMARequest, EasyPaisaRawResponse } from "./types";

import { mapEasyPaisaError } from "./errors";

const EASYPAISA_SANDBOX_URL = "https://easypaystg.easypaisa.com.pk/easypay-service/rest/v4/initiate-ma-transaction";
const EASYPAISA_PRODUCTION_URL = "https://easypay.easypaisa.com.pk/easypay-service/rest/v4/initiate-ma-transaction";
const EASYPAISA_SANDBOX_INQUIRY_URL = "https://easypaystg.easypaisa.com.pk/easypay-service/rest/v4/inquire-transaction";
const EASYPAISA_PRODUCTION_INQUIRY_URL = "https://easypay.easypaisa.com.pk/easypay-service/rest/v4/inquire-transaction";

export class EasyPaisaDriver implements PaymentDriver<EasyPaisaMAParams, EasyPaisaGetStatusParams> {
	readonly name = "easypaisa";
	readonly config: EasyPaisaConfig;

	constructor(config: EasyPaisaConfig) {
		assertServerEnv("EasyPaisaDriver");

		if (!config.storeId) {
			throw new RawaPayError({
				code: "INVALID_CREDENTIALS",
				message: "EasyPaisa storeId is required.",
				provider: "easypaisa",
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

		// 3. Select Gateway Endpoint
		const endpoint = this.config.options?.environment === "production" ? EASYPAISA_PRODUCTION_URL : EASYPAISA_SANDBOX_URL;
		const timeoutMs = this.config.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		// 4. Headers & Credentials
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

		// 5. Execute HTTP Request
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(timeoutMs),
			});

			let rawJson: EasyPaisaRawResponse | null = null;
			try {
				rawJson = (await res.json()) as EasyPaisaRawResponse;
			} catch {
				// Response was not JSON
			}

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
			if (!res.ok) {
				const errorText = await res.text().catch(() => "");
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
			if (err instanceof Error && err.name === "TimeoutError") {
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `EasyPaisa request timed out after ${timeoutMs}ms`,
						provider: "easypaisa",
						statusCode: 408,
						isRetryable: true,
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

		const endpoint = this.config.options?.environment === "production" ? EASYPAISA_PRODUCTION_INQUIRY_URL : EASYPAISA_SANDBOX_INQUIRY_URL;
		const timeoutMs = this.config.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
			const res = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(timeoutMs),
			});

			let rawJson: EasyPaisaRawResponse | null = null;
			try {
				rawJson = (await res.json()) as EasyPaisaRawResponse;
			} catch {
				// Response was not JSON
			}

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

			if (!res.ok) {
				const errorText = await res.text().catch(() => "");
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
			if (err instanceof Error && err.name === "TimeoutError") {
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `EasyPaisa inquiry request timed out after ${timeoutMs}ms`,
						provider: "easypaisa",
						statusCode: 408,
						isRetryable: true,
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
