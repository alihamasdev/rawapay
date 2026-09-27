import { RawaPayError, type RawaPayErrorCode } from "@rawapay/core";

import type { EasyPaisaRawResponse } from "./types";

interface CodeMapping {
	code: RawaPayErrorCode;
	message: string;
	statusCode: number;
	isRetryable: boolean;
}

const EASYPAISA_ERROR_MAP: Record<string, CodeMapping> = {
	"0001": {
		code: "GATEWAY_ERROR",
		message: "System error on EasyPaisa payment gateway. Please retry shortly.",
		statusCode: 502,
		isRetryable: true,
	},
	"0002": {
		code: "INVALID_PARAMETER",
		message: "Required field is missing or invalid in EasyPaisa request.",
		statusCode: 400,
		isRetryable: false,
	},
	"0005": {
		code: "ACCOUNT_INACTIVE",
		message: "EasyPaisa merchant account is not active.",
		statusCode: 403,
		isRetryable: false,
	},
	"0006": {
		code: "INVALID_CREDENTIALS",
		message: "Invalid EasyPaisa storeId.",
		statusCode: 401,
		isRetryable: false,
	},
	"0007": {
		code: "ACCOUNT_INACTIVE",
		message: "EasyPaisa store is not active or suspended.",
		statusCode: 403,
		isRetryable: false,
	},
	"0008": {
		code: "INVALID_PARAMETER",
		message: "Payment method (Mobile Account) is not enabled for this store.",
		statusCode: 400,
		isRetryable: false,
	},
	"0010": {
		code: "INVALID_CREDENTIALS",
		message: "Invalid EasyPaisa merchant credentials (username/password/hash).",
		statusCode: 401,
		isRetryable: false,
	},
	"0013": {
		code: "INSUFFICIENT_FUNDS",
		message: "Customer EasyPaisa mobile account has low or insufficient balance.",
		statusCode: 402,
		isRetryable: false,
	},
	"0014": {
		code: "ACCOUNT_NOT_FOUND",
		message: "Customer EasyPaisa mobile account does not exist.",
		statusCode: 404,
		isRetryable: false,
	},
	"0017": {
		code: "INVALID_CREDENTIALS",
		message: "Incomplete merchant information or invalid storeId.",
		statusCode: 401,
		isRetryable: false,
	},
};

/**
 * Maps a raw EasyPaisa response into a standardized, strongly-typed RawaPayError.
 */
export function mapEasyPaisaError(response: EasyPaisaRawResponse): RawaPayError {
	const rawCode = response.responseCode || "UNKNOWN";
	const rawMessage = response.responseDesc || "";
	const mapping = EASYPAISA_ERROR_MAP[rawCode];

	if (mapping) {
		const message = rawMessage && rawMessage !== "FAILED" ? `${mapping.message} (${rawMessage})` : mapping.message;

		return new RawaPayError({
			code: mapping.code,
			message,
			provider: "easypaisa",
			statusCode: mapping.statusCode,
			rawCode,
			rawResponse: response,
			isRetryable: mapping.isRetryable,
		});
	}

	return new RawaPayError({
		code: "PAYMENT_FAILED",
		message: rawMessage || "EasyPaisa transaction failed.",
		provider: "easypaisa",
		statusCode: 400,
		rawCode,
		rawResponse: response,
		isRetryable: false,
	});
}
