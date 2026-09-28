import {
	type Payment,
	type PaymentDriver,
	type Result,
	RawaPayError,
	assertServerEnv,
	failure,
	DEFAULT_PAYMENT_ENVIRONMENT,
	DEFAULT_TIMEOUT_MS,
} from "@rawapay/core";
import { EasyPaisaDriver, type EasyPaisaConfig } from "@rawapay/easypaisa";
import { JazzCashDriver, type JazzCashConfig } from "@rawapay/jazzcash";

import type { CreatePaymentOptions, PaymentStatusOptions, RawaPayOptions } from "./types";

/**
 * RawaPay Universal Payment SDK client.
 */
export class RawaPay {
	readonly options: RawaPayOptions;
	readonly jazzcash?: JazzCashDriver;
	readonly easypaisa?: EasyPaisaDriver;
	private readonly drivers = new Map<string, PaymentDriver<any, any>>();

	constructor(options: RawaPayOptions) {
		assertServerEnv("RawaPay");

		if (!options || !options.providers) {
			throw new RawaPayError({
				code: "INVALID_REQUEST",
				message: "RawaPay requires a 'providers' configuration object.",
			});
		}

		const globalEnv = options.options?.environment ?? DEFAULT_PAYMENT_ENVIRONMENT;
		const globalTimeout = options.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		this.options = {
			...options,
			options: {
				environment: globalEnv,
				timeoutMs: globalTimeout,
			},
		};

		// Initialize JazzCash if configured
		if (options.providers.jazzcash) {
			const jcConfig: JazzCashConfig = {
				...options.providers.jazzcash,
				options: {
					environment: options.providers.jazzcash.options?.environment ?? globalEnv,
					timeoutMs: options.providers.jazzcash.options?.timeoutMs ?? globalTimeout,
				},
			};
			this.jazzcash = new JazzCashDriver(jcConfig);
			this.drivers.set("jazzcash", this.jazzcash);
		}

		// Initialize EasyPaisa if configured
		if (options.providers.easypaisa) {
			const epConfig: EasyPaisaConfig = {
				...options.providers.easypaisa,
				options: {
					environment: options.providers.easypaisa.options?.environment ?? globalEnv,
					timeoutMs: options.providers.easypaisa.options?.timeoutMs ?? globalTimeout,
				},
			};
			this.easypaisa = new EasyPaisaDriver(epConfig);
			this.drivers.set("easypaisa", this.easypaisa);
		}
	}

	/**
	 * Returns the driver instance for a configured provider.
	 */
	getDriver<T = PaymentDriver<any, any>>(providerName: string): T | undefined {
		return this.drivers.get(providerName) as T | undefined;
	}

	/**
	 * Payment API operations namespace.
	 */
	readonly payment = {
		/**
		 * Initiates a payment transaction using the specified provider.
		 * Automatically routes to the configured provider driver without requiring manual `if` branching.
		 * Returns a safe Result ({ data, error }).
		 */
		create: async (options: CreatePaymentOptions): Promise<Result<Payment, RawaPayError>> => {
			const providerName = options?.provider;
			const driver = this.drivers.get(providerName);

			if (!driver) {
				const available = Array.from(this.drivers.keys()).join(", ") || "none";
				return failure(
					new RawaPayError({
						code: "INVALID_REQUEST",
						message: `Provider '${providerName}' is not configured in RawaPay. Configured providers: [${available}].`,
						provider: providerName,
						statusCode: 400,
					}),
				);
			}

			try {
				return await driver.createPayment(options as any);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `Unexpected error executing payment with ${providerName}: ${message}`,
						provider: providerName,
						statusCode: 500,
						isRetryable: true,
					}),
				);
			}
		},

		/**
		 * Checks the status of an existing transaction using the specified provider.
		 * Automatically routes to the configured provider driver's `getStatus`.
		 * Returns a safe Result ({ data, error }).
		 */
		status: async (options: PaymentStatusOptions): Promise<Result<Payment, RawaPayError>> => {
			const providerName = options?.provider;
			const driver = this.drivers.get(providerName);

			if (!driver) {
				const available = Array.from(this.drivers.keys()).join(", ") || "none";
				return failure(
					new RawaPayError({
						code: "INVALID_REQUEST",
						message: `Provider '${providerName}' is not configured in RawaPay. Configured providers: [${available}].`,
						provider: providerName,
						statusCode: 400,
					}),
				);
			}

			try {
				return await driver.getStatus(options as any);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `Unexpected error checking status with ${providerName}: ${message}`,
						provider: providerName,
						statusCode: 500,
						isRetryable: true,
					}),
				);
			}
		},
	};

	/**
	 * Verifies an incoming IPN / webhook callback payload from a payment provider.
	 * Keeps signature verification server-side without exposing merchant secrets.
	 *
	 * Recommended merchant workflow:
	 * 1. Initiate payment: `await pay.payment.create(...)` (JazzCash MWALLET returns status: "pending")
	 * 2. Customer authorizes transaction via USSD / MPIN prompt on mobile handset
	 * 3. Gateway POSTs transaction result to merchant callback / webhook URL
	 * 4. Verify authenticity: `if (!pay.verifyCallback("jazzcash", body)) return 400;`
	 * 5. Confirm status: optionally call `await pay.payment.status(...)` before order fulfillment
	 *
	 * @param provider "jazzcash" | "easypaisa"
	 * @param body Callback request body payload
	 * @returns boolean true if signature is valid, false if invalid, unconfigured, or unsupported
	 */
	verifyCallback(provider: "jazzcash" | "easypaisa", body: Record<string, unknown>): boolean {
		const driver = this.drivers.get(provider);
		if (!driver || !driver.verifyCallback) {
			return false;
		}
		try {
			return driver.verifyCallback(body);
		} catch {
			return false;
		}
	}
}
