import { RawaPayError, type RawaPayErrorCode } from "@rawapay/core";

import type { JazzCashRawResponse } from "./types";

interface CodeMapping {
	code: RawaPayErrorCode;
	message: string;
	statusCode: number;
	isRetryable: boolean;
}

const JAZZCASH_ERROR_MAP: Record<string, CodeMapping> = {
	"101": {
		code: "INVALID_CREDENTIALS",
		message: "Invalid JazzCash merchant credentials (pp_MerchantID or pp_Password).",
		statusCode: 401,
		isRetryable: false,
	},
	"102": {
		code: "CARD_BLOCKED",
		message: "Payment instrument or customer card is blocked.",
		statusCode: 403,
		isRetryable: false,
	},
	"103": {
		code: "ACCOUNT_INACTIVE",
		message: "Customer mobile wallet account is inactive or suspended.",
		statusCode: 403,
		isRetryable: false,
	},
	"110": {
		code: "INVALID_PARAMETER",
		message: "Invalid parameter format or missing mandatory field in JazzCash request.",
		statusCode: 400,
		isRetryable: false,
	},
	"115": {
		code: "INVALID_SIGNATURE",
		message: "Invalid pp_SecureHash. Cryptographic integrity check failed.",
		statusCode: 401,
		isRetryable: false,
	},
	"116": {
		code: "DUPLICATE_REFERENCE",
		message: "Duplicate transaction reference (pp_TxnRefNo). This reference has already been used.",
		statusCode: 409,
		isRetryable: false,
	},
	"117": {
		code: "INVALID_TIMESTAMP",
		message: "Invalid or expired transaction datetime format (pp_TxnDateTime).",
		statusCode: 400,
		isRetryable: false,
	},
	"118": {
		code: "ACCOUNT_NOT_FOUND",
		message: "Customer JazzCash mobile account does not exist or invalid number provided.",
		statusCode: 404,
		isRetryable: false,
	},
	"119": {
		code: "INSUFFICIENT_FUNDS",
		message: "Customer mobile account has insufficient balance to complete this transaction.",
		statusCode: 402,
		isRetryable: false,
	},
	"120": {
		code: "AUTHENTICATION_FAILED",
		message: "Incorrect MPIN entered on customer handset. Authorization failed.",
		statusCode: 401,
		isRetryable: false,
	},
	"122": {
		code: "TRANSACTION_EXPIRED",
		message: "Transaction timed out. Customer did not enter MPIN within the authorization window.",
		statusCode: 408,
		isRetryable: true,
	},
	"123": {
		code: "TRANSACTION_CANCELLED",
		message: "Transaction was rejected or cancelled by the customer on their mobile handset.",
		statusCode: 400,
		isRetryable: false,
	},
	"124": {
		code: "PAYMENT_PENDING",
		message: "Transaction initiated and waiting for customer authorization.",
		statusCode: 202,
		isRetryable: false,
	},
	"157": {
		code: "LIMIT_EXCEEDED",
		message: "Customer daily or monthly wallet transaction limit has been exceeded.",
		statusCode: 403,
		isRetryable: false,
	},
	"199": {
		code: "PAYMENT_FAILED",
		message: "JazzCash payment failed. Please try again.",
		statusCode: 500,
		isRetryable: true,
	},
	"210": {
		code: "PAYMENT_REJECTED",
		message: "Transaction rejected by banking network or fraud rules.",
		statusCode: 403,
		isRetryable: false,
	},
	"999": {
		code: "GATEWAY_ERROR",
		message: "JazzCash gateway timeout or internal service error. Please retry shortly.",
		statusCode: 502,
		isRetryable: true,
	},
};

/**
 * Maps a raw JazzCash response into a standardized, strongly-typed RawaPayError.
 */
export function mapJazzCashError(response: JazzCashRawResponse): RawaPayError {
	const rawCode = response.pp_ResponseCode || "UNKNOWN";
	const rawMessage = response.pp_ResponseMessage || "Unknown gateway error";
	const mapping = JAZZCASH_ERROR_MAP[rawCode];

	if (mapping) {
		const message = rawMessage && rawMessage !== "Unknown gateway error" ? `${mapping.message} (${rawMessage})` : mapping.message;

		return new RawaPayError({
			code: mapping.code,
			message,
			provider: "jazzcash",
			statusCode: mapping.statusCode,
			rawCode,
			rawResponse: response,
			isRetryable: mapping.isRetryable,
		});
	}

	return new RawaPayError({
		code: "PAYMENT_FAILED",
		message: rawMessage,
		provider: "jazzcash",
		statusCode: 400,
		rawCode,
		rawResponse: response,
		isRetryable: false,
	});
}
