import { describe, expect, it } from "bun:test";

import { calculateSecureHash, verifySecureHash } from "./crypto";

describe("JazzCash Cryptographic Engine", () => {
	const salt = "test_salt_secret_123";

	it("sorts keys alphabetically and produces an uppercase 64-char hex hash", () => {
		const params = {
			pp_MerchantID: "MC12345",
			pp_Amount: "10000",
			pp_TxnRefNo: "T123456",
			pp_BillReference: "BILL-001",
		};

		const hash = calculateSecureHash(params, salt);
		expect(hash).toBeString();
		expect(hash).toHaveLength(64);
		expect(hash).toBe(hash.toUpperCase());
	});

	it("filters out empty, null, undefined, and pp_SecureHash values", () => {
		const paramsWithNoise = {
			pp_MerchantID: "MC12345",
			pp_Amount: "10000",
			pp_SecureHash: "OLD_HASH_SHOULD_BE_IGNORED",
			emptyField: "",
			nullField: null,
			undefinedField: undefined,
		};

		const cleanParams = {
			pp_MerchantID: "MC12345",
			pp_Amount: "10000",
		};

		const hash1 = calculateSecureHash(paramsWithNoise, salt);
		const hash2 = calculateSecureHash(cleanParams, salt);

		expect(hash1).toBe(hash2);
	});

	it("produces deterministic output regardless of input key insertion order", () => {
		const orderA = {
			z_field: "z",
			a_field: "a",
			m_field: "m",
		};

		const orderB = {
			a_field: "a",
			m_field: "m",
			z_field: "z",
		};

		expect(calculateSecureHash(orderA, salt)).toBe(calculateSecureHash(orderB, salt));
	});

	it("verifies authentic response payload signatures", () => {
		const response = {
			pp_ResponseCode: "000",
			pp_ResponseMessage: "Transaction Successful",
			pp_TxnRefNo: "T998877",
			pp_Amount: "50000",
		};

		const signature = calculateSecureHash(response, salt);
		const payloadWithSignature = {
			...response,
			pp_SecureHash: signature,
		};

		expect(verifySecureHash(payloadWithSignature, salt)).toBeTrue();

		// Tampered response should fail
		const tamperedPayload = {
			...payloadWithSignature,
			pp_Amount: "100000", // Tampered amount
		};
		expect(verifySecureHash(tamperedPayload, salt)).toBeFalse();

		// Lowercase hash should also verify (case-insensitive)
		const lowercaseHashPayload = {
			...response,
			pp_SecureHash: signature.toLowerCase(),
		};
		expect(verifySecureHash(lowercaseHashPayload, salt)).toBeTrue();

		// Missing or non-string hash should fail safely
		expect(verifySecureHash(response, salt)).toBeFalse();
		expect(verifySecureHash({ ...response, pp_SecureHash: "" }, salt)).toBeFalse();
		expect(verifySecureHash({ ...response, pp_SecureHash: 123456 as any }, salt)).toBeFalse();
	});
});
