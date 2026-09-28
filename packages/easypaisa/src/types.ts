import type { BasePaymentParams, BaseProviderConfig, GetStatusParams } from "@rawapay/core";

/**
 * Configuration options required to initialize the EasyPaisa driver.
 */
export interface EasyPaisaConfig extends BaseProviderConfig {
	/** Assigned Store ID from EasyPaisa Merchant Portal */
	storeId: string;
	/** Optional API Username (used for Basic Auth if required) */
	username?: string;
	/** Optional API Password */
	password?: string;
	/** Optional Hash Key for message integrity verification */
	hashKey?: string;
}

/**
 * Parameters for initiating an EasyPaisa Mobile Account (MA) direct payment.
 * Notice: Unlike JazzCash, EasyPaisa does NOT require customer CNIC digits!
 */
export interface EasyPaisaMAParams extends BasePaymentParams {
	/** Customer's EasyPaisa mobile phone number (03xxxxxxxxx) */
	phone: string;
}

/**
 * Parameters for checking the status of an EasyPaisa transaction.
 */
export interface EasyPaisaGetStatusParams extends GetStatusParams {}

/**
 * Raw JSON request payload sent to the EasyPaisa Direct Pay API.
 */
export interface EasyPaisaRawMARequest {
	orderId: string;
	storeId: string;
	transactionAmount: string;
	transactionType: "MA";
	mobileAccountNo: string;
	[key: string]: unknown;
}

/**
 * Raw JSON response payload returned by EasyPaisa API.
 */
export interface EasyPaisaRawResponse {
	orderId?: string;
	storeId?: string;
	responseCode?: string;
	responseDesc?: string;
	transactionId?: string;
	transactionDateTime?: string;
	paymentToken?: string;
	[key: string]: unknown;
}
