import type { RawaPayErrorCode, SuccessResult, ErrorResult } from "./types";

export interface RawaPayErrorOptions {
	code: RawaPayErrorCode;
	message: string;
	provider?: string;
	statusCode?: number;
	rawCode?: string;
	rawResponse?: unknown;
	isRetryable?: boolean;
}

/**
 * Standardized error class thrown or returned by RawaPay operations.
 */
export class RawaPayError extends Error {
	readonly code: RawaPayErrorCode;
	readonly provider: string;
	readonly statusCode: number;
	readonly rawCode?: string;
	readonly rawResponse?: unknown;
	readonly isRetryable: boolean;

	constructor(options: RawaPayErrorOptions) {
		super(options.message);
		this.name = "RawaPayError";
		this.code = options.code;
		this.provider = options.provider ?? "rawapay";
		this.statusCode = options.statusCode ?? 400;
		this.rawCode = options.rawCode;
		this.rawResponse = options.rawResponse;
		this.isRetryable = options.isRetryable ?? false;

		// Ensure 'message' is enumerable so JSON.stringify / NextResponse.json does not drop it
		Object.defineProperty(this, "message", {
			value: options.message,
			enumerable: true,
			writable: true,
			configurable: true,
		});

		Object.setPrototypeOf(this, RawaPayError.prototype);
	}

	/**
	 * Custom serializer ensuring all fields (including message and name) are preserved
	 * when serialized to JSON in API routes and loggers.
	 */
	toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			provider: this.provider,
			statusCode: this.statusCode,
			rawCode: this.rawCode,
			rawResponse: this.rawResponse,
			isRetryable: this.isRetryable,
		};
	}
}

export type SerializedRawaPayError = ReturnType<RawaPayError["toJSON"]>;

/**
 * Helper to construct a SuccessResult.
 */
export function success<T>(data: T): SuccessResult<T> {
	return { data, error: null };
}

/**
 * Helper to construct an ErrorResult.
 */
export function failure<E = RawaPayError>(error: E): ErrorResult<E> {
	return { data: null, error };
}
