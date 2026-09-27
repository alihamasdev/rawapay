import { describe, expect, it } from "bun:test";

import {
	cnicSchema,
	formatDateTime,
	formatToPaisa,
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

	it("strictly rejects international formats (+92, 92) and invalid phone numbers", () => {
		expect(() => phoneSchema.parse("+923001234567")).toThrow();
		expect(() => phoneSchema.parse("923001234567")).toThrow();
		expect(() => phoneSchema.parse("04212345678")).toThrow();
		expect(() => phoneSchema.parse("03001234")).toThrow();
		expect(() => phoneSchema.parse("abcdefghijk")).toThrow();
		expect(isValidPakistaniPhone("+923001234567")).toBe(false);
		expect(isValidPakistaniPhone("923001234567")).toBe(false);
	});

	it("validates CNIC with cnicSchema (strictly 6 digits)", () => {
		expect(cnicSchema.parse("123456")).toBe("123456");
		expect(() => cnicSchema.parse("12345")).toThrow();
		expect(() => cnicSchema.parse("1234567")).toThrow();
		expect(() => cnicSchema.parse("42101-1234567-1")).toThrow();
		expect(() => cnicSchema.parse("abcdef")).toThrow();
		expect(isValidCnic("123456")).toBe(true);
		expect(isValidCnic("12345")).toBe(false);
	});

	it("converts PKR amount to integer paisas string", () => {
		expect(formatToPaisa(100)).toBe("10000");
		expect(formatToPaisa(1500.5)).toBe("150050");
		expect(formatToPaisa(0.25)).toBe("25");
	});

	it("validates positive amounts", () => {
		expect(positiveAmountSchema.parse(500)).toBe(500);
		expect(() => positiveAmountSchema.parse(0)).toThrow();
		expect(() => positiveAmountSchema.parse(-10)).toThrow();
	});

	it("formats date to YYYYMMDDHHMMSS", () => {
		const fixedDate = new Date(2026, 8, 26, 14, 30, 45); // Month is 0-indexed: 8 = September
		expect(formatDateTime(fixedDate)).toBe("20260926143045");
	});
});
