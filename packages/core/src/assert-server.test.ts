import { describe, expect, it } from "bun:test";

import { assertServerEnv } from "./assert-server";
import { RawaPayError } from "./errors";

describe("Server-only Environment Guard", () => {
	it("does not throw when running in a server environment (window is undefined)", () => {
		expect(() => assertServerEnv("TestServer")).not.toThrow();
	});

	it("throws a RawaPayError when running in a browser/client environment (window is defined and NODE_ENV is not test)", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";

		// Mock browser environment
		(globalThis as unknown as { window: unknown }).window = {
			document: {},
		};

		try {
			expect(() => assertServerEnv("RawaPay")).toThrow(RawaPayError);
			expect(() => assertServerEnv("RawaPay")).toThrow(/is a server-only SDK and cannot be initialized in browser\/client-side code/);
		} finally {
			// Clean up global mock
			delete (globalThis as unknown as { window?: unknown }).window;
			process.env.NODE_ENV = originalEnv;
		}
	});

	it("throws a RawaPayError when document is defined and NODE_ENV is development", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "development";

		(globalThis as unknown as { document: unknown }).document = {};

		try {
			expect(() => assertServerEnv("RawaPay")).toThrow(RawaPayError);
		} finally {
			delete (globalThis as unknown as { document?: unknown }).document;
			process.env.NODE_ENV = originalEnv;
		}
	});

	it("bypasses check and does not throw when NODE_ENV is 'test' even if window and document are defined", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "test";

		(globalThis as unknown as { window: unknown; document: unknown }).window = {};
		(globalThis as unknown as { window: unknown; document: unknown }).document = {};

		try {
			expect(() => assertServerEnv("RawaPay")).not.toThrow();
		} finally {
			delete (globalThis as unknown as { window?: unknown }).window;
			delete (globalThis as unknown as { document?: unknown }).document;
			process.env.NODE_ENV = originalEnv;
		}
	});

	it("does not bypass check when NODE_ENV is uppercase 'TEST'", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "TEST";

		(globalThis as unknown as { window: unknown }).window = {};

		try {
			expect(() => assertServerEnv("RawaPay")).toThrow(RawaPayError);
		} finally {
			delete (globalThis as unknown as { window?: unknown }).window;
			process.env.NODE_ENV = originalEnv;
		}
	});
});
