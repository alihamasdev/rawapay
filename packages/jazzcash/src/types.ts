import type { BasePaymentParams, BaseProviderConfig, GetStatusParams } from "@rawapay/core";

/**
 * Configuration options required to initialize the JazzCash driver.
 */
export interface JazzCashConfig extends BaseProviderConfig {
	/** Assigned Merchant ID from JazzCash (pp_MerchantID) */
	merchantId: string;
	/** Merchant API Password (pp_Password) */
	password: string;
	/** Cryptographic Integrity Salt / Hash Key for HMAC-SHA256 (pp_IntegritySalt) */
	integritySalt: string;
}

/**
 * Parameters for initiating a direct Mobile Wallet (MWALLET) payment.
 */
export interface JazzCashMWalletParams extends BasePaymentParams {
	/** Customer's JazzCash mobile phone number (e.g. "03001234567") */
	phone: string;
	/** Last 6 digits of customer's CNIC or full 13-digit CNIC (e.g. "123456" or "42101-1234567-1") */
	cnic?: string;
}

/**
 * Parameters for checking the status of a JazzCash transaction.
 */
export interface JazzCashGetStatusParams extends GetStatusParams {}

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
