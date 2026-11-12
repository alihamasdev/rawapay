import { describe, expect, it } from "bun:test";

import { RawaPay, createRawaPay } from "./client";
import { BasePaymentDriver } from "./driver";
import { success, type RawaPayError } from "./errors";
import type { CreatePaymentOptions, GetStatusParams, Payment, PaymentProviderFactory, Result } from "./types";

// Mock driver for testing pluggable architecture in core without external dependencies
class MockDriver extends BasePaymentDriver {
	readonly name: string;
	readonly baseUrls = {
		sandbox: "https://sandbox.mock.com",
		production: "https://api.mock.com",
	};
	lastCreatedParams?: unknown;
	lastStatusParams?: unknown;

	constructor(name = "mock") {
		super();
		this.name = name;
	}

	async createPayment(params: unknown): Promise<Result<Payment, RawaPayError>> {
		this.lastCreatedParams = params;
		const options = params as CreatePaymentOptions;
		return success({
			id: "PAY_12345",
			provider: this.name,
			status: "succeeded",
			amount: options.amount,
			currency: "PKR",
			responseCode: "000",
			responseMessage: "Success",
			raw: {},
			createdAt: new Date().toISOString(),
		});
	}

	async getStatus(params: GetStatusParams): Promise<Result<Payment, RawaPayError>> {
		this.lastStatusParams = params;
		return success({
			id: params.paymentId,
			provider: this.name,
			status: "succeeded",
			amount: 500,
			currency: "PKR",
			responseCode: "000",
			responseMessage: "Success",
			raw: {},
			createdAt: new Date().toISOString(),
		});
	}

	verifyCallback(body: Record<string, unknown>): boolean {
		return body.signed === true;
	}
}

describe("@rawapay/core - Pluggable Provider Architecture", () => {
	it("initializes RawaPay with an array of providers", () => {
		const mock1 = new MockDriver("jazzcash");
		const mock2 = new MockDriver("easypaisa");

		const pay = new RawaPay({
			providers: [mock1, mock2],
		});

		expect(pay.listDrivers()).toEqual(["jazzcash", "easypaisa"]);
		expect(pay.hasDriver("jazzcash")).toBe(true);
		expect(pay.hasDriver("easypaisa")).toBe(true);
		expect(pay.hasDriver("stripe")).toBe(false);
		expect(pay.getDriver("jazzcash")).toBe(mock1);
		expect(pay.getDriver("easypaisa")).toBe(mock2);
	});

	it("supports provider factory functions and registers created driver", () => {
		let factoryCalled = false;

		const mockFactory: PaymentProviderFactory = () => {
			factoryCalled = true;
			return new MockDriver("custom_wallet");
		};

		const pay = createRawaPay({
			environment: "production",
			timeoutMs: 15000,
			providers: [mockFactory],
		});

		expect(factoryCalled).toBe(true);
		expect(pay.hasDriver("custom_wallet")).toBe(true);
		expect(pay.getDriver<any>("custom_wallet")?.http.baseUrl).toBe("https://api.mock.com");
		expect(pay.getDriver<any>("custom_wallet")?.http.timeoutMs).toBe(15000);
	});

	it("automatically configures driver HttpClient with environment baseUrl and timeoutMs", () => {
		class UrlMockDriver extends MockDriver {
			readonly baseUrls = {
				sandbox: "https://sandbox.bank.com/api",
				production: "https://payments.bank.com/api",
			};
		}

		const driverSandbox = new UrlMockDriver("bank_sandbox");
		new RawaPay({
			environment: "sandbox",
			timeoutMs: 8000,
			providers: [driverSandbox],
		});
		expect(driverSandbox.http.baseUrl).toBe("https://sandbox.bank.com/api");
		expect(driverSandbox.http.timeoutMs).toBe(8000);

		const driverProd = new UrlMockDriver("bank_prod");
		new RawaPay({
			environment: "production",
			timeoutMs: 4000,
			providers: [driverProd],
		});
		expect(driverProd.http.baseUrl).toBe("https://payments.bank.com/api");
		expect(driverProd.http.timeoutMs).toBe(4000);
	});

	it("enforces server environment check in BasePaymentDriver constructor", () => {
		(globalThis as any).window = {};
		try {
			expect(() => new MockDriver()).toThrow(/cannot be initialized in browser/);
		} finally {
			delete (globalThis as any).window;
		}
	});

	it("initializes successfully with default empty providers when omitted", () => {
		const pay = new RawaPay();
		expect(pay.providers).toEqual([]);
		expect(pay.listDrivers()).toEqual([]);
	});

	it("throws descriptive error when invalid provider is passed in array", () => {
		expect(() => new RawaPay({ providers: ["invalid" as any] })).toThrow(/Invalid payment provider supplied/);
	});

	it("throws descriptive error when providers is not an array", () => {
		expect(() => new RawaPay({ providers: "invalid" as any })).toThrow(/requires a 'providers' configuration array/);
	});

	it("dispatches payment.create to the specified provider", async () => {
		const mock = new MockDriver("jazzcash");
		const pay = new RawaPay({
			providers: [mock],
		});

		const result = await pay.payment.create({
			provider: "jazzcash",
			amount: 1000,
			phone: "03001234567",
			description: "Test Order #101",
		});

		expect(result.error).toBeNull();
		expect(result.data?.id).toBe("PAY_12345");
		expect(result.data?.amount).toBe(1000);
		expect(result.data?.provider).toBe("jazzcash");
		expect(mock.lastCreatedParams).toEqual({
			provider: "jazzcash",
			amount: 1000,
			phone: "03001234567",
			description: "Test Order #101",
		});
	});

	it("returns a failure Result when provider is not registered", async () => {
		const mock = new MockDriver("jazzcash");
		const pay = new RawaPay({
			providers: [mock],
		});

		const result = await pay.payment.create({
			provider: "easypaisa",
			amount: 1000,
		});

		expect(result.data).toBeNull();
		expect(result.error?.code).toBe("INVALID_REQUEST");
		expect(result.error?.message).toContain("Provider 'easypaisa' is not configured");
		expect(result.error?.message).toContain("jazzcash");
	});

	it("dispatches payment.status to the specified provider", async () => {
		const mock = new MockDriver("easypaisa");
		const pay = new RawaPay({
			providers: [mock],
		});

		const result = await pay.payment.status({
			provider: "easypaisa",
			paymentId: "TXN_9999",
		});

		expect(result.error).toBeNull();
		expect(result.data?.id).toBe("TXN_9999");
		expect(mock.lastStatusParams).toEqual({
			provider: "easypaisa",
			paymentId: "TXN_9999",
		});
	});

	it("verifies callback via driver when driver supports verifyCallback", () => {
		const mock = new MockDriver("jazzcash");
		const pay = new RawaPay({
			providers: [mock],
		});

		expect(pay.verifyCallback("jazzcash", { signed: true })).toBe(true);
		expect(pay.verifyCallback("jazzcash", { signed: false })).toBe(false);
		expect(pay.verifyCallback("easypaisa", { signed: true })).toBe(false);
	});
});
