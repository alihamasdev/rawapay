import type { RawaPayErrorCode, SuccessResult, ErrorResult, Result } from "./types";

export interface RawaPayErrorOptions {
	code: RawaPayErrorCode;
	message: string;
	provider?: string;
	statusCode?: number;
	rawCode?: string;
	rawResponse?: unknown;
	isRetryable?: boolean;
	cause?: unknown;
}

/**
 * Standardized base error class thrown or returned by RawaPay operations.
 */
export class RawaPayError extends Error {
	readonly isRawaPayError = true as const;
	readonly code: RawaPayErrorCode;
	readonly provider: string;
	readonly statusCode: number;
	readonly rawCode?: string;
	readonly rawResponse?: unknown;
	readonly isRetryable: boolean;
	readonly cause?: unknown;

	constructor(options: RawaPayErrorOptions) {
		super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = "RawaPayError";
		this.code = options.code;
		this.provider = options.provider ?? "rawapay";
		this.statusCode = options.statusCode ?? 400;
		this.rawCode = options.rawCode;
		this.rawResponse = options.rawResponse;
		this.isRetryable = options.isRetryable ?? false;
		this.cause = options.cause;

		// Ensure 'message' is enumerable so JSON.stringify / NextResponse.json does not drop it
		Object.defineProperty(this, "message", {
			value: options.message,
			enumerable: true,
			writable: true,
			configurable: true,
		});

		Object.setPrototypeOf(this, new.target.prototype);
	}

	/**
	 * Static type guard to verify if any error or value is a RawaPayError.
	 * Bulletproof across bundler/package boundaries and separate @rawapay/core instances.
	 */
	static is(error: unknown): error is RawaPayError {
		return Boolean(error && typeof error === "object" && ("isRawaPayError" in error || error instanceof RawaPayError));
	}

	/**
	 * Custom serializer ensuring all fields (including message, name, and cause) are preserved
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
			...(this.cause !== undefined ? { cause: this.serializeCause(this.cause) } : {}),
		};
	}

	private serializeCause(cause: unknown): unknown {
		if (cause instanceof Error) {
			return {
				name: cause.name,
				message: cause.message,
				stack: cause.stack,
			};
		}
		return cause;
	}
}

export type SerializedRawaPayError = ReturnType<RawaPayError["toJSON"]>;

/**
 * Thrown or returned when parameter or schema validation fails before calling the gateway.
 */
export class RawaPayValidationError extends RawaPayError {
	constructor(options: Omit<RawaPayErrorOptions, "code"> & { code?: RawaPayErrorCode }) {
		super({
			...options,
			code: options.code ?? "INVALID_PARAMETER",
			statusCode: options.statusCode ?? 400,
		});
		this.name = "RawaPayValidationError";
		Object.setPrototypeOf(this, new.target.prototype);
	}

	static override is(error: unknown): error is RawaPayValidationError {
		return RawaPayError.is(error) && error.name === "RawaPayValidationError";
	}
}

/**
 * Thrown or returned on network transport failures, timeouts, connection drops, or gateway 5xx errors.
 */
export class RawaPayNetworkError extends RawaPayError {
	constructor(options: Omit<RawaPayErrorOptions, "code"> & { code?: RawaPayErrorCode }) {
		super({
			...options,
			code: options.code ?? "GATEWAY_ERROR",
			statusCode: options.statusCode ?? 502,
			isRetryable: options.isRetryable ?? true,
		});
		this.name = "RawaPayNetworkError";
		Object.setPrototypeOf(this, new.target.prototype);
	}

	static override is(error: unknown): error is RawaPayNetworkError {
		return RawaPayError.is(error) && error.name === "RawaPayNetworkError";
	}
}

/**
 * Thrown or returned when merchant credentials or cryptographic signatures fail.
 */
export class RawaPayAuthenticationError extends RawaPayError {
	constructor(options: Omit<RawaPayErrorOptions, "code"> & { code?: RawaPayErrorCode }) {
		super({
			...options,
			code: options.code ?? "AUTHENTICATION_FAILED",
			statusCode: options.statusCode ?? 401,
		});
		this.name = "RawaPayAuthenticationError";
		Object.setPrototypeOf(this, new.target.prototype);
	}

	static override is(error: unknown): error is RawaPayAuthenticationError {
		return RawaPayError.is(error) && error.name === "RawaPayAuthenticationError";
	}
}

/**
 * Thrown or returned when a gateway or wallet rejects a transaction (e.g. insufficient funds, expired MPIN, limit exceeded).
 */
export class RawaPayTransactionError extends RawaPayError {
	constructor(options: RawaPayErrorOptions) {
		super(options);
		this.name = "RawaPayTransactionError";
		Object.setPrototypeOf(this, new.target.prototype);
	}

	static override is(error: unknown): error is RawaPayTransactionError {
		return RawaPayError.is(error) && error.name === "RawaPayTransactionError";
	}
}

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

/**
 * Unwraps a Result, returning the value if successful or throwing the error.
 * Gives developers who prefer traditional try/catch or throwing async/await
 * a concise one-line syntax:
 *
 * @example
 * const payment = unwrap(await pay.payment.create(...));
 */
export function unwrap<T, E extends Error = RawaPayError>(result: Result<T, E>): T {
	if (isError(result)) {
		throw result.error;
	}
	return result.data;
}

/**
 * Unwraps a Result, returning the value if successful or fallback value if it failed.
 *
 * @example
 * const payment = unwrapOr(await pay.payment.status(...), defaultPayment);
 */
export function unwrapOr<T, E = RawaPayError>(result: Result<T, E>, fallback: T): T {
	if (isError(result)) {
		return fallback;
	}
	return result.data;
}

/**
 * Type guard to check if a Result is a SuccessResult.
 */
export function isSuccess<T, E>(result: Result<T, E>): result is SuccessResult<T> {
	return result.error === null;
}

/**
 * Type guard to check if a Result is an ErrorResult.
 */
export function isError<T, E>(result: Result<T, E>): result is ErrorResult<E> {
	return result.error !== null;
}
