import { describe, expect, it } from "bun:test";

import { RawaPayError } from "./errors";
import { HttpClient } from "./http";

describe("HttpClient - Standardized Network Layer", () => {
	it("sends standard default headers including User-Agent telemetry and Accept", async () => {
		let capturedHeaders: Headers | undefined;

		const mockFetch = async (_url: any, init?: RequestInit) => {
			capturedHeaders = new Headers(init?.headers);
			return new Response(JSON.stringify({ status: "ok" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
		const res = await client.get<{ status: string }>("https://api.example.com/test");

		expect(res.data).toEqual({ status: "ok" });
		expect(capturedHeaders?.get("Accept")).toBe("application/json");
		expect(capturedHeaders?.get("User-Agent")).toBe("rawapay-node/0.1.0");
	});

	it("merges custom client and request headers", async () => {
		let capturedHeaders: Headers | undefined;

		const mockFetch = async (_url: any, init?: RequestInit) => {
			capturedHeaders = new Headers(init?.headers);
			return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
		};

		const client = new HttpClient({
			fetch: mockFetch as unknown as typeof fetch,
			headers: {
				"X-Client-Id": "client-123",
				"User-Agent": "custom-agent/2.0",
			},
		});

		await client.post(
			"https://api.example.com/charge",
			{ amount: 100 },
			{
				headers: {
					"X-Request-Id": "req-999",
				},
			},
		);

		expect(capturedHeaders?.get("X-Client-Id")).toBe("client-123");
		expect(capturedHeaders?.get("X-Request-Id")).toBe("req-999");
		expect(capturedHeaders?.get("User-Agent")).toBe("custom-agent/2.0");
		expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
	});

	it("serializes URL query parameters correctly", async () => {
		let capturedUrl = "";

		const mockFetch = async (url: any) => {
			capturedUrl = String(url);
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
		await client.get("https://api.example.com/search", {
			params: {
				page: 1,
				filter: "active",
				empty: undefined,
			},
		});

		expect(capturedUrl).toBe("https://api.example.com/search?page=1&filter=active");
	});

	it("resolves relative paths with baseUrl", async () => {
		let capturedUrl = "";

		const mockFetch = async (url: any) => {
			capturedUrl = String(url);
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new HttpClient({
			baseUrl: "https://api.gateway.com/v1",
			fetch: mockFetch as unknown as typeof fetch,
		});

		await client.get("/payments/123");
		expect(capturedUrl).toBe("https://api.gateway.com/v1/payments/123");
	});

	it("supports pluggable fetch dispatcher for enterprise proxies and mocking", async () => {
		let proxyInvoked = false;

		const customProxyFetch = async () => {
			proxyInvoked = true;
			return new Response(JSON.stringify({ proxied: true }), { status: 200 });
		};

		const client = new HttpClient({ fetch: customProxyFetch as unknown as typeof fetch });
		const res = await client.post<{ proxied: boolean }>("https://internal-bank-proxy.com/txn");

		expect(proxyInvoked).toBe(true);
		expect(res.data.proxied).toBe(true);
	});

	it("supports Axios-style request interceptors to mutate configuration", async () => {
		let capturedHeader = "";

		const mockFetch = async (_url: any, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			capturedHeader = headers.get("Authorization") || "";
			return new Response(JSON.stringify({}), { status: 200 });
		};

		const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

		// Add request interceptor
		const interceptorId = client.interceptors.request.use(async (config) => {
			return {
				...config,
				headers: {
					...config.headers,
					Authorization: "Bearer token-from-interceptor",
				},
			};
		});

		await client.get("https://api.example.com/secured");
		expect(capturedHeader).toBe("Bearer token-from-interceptor");

		// Eject interceptor
		client.interceptors.request.eject(interceptorId);
		capturedHeader = "";

		await client.get("https://api.example.com/secured");
		expect(capturedHeader).toBe("");
	});

	it("supports Axios-style response interceptors to transform data", async () => {
		const mockFetch = async () => {
			return new Response(JSON.stringify({ rawVal: 100 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

		client.interceptors.response.use((res) => {
			return {
				...res,
				data: { transformed: true, value: (res.data as any).rawVal * 2 },
			};
		});

		const res = await client.get<any>("https://api.example.com/data");
		expect(res.data).toEqual({ transformed: true, value: 200 });
	});

	it("provides hooks for future rate limiting via RateLimitHandler", async () => {
		let preRequestCount = 0;
		let postResponseCount = 0;

		const mockFetch = async () => {
			return new Response(JSON.stringify({}), {
				status: 200,
				headers: { "X-RateLimit-Remaining": "49" },
			});
		};

		const client = new HttpClient({
			fetch: mockFetch as unknown as typeof fetch,
			rateLimitHandler: {
				beforeRequest: async (_config) => {
					preRequestCount++;
				},
				onResponse: async (response) => {
					postResponseCount++;
					expect(response.headers.get("X-RateLimit-Remaining")).toBe("49");
				},
			},
		});

		await client.get("https://api.example.com/rate-limited");
		expect(preRequestCount).toBe(1);
		expect(postResponseCount).toBe(1);
	});

	it("retries on transient 500 errors and succeeds if next attempt passes", async () => {
		let attempts = 0;

		const mockFetch = async () => {
			attempts++;
			if (attempts < 3) {
				return new Response("Gateway Flap", { status: 502, statusText: "Bad Gateway" });
			}
			return new Response(JSON.stringify({ recovered: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = new HttpClient({
			fetch: mockFetch as unknown as typeof fetch,
			retries: 3,
			retryDelayMs: 10, // Fast delay for tests
		});

		const res = await client.get<{ recovered: boolean }>("https://api.gateway.com/flaky");
		expect(attempts).toBe(3);
		expect(res.data.recovered).toBe(true);
	});

	it("does not retry on 400 client error by default", async () => {
		let attempts = 0;

		const mockFetch = async () => {
			attempts++;
			return new Response(JSON.stringify({ error: "Invalid Parameter" }), {
				status: 400,
				statusText: "Bad Request",
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = new HttpClient({
			fetch: mockFetch as unknown as typeof fetch,
			retries: 2,
			retryDelayMs: 10,
		});

		try {
			await client.post("https://api.gateway.com/bad-request", {});
			expect(true).toBe(false); // Should not reach here
		} catch (err: unknown) {
			expect(err).toBeInstanceOf(RawaPayError);
			expect((err as RawaPayError).statusCode).toBe(400);
			expect(attempts).toBe(1); // 400 is not transient, no retry
		}
	});

	it("allows custom validateStatus to bypass throwing on HTTP 4xx/5xx", async () => {
		const mockFetch = async () => {
			return new Response(JSON.stringify({ responseCode: "999", reason: "Blocked" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
		const res = await client.post<{ responseCode: string; reason: string }>(
			"https://api.gateway.com/custom-status",
			{},
			{ validateStatus: () => true },
		);

		expect(res.status).toBe(400);
		expect(res.data.responseCode).toBe("999");
		expect(res.data.reason).toBe("Blocked");
	});

	it("converts timeout into typed RawaPayError with status 408", async () => {
		const mockFetch = async (_url: any, init?: RequestInit) => {
			// Simulate hung network that aborts on signal
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const error = new Error("AbortError");
					error.name = "AbortError";
					reject(error);
				});
			});
		};

		const client = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });

		try {
			await client.get("https://api.gateway.com/hang", { timeoutMs: 25, retries: 0 });
			expect(true).toBe(false);
		} catch (err: unknown) {
			expect(err).toBeInstanceOf(RawaPayError);
			const payErr = err as RawaPayError;
			expect(payErr.statusCode).toBe(408);
			expect(payErr.isRetryable).toBe(true);
			expect(payErr.message).toContain("timed out");
		}
	});

	it("clones HttpClient with scoped baseUrl while preserving interceptors and fetch", async () => {
		let capturedUrl = "";
		let capturedAuth = "";

		const mockFetch = async (url: any, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedAuth = new Headers(init?.headers).get("Authorization") || "";
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const parent = new HttpClient({ fetch: mockFetch as unknown as typeof fetch });
		parent.interceptors.request.use((config) => ({
			...config,
			headers: { ...config.headers, Authorization: "Bearer parent-token" },
		}));

		const child = parent.clone({
			baseUrl: "https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase",
		});

		await child.post("/DoMWalletTransaction", { amount: 500 });

		expect(capturedUrl).toBe("https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction");
		expect(capturedAuth).toBe("Bearer parent-token");
	});
});
