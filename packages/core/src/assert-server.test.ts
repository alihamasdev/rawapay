import { describe, expect, it } from "bun:test";

import { assertServerEnv } from "./assert-server";
import { RawaPayError } from "./errors";

describe("Server-only Environment Guard", () => {
	it("does not throw when running in a server environment (window is undefined)", () => {
		expect(() => assertServerEnv("TestServer")).not.toThrow();
	});

	it("throws a RawaPayError when running in a browser/client environment (window is defined)", () => {
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
		}
	});
});
