import { describe, expect, it } from "bun:test";

import {
	cnicSchema,
	formatDateTime,
	formatFromPaisa,
	formatToPaisa,
	generateTxnRefNo,
	isValidCnic,
	isValidPakistaniPhone,
	normalizePakistaniPhone,
	phoneSchema,
	positiveAmountSchema,
} from "./schema";

describe("Core Validation & Formatting", () => {
	it("normalizes and validates valid Pakistani phone numbers starting with 03 (11 digits)", () => {
		expect(phoneSchema.parse("03001234567")).toBe("03001234567");
		expect(phoneSchema.parse(" 0321-9876543 ")).toBe("03219876543");
		expect(isValidPakistaniPhone("03001234567")).toBe(true);
		expect(normalizePakistaniPhone(" 0300-1234567 ")).toBe("03001234567");
	});

	it("normalizes international formats (+92, 92) and 10-digit formats to standard 03... format", () => {
		expect(phoneSchema.parse("+923001234567")).toBe("03001234567");
		expect(phoneSchema.parse("923001234567")).toBe("03001234567");
		expect(phoneSchema.parse("+92 300 1234567")).toBe("03001234567");
		expect(phoneSchema.parse("3001234567")).toBe("03001234567");
		expect(isValidPakistaniPhone("+923001234567")).toBe(true);
		expect(isValidPakistaniPhone("923001234567")).toBe(true);
	});

	it("strictly rejects invalid phone numbers", () => {
		expect(() => phoneSchema.parse("04212345678")).toThrow();
		expect(() => phoneSchema.parse("03001234")).toThrow();
		expect(() => phoneSchema.parse("abcdefghijk")).toThrow();
		expect(isValidPakistaniPhone("04212345678")).toBe(false);
	});

	it("validates CNIC with cnicSchema (accepting 6-digit suffix or full 13 digits)", () => {
		expect(cnicSchema.parse("123456")).toBe("123456");
		expect(cnicSchema.parse("42101-1234567-1")).toBe("345671"); // Extracts last 6 digits of "4210112345671" -> "345671"
		expect(cnicSchema.parse("4210112345671")).toBe("345671");
		expect(() => cnicSchema.parse("12345")).toThrow();
		expect(() => cnicSchema.parse("1234567")).toThrow();
		expect(() => cnicSchema.parse("abcdef")).toThrow();
		expect(isValidCnic("123456")).toBe(true);
		expect(isValidCnic("42101-1234567-1")).toBe(true);
		expect(isValidCnic("12345")).toBe(false);
	});

	it("converts PKR amount to integer paisas string", () => {
		expect(formatToPaisa(100)).toBe("10000");
		expect(formatToPaisa(1500.5)).toBe("150050");
		expect(formatToPaisa(0.25)).toBe("25");
	});

	it("converts integer paisas back to PKR rupee decimals (formatFromPaisa)", () => {
		expect(formatFromPaisa("10000")).toBe(100);
		expect(formatFromPaisa(10000)).toBe(100);
		expect(formatFromPaisa("150050")).toBe(1500.5);
		expect(formatFromPaisa(150050)).toBe(1500.5);
		expect(formatFromPaisa("25")).toBe(0.25);
		expect(formatFromPaisa(25)).toBe(0.25);
		expect(formatFromPaisa(0)).toBe(0);
		expect(formatFromPaisa("0")).toBe(0);
		expect(formatFromPaisa("  10000  ")).toBe(100);
	});

	it("maintains mathematical symmetry between formatToPaisa and formatFromPaisa", () => {
		const amounts = [1, 100, 1500.5, 0.25, 9999.99, 50000];
		for (const amt of amounts) {
			const paisa = formatToPaisa(amt);
			const rupee = formatFromPaisa(paisa);
			expect(rupee).toBe(amt);
		}
	});

	it("strictly validates inputs in formatFromPaisa", () => {
		expect(() => formatFromPaisa("")).toThrow(/string cannot be empty/);
		expect(() => formatFromPaisa("   ")).toThrow(/string cannot be empty/);
		expect(() => formatFromPaisa("invalid")).toThrow(/Invalid paisa value/);
		expect(() => formatFromPaisa(-100)).toThrow(/Invalid paisa value/);
		expect(() => formatFromPaisa("-50")).toThrow(/Invalid paisa value/);
		expect(() => formatFromPaisa(null as any)).toThrow(/Expected a string or number/);
		expect(() => formatFromPaisa(undefined as any)).toThrow(/Expected a string or number/);
		expect(() => formatFromPaisa(Number.NaN)).toThrow(/Invalid paisa value/);
	});

	it("validates positive amounts", () => {
		expect(positiveAmountSchema.parse(500)).toBe(500);
		expect(() => positiveAmountSchema.parse(0)).toThrow();
		expect(() => positiveAmountSchema.parse(-10)).toThrow();
	});

	it("formats date to YYYYMMDDHHMMSS in PKT timezone", () => {
		// 2026-09-26T09:30:45Z in UTC is 2026-09-26T14:30:45 in Asia/Karachi (UTC+5)
		const utcDate = new Date("2026-09-26T09:30:45Z");
		expect(formatDateTime(utcDate)).toBe("20260926143045");
	});

	it("generates cryptographically secure transaction reference numbers (generateTxnRefNo)", () => {
		const ref = generateTxnRefNo();
		// Prefix "T" + 14-digit PKT timestamp (YYYYMMDDHHMMSS) + 6-digit random number = 21 chars
		expect(ref).toMatch(/^T\d{14}\d{6}$/);

		const customRef = generateTxnRefNo("INV-");
		expect(customRef).toMatch(/^INV-\d{14}\d{6}$/);

		// Concurrency uniqueness: 100 generated refs must be distinct
		const generated = new Set<string>();
		for (let i = 0; i < 100; i++) {
			generated.add(generateTxnRefNo());
		}
		expect(generated.size).toBe(100);
	});
});
