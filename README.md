<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/logo-dark.png">
    <img alt="RawaPay" src="apps/docs/public/logo-light.png" width="96">
  </picture>
</p>

<h1 align="center">RawaPay</h1>

<p align="center">
  Universal payment gateway infrastructure and TypeScript SDK for Pakistan.<br>
  Unifying mobile wallets into a single, type-safe, developer-first API.
</p>

<p align="center">
  <a href="#packages-architecture"><strong>Explore Packages</strong></a> •
  <a href="#quickstart"><strong>Quickstart</strong></a> •
  <a href="#error-handling--diagnostics"><strong>Error Diagnostics</strong></a> •
  <a href="#monorepo-structure"><strong>Repository Structure</strong></a>
</p>

---

## Overview

Integrating digital payment gateways in Pakistan traditionally requires managing disparate HMAC-SHA256 signature algorithms, custom string concatenation rules, non-standard timestamp formats, paisa conversions, and inconsistent banking error response codes across providers.

**RawaPay** abstracts this complexity behind a modular monorepo architecture and a unified, Stripe-inspired API for **JazzCash** and **EasyPaisa** Mobile Wallets.

> [!NOTE]
> Currently, RawaPay supports direct single-charge Mobile Wallet deductions (USSD push prompt and mobile PIN authorization). Recurring billing and card schemes will be supported in upcoming iterations.

---

## Packages Architecture

The core engineering work of RawaPay lives inside the `packages/` directory. The codebase is decoupled into focused, standalone libraries designed for maximum flexibility:

```
packages/
├── core/         # @rawapay/core      - Primitives, types, schemas, errors & validation
├── jazzcash/     # @rawapay/jazzcash  - JazzCash MWALLET driver & HMAC-SHA256 engine
├── easypaisa/    # @rawapay/easypaisa - EasyPaisa MA driver & REST authentication
└── rawapay/      # rawapay            - Unified umbrella SDK bundling all packages
```

| Package                                    | Role                | Purpose                                                                                                                                                                |
| :----------------------------------------- | :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`rawapay`](#packagesrawapay)              | **Umbrella SDK**    | The complete package developers install. Exposes the unified `RawaPay` client, dynamic driver routing, and re-exports all drivers and core utilities.                  |
| [`@rawapay/core`](#packagescore)           | **Core Engine**     | Zero-dependency foundational layer: Safe Result pattern (`Result<T, E>`), normalized `Payment` entity, `RawaPayError`, server guards, and Pakistani format validators. |
| [`@rawapay/jazzcash`](#packagesjazzcash)   | **Provider Driver** | JazzCash Mobile Wallet (`MWALLET`) driver. Handles payload ordering, HMAC-SHA256 hashing, USSD dispatch, inquiry APIs, and webhook signature verification.             |
| [`@rawapay/easypaisa`](#packageseasypaisa) | **Provider Driver** | EasyPaisa Mobile Account (`MA`) driver. Handles REST endpoint communication, Basic Auth credentials generation, status inquiry, and error code translation.            |

> [!TIP]
> Most developers will only need the all-in-one `rawapay` package. If you are building a microservice dedicated solely to JazzCash or EasyPaisa, you can optionally install `@rawapay/jazzcash` or `@rawapay/easypaisa` alongside `@rawapay/core` for a minimal dependency footprint.

---

## Key Features

- **Unified Client Interface**: Initialize once and charge any supported wallet without writing nested `if/else` or `switch` statements across your codebase.
- **Safe Result Pattern**: No unexpected uncaught exceptions. Operations return a type-narrowed `{ data, error }` object inspired by Go and Rust.
- **Normalized Error Matrix**: Translates proprietary gateway error codes (e.g. JazzCash `119` and EasyPaisa `0013`) into standard codes like `INSUFFICIENT_FUNDS`, `ACCOUNT_NOT_FOUND`, and `LIMIT_EXCEEDED`.
- **Intelligent Retry Diagnostics**: `error.isRetryable` explicitly identifies transient failures (such as customer USSD timeouts or bank gateway 502s) versus terminal rejections (wrong PIN, invalid credentials).
- **Server-Only Security Guard**: Built-in runtime checks prevent accidental imports into client bundles, protecting merchant passwords, store IDs, and integrity salts from leaking to browsers.
- **Built-in Format Validation**: Lightweight validators for Pakistani phone numbers (`03xxxxxxxxx`), CNIC suffixes, and paisa conversion with zero external validation dependencies.

---

## Quickstart

### 1. Installation

Install the unified SDK:

```bash
# Using bun
bun add rawapay

# Using npm
npm install rawapay

# Using pnpm
pnpm add rawapay
```

### 2. Configure Credentials

Store your gateway credentials in your server environment:

```env
# JazzCash (Sandbox or Production)
JAZZCASH_MERCHANT_ID="MC12345"
JAZZCASH_PASSWORD="your_api_password"
JAZZCASH_INTEGRITY_SALT="your_integrity_salt"

# EasyPaisa (Sandbox or Production)
EASYPAISA_STORE_ID="12345"
EASYPAISA_USERNAME="your_username"
EASYPAISA_PASSWORD="your_password"
```

### 3. Initialize the Client

Instantiate `RawaPay` once in a server-side module:

```ts
import { RawaPay } from "rawapay";

export const pay = new RawaPay({
	options: {
		environment: "sandbox", // "sandbox" | "production" (defaults to "sandbox")
		timeoutMs: 30000,
	},
	providers: {
		jazzcash: {
			merchantId: process.env.JAZZCASH_MERCHANT_ID!,
			password: process.env.JAZZCASH_PASSWORD!,
			integritySalt: process.env.JAZZCASH_INTEGRITY_SALT!,
		},
		easypaisa: {
			storeId: process.env.EASYPAISA_STORE_ID!,
			username: process.env.EASYPAISA_USERNAME,
			password: process.env.EASYPAISA_PASSWORD,
		},
	},
});
```

### 4. Create Payments

#### Charging JazzCash Mobile Wallet

JazzCash requires the customer's mobile number and the last 6 digits of their CNIC (or full 13-digit CNIC) to initiate the USSD authorization prompt on their mobile device:

```ts
const { data, error } = await pay.payment.create({
	provider: "jazzcash",
	amount: 2500, // Amount in PKR
	phone: "03001234567",
	cnic: "123456", // Last 6 digits or full 13-digit CNIC
	description: "Order #1042",
});

if (error) {
	console.error(`Payment failed [${error.code}]:`, error.message);
	return;
}

// Initial direct wallet creation returns status: "pending"
// while awaiting customer MPIN entry
console.log("Transaction ID:", data.id);
console.log("Status:", data.status); // "pending"
```

#### Charging EasyPaisa Mobile Account

EasyPaisa requires only the customer's mobile number:

```ts
const { data, error } = await pay.payment.create({
	provider: "easypaisa",
	amount: 3200, // Amount in PKR
	phone: "03451234567",
	description: "Order #1043",
});

if (error) {
	console.error(`Payment failed [${error.code}]:`, error.message);
	return;
}

console.log("Transaction ID:", data.id);
console.log("Status:", data.status); // "succeeded"
```

### 5. Check Payment Status

Query transaction settlement across providers with a single call:

```ts
const { data, error } = await pay.payment.status({
	provider: "jazzcash", // or "easypaisa"
	paymentId: "T20260926101234123456",
});

if (data?.status === "succeeded") {
	// Safe to mark order as paid
}
```

### 6. Verify Webhooks & IPN Callbacks

Protect your server endpoints against forged callbacks. JazzCash HMAC-SHA256 signatures are verified using constant-time comparisons:

```ts
export async function handleJazzCashWebhook(req: Request) {
	const body = await req.json();

	// Validate cryptographic signature against integritySalt
	const isValid = pay.verifyCallback("jazzcash", body);
	if (!isValid) {
		return new Response("Unauthorized signature", { status: 400 });
	}

	if (body.pp_ResponseCode === "000") {
		// Transaction authorized by customer
		await fulfillOrder(body.pp_TxnRefNo);
	}

	return new Response("OK");
}
```

> [!IMPORTANT]
> Standard EasyPaisa Mobile Account callbacks do not carry symmetric HMAC signatures. To confirm transaction finality with EasyPaisa, perform a server-to-server inquiry using `pay.payment.status({ provider: "easypaisa", paymentId })` or restrict callback access to EasyPaisa's IP ranges.

---

## Deep Dive into Packages

### `packages/rawapay`

The top-level developer package. Coordinates configured providers through an internal driver registry.

- **Client Class**: `RawaPay`
- **Dynamic Routing**: Dispatches `create` and `status` calls to the appropriate driver using `options.provider`.
- **Direct Driver Access**: Access underlying driver instances using `pay.getDriver<JazzCashDriver>("jazzcash")`.
- **Re-exports**: Automatically exposes all types, errors, driver classes, crypto utilities, and validators from `@rawapay/core`, `@rawapay/jazzcash`, and `@rawapay/easypaisa`.

### `packages/core`

The foundation for all RawaPay drivers and client operations. Contains no external dependencies.

- **Safe Result Primitives**:
  - `Result<T, E>`
  - `success(data)` and `failure(error)`
- **Normalized Data Models**:
  - `Payment`: Standard transaction entity returned by all drivers (`id`, `provider`, `status`, `amount`, `currency`, `responseCode`, `responseMessage`, `retrievalRefNo`, `raw`, `createdAt`).
  - `PaymentStatus`: `"succeeded" | "pending" | "processing" | "failed" | "cancelled" | "expired"`.
- **Error Engine**:
  - `RawaPayError`: Custom error class with enumerable `message`, normalized `RawaPayErrorCode`, HTTP `statusCode`, `rawCode`, `rawResponse`, and `isRetryable`.
  - Serializer: `error.toJSON()` prevents serialization loss in JSON APIs and Next.js Server Actions.
- **Security**:
  - `assertServerEnv(context)`: Guarantees that code executing sensitive operations runs solely in server runtimes (Node.js, Bun, Edge).
- **Pakistani Format Validators & Normalizers**:
  - `phoneSchema`: Validates and normalizes `03xxxxxxxxx`, `+923xxxxxxxxx`, `923xxxxxxxxx`, and `3xxxxxxxxx` into a clean 11-digit string.
  - `cnicSchema`: Validates and extracts the 6-digit suffix required for mobile wallet authorization from either a 6-digit string or a full 13-digit CNIC (`42101-1234567-1`).
  - `positiveAmountSchema`: Enforces valid positive transaction limits up to PKR 10,000,000.
  - Utility helpers: `formatToPaisa()`, `formatDateTime()` (guarantees Asia/Karachi PKT UTC+5 timestamp synchronization), and `generateTxnRefNo()`.

### `packages/jazzcash`

Driver implementation for JazzCash API v2.0.

- **Driver Class**: `JazzCashDriver`
- **Supported Flow**: Direct Mobile Wallet (`MWALLET`) transactions via `DoMWalletTransaction`.
- **Status Inquiry**: Transaction status verification via `PaymentInquiry`.
- **Cryptographic Engine (`crypto.ts`)**:
  - Alphabetical key sorting and parameter concatenation with `pp_IntegritySalt`.
  - Uppercase hexadecimal HMAC-SHA256 signature calculation (`calculateSecureHash`).
  - Constant-time verification (`verifySecureHash`) via `crypto.timingSafeEqual` to safeguard against timing attacks.
- **Error Mapping (`errors.ts`)**: Maps 3-digit `pp_ResponseCode` values (`101`, `115`, `116`, `118`, `119`, `120`, `122`, `157`, `999`, etc.) into standardized `RawaPayError` codes.

### `packages/easypaisa`

Driver implementation for EasyPaisa REST API v4.

- **Driver Class**: `EasyPaisaDriver`
- **Supported Flow**: Direct Mobile Account (`MA`) transactions via `initiate-ma-transaction`.
- **Status Inquiry**: Direct reconciliation via `inquire-transaction`.
- **Header Authentication**: Manages Base64 credential token formatting across `Credentials` and `Authorization: Basic` headers.
- **Error Mapping (`errors.ts`)**: Maps 4-digit `responseCode` values (`0001`, `0002`, `0006`, `0007`, `0013`, `0014`, `0017`, etc.) into standardized `RawaPayError` codes.

---

## Error Handling & Diagnostics

RawaPay maps distinct gateway error responses into a single standardized error matrix:

```json
{
	"name": "RawaPayError",
	"code": "INSUFFICIENT_FUNDS",
	"message": "Customer mobile account has insufficient balance to complete this transaction. (119)",
	"provider": "jazzcash",
	"statusCode": 402,
	"rawCode": "119",
	"isRetryable": false,
	"rawResponse": {
		"pp_ResponseCode": "119",
		"pp_ResponseMessage": "Customer mobile account has insufficient balance"
	}
}
```

### Transient vs Terminal Errors (`isRetryable`)

Using `error.isRetryable`, background jobs and API consumers can immediately determine whether an operation is eligible for retry:

```ts
const { data, error } = await pay.payment.create(params);

if (error) {
	if (error.isRetryable) {
		// Customer timed out on USSD prompt (122) or gateway dropped connection (502)
		// Safe to queue for retry or invite the customer to request a new prompt
		await scheduleRetry();
	} else {
		// Terminal failure: wrong PIN (120), invalid CNIC, or insufficient funds (119/0013)
		await markOrderFailed(error.message);
	}
}
```

---

## Monorepo Structure

```
rawapay/
├── apps/
│   ├── docs/          # Full documentation website (Next.js, Fumadocs)
│   └── web/           # Interactive playground & demo checkout application (Next.js, TailwindCSS)
├── packages/
│   ├── config/        # Shared tsconfig and lint rules (@rawapay/config)
│   ├── core/          # Foundational primitives, error engine, validators (@rawapay/core)
│   ├── easypaisa/     # EasyPaisa REST v4 driver (@rawapay/easypaisa)
│   ├── jazzcash/      # JazzCash API v2.0 driver & crypto engine (@rawapay/jazzcash)
│   └── rawapay/       # Unified public SDK client (rawapay)
├── package.json       # Monorepo workspaces definition
└── turbo.json         # Turborepo task pipeline configuration
```

- **`apps/docs`**: Documentation portal detailing guides, API references, error tables, and provider specifications.
- **`apps/web`**: Demonstration app and sandbox testing playground for inspecting live checkout flows.

---

## Development & Local Testing

RawaPay uses [Bun](https://bun.sh/) and [Turborepo](https://turbo.build/) to manage workspace builds and package dependencies.

### Setup

```bash
# Clone the repository
git clone https://github.com/alihamas/rawapay.git
cd rawapay

# Install monorepo dependencies
bun install
```

### Available Scripts

| Script                | Description                                                    |
| :-------------------- | :------------------------------------------------------------- |
| `bun run dev`         | Starts all applications (`docs` and `web`) in development mode |
| `bun run dev:web`     | Starts only the playground web application                     |
| `bun run build`       | Builds all packages and applications via Turborepo             |
| `bun run check-types` | Executes TypeScript type-checks across all workspaces          |
| `bun run check`       | Runs Oxlint and Oxfmt for linting and code formatting          |
