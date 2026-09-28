/**
 * Normalizes a Pakistani phone number.
 * Accepts local (03xxxxxxxxx), international (+923xxxxxxxxx, 923xxxxxxxxx), or 10-digit formats (3xxxxxxxxx).
 * Returns clean 11-digit string starting with 03 or null if invalid.
 */
export function normalizePakistaniPhone(val: unknown): string | null {
	if (typeof val !== "string") return null;
	let cleaned = val.trim().replace(/[\s-()]/g, "");
	if (cleaned.startsWith("+92")) {
		cleaned = `0${cleaned.slice(3)}`;
	} else if (cleaned.startsWith("0092")) {
		cleaned = `0${cleaned.slice(4)}`;
	} else if (cleaned.startsWith("92")) {
		cleaned = `0${cleaned.slice(2)}`;
	} else if (/^3\d{9}$/.test(cleaned)) {
		cleaned = `0${cleaned}`;
	}
	return /^03\d{9}$/.test(cleaned) ? cleaned : null;
}

/**
 * Checks if a value is a valid Pakistani phone number.
 */
export function isValidPakistaniPhone(val: unknown): boolean {
	return normalizePakistaniPhone(val) !== null;
}

/**
 * Validates a Pakistani CNIC (either 6-digit suffix or full 13-digit CNIC).
 */
export function isValidCnic(val: unknown): boolean {
	if (typeof val !== "string") return false;
	const cleaned = val.trim().replace(/\D/g, "");
	return cleaned.length === 6 || cleaned.length === 13;
}

/**
 * Validates transaction amounts (must be positive number up to 10,000,000 PKR).
 */
export function isValidAmount(val: unknown): boolean {
	return typeof val === "number" && !Number.isNaN(val) && val > 0 && val <= 10_000_000;
}

export interface ValidationSuccess<T> {
	success: true;
	data: T;
}

export interface ValidationFailure {
	success: false;
	error: {
		issues: Array<{ message: string }>;
	};
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export interface Validator<T> {
	safeParse(val: unknown): ValidationResult<T>;
	parse(val: unknown): T;
}

/**
 * Standard Pakistani phone number validator and normalizer.
 * Standalone without requiring any external validation library.
 */
export const phoneSchema: Validator<string> = {
	safeParse(val: unknown): ValidationResult<string> {
		const normalized = normalizePakistaniPhone(val);
		if (!normalized) {
			return {
				success: false,
				error: {
					issues: [
						{
							message: "Invalid Pakistani phone number. Must be an 11-digit number starting with '03' (e.g. 03001234567, +923001234567)",
						},
					],
				},
			};
		}
		return { success: true, data: normalized };
	},
	parse(val: unknown): string {
		const res = this.safeParse(val);
		if (!res.success) {
			throw new Error(res.error.issues[0]?.message);
		}
		return res.data;
	},
};

/**
 * Validates a Pakistani CNIC and extracts the required 6-digit suffix for mobile wallet authorizations.
 * Accepts either the exact last 6 digits ("123456") or a full 13-digit CNIC ("42101-1234567-1" / "4210112345671").
 */
export const cnicSchema: Validator<string> = {
	safeParse(val: unknown): ValidationResult<string> {
		if (typeof val !== "string") {
			return {
				success: false,
				error: {
					issues: [{ message: "Invalid CNIC. Must be a string." }],
				},
			};
		}
		const cleaned = val.trim().replace(/\D/g, "");
		if (cleaned.length === 6) {
			return { success: true, data: cleaned };
		}
		if (cleaned.length === 13) {
			return { success: true, data: cleaned.slice(-6) };
		}
		return {
			success: false,
			error: {
				issues: [
					{
						message: "Invalid CNIC. Must be the last 6 digits or a full 13-digit CNIC (e.g. '123456' or '42101-1234567-1')",
					},
				],
			},
		};
	},
	parse(val: unknown): string {
		const res = this.safeParse(val);
		if (!res.success) {
			throw new Error(res.error.issues[0]?.message);
		}
		return res.data;
	},
};

/**
 * Validates transaction amounts (must be positive number).
 */
export const positiveAmountSchema: Validator<number> = {
	safeParse(val: unknown): ValidationResult<number> {
		if (typeof val !== "number" || Number.isNaN(val) || val <= 0) {
			return {
				success: false,
				error: {
					issues: [{ message: "Transaction amount must be greater than zero" }],
				},
			};
		}
		if (val > 10_000_000) {
			return {
				success: false,
				error: {
					issues: [{ message: "Transaction amount exceeds maximum allowable limit" }],
				},
			};
		}
		return { success: true, data: val };
	},
	parse(val: unknown): number {
		const res = this.safeParse(val);
		if (!res.success) {
			throw new Error(res.error.issues[0]?.message);
		}
		return res.data;
	},
};

/**
 * Converts a PKR amount to integer paisas string (e.g. 1500 -> "150000").
 */
export function formatToPaisa(amount: number): string {
	const rounded = Math.round(amount * 100);
	return rounded.toString();
}

/**
 * Formats a Date object to YYYYMMDDHHMMSS format in Pakistan Standard Time (PKT, UTC+5).
 * Guarantees correct gateway timestamp synchronization regardless of the server's local timezone.
 */
export function formatDateTime(date = new Date()): string {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Karachi",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	let year = "";
	let month = "";
	let day = "";
	let hour = "";
	let minute = "";
	let second = "";
	for (const part of parts) {
		if (part.type === "year") year = part.value;
		else if (part.type === "month") month = part.value;
		else if (part.type === "day") day = part.value;
		else if (part.type === "hour") hour = part.value === "24" ? "00" : part.value;
		else if (part.type === "minute") minute = part.value;
		else if (part.type === "second") second = part.value;
	}
	return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * Generates an expiry timestamp in PKT (default: 1 hour in the future).
 */
export function formatExpiryDateTime(hoursAhead = 1, fromDate = new Date()): string {
	const expiry = new Date(fromDate.getTime() + hoursAhead * 60 * 60 * 1000);
	return formatDateTime(expiry);
}

/**
 * Generates a unique transaction reference number (e.g. "T20260926101234123456").
 */
export function generateTxnRefNo(prefix = "T"): string {
	const timestamp = formatDateTime();
	const random = Math.floor(100000 + Math.random() * 900000);
	return `${prefix}${timestamp}${random}`;
}
