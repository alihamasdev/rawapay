import { type Payment, type PaymentDriver, type Result, RawaPayError, assertServerEnv, failure } from "@rawapay/core";
import { EasyPaisaDriver, type EasyPaisaConfig, type EasyPaisaMAParams } from "@rawapay/easypaisa";
import { JazzCashDriver, type JazzCashConfig, type JazzCashMWalletParams } from "@rawapay/jazzcash";

/**
 * Configuration options for RawaPay providers.
 */
export interface RawaPayProvidersConfig {
	/** Configuration for JazzCash Payment Gateway */
	jazzcash?: JazzCashConfig;
	/** Configuration for EasyPaisa Payment Gateway */
	easypaisa?: EasyPaisaConfig;
	[key: string]: unknown;
}

/**
 * RawaPay initialization options.
 */
export interface RawaPayOptions {
	/**
	 * Target environment for all configured payment providers.
	 * Can be overridden per-provider if needed.
	 * @default "sandbox"
	 */
	environment?: "sandbox" | "production";
	/** Dictionary of configured payment providers */
	providers: RawaPayProvidersConfig;
}

/**
 * Generic parameter object for dynamic or form-based checkout calls.
 */
export interface UniversalPaymentParams {
	provider: "jazzcash" | "easypaisa" | (string & {});
	amount: number;
	/** Customer's mobile phone number (03xxxxxxxxx) */
	phone: string;
	/** Last 6 digits of customer's CNIC (for JazzCash) */
	cnic?: string;
	description?: string;
	orderId?: string;
	emailAddress?: string;
	billReference?: string;
	[key: string]: unknown;
}

/**
 * Discriminated union of payment creation options.
 * Supports provider-specific typed params or universal dynamic form payloads.
 */
export type CreatePaymentOptions =
	| ({ provider: "jazzcash" } & JazzCashMWalletParams)
	| ({ provider: "easypaisa" } & EasyPaisaMAParams)
	| UniversalPaymentParams;

/**
 * RawaPay Universal Payment SDK client.
 */
export class RawaPay {
	readonly options: RawaPayOptions;
	readonly jazzcash?: JazzCashDriver;
	readonly easypaisa?: EasyPaisaDriver;
	private readonly drivers = new Map<string, PaymentDriver<any>>();

	constructor(options: RawaPayOptions) {
		assertServerEnv("RawaPay");

		if (!options || !options.providers) {
			throw new RawaPayError({
				code: "INVALID_REQUEST",
				message: "RawaPay requires a 'providers' configuration object.",
			});
		}

		const globalEnv = options.environment ?? "sandbox";

		this.options = {
			environment: globalEnv,
			...options,
		};

		// Initialize JazzCash if configured
		if (options.providers.jazzcash) {
			const jcConfig: JazzCashConfig = {
				environment: options.providers.jazzcash.environment ?? globalEnv,
				...options.providers.jazzcash,
			};
			this.jazzcash = new JazzCashDriver(jcConfig);
			this.drivers.set("jazzcash", this.jazzcash);
		}

		// Initialize EasyPaisa if configured
		if (options.providers.easypaisa) {
			const epConfig: EasyPaisaConfig = {
				environment: options.providers.easypaisa.environment ?? globalEnv,
				...options.providers.easypaisa,
			};
			this.easypaisa = new EasyPaisaDriver(epConfig);
			this.drivers.set("easypaisa", this.easypaisa);
		}
	}

	/**
	 * Returns the driver instance for a configured provider.
	 */
	getDriver<T = PaymentDriver<any>>(providerName: string): T | undefined {
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
	};
}
