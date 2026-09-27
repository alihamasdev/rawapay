import { RawaPayError } from "./errors";

/**
 * Asserts that the code is running in a server-side environment (Node.js, Bun, Edge, Deno).
 * If executed in a browser/client environment, immediately throws a descriptive RawaPayError
 * to prevent leaking sensitive merchant credentials (Merchant ID, Password, Integrity Salt).
 */
export function assertServerEnv(context = "RawaPay"): void {
	const globalObj = globalThis as unknown as {
		window?: unknown;
		document?: unknown;
	};

	const isClient = typeof globalObj.window !== "undefined" || typeof globalObj.document !== "undefined";

	if (isClient) {
		throw new RawaPayError({
			code: "INVALID_REQUEST",
			message: `${context} is a server-only SDK and cannot be initialized in browser/client-side code. To keep your merchant credentials secure, initialize and call RawaPay inside server.`,
			statusCode: 500,
			isRetryable: false,
		});
	}
}
