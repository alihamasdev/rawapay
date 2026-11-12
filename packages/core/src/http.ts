import { DEFAULT_TIMEOUT_MS } from "./constants";
import { RawaPayError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/**
 * Configuration options for an HTTP request.
 */
export interface HttpRequestConfig<TBody = unknown> {
	/** Target URL (relative to baseUrl if set, or absolute) */
	url?: string;
	/** HTTP method (defaults to "GET" or "POST" if body is provided) */
	method?: HttpMethod;
	/** Custom HTTP headers */
	headers?: Record<string, string | undefined>;
	/** URL query parameters to serialize and append to the URL */
	params?: Record<string, string | number | boolean | null | undefined>;
	/** Request payload (objects will be serialized to JSON unless FormData/URLSearchParams/string) */
	body?: TBody;
	/** Request timeout in milliseconds (defaults to client timeoutMs) */
	timeoutMs?: number;
	/** Number of retry attempts on transient network or gateway errors */
	retries?: number;
	/** Base retry delay in milliseconds before exponential backoff */
	retryDelayMs?: number;
	/** Maximum delay cap for exponential backoff in milliseconds */
	maxRetryDelayMs?: number;
	/** External AbortSignal to cancel the request */
	signal?: AbortSignal;
	/** Custom fetch implementation for this specific request */
	fetch?: typeof fetch;
	/** Custom status code validator (defaults to 200-299) */
	validateStatus?: (status: number) => boolean;
	/** Custom retry predicate to decide if a request should be retried */
	shouldRetry?: (error: unknown, attempt: number, config: HttpRequestConfig<TBody>) => boolean;
	/** Contextual metadata attached to the request (useful for interceptors, e.g. provider name, rate-limit keys) */
	context?: Record<string, unknown>;
}

/**
 * Standardized response object returned by HttpClient.
 */
export interface HttpResponse<T = unknown> {
	/** Parsed response data */
	data: T;
	/** HTTP status code */
	status: number;
	/** HTTP status text */
	statusText: string;
	/** Response headers */
	headers: Headers;
	/** Original request configuration */
	config: HttpRequestConfig;
	/** Underlying native Response object */
	rawResponse: Response;
}

/**
 * Rate limit lifecycle hook for intercepting and throttling requests.
 * Designed to provide first-class room for token-bucket / leaky-bucket rate limiting.
 */
export interface RateLimitHandler {
	/**
	 * Called before an HTTP request is dispatched.
	 * Can pause/delay execution, acquire rate limit tokens, or throw a 429 error.
	 */
	beforeRequest?: (config: HttpRequestConfig) => Promise<void> | void;
	/**
	 * Called when a response is received, enabling inspection of headers like 'Retry-After' or 'X-RateLimit-*'.
	 */
	onResponse?: (response: HttpResponse<any>) => Promise<void> | void;
}

export type RequestInterceptorFulfilled = (config: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>;
export type RequestInterceptorRejected = (error: unknown) => unknown;

export type ResponseInterceptorFulfilled<T = any> = (response: HttpResponse<T>) => HttpResponse<T> | Promise<HttpResponse<T>>;
export type ResponseInterceptorRejected = (error: unknown) => unknown;

export interface RequestInterceptorHandler {
	fulfilled: RequestInterceptorFulfilled;
	rejected?: RequestInterceptorRejected;
}

export interface ResponseInterceptorHandler<T = any> {
	fulfilled: ResponseInterceptorFulfilled<T>;
	rejected?: ResponseInterceptorRejected;
}

/**
 * Manager for registering and ejecting Axios-style request and response interceptors.
 */
export class InterceptorManager<TFulfilled, TRejected = (error: unknown) => unknown> {
	private handlers: ({ fulfilled: TFulfilled; rejected?: TRejected } | null)[] = [];

	/**
	 * Registers an interceptor handler (Axios style) and returns an ID to eject it later.
	 * Supports both use(onFulfilled, onRejected) and use({ fulfilled, rejected }).
	 */
	use(fulfilledOrHandler: TFulfilled | { fulfilled: TFulfilled; rejected?: TRejected }, rejected?: TRejected): number {
		if (typeof fulfilledOrHandler === "function") {
			this.handlers.push({
				fulfilled: fulfilledOrHandler as TFulfilled,
				rejected,
			});
		} else {
			this.handlers.push(fulfilledOrHandler as { fulfilled: TFulfilled; rejected?: TRejected });
		}
		return this.handlers.length - 1;
	}

	/**
	 * Removes an interceptor by ID.
	 */
	eject(id: number): void {
		if (id >= 0 && id < this.handlers.length) {
			this.handlers[id] = null;
		}
	}

	/**
	 * Iterates over all active registered handlers.
	 */
	forEach(fn: (handler: { fulfilled: TFulfilled; rejected?: TRejected }) => void): void {
		for (const handler of this.handlers) {
			if (handler !== null) {
				fn(handler);
			}
		}
	}

	/**
	 * Clears all registered interceptors.
	 */
	clear(): void {
		this.handlers = [];
	}
}

/**
 * Options for configuring an HttpClient instance.
 */
export interface HttpClientConfig {
	/** Base URL prepended to relative request paths */
	baseUrl?: string;
	/** Default HTTP headers merged into every request */
	headers?: Record<string, string>;
	/** Request timeout in milliseconds (defaults to 30000) */
	timeoutMs?: number;
	/** Default number of retry attempts for transient errors (defaults to 0) */
	retries?: number;
	/** Base delay in milliseconds before exponential backoff (defaults to 300) */
	retryDelayMs?: number;
	/** Maximum delay cap in milliseconds for exponential backoff (defaults to 3000) */
	maxRetryDelayMs?: number;
	/** Custom fetch function (supports mock fetch, proxies, enterprise mTLS) */
	fetch?: typeof fetch;
	/** Optional rate limit handler */
	rateLimitHandler?: RateLimitHandler;
}

/**
 * Production-ready, interceptor-driven HTTP client tailored for payment gateways.
 * Features:
 * - Axios-style request and response interceptors
 * - Pluggable fetch dispatcher (proxies, mTLS, MSW)
 * - Automatic exponential backoff with jitter on transient 5xx/429/408 errors
 * - Standardized User-Agent diagnostic telemetry
 * - Integrated timeout and network error mapping into typed RawaPayError
 * - Extensible hooks for future rate limiting
 */
export class HttpClient {
	readonly baseUrl?: string;
	readonly headers: Record<string, string>;
	readonly timeoutMs: number;
	readonly retries: number;
	readonly retryDelayMs: number;
	readonly maxRetryDelayMs: number;
	readonly customFetch?: typeof fetch;
	readonly rateLimitHandler?: RateLimitHandler;

	readonly interceptors = {
		request: new InterceptorManager<RequestInterceptorFulfilled, RequestInterceptorRejected>(),
		response: new InterceptorManager<ResponseInterceptorFulfilled, ResponseInterceptorRejected>(),
	};

	constructor(config: HttpClientConfig = {}) {
		this.baseUrl = config.baseUrl;
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.retries = config.retries ?? 0;
		this.retryDelayMs = config.retryDelayMs ?? 300;
		this.maxRetryDelayMs = config.maxRetryDelayMs ?? 3000;
		this.customFetch = config.fetch;
		this.rateLimitHandler = config.rateLimitHandler;

		this.headers = {
			Accept: "application/json",
			"User-Agent": "rawapay-node/0.1.0",
			...config.headers,
		};
	}

	get fetchFn(): typeof fetch {
		return this.customFetch ?? globalThis.fetch;
	}

	/**
	 * Creates a child HttpClient instance inheriting configuration, custom fetch, and interceptors,
	 * while applying scoped overrides (such as a provider-specific baseUrl).
	 */
	clone(config: Partial<HttpClientConfig> = {}): HttpClient {
		const child = new HttpClient({
			baseUrl: config.baseUrl ?? this.baseUrl,
			headers: { ...this.headers, ...config.headers },
			timeoutMs: config.timeoutMs ?? this.timeoutMs,
			retries: config.retries ?? this.retries,
			retryDelayMs: config.retryDelayMs ?? this.retryDelayMs,
			maxRetryDelayMs: config.maxRetryDelayMs ?? this.maxRetryDelayMs,
			fetch: config.fetch ?? this.customFetch,
			rateLimitHandler: config.rateLimitHandler ?? this.rateLimitHandler,
		});

		// Copy over active request and response interceptors
		this.interceptors.request.forEach((handler) => {
			child.interceptors.request.use(handler.fulfilled, handler.rejected);
		});
		this.interceptors.response.forEach((handler) => {
			child.interceptors.response.use(handler.fulfilled, handler.rejected);
		});

		return child;
	}

	/**
	 * Dispatches an HTTP request with interceptors, retries, and timeout management.
	 */
	async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
		// 1. Run Request Interceptors pipeline
		let currentConfig: HttpRequestConfig = {
			...config,
			headers: {
				...this.headers,
				...config.headers,
			},
			timeoutMs: config.timeoutMs ?? this.timeoutMs,
			retries: config.retries ?? this.retries,
			retryDelayMs: config.retryDelayMs ?? this.retryDelayMs,
			maxRetryDelayMs: config.maxRetryDelayMs ?? this.maxRetryDelayMs,
		};

		const requestHandlers: RequestInterceptorHandler[] = [];
		this.interceptors.request.forEach((handler) => requestHandlers.push(handler));

		for (const handler of requestHandlers) {
			try {
				currentConfig = await handler.fulfilled(currentConfig);
			} catch (err) {
				if (handler.rejected) {
					const rejectedResult = await handler.rejected(err);
					if (rejectedResult !== undefined) {
						currentConfig = rejectedResult as HttpRequestConfig;
						continue;
					}
				}
				throw err;
			}
		}

		// 2. Pre-request Rate Limit hook
		if (this.rateLimitHandler?.beforeRequest) {
			await this.rateLimitHandler.beforeRequest(currentConfig);
		}

		// 3. Execute with retries
		let lastError: unknown;
		const maxAttempts = (currentConfig.retries ?? 0) + 1;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const response = await this.executeSingleRequest<T>(currentConfig);

				// 4. Post-response Rate Limit hook
				if (this.rateLimitHandler?.onResponse) {
					await this.rateLimitHandler.onResponse(response);
				}

				// 5. Run Response Interceptors pipeline
				let currentResponse: HttpResponse<T> = response;
				const responseHandlers: ResponseInterceptorHandler<T>[] = [];
				this.interceptors.response.forEach((handler) => responseHandlers.push(handler));

				for (const handler of responseHandlers) {
					try {
						currentResponse = await handler.fulfilled(currentResponse);
					} catch (err) {
						if (handler.rejected) {
							const handled = await handler.rejected(err);
							if (handled !== undefined) {
								currentResponse = handled as HttpResponse<T>;
								continue;
							}
						}
						throw err;
					}
				}

				return currentResponse;
			} catch (err: unknown) {
				lastError = err;

				const shouldRetry =
					attempt < maxAttempts &&
					(currentConfig.shouldRetry ? currentConfig.shouldRetry(err, attempt, currentConfig) : this.isTransientError(err));

				if (!shouldRetry) {
					break;
				}

				// Calculate exponential backoff with full jitter
				const baseDelay = currentConfig.retryDelayMs ?? this.retryDelayMs;
				const maxDelay = currentConfig.maxRetryDelayMs ?? this.maxRetryDelayMs;
				const backoff = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
				const jitter = Math.random() * 100;
				const delayMs = backoff + jitter;

				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}

		// If all attempts failed, throw the last error (or re-run response rejection interceptors)
		const responseHandlers: ResponseInterceptorHandler<T>[] = [];
		this.interceptors.response.forEach((handler) => responseHandlers.push(handler));
		for (const handler of responseHandlers) {
			if (handler.rejected) {
				try {
					const fallback = await handler.rejected(lastError);
					if (fallback !== undefined) {
						return fallback as HttpResponse<T>;
					}
				} catch (handledErr) {
					lastError = handledErr;
				}
			}
		}

		throw lastError;
	}

	/**
	 * Dispatches a single HTTP request using fetch.
	 */
	private async executeSingleRequest<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
		const fullUrl = this.buildUrl(config.url, config.params);
		const fetchFn = config.fetch ?? this.fetchFn;
		const method = (config.method ?? (config.body ? "POST" : "GET")).toUpperCase() as HttpMethod;
		const timeoutMs = config.timeoutMs ?? this.timeoutMs;

		const headers = new Headers();
		if (config.headers) {
			for (const [key, value] of Object.entries(config.headers)) {
				if (value !== undefined) {
					headers.set(key, value);
				}
			}
		}

		type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
		type FetchBody = FetchInit["body"];
		let body: FetchBody | undefined;
		if (config.body !== undefined && config.body !== null && method !== "GET" && method !== "HEAD") {
			if (
				typeof config.body === "string" ||
				config.body instanceof URLSearchParams ||
				config.body instanceof FormData ||
				config.body instanceof Blob ||
				config.body instanceof ArrayBuffer
			) {
				body = config.body as FetchBody;
			} else {
				if (!headers.has("Content-Type")) {
					headers.set("Content-Type", "application/json");
				}
				body = JSON.stringify(config.body);
			}
		}

		// Setup AbortController for timeout + external signal chaining
		const controller = new AbortController();
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		if (timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				controller.abort(new Error(`Timeout of ${timeoutMs}ms exceeded`));
			}, timeoutMs);
		}

		if (config.signal) {
			config.signal.addEventListener("abort", () => {
				controller.abort(config.signal?.reason);
			});
		}

		let rawResponse: Response;
		try {
			rawResponse = await fetchFn(fullUrl, {
				method,
				headers,
				body,
				signal: controller.signal,
			});
		} catch (networkErr: unknown) {
			const isAbort =
				controller.signal.aborted ||
				(networkErr instanceof Error && (networkErr.name === "AbortError" || networkErr.name === "TimeoutError"));

			if (isAbort) {
				throw new RawaPayError({
					code: "GATEWAY_ERROR",
					message: `HTTP request timed out after ${timeoutMs}ms.`,
					statusCode: 408,
					isRetryable: true,
				});
			}

			const message = networkErr instanceof Error ? networkErr.message : String(networkErr);
			throw new RawaPayError({
				code: "GATEWAY_ERROR",
				message: `Network communication failure: ${message}`,
				statusCode: 502,
				isRetryable: true,
			});
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}

		// Parse response body (JSON if applicable, text fallback)
		let data: any = null;
		const contentType = rawResponse.headers.get("content-type") || "";

		try {
			if (contentType.includes("application/json")) {
				data = await rawResponse.json();
			} else {
				const text = await rawResponse.text();
				if (text.length > 0) {
					try {
						data = JSON.parse(text);
					} catch {
						data = text;
					}
				}
			}
		} catch {
			data = null;
		}

		const validateStatus = config.validateStatus ?? ((status) => status >= 200 && status < 300);
		if (!validateStatus(rawResponse.status)) {
			const errorMsg =
				(data && typeof data === "object" && "message" in data ? String((data as any).message) : null) ||
				rawResponse.statusText ||
				`Request failed with status ${rawResponse.status}`;

			throw new RawaPayError({
				code: "GATEWAY_ERROR",
				message: `Gateway returned HTTP ${rawResponse.status}: ${errorMsg}`,
				statusCode: rawResponse.status,
				rawResponse: data,
				isRetryable: this.isTransientStatus(rawResponse.status),
			});
		}

		return {
			data: data as T,
			status: rawResponse.status,
			statusText: rawResponse.statusText,
			headers: rawResponse.headers,
			config,
			rawResponse,
		};
	}

	/**
	 * Helper to determine if an error or status code is transient and safe to retry.
	 */
	private isTransientError(err: unknown): boolean {
		if (err instanceof RawaPayError) {
			return err.isRetryable || this.isTransientStatus(err.statusCode);
		}
		if (err instanceof Error) {
			return (
				err.name === "AbortError" ||
				err.name === "TimeoutError" ||
				err.message.includes("fetch failed") ||
				err.message.includes("ECONNRESET") ||
				err.message.includes("ETIMEDOUT")
			);
		}
		return false;
	}

	private isTransientStatus(status: number): boolean {
		// 408 Request Timeout, 429 Too Many Requests, 500/502/503/504 Server Errors
		return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
	}

	/**
	 * Constructs the full URL, resolving relative paths against baseUrl and appending query parameters.
	 */
	private buildUrl(url?: string, params?: Record<string, string | number | boolean | null | undefined>): string {
		let target = url ?? "";

		if (this.baseUrl && !target.startsWith("http://") && !target.startsWith("https://")) {
			const cleanBase = this.baseUrl.replace(/\/+$/, "");
			const cleanTarget = target.replace(/^\/+/, "");
			target = cleanTarget ? `${cleanBase}/${cleanTarget}` : cleanBase;
		}

		if (params && Object.keys(params).length > 0) {
			const [path, existingQuery] = target.split("?");
			const searchParams = new URLSearchParams(existingQuery || "");

			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined && value !== null) {
					searchParams.set(key, String(value));
				}
			}

			const queryString = searchParams.toString();
			target = queryString ? `${path}?${queryString}` : path;
		}

		return target;
	}

	// Convenience HTTP Methods
	get<T = unknown>(url: string, config?: Omit<HttpRequestConfig, "url" | "method">): Promise<HttpResponse<T>> {
		return this.request<T>({ ...config, url, method: "GET" });
	}

	post<T = unknown>(url: string, body?: unknown, config?: Omit<HttpRequestConfig, "url" | "method" | "body">): Promise<HttpResponse<T>> {
		return this.request<T>({ ...config, url, method: "POST", body });
	}

	put<T = unknown>(url: string, body?: unknown, config?: Omit<HttpRequestConfig, "url" | "method" | "body">): Promise<HttpResponse<T>> {
		return this.request<T>({ ...config, url, method: "PUT", body });
	}

	delete<T = unknown>(url: string, config?: Omit<HttpRequestConfig, "url" | "method">): Promise<HttpResponse<T>> {
		return this.request<T>({ ...config, url, method: "DELETE" });
	}

	patch<T = unknown>(url: string, body?: unknown, config?: Omit<HttpRequestConfig, "url" | "method" | "body">): Promise<HttpResponse<T>> {
		return this.request<T>({ ...config, url, method: "PATCH", body });
	}
}
