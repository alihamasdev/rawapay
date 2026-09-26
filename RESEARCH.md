# RawaPay: "Stripe for Pakistan" Architecture & Provider Specification

> **Project:** `rawapay` (Universal Payment Infrastructure & TypeScript SDK for Pakistan)  
> **Initial Driver/Provider:** JazzCash Payment Gateway (Direct MWALLET, Cards, OTC, Inquiry, Refunds)  
> **Status:** Architecture Specification & Research Report  

---

## 1. JazzCash Payment Gateway: Deep-Dive Technical Mechanics

JazzCash is the flagship provider being implemented in `rawapay`. Below is the complete technical analysis of its API operations, parameters, cryptographic hash system, and edge cases.

### 1.1 Environments & Gateways

1. **Sandbox Environment:** `https://sandbox.jazzcash.com.pk/`
   - Used for simulated payments (MWALLET, Card, OTC).
   - Generates Merchant ID, Password, and Integrity Salt for testing.
2. **Production Environment:** `https://payments.jazzcash.com.pk/`
   - Used for real money transactions once merchant compliance and IP whitelisting are complete.

### 1.2 Credentials Required

- **`pp_MerchantID`**: Assigned Merchant identifier.
- **`pp_Password`**: Merchant gateway password.
- **`pp_IntegritySalt` (Hash Key)**: Secret cryptographic salt used for signing request and response payloads.

---

### 1.3 The Cryptographic Integrity Engine (`pp_SecureHash`)

JazzCash relies on HMAC-SHA256 signing to guarantee that transaction payloads (amounts, references, merchant credentials) are not tampered with in transit.

```
                  ┌──────────────────────────────────────────────┐
                  │ 1. Collect all non-empty transaction fields  │
                  └──────────────────────┬───────────────────────┘
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 2. Sort parameters Alphabetically (A to Z)   │
                  │    (Excluding pp_SecureHash itself)          │
                  └──────────────────────┬───────────────────────┘
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 3. Concatenate values with '&' separator:    │
                  │    IntegritySalt & val1 & val2 & val3 ...    │
                  └──────────────────────┬───────────────────────┘
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 4. Compute HMAC-SHA256 using IntegritySalt   │
                  │    Convert digest to UPPERCASE Hex String    │
                  └──────────────────────────────────────────────┘
```

#### Common Integration Pitfalls & How `rawapay` Solves Them:

1. **Strict Alphabetical Ordering:** Parameter keys must be ordered strictly by ASCII/alphabetical order. `rawapay` automates this cleanly using an immutable sorting pipeline.
2. **Empty or Null Parameters:** JazzCash rejects hashes if empty fields are concatenated incorrectly. `rawapay` automatically prunes `undefined` and empty values before signing.
3. **Response Verification:** When receiving callbacks or IPN webhooks, `rawapay` validates the response `pp_SecureHash` automatically via `rawapay.webhooks.constructEvent()`.

---

### 1.4 Core Transaction Parameters

| Parameter | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `pp_Version` | String | API Version (`1.1` or `2.0`) | `"2.0"` |
| `pp_TxnType` | String | Payment instrument type | `"MWALLET"`, `"MPAY"` |
| `pp_MerchantID` | String | Merchant ID | `"MC12345"` |
| `pp_Password` | String | Gateway Password | `"xxxxxx"` |
| `pp_TxnRefNo` | String | Unique merchant transaction reference | `"T20260925170001"` |
| `pp_Amount` | String | Transaction amount (e.g. PKR 1,500.00 = `"150000"`) | `"150000"` |
| `pp_TxnCurrency` | String | Currency code | `"PKR"` |
| `pp_TxnDateTime` | String | Timestamp format: `YYYYMMDDHHMMSS` | `"20260925170119"` |
| `pp_TxnExpiryDateTime` | String | Expiry timestamp: `YYYYMMDDHHMMSS` | `"20260925180119"` |
| `pp_BillReference` | String | Invoice or order identifier | `"INV-1024"` |
| `pp_Description` | String | Transaction memo | `"Order Payment #1024"` |
| `pp_ReturnURL` | String | Merchant redirect landing page | `"https://merchant.pk/api/callback"` |
| `pp_SecureHash` | String | HMAC-SHA256 signature | `"9A5D6B...F31C"` |
| `pp_ResponseCode` | String | Gateway status code (`000` = Success) | `"000"` |
| `pp_ResponseMessage` | String | Status description | `"Transaction Successful"` |

---

### 1.5 Supported JazzCash API Operations

#### 1. Mobile Wallet (MWALLET - Direct REST API `DoMWalletTransaction`)

- Customer provides their JazzCash mobile number (e.g. `03001234567`) and the last 6 digits of their CNIC.
- Direct server-to-server POST to `/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction`.
- **Handset Push Authorization:** A real-time USSD push prompt appears on the user's phone: _"Authorize payment of PKR 1,500 to Merchant? Enter MPIN."_
- Once entered, transaction is authorized.

#### 2. Card Payments (Mastercard / Visa)

- Hosted Redirection flow powered by MPGS (Mastercard Payment Gateway Services) with 3D-Secure OTP verification.

#### 3. Over-The-Counter (OTC) / Vouchers

- Generates an OTC token for customers who want to pay with cash at 100,000+ JazzCash retail agent shops or via 1Link 1Bill.

#### 4. Transaction Status Inquiry (`InquireTxn`)

- Proactively checks transaction status when mobile push timeouts or network drops occur before redirect callback.

#### 5. Programmatic Refunds (`DoRefundTransaction`)

- Reverses funds back to customer's mobile wallet or card without manual portal intervention.

---

## 2. The Unified RawaPay Architecture

All functionality is exported from a single unified package: **`rawapay`**. Developers never need to juggle separate packages or complex provider factory imports.

### 2.1 Developer Usage Experience

```typescript
import { RawaPay } from "rawapay";

// 1. Initialize RawaPay with one or multiple providers
export const pay = new RawaPay({
  providers: {
    jazzcash: {
      merchantId: process.env.JAZZCASH_MERCHANT_ID!,
      password: process.env.JAZZCASH_PASSWORD!,
      integritySalt: process.env.JAZZCASH_INTEGRITY_SALT!,
      environment: "sandbox", // "sandbox" | "production"
      returnUrl: "https://myshop.pk/api/pay/callback",
    },
    // easypaisa: { ... } (Future providers)
  },
});

// 2. Create Payment using the Safe-Result Pattern (data / error)
const { data, error } = await pay.payment.create({
  provider: "jazzcash",
  method: "mwallet", // "mwallet" | "card" | "voucher"
  amount: 1500, // PKR 1,500
  mobileNumber: "03001234567",
  cnicLast6: "123456",
  billReference: "INV-1001",
  description: "E-commerce Order #1001",
});

if (error) {
  // Strongly typed RawaPayError
  console.error(`[${error.code}] ${error.message} (Raw code: ${error.rawCode})`);
  return;
}

// Strongly typed Payment result
console.log(data.id, data.status, data.txnRefNo);
```

### 2.2 Key Architectural Tenets

1. **Single Entry Point (`rawapay`):** All providers and types are packaged into `rawapay`. Internal modular packages (`@rawapay/core`, `@rawapay/jazzcash`) maintain clean internal boundaries while bundling seamlessly into the root `rawapay` export.
2. **Discriminated Union Type Safety:** Passing `{ provider: "jazzcash" }` automatically activates TypeScript autocomplete and strict validation for JazzCash-specific parameters (`mobileNumber`, `cnicLast6`), rejecting fields that don't belong.
3. **Safe-Result Pattern (`{ data, error }`):** Prevents unhandled runtime crashes, giving developers full control over error states without requiring nested try/catch blocks everywhere.
4. **100% Exported Types:** Every parameter, response model, error code, and raw gateway response is exported.

---

## 3. Monorepo Structure

```
rawapay/
├── apps/
│   ├── docs/                 # Documentation site (Next.js & Fumadocs)
│   └── web/                  # Interactive demo app & checkout tester (Next.js)
├── packages/
│   ├── config/               # Shared TypeScript configurations (@rawapay/config)
│   ├── core/                 # Internal: Provider contracts, errors, Result<T,E>, Zod schemas (@rawapay/core)
│   ├── jazzcash/             # Internal: JazzCash driver, crypto, REST client, error mapping (@rawapay/jazzcash)
│   └── rawapay/              # 🚀 The published NPM package bundling all providers & unified RawaPay class
├── turbo.json                # Turborepo task pipelines
└── package.json              # Monorepo workspaces definition
```

---

## 4. Development Roadmap

1. **Step 1: `@rawapay/core` Setup**
   * Result type (`{ data: T; error: null } | { data: null; error: RawaPayError }`).
   * Provider interfaces & lifecycle contracts (`PaymentDriver`).
   * Unified error hierarchy & error code enums.
   * Shared Zod schemas (Pakistani phone numbers `03xx`, CNIC 6/13 digits, amounts).
   * 100% exported types.

2. **Step 2: `@rawapay/jazzcash` Driver**
   * Cryptographic engine: HMAC-SHA256 signature calculation & strict alphabetical sorting.
   * Direct MWALLET client (`DoMWalletTransaction`) with USSD push prompt flow.
   * Hosted Checkout Redirection form generator.
   * Transaction Inquiry (`InquireTxn`) & Refund (`DoRefundTransaction`).
   * Comprehensive error mapping (handling JazzCash codes: `000`, `101`, `110`, `115`, `116`, `118`, `119`, `120`, `122`, `123`, `157`, `199`, `999`).

3. **Step 3: Unified `rawapay` Package Assembly**
   * Implement the `RawaPay` class with `{ providers: { jazzcash: { ... } } }` configuration.
   * Expose `pay.payment.create({ provider: "jazzcash", ... })` with discriminated union type safety.
   * Expose `pay.payment.inquire()` and `pay.payment.refund()`.
   * Export all types from index.

4. **Step 4: Webhook Handler & Verification**
   * Implement `pay.webhooks.constructEvent()` / `pay.webhooks.verify()` to securely authenticate postbacks.

5. **Step 5: Interactive Demo (`apps/web`) & Documentation (`apps/docs`)**
   * Connect demo checkout in `apps/web` with real-time UI response feedback.
   * Build interactive docs and examples in `apps/docs`.

6. **Step 6: NPM Release**
   * Publish `rawapay` v1.0.0 to the npm registry.
