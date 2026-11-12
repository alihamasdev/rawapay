import { assertServerEnv } from "./assert-server";
import { DEFAULT_PAYMENT_ENVIRONMENT, DEFAULT_TIMEOUT_MS } from "./constants";
import { RawaPayError, RawaPayValidationError, failure } from "./errors";
import { HttpClient } from "./http";
import type {
	CreatePaymentOptions,
	ExtractProviderNames,
	Payment,
	PaymentDriver,
	PaymentEnvironment,
	PaymentProvider,
	PaymentStatusOptions,
	RawaPayOptions,
	Result,
} from "./types";

/**
 * RawaPay Universal Payment SDK client.
 * Serves as the central orchestrator where payment providers are dynamically registered.
 */
export class RawaPay<
	const TProviders extends readonly PaymentProvider[] = readonly PaymentProvider[],
	TProviderName extends string = ExtractProviderNames<TProviders>,
> {
	readonly environment: PaymentEnvironment;
	readonly timeoutMs: number;
	readonly providers: TProviders;
	readonly httpClient: HttpClient;

	private readonly drivers = new Map<string, PaymentDriver<any, any>>();

	constructor(options: RawaPayOptions<TProviders> = {} as RawaPayOptions<TProviders>) {
		assertServerEnv("RawaPay");

		if (options.providers !== undefined && !Array.isArray(options.providers)) {
			throw new RawaPayError({
				code: "INVALID_REQUEST",
				message: "RawaPay requires a 'providers' configuration array.",
			});
		}

		this.environment = options.environment ?? DEFAULT_PAYMENT_ENVIRONMENT;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.providers = (options.providers ?? []) as unknown as TProviders;
		this.httpClient =
			options.httpClient ??
			new HttpClient({
				timeoutMs: this.timeoutMs,
				fetch: options.fetch,
			});

		for (const item of this.providers as readonly PaymentProvider[]) {
			const driver = typeof item === "function" ? item() : item;

			if (!driver || typeof driver !== "object" || !("name" in driver) || !("baseUrls" in driver)) {
				throw new RawaPayError({
					code: "INVALID_REQUEST",
					message: "Invalid payment provider supplied. Each provider must extend BasePaymentDriver or implement PaymentDriver.",
				});
			}

			// Scope an HttpClient with the driver's environment baseUrl and SDK timeout
			const driverHttpClient = this.httpClient.clone({
				baseUrl: driver.baseUrls[this.environment] ?? driver.baseUrls.sandbox,
				timeoutMs: this.timeoutMs,
			});

			// Inject scoped HTTP client directly into driver
			driver.http = driverHttpClient;

			this.drivers.set(driver.name, driver);
		}
	}

	/**
	 * Returns the driver instance for a configured provider.
	 */
	getDriver<T = PaymentDriver<any, any>>(providerName: TProviderName | (string & {})): T | undefined {
		return this.drivers.get(providerName) as T | undefined;
	}

	/**
	 * Checks if a provider driver is registered.
	 */
	hasDriver(providerName: TProviderName | (string & {})): boolean {
		return this.drivers.has(providerName);
	}

	/**
	 * Lists all registered provider names.
	 */
	listDrivers(): string[] {
		return Array.from(this.drivers.keys());
	}

	/**
	 * Payment API operations namespace.
	 */
	readonly payment = {
		/**
		 * Initiates a payment transaction using the specified provider.
		 * Automatically routes to the configured provider driver.
		 * Returns a safe Result ({ data, error }).
		 */
		create: async (options: CreatePaymentOptions<TProviderName>): Promise<Result<Payment, RawaPayError>> => {
			const providerName = options?.provider;
			const driver = this.drivers.get(providerName);

			if (!driver) {
				const available = this.listDrivers().join(", ") || "none";
				return failure(
					new RawaPayValidationError({
						code: "INVALID_REQUEST",
						message: `Provider '${providerName}' is not configured in RawaPay. Configured providers: [${available}].`,
						provider: providerName,
						statusCode: 400,
					}),
				);
			}

			try {
				return await driver.createPayment(options);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `Unexpected error executing payment with ${providerName}: ${message}`,
						provider: providerName,
						statusCode: 500,
						isRetryable: true,
						cause: err,
					}),
				);
			}
		},

		/**
		 * Checks the status of an existing transaction using the specified provider.
		 * Automatically routes to the configured provider driver's `getStatus`.
		 * Returns a safe Result ({ data, error }).
		 */
		status: async (options: PaymentStatusOptions<TProviderName>): Promise<Result<Payment, RawaPayError>> => {
			const providerName = options?.provider;
			const driver = this.drivers.get(providerName);

			if (!driver) {
				const available = this.listDrivers().join(", ") || "none";
				return failure(
					new RawaPayValidationError({
						code: "INVALID_REQUEST",
						message: `Provider '${providerName}' is not configured in RawaPay. Configured providers: [${available}].`,
						provider: providerName,
						statusCode: 400,
					}),
				);
			}

			try {
				return await driver.getStatus(options);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return failure(
					new RawaPayError({
						code: "GATEWAY_ERROR",
						message: `Unexpected error checking status with ${providerName}: ${message}`,
						provider: providerName,
						statusCode: 500,
						isRetryable: true,
						cause: err,
					}),
				);
			}
		},
	};

	/**
	 * Verifies an incoming IPN / webhook callback payload from a payment provider.
	 * Keeps signature verification server-side without exposing merchant secrets.
	 *
	 * @param provider "jazzcash" | "easypaisa" | string
	 * @param body Callback request body payload
	 * @returns boolean true if signature is valid, false if invalid, unconfigured, or unsupported
	 */
	verifyCallback(provider: TProviderName | (string & {}), body: Record<string, unknown>): boolean {
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

/**
 * Functional factory helper for initializing RawaPay.
 */
export function createRawaPay<const TProviders extends readonly PaymentProvider[] = readonly PaymentProvider[]>(
	options: RawaPayOptions<TProviders> = {} as RawaPayOptions<TProviders>,
): RawaPay<TProviders> {
	return new RawaPay(options);
}
