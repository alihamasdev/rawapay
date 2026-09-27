import type { BasePaymentParams } from "@rawapay/core";

/**
 * Configuration options required to initialize the JazzCash driver.
 */
export interface JazzCashConfig {
	/** Assigned Merchant ID from JazzCash (pp_MerchantID) */
	merchantId?: string;
	/** Merchant API Password (pp_Password) */
	password?: string;
	/** Cryptographic Integrity Salt / Hash Key for HMAC-SHA256 (pp_IntegritySalt) */
	integritySalt?: string;
	/** Environment mode: "sandbox" for testing, "production" for live transactions. @default "sandbox" */
	environment?: "sandbox" | "production";
	/** Optional callback / return URL (pp_ReturnURL) */
	returnUrl?: string;
	/** Optional custom API version @default "2.0" */
	version?: string;
	/** Optional language @default "EN" */
	language?: string;
}

/**
 * Parameters for initiating a direct Mobile Wallet (MWALLET) payment.
 */
export interface JazzCashMWalletParams extends BasePaymentParams {
	/** Customer's JazzCash mobile phone number (e.g. "03001234567") */
	phone: string;
	/** Last 6 digits of customer's CNIC tied to the JazzCash mobile wallet (e.g. "123456") */
	cnic?: string;
	/** Optional custom transaction reference (pp_TxnRefNo). Generated automatically if omitted. */
	txnRefNo?: string;
	/** Optional custom transaction datetime in YYYYMMDDHHMMSS format */
	txnDateTime?: string;
	/** Optional custom expiry datetime in YYYYMMDDHHMMSS format */
	txnExpiryDateTime?: string;
}

/**
 * Raw JSON request payload sent to the JazzCash DoMWalletTransaction endpoint.
 */
export interface JazzCashRawMWalletRequest {
	pp_Version: string;
	pp_TxnType: string;
	pp_Language: string;
	pp_MerchantID: string;
	pp_Password: string;
	pp_TxnRefNo: string;
	pp_Amount: string;
	pp_TxnCurrency: string;
	pp_TxnDateTime: string;
	pp_BillReference: string;
	pp_Description: string;
	pp_TxnExpiryDateTime: string;
	pp_ReturnURL?: string;
	pp_SecureHash: string;
	pp_MobileNumber: string;
	pp_CNIC: string;
	[key: string]: unknown;
}

/**
 * Raw response structure returned by JazzCash API.
 */
export interface JazzCashRawResponse {
	pp_ResponseCode: string;
	pp_ResponseMessage: string;
	pp_TxnRefNo?: string;
	pp_Amount?: string;
	pp_TxnCurrency?: string;
	pp_TxnDateTime?: string;
	pp_BillReference?: string;
	pp_RetreivalReferenceNo?: string;
	pp_AuthCode?: string;
	pp_SecureHash?: string;
	pp_SettlementExpiry?: string;
	pp_BankID?: string;
	pp_ProductID?: string;
	[key: string]: unknown;
}
