import { calculateSecureHash } from "@rawapay/jazzcash";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { RawaPay } from "./client";

describe("RawaPay Universal SDK Client", () => {
	const originalFetch = globalThis.fetch;
	const mockFetch = (fn: (url?: any, options?: any) => Promise<Response>) => {
		globalThis.fetch = fn as unknown as typeof fetch;
	};

	beforeEach(() => {
		// Reset fetch mock before each test
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("initializes RawaPay with JazzCash configuration and inherits default sandbox environment", () => {
		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		expect(pay.options.options?.environment).toBe("sandbox");
		expect(pay.jazzcash).toBeDefined();
		expect(pay.jazzcash?.config.options?.environment).toBe("sandbox");
		expect(pay.easypaisa).toBeDefined();
		expect(pay.easypaisa?.config.options?.environment).toBe("sandbox");
	});

	it("propagates top-level production environment to all providers", () => {
		const pay = new RawaPay({
			options: {
				environment: "production",
			},
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		expect(pay.options.options?.environment).toBe("production");
		expect(pay.jazzcash?.config.options?.environment).toBe("production");
		expect(pay.easypaisa?.config.options?.environment).toBe("production");
	});

	it("allows provider-level environment override", () => {
		const pay = new RawaPay({
			options: {
				environment: "production",
			},
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
					options: {
						environment: "sandbox",
					},
				},
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		expect(pay.options.options?.environment).toBe("production");
		expect(pay.jazzcash?.config.options?.environment).toBe("sandbox");
		expect(pay.easypaisa?.config.options?.environment).toBe("production");
	});

	it("returns an error if payment is attempted with an unconfigured provider", async () => {
		const pay = new RawaPay({
			providers: {},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 500,
			phone: "03001234567",
			cnic: "123456",
		});

		expect(data).toBeNull();
		expect(error).toBeDefined();
		expect(error?.code).toBe("INVALID_REQUEST");
		expect(error?.message).toContain("not configured");
	});

	it("validates input parameters before making an HTTP request", async () => {
		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		// 1. Invalid phone number
		const res1 = await pay.payment.create({
			provider: "jazzcash",
			amount: 500,
			phone: "invalid_phone",
			cnic: "123456",
		});
		expect(res1.data).toBeNull();
		expect(res1.error?.code).toBe("INVALID_PARAMETER");
		expect(res1.error?.message).toContain("Invalid Pakistani phone number");

		// 2. Invalid CNIC (too short)
		const res2 = await pay.payment.create({
			provider: "jazzcash",
			amount: 500,
			phone: "03001234567",
			cnic: "123",
		});
		expect(res2.data).toBeNull();
		expect(res2.error?.code).toBe("INVALID_PARAMETER");
		expect(res2.error?.message).toContain("Invalid CNIC");

		// 3. Invalid amount (zero/negative)
		const res3 = await pay.payment.create({
			provider: "jazzcash",
			amount: -100,
			phone: "03001234567",
			cnic: "123456",
		});
		expect(res3.data).toBeNull();
		expect(res3.error?.code).toBe("INVALID_PARAMETER");
	});

	it("successfully completes a mobile wallet payment (pp_ResponseCode: 000)", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "000",
					pp_ResponseMessage: "Transaction Successful",
					pp_TxnRefNo: "T2026092610123456",
					pp_Amount: "150000",
					pp_RetreivalReferenceNo: "62691234567",
					pp_BillReference: "BILL-TEST-1",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 1500,
			phone: "03001234567",
			cnic: "123456",
			description: "BILL-TEST-1",
		});

		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data?.id).toMatch(/^T\d+/);
		expect(data?.status).toBe("pending");
		expect(data?.amount).toBe(1500);
		expect(data?.rawAmount).toBe("150000");
		expect(data?.currency).toBe("PKR");
		expect(data?.description).toBe("BILL-TEST-1");
		expect(data?.retrievalRefNo).toBe("62691234567");
	});

	it("handles insufficient funds error (pp_ResponseCode: 119)", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "119",
					pp_ResponseMessage: "Customer account does not have sufficient balance",
					pp_TxnRefNo: "T998877",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 50000,
			phone: "03001234567",
			cnic: "123456",
		});

		expect(data).toBeNull();
		expect(error).toBeDefined();
		expect(error?.code).toBe("INSUFFICIENT_FUNDS");
		expect(error?.rawCode).toBe("119");
		expect(error?.isRetryable).toBeFalse();
	});

	it("handles wrong MPIN error (pp_ResponseCode: 120)", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "120",
					pp_ResponseMessage: "Invalid MPIN entered",
					pp_TxnRefNo: "T998877",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 1000,
			phone: "03001234567",
			cnic: "123456",
		});

		expect(data).toBeNull();
		expect(error?.code).toBe("AUTHENTICATION_FAILED");
		expect(error?.rawCode).toBe("120");
	});

	it("handles USSD timeout error (pp_ResponseCode: 122) as retryable", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "122",
					pp_ResponseMessage: "Transaction expired waiting for customer MPIN",
					pp_TxnRefNo: "T998877",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 1000,
			phone: "03001234567",
			cnic: "123456",
		});

		expect(data).toBeNull();
		expect(error?.code).toBe("TRANSACTION_EXPIRED");
		expect(error?.rawCode).toBe("122");
		expect(error?.isRetryable).toBeTrue();
	});

	it("successfully completes an EasyPaisa payment (responseCode: 0000)", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					responseCode: "0000",
					responseDesc: "SUCCESS",
					transactionId: "EP_TXN_9988",
					orderId: "ORDER-EP-101",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});

		const pay = new RawaPay({
			providers: {
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "easypaisa",
			amount: 850,
			phone: "03451234567",
			description: "ORDER-EP-101",
		});

		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data?.id).toMatch(/^T\d+/);
		expect(data?.status).toBe("succeeded");
		expect(data?.provider).toBe("easypaisa");
		expect(data?.amount).toBe(850);
		expect(data?.description).toBe("ORDER-EP-101");
	});

	it("handles EasyPaisa insufficient funds (responseCode: 0013)", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					responseCode: "0013",
					responseDesc: "LOW_BALANCE",
					orderId: "ORDER-EP-102",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});

		const pay = new RawaPay({
			providers: {
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "easypaisa",
			amount: 5000,
			phone: "03451234567",
		});

		expect(data).toBeNull();
		expect(error?.code).toBe("INSUFFICIENT_FUNDS");
		expect(error?.statusCode).toBe(402);
		expect(error?.rawCode).toBe("0013");
		expect(error?.provider).toBe("easypaisa");
		expect(error?.isRetryable).toBeFalse();
	});

	it("propagates options down to providers with per-provider override", () => {
		const pay = new RawaPay({
			options: {
				environment: "production",
				timeoutMs: 45000,
			},
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
				easypaisa: {
					storeId: "12345",
					options: {
						environment: "sandbox",
						timeoutMs: 15000,
					},
				},
			},
		});

		expect(pay.options.options?.environment).toBe("production");
		expect(pay.options.options?.timeoutMs).toBe(45000);
		expect(pay.jazzcash?.config.options?.environment).toBe("production");
		expect(pay.jazzcash?.config.options?.timeoutMs).toBe(45000);
		expect(pay.easypaisa?.config.options?.environment).toBe("sandbox");
		expect(pay.easypaisa?.config.options?.timeoutMs).toBe(15000);
	});

	it("requires CNIC for JazzCash when calling createPayment", async () => {
		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 1000,
			phone: "03001234567",
		});

		expect(data).toBeNull();
		expect(error?.code).toBe("INVALID_PARAMETER");
		expect(error?.message).toContain("customer CNIC");
	});

	it("generates unique transaction id and maps to pp_TxnRefNo & pp_BillReference in JazzCash and orderId in EasyPaisa", async () => {
		let capturedJazzCashBody: Record<string, unknown> = {};
		let capturedEasyPaisaBody: Record<string, unknown> = {};

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		// Test JazzCash ID generation & mapping
		mockFetch(async (_url, options) => {
			capturedJazzCashBody = JSON.parse(options?.body as string);
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "000",
					pp_ResponseMessage: "Transaction Successful",
					pp_TxnRefNo: capturedJazzCashBody.pp_TxnRefNo,
					pp_BillReference: capturedJazzCashBody.pp_BillReference,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const jcRes = await pay.payment.create({
			provider: "jazzcash",
			amount: 1000,
			phone: "03001234567",
			cnic: "123456",
			description: "ORDER-UNI-101",
		});

		expect(jcRes.error).toBeNull();
		expect(capturedJazzCashBody.pp_TxnRefNo).toMatch(/^T\d+/);
		expect(capturedJazzCashBody.pp_BillReference).toBe(capturedJazzCashBody.pp_TxnRefNo);
		expect(capturedJazzCashBody.pp_Description).toBe("ORDER-UNI-101");
		expect(jcRes.data?.id).toBe(capturedJazzCashBody.pp_TxnRefNo as string);
		expect(jcRes.data?.description).toBe("ORDER-UNI-101");

		// Test EasyPaisa ID generation & mapping
		mockFetch(async (_url, options) => {
			capturedEasyPaisaBody = JSON.parse(options?.body as string);
			return new Response(
				JSON.stringify({
					responseCode: "0000",
					responseDesc: "SUCCESS",
					orderId: capturedEasyPaisaBody.orderId,
					transactionId: "EP-9988",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const epRes = await pay.payment.create({
			provider: "easypaisa",
			amount: 500,
			phone: "03451234567",
			description: "ORDER-UNI-102",
		});

		expect(epRes.error).toBeNull();
		expect(capturedEasyPaisaBody.orderId).toMatch(/^T\d+/);
		expect(epRes.data?.id).toBe(capturedEasyPaisaBody.orderId as string);
		expect(epRes.data?.description).toBe("ORDER-UNI-102");
	});

	it("successfully checks JazzCash transaction status via pay.payment.status", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "000",
					pp_ResponseMessage: "Transaction Successful",
					pp_TxnRefNo: "T998877",
					pp_Amount: "250000",
					pp_Description: "ORDER-JC-202",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		const { data, error } = await pay.payment.status({
			provider: "jazzcash",
			paymentId: "T998877",
		});

		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data?.id).toBe("T998877");
		expect(data?.status).toBe("succeeded");
		expect(data?.amount).toBe(2500);
		expect(data?.description).toBe("ORDER-JC-202");
	});

	it("successfully checks EasyPaisa transaction status via pay.payment.status", async () => {
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					responseCode: "0000",
					responseDesc: "SUCCESS",
					transactionId: "EP-INQ-101",
					orderId: "ORDER-EP-303",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const pay = new RawaPay({
			providers: {
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		const { data, error } = await pay.payment.status({
			provider: "easypaisa",
			paymentId: "ORDER-EP-303",
		});

		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data?.id).toBe("ORDER-EP-303");
		expect(data?.status).toBe("succeeded");
	});

	it("treats JazzCash createPayment success (000, 121, 124) as pending customer authorization", async () => {
		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		// 1. Response Code 121 (Transaction Pending)
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "121",
					pp_ResponseMessage: "Transaction is pending customer action",
					pp_TxnRefNo: "T121000",
					pp_BillReference: "ORDER-PEND-1",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const res1 = await pay.payment.create({
			provider: "jazzcash",
			amount: 500,
			phone: "03001234567",
			cnic: "123456",
		});

		expect(res1.error).toBeNull();
		expect(res1.data?.status).toBe("pending");

		// 2. Response Code 124 (Waiting for customer authorization)
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "124",
					pp_ResponseMessage: "Waiting for customer MPIN input",
					pp_TxnRefNo: "T124000",
					pp_BillReference: "ORDER-PEND-2",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const res2 = await pay.payment.create({
			provider: "jazzcash",
			amount: 500,
			phone: "03001234567",
			cnic: "123456",
		});

		expect(res2.error).toBeNull();
		expect(res2.data?.status).toBe("pending");
	});

	it("payment.status maps 121 and 124 to pending, and 000 to succeeded", async () => {
		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
				},
			},
		});

		// 124 in status -> pending
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "124",
					pp_ResponseMessage: "Waiting for customer authorization",
					pp_TxnRefNo: "T-INQ-124",
					pp_BillReference: "ORDER-INQ-124",
					pp_Amount: "100000",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const inqPending = await pay.payment.status({
			provider: "jazzcash",
			paymentId: "T-INQ-124",
		});

		expect(inqPending.error).toBeNull();
		expect(inqPending.data?.status).toBe("pending");

		// 000 in status -> succeeded
		mockFetch(async () => {
			return new Response(
				JSON.stringify({
					pp_ResponseCode: "000",
					pp_ResponseMessage: "Transaction Successful",
					pp_TxnRefNo: "T-INQ-000",
					pp_BillReference: "ORDER-INQ-000",
					pp_Amount: "100000",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const inqSuccess = await pay.payment.status({
			provider: "jazzcash",
			paymentId: "T-INQ-000",
		});

		expect(inqSuccess.error).toBeNull();
		expect(inqSuccess.data?.status).toBe("succeeded");
	});

	it("verifies incoming callback signatures with pay.verifyCallback", () => {
		const salt = "merchant_secret_salt";
		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: salt,
				},
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		const validCallbackBody = {
			pp_ResponseCode: "000",
			pp_ResponseMessage: "Transaction Successful",
			pp_TxnRefNo: "T20260928001122",
			pp_Amount: "250000",
			pp_BillReference: "ORDER-CB-1",
			pp_RetreivalReferenceNo: "RRN-9988",
		};

		const validHash = calculateSecureHash(validCallbackBody, salt);
		const fullBody = {
			...validCallbackBody,
			pp_SecureHash: validHash,
		};

		// Authentic JazzCash callback returns true
		expect(pay.verifyCallback("jazzcash", fullBody)).toBeTrue();

		// Case-insensitivity support for pp_SecureHash
		expect(pay.verifyCallback("jazzcash", { ...fullBody, pp_SecureHash: validHash.toLowerCase() })).toBeTrue();

		// Tampered amount returns false
		expect(pay.verifyCallback("jazzcash", { ...fullBody, pp_Amount: "100000" })).toBeFalse();

		// Missing or empty pp_SecureHash returns false
		expect(pay.verifyCallback("jazzcash", validCallbackBody)).toBeFalse();
		expect(pay.verifyCallback("jazzcash", { ...validCallbackBody, pp_SecureHash: "" })).toBeFalse();

		// Unconfigured provider returns false safely
		const unconfiguredPay = new RawaPay({ providers: {} });
		expect(unconfiguredPay.verifyCallback("jazzcash", fullBody)).toBeFalse();

		// EasyPaisa returns false with documented inquiry verification pattern
		expect(pay.verifyCallback("easypaisa", { orderId: "ORDER-1" })).toBeFalse();
	});
});
