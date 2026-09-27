import type { RawaPayError } from "./errors";

/**
 * Result pattern types for predictable error handling.
 */
export type SuccessResult<T> = {
	data: T;
	error: null;
};

export type ErrorResult<E = RawaPayError> = {
	data: null;
	error: E;
};

export type Result<T, E = RawaPayError> = SuccessResult<T> | ErrorResult<E>;

/**
 * Normalized payment statuses across all providers.
 */
export type PaymentStatus = "succeeded" | "pending" | "processing" | "failed" | "cancelled" | "expired" | "refunded";

/**
 * Standardized payment entity returned to developers.
 */
export interface Payment {
	/** Unique transaction identifier from the payment gateway */
	id: string;
	/** Provider used for this payment, e.g. "jazzcash" */
	provider: string;
	/** Standardized lifecycle status of the transaction */
	status: PaymentStatus;
	/** Payment amount in Pakistani Rupees (PKR) */
	amount: number;
	/** Raw amount sent to provider (e.g. paisas string for JazzCash) */
	ppAmount?: string;
	/** Currency code, always PKR */
	currency: "PKR";
	/** Merchant bill or order reference */
	billReference: string;
	/** Human-readable memo or description */
	description?: string;
	/** Gateway raw response code (e.g. "000") */
	responseCode: string;
	/** Gateway raw response message */
	responseMessage: string;
	/** Bank / Gateway Retrieval Reference Number (RRN) for reconciliation */
	retrievalRefNo?: string;
	/** Full unmodified raw response payload from the gateway */
	raw: Record<string, unknown>;
	/** ISO 8601 creation timestamp */
	createdAt: string;
}

/**
 * Unified error codes categorized across all payment providers.
 */
export type RawaPayErrorCode =
	| "SUCCESS"
	| "INVALID_REQUEST"
	| "INVALID_PARAMETER"
	| "INVALID_CREDENTIALS"
	| "INVALID_SIGNATURE"
	| "CARD_BLOCKED"
	| "ACCOUNT_INACTIVE"
	| "ACCOUNT_NOT_FOUND"
	| "DUPLICATE_REFERENCE"
	| "INVALID_TIMESTAMP"
	| "INSUFFICIENT_FUNDS"
	| "AUTHENTICATION_FAILED"
	| "TRANSACTION_EXPIRED"
	| "TRANSACTION_CANCELLED"
	| "PAYMENT_PENDING"
	| "LIMIT_EXCEEDED"
	| "PAYMENT_FAILED"
	| "PAYMENT_REJECTED"
	| "GATEWAY_ERROR"
	| "UNKNOWN_ERROR";

/**
 * Common payment parameters required across all drivers.
 */
export interface BasePaymentParams {
	/** Payment amount in PKR */
	amount: number;
	/** Unique merchant order reference (generated automatically if not provided) */
	billReference?: string;
	/** Short memo or note describing the order */
	description?: string;
}

/**
 * Interface that each provider driver must implement.
 */
export interface PaymentDriver<TPaymentParams = unknown> {
	/** Unique identifier for the provider driver (e.g. "jazzcash") */
	readonly name: string;

	/** Direct payment initiation */
	createPayment(params: TPaymentParams): Promise<Result<Payment, RawaPayError>>;
}

/**
 * Execution environment for payment providers and RawaPay.
 */
export type RawaPayEnvironment = "sandbox" | "production";
