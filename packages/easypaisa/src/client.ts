import {
	type Payment,
	type PaymentDriver,
	type Result,
	RawaPayError,
	assertServerEnv,
	failure,
	generateTxnRefNo,
	phoneSchema,
	positiveAmountSchema,
	success,
} from "@rawapay/core";

import type { EasyPaisaConfig, EasyPaisaMAParams, EasyPaisaRawMARequest, EasyPaisaRawResponse } from "./types";

import { mapEasyPaisaError } from "./errors";

const EASYPAISA_SANDBOX_URL = "https://easypaystg.easypaisa.com.pk/easypay-service/rest/v4/initiate-ma-transaction";
const EASYPAISA_PRODUCTION_URL = "https://easypay.easypaisa.com.pk/easypay-service/rest/v4/initiate-ma-transaction";

export class EasyPaisaDriver implements PaymentDriver<EasyPaisaMAParams> {
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
			environment: "sandbox",
			...config,
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
		const orderId = params.orderId || generateTxnRefNo("EP");
		const amountStr = amountResult.data.toFixed(2);
		const description = params.description || `Payment of PKR ${params.amount}`;

		// 2. Build Payload
		const payload: EasyPaisaRawMARequest = {
			orderId,
			storeId: this.config.storeId!,
			transactionAmount: amountStr,
			transactionType: "MA",
			mobileAccountNo: normalizedPhone,
			emailAddress: params.emailAddress || "",
		};

		// 3. Select Gateway Endpoint
		const endpoint = this.config.environment === "production" ? EASYPAISA_PRODUCTION_URL : EASYPAISA_SANDBOX_URL;

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

		// 5. Execute HTTP Request
		try {
			const res = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
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
						id: rawJson.transactionId || orderId,
						provider: "easypaisa",
						status: "succeeded",
						amount: params.amount,
						currency: "PKR",
						billReference: orderId,
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
}
