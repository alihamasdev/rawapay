import { assertServerEnv } from "./assert-server";
import type { RawaPayError } from "./errors";
import type { HttpClient } from "./http";
import type { DriverBaseUrls, GetStatusParams, Payment, PaymentDriver, Result } from "./types";

/**
 * Base abstract class that every payment driver extends.
 * Automatically enforces server-only runtime execution in its constructor
 * and exposes a managed HttpClient injected by RawaPay core.
 */
export abstract class BasePaymentDriver<
	TPaymentParams = unknown,
	TStatusParams = GetStatusParams,
	TName extends string = string,
> implements PaymentDriver<TPaymentParams, TStatusParams, TName> {
	/** Unique provider identifier (e.g. "jazzcash", "easypaisa") */
	abstract readonly name: TName;

	/** Gateway base URLs strictly mapped to sandbox and production */
	abstract readonly baseUrls: DriverBaseUrls;

	/**
	 * Managed HTTP client automatically injected by RawaPay core upon registration.
	 * Pre-configured with the merchant's environment, timeouts, and retries.
	 */
	http!: HttpClient;

	constructor() {
		assertServerEnv(this.constructor.name);
	}

	/** Direct payment initiation */
	abstract createPayment(params: TPaymentParams): Promise<Result<Payment, RawaPayError>>;

	/** Checks status for a previously initiated transaction */
	abstract getStatus(params: TStatusParams): Promise<Result<Payment, RawaPayError>>;

	/** Verifies the cryptographic signature / integrity of an incoming IPN callback */
	verifyCallback?(body: Record<string, unknown>): boolean;
}
