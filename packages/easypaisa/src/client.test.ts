import { describe, expect, it } from "bun:test";

import { EasyPaisaDriver } from "./client";
import { mapEasyPaisaError } from "./errors";

describe("EasyPaisa Driver & Error Mapping", () => {
	it("fails initialization if storeId is missing", () => {
		expect(() => {
			new EasyPaisaDriver({
				storeId: "",
				options: {
					environment: "sandbox",
				},
			});
		}).toThrow();
	});

	it("maps 0013 to INSUFFICIENT_FUNDS with 402 status code and isRetryable false", () => {
		const err = mapEasyPaisaError({
			responseCode: "0013",
			responseDesc: "LOW_BALANCE",
		});

		expect(err.code).toBe("INSUFFICIENT_FUNDS");
		expect(err.statusCode).toBe(402);
		expect(err.rawCode).toBe("0013");
		expect(err.isRetryable).toBe(false);
		expect(err.message).toContain("low or insufficient balance");
	});

	it("maps 0014 to ACCOUNT_NOT_FOUND with 404 status code", () => {
		const err = mapEasyPaisaError({
			responseCode: "0014",
			responseDesc: "ACCOUNT_NOT_FOUND",
		});

		expect(err.code).toBe("ACCOUNT_NOT_FOUND");
		expect(err.statusCode).toBe(404);
		expect(err.rawCode).toBe("0014");
		expect(err.isRetryable).toBe(false);
	});

	it("maps 0001 to GATEWAY_ERROR with 502 status code and isRetryable true", () => {
		const err = mapEasyPaisaError({
			responseCode: "0001",
			responseDesc: "SYSTEM_TIMEOUT",
		});

		expect(err.code).toBe("GATEWAY_ERROR");
		expect(err.statusCode).toBe(502);
		expect(err.isRetryable).toBe(true);
	});

	it("serializes cleanly with toJSON including enumerable message and rawCode", () => {
		const err = mapEasyPaisaError({
			responseCode: "0010",
			responseDesc: "INVALID_CREDENTIALS",
		});

		const json = JSON.parse(JSON.stringify(err));
		expect(json.code).toBe("INVALID_CREDENTIALS");
		expect(json.rawCode).toBe("0010");
		expect(json.provider).toBe("easypaisa");
		expect(json.message).toBeDefined();
		expect(json.isRetryable).toBe(false);
	});

	it("validates phone number format before dispatching network request", async () => {
		const driver = new EasyPaisaDriver({
			storeId: "12345",
			options: {
				environment: "sandbox",
			},
		});

		const res = await driver.createPayment({
			amount: 100,
			phone: "invalid_phone",
		});

		expect(res.error).toBeDefined();
		expect(res.error?.code).toBe("INVALID_PARAMETER");
	});
});
