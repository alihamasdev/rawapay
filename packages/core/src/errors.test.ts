import { describe, expect, it } from "bun:test";

import {
	RawaPayAuthenticationError,
	RawaPayError,
	RawaPayNetworkError,
	RawaPayTransactionError,
	RawaPayValidationError,
	failure,
	isError,
	isSuccess,
	success,
	unwrap,
	unwrapOr,
} from "./errors";
import { HttpClient } from "./http";

describe("Error Hierarchy & Developer Ergonomics", () => {
	describe("RawaPayError and Error.cause Chaining", () => {
		it("chains original root errors via cause property and Error.cause", () => {
			const rootCause = new TypeError("Connection terminated unexpectedly");
			const error = new RawaPayError({
				code: "GATEWAY_ERROR",
				message: "Failed to communicate with payment gateway",
				statusCode: 502,
				cause: rootCause,
			});

			expect(error.cause).toBe(rootCause);
			// Standard ES2022 Error.cause check
			expect((error as any).cause).toBe(rootCause);
			expect(error.message).toBe("Failed to communicate with payment gateway");
			expect(error.isRawaPayError).toBe(true);
		});

		it("serializes cause cleanly in toJSON()", () => {
			const rootCause = new Error("DNS resolution failed");
			const error = new RawaPayError({
				code: "GATEWAY_ERROR",
				message: "Network unreachable",
				cause: rootCause,
			});

			const json = error.toJSON();
			expect(json.name).toBe("RawaPayError");
			expect(json.code).toBe("GATEWAY_ERROR");
			expect(json.message).toBe("Network unreachable");
			expect((json as any).cause).toEqual({
				name: "Error",
				message: "DNS resolution failed",
				stack: rootCause.stack,
			});
		});

		it("handles non-Error objects as cause in toJSON()", () => {
			const error = new RawaPayError({
				code: "INVALID_REQUEST",
				message: "Bad request payload",
				cause: { reason: "timeout", attempt: 3 },
			});

			const json = error.toJSON();
			expect((json as any).cause).toEqual({ reason: "timeout", attempt: 3 });
		});
	});

	describe("Runtime Type Guard (RawaPayError.is)", () => {
		it("identifies direct RawaPayError instances", () => {
			const err = new RawaPayError({ code: "INVALID_REQUEST", message: "Invalid" });
			expect(RawaPayError.is(err)).toBe(true);
		});

		it("identifies specialized error subclasses", () => {
			const valErr = new RawaPayValidationError({ message: "Bad phone" });
			const netErr = new RawaPayNetworkError({ message: "Timeout" });
			const authErr = new RawaPayAuthenticationError({ message: "Invalid credentials" });
			const txnErr = new RawaPayTransactionError({ code: "INSUFFICIENT_FUNDS", message: "Low balance" });

			expect(RawaPayError.is(valErr)).toBe(true);
			expect(RawaPayError.is(netErr)).toBe(true);
			expect(RawaPayError.is(authErr)).toBe(true);
			expect(RawaPayError.is(txnErr)).toBe(true);
		});

		it("identifies cross-boundary duck-typed objects with isRawaPayError discriminator", () => {
			// Simulates an error thrown across package/bundler boundaries where instanceof is false
			const crossBoundaryError = {
				isRawaPayError: true,
				name: "RawaPayError",
				code: "GATEWAY_ERROR",
				message: "Cross-boundary failure",
			};

			expect(RawaPayError.is(crossBoundaryError)).toBe(true);
		});

		it("returns false for non-RawaPay errors and primitives", () => {
			expect(RawaPayError.is(new Error("Standard error"))).toBe(false);
			expect(RawaPayError.is(new TypeError("Type error"))).toBe(false);
			expect(RawaPayError.is(null)).toBe(false);
			expect(RawaPayError.is(undefined)).toBe(false);
			expect(RawaPayError.is("Error string")).toBe(false);
			expect(RawaPayError.is({ message: "Custom object" })).toBe(false);
		});

		it("discriminates specific error types via subclass static guards", () => {
			const valErr = new RawaPayValidationError({ message: "Bad phone" });
			const netErr = new RawaPayNetworkError({ message: "Timeout" });

			expect(RawaPayValidationError.is(valErr)).toBe(true);
			expect(RawaPayValidationError.is(netErr)).toBe(false);

			expect(RawaPayNetworkError.is(netErr)).toBe(true);
			expect(RawaPayNetworkError.is(valErr)).toBe(false);
		});
	});

	describe("Domain Error Subclass Hierarchy", () => {
		it("RawaPayValidationError defaults to INVALID_PARAMETER and status 400", () => {
			const err = new RawaPayValidationError({ message: "Phone number required" });
			expect(err.name).toBe("RawaPayValidationError");
			expect(err.code).toBe("INVALID_PARAMETER");
			expect(err.statusCode).toBe(400);
			expect(err.isRetryable).toBe(false);
			expect(err instanceof RawaPayError).toBe(true);
		});

		it("RawaPayNetworkError defaults to GATEWAY_ERROR, status 502, and retryable", () => {
			const err = new RawaPayNetworkError({ message: "Connection reset by peer" });
			expect(err.name).toBe("RawaPayNetworkError");
			expect(err.code).toBe("GATEWAY_ERROR");
			expect(err.statusCode).toBe(502);
			expect(err.isRetryable).toBe(true);
			expect(err instanceof RawaPayError).toBe(true);
		});

		it("RawaPayAuthenticationError defaults to AUTHENTICATION_FAILED and status 401", () => {
			const err = new RawaPayAuthenticationError({ message: "Invalid merchant hash" });
			expect(err.name).toBe("RawaPayAuthenticationError");
			expect(err.code).toBe("AUTHENTICATION_FAILED");
			expect(err.statusCode).toBe(401);
			expect(err.isRetryable).toBe(false);
			expect(err instanceof RawaPayError).toBe(true);
		});

		it("RawaPayTransactionError retains gateway specifics", () => {
			const err = new RawaPayTransactionError({
				code: "INSUFFICIENT_FUNDS",
				message: "Balance below transaction amount",
				statusCode: 402,
				provider: "jazzcash",
				rawCode: "119",
			});
			expect(err.name).toBe("RawaPayTransactionError");
			expect(err.code).toBe("INSUFFICIENT_FUNDS");
			expect(err.statusCode).toBe(402);
			expect(err.rawCode).toBe("119");
			expect(err instanceof RawaPayError).toBe(true);
		});
	});

	describe("Result Unwrapping & Inspection Utilities (unwrap, unwrapOr, isSuccess, isError)", () => {
		it("unwrap returns the value when Result is a success", () => {
			const res = success({ id: "tx_123", amount: 1500 });
			const value = unwrap(res);
			expect(value).toEqual({ id: "tx_123", amount: 1500 });
		});

		it("unwrap throws the error when Result is a failure", () => {
			const err = new RawaPayValidationError({ message: "Invalid CNIC" });
			const res = failure(err);

			expect(() => unwrap(res)).toThrow(err);
			expect(() => unwrap(res)).toThrow("Invalid CNIC");
		});

		it("unwrapOr returns the value on success and fallback on failure", () => {
			const successRes = success("completed");
			const failRes = failure(new RawaPayError({ code: "GATEWAY_ERROR", message: "Failed" }));

			expect(unwrapOr(successRes, "default")).toBe("completed");
			expect(unwrapOr(failRes, "default")).toBe("default");
		});

		it("isSuccess and isError narrow Result types accurately", () => {
			const successRes = success(42);
			const failRes = failure(new RawaPayError({ code: "PAYMENT_FAILED", message: "Failed" }));

			expect(isSuccess(successRes)).toBe(true);
			expect(isError(successRes)).toBe(false);

			expect(isSuccess(failRes)).toBe(false);
			expect(isError(failRes)).toBe(true);

			if (isSuccess(successRes)) {
				// Type narrowed to SuccessResult<number>
				expect(successRes.data).toBe(42);
				expect(successRes.error).toBeNull();
			}

			if (isError(failRes)) {
				// Type narrowed to ErrorResult<RawaPayError>
				expect(failRes.data).toBeNull();
				expect(failRes.error.code).toBe("PAYMENT_FAILED");
			}
		});
	});

	describe("Integration with HttpClient", () => {
		it("preserves underlying network fetch error as cause in RawaPayNetworkError", async () => {
			const rootError = new Error("Failed to connect to host (ECONNREFUSED)");
			const mockFetch = (() => Promise.reject(rootError)) as unknown as typeof fetch;

			const client = new HttpClient({
				fetch: mockFetch,
				retries: 0,
			});

			try {
				await client.get("https://api.example.com/pay");
				expect.unreachable();
			} catch (err: unknown) {
				expect(RawaPayError.is(err)).toBe(true);
				expect(RawaPayNetworkError.is(err)).toBe(true);
				if (err instanceof RawaPayNetworkError) {
					expect(err.cause).toBe(rootError);
					expect(err.statusCode).toBe(502);
					expect(err.isRetryable).toBe(true);
				}
			}
		});
	});
});
