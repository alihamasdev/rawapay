import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { RawaPay } from "./client";

describe("RawaPay Universal SDK Client", () => {
	const originalFetch = globalThis.fetch;

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

		expect(pay.options.environment).toBe("sandbox");
		expect(pay.jazzcash).toBeDefined();
		expect(pay.jazzcash?.config.environment).toBe("sandbox");
		expect(pay.easypaisa).toBeDefined();
		expect(pay.easypaisa?.config.environment).toBe("sandbox");
	});

	it("propagates top-level production environment to all providers", () => {
		const pay = new RawaPay({
			environment: "production",
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

		expect(pay.options.environment).toBe("production");
		expect(pay.jazzcash?.config.environment).toBe("production");
		expect(pay.easypaisa?.config.environment).toBe("production");
	});

	it("allows provider-level environment override", () => {
		const pay = new RawaPay({
			environment: "production",
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
					environment: "sandbox",
				},
				easypaisa: {
					storeId: "12345",
				},
			},
		});

		expect(pay.options.environment).toBe("production");
		expect(pay.jazzcash?.config.environment).toBe("sandbox");
		expect(pay.easypaisa?.config.environment).toBe("production");
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
					environment: "sandbox",
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
		globalThis.fetch = async () => {
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
		};

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
					environment: "sandbox",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "jazzcash",
			amount: 1500,
			phone: "03001234567",
			cnic: "123456",
			billReference: "BILL-TEST-1",
		});

		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data?.id).toBe("T2026092610123456");
		expect(data?.status).toBe("succeeded");
		expect(data?.amount).toBe(1500);
		expect(data?.ppAmount).toBe("150000");
		expect(data?.currency).toBe("PKR");
		expect(data?.retrievalRefNo).toBe("62691234567");
	});

	it("handles insufficient funds error (pp_ResponseCode: 119)", async () => {
		globalThis.fetch = async () => {
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
		};

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
					environment: "sandbox",
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
		globalThis.fetch = async () => {
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
		};

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
					environment: "sandbox",
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
		globalThis.fetch = async () => {
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
		};

		const pay = new RawaPay({
			providers: {
				jazzcash: {
					merchantId: "MC12345",
					password: "test_password",
					integritySalt: "test_salt",
					environment: "sandbox",
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
		globalThis.fetch = async () => {
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
		};

		const pay = new RawaPay({
			providers: {
				easypaisa: {
					storeId: "12345",
					environment: "sandbox",
				},
			},
		});

		const { data, error } = await pay.payment.create({
			provider: "easypaisa",
			amount: 850,
			phone: "03451234567",
			orderId: "ORDER-EP-101",
		});

		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data?.id).toBe("EP_TXN_9988");
		expect(data?.status).toBe("succeeded");
		expect(data?.provider).toBe("easypaisa");
		expect(data?.amount).toBe(850);
	});

	it("handles EasyPaisa insufficient funds (responseCode: 0013)", async () => {
		globalThis.fetch = async () => {
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
		};

		const pay = new RawaPay({
			providers: {
				easypaisa: {
					storeId: "12345",
					environment: "sandbox",
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
});
