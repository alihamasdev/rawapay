/**
 * Normalizes a Pakistani phone number.
 * Accepts an 11-digit string starting with 03 (e.g. "03001234567"), optionally containing spaces or dashes.
 * Returns the clean 11-digit string or null if invalid.
 */
export function normalizePakistaniPhone(val: unknown): string | null {
	if (typeof val !== "string") return null;
	const cleaned = val.trim().replace(/[\s-]/g, "");
	return /^03\d{9}$/.test(cleaned) ? cleaned : null;
}

/**
 * Checks if a value is a valid Pakistani phone number (starts with 03, exactly 11 digits).
 */
export function isValidPakistaniPhone(val: unknown): boolean {
	return normalizePakistaniPhone(val) !== null;
}

/**
 * Validates the last 6 digits of a Pakistani CNIC.
 */
export function isValidCnic(val: unknown): boolean {
	if (typeof val !== "string") return false;
	return /^\d{6}$/.test(val.trim());
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
							message: "Invalid Pakistani phone number. Must be an 11-digit number starting with '03' (e.g. 03001234567)",
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
 * Validates the last 6 digits of a Pakistani CNIC.
 */
export const cnicSchema: Validator<string> = {
	safeParse(val: unknown): ValidationResult<string> {
		if (typeof val !== "string" || !isValidCnic(val)) {
			return {
				success: false,
				error: {
					issues: [
						{
							message: "Invalid CNIC. Must be exactly the last 6 digits of the CNIC (e.g. '123456')",
						},
					],
				},
			};
		}
		return { success: true, data: val.trim() };
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
 * Formats a Date object to YYYYMMDDHHMMSS format required by JazzCash.
 */
export function formatDateTime(date = new Date()): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	const seconds = pad(date.getSeconds());
	return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Generates an expiry timestamp (default: 1 hour in the future).
 */
export function formatExpiryDateTime(hoursAhead = 1): string {
	const expiry = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
	return formatDateTime(expiry);
}

/**
 * Generates a unique transaction reference number (e.g. "T202609261012341234").
 */
export function generateTxnRefNo(prefix = "T"): string {
	const timestamp = formatDateTime();
	const random = Math.floor(1000 + Math.random() * 9000);
	return `${prefix}${timestamp}${random}`;
}
