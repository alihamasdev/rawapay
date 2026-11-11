import { describe, expect, it } from "bun:test";

import { RawaPay, createRawaPay } from "./client";
import { success, type RawaPayError } from "./errors";
import type {
	CreatePaymentOptions,
	GetStatusParams,
	Payment,
	PaymentDriver,
	PaymentProviderFactory,
	ProviderInitContext,
	Result,
} from "./types";

// Mock driver for testing pluggable architecture in core without external dependencies
class MockDriver implements PaymentDriver {
	readonly name: string;
	lastCreatedParams?: unknown;
	lastStatusParams?: unknown;
	initContext?: ProviderInitContext;

	constructor(name = "mock") {
		this.name = name;
	}

	init(context: ProviderInitContext): void {
		this.initContext = context;
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

	it("supports provider factory functions and propagates global options", () => {
		let factoryCalledWith: ProviderInitContext | undefined;

		const mockFactory: PaymentProviderFactory = (context) => {
			factoryCalledWith = context;
			const driver = new MockDriver("custom_wallet");
			return driver;
		};

		const pay = createRawaPay({
			environment: "production",
			timeoutMs: 15000,
			providers: [mockFactory],
		});

		expect(factoryCalledWith?.environment).toBe("production");
		expect(factoryCalledWith?.timeoutMs).toBe(15000);
		expect(pay.hasDriver("custom_wallet")).toBe(true);
	});

	it("calls init lifecycle hook on provider driver instances", () => {
		const driver = new MockDriver("test_wallet");

		new RawaPay({
			environment: "production",
			timeoutMs: 45000,
			providers: [driver],
		});

		expect(driver.initContext?.environment).toBe("production");
		expect(driver.initContext?.timeoutMs).toBe(45000);
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
