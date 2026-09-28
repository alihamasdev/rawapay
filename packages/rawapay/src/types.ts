import type { ProviderOptions } from "@rawapay/core";
import type { EasyPaisaConfig, EasyPaisaMAParams } from "@rawapay/easypaisa";
import type { JazzCashConfig, JazzCashMWalletParams } from "@rawapay/jazzcash";

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
	/** Global provider options (environment, timeout) inherited by all configured providers */
	options?: ProviderOptions;
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
	/** Unified merchant order reference across providers */
	referenceId: string;
	/** Last 6 digits or full 13-digit CNIC (for JazzCash) */
	cnic?: string;
	description?: string;
	emailAddress?: string;
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
 * Options for checking a transaction status.
 */
export interface PaymentStatusOptions {
	/** Target provider: "jazzcash" | "easypaisa" */
	provider: "jazzcash" | "easypaisa" | (string & {});
	/** Unified reference ID for the transaction */
	referenceId: string;
	[key: string]: unknown;
}
