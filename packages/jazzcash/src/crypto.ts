import { createHmac } from "node:crypto";

/**
 * Calculates the HMAC-SHA256 signature (pp_SecureHash) for JazzCash transactions.
 *
 * Algorithm specifications:
 * 1. Filter out keys with empty, null, or undefined values, as well as pp_SecureHash itself.
 * 2. Sort remaining parameter keys alphabetically (A-Z).
 * 3. Concatenate values with '&' separator, prefixed with the integritySalt:
 *    `IntegritySalt&val1&val2&val3...`
 * 4. Generate HMAC-SHA256 hash using integritySalt as the key.
 * 5. Convert hash output to uppercase hexadecimal string.
 *
 * @param params Object containing transaction parameters
 * @param integritySalt The secret integrity salt provided by JazzCash
 * @returns 64-character uppercase hexadecimal hash string
 */
export function calculateSecureHash(params: Record<string, unknown>, integritySalt: string): string {
	// 1. Filter out empty, null, undefined values, and pp_SecureHash
	const validKeys = Object.keys(params).filter((key) => {
		if (key === "pp_SecureHash") return false;
		const val = params[key];
		return val !== null && val !== undefined && val !== "";
	});

	// 2. Sort keys alphabetically (ASCII/A-Z)
	validKeys.sort();

	// 3. Concatenate values with '&'
	const sortedValues = validKeys.map((key) => String(params[key]));
	const hashString = sortedValues.length > 0 ? `${integritySalt}&${sortedValues.join("&")}` : integritySalt;

	// 4. Compute HMAC-SHA256 and convert to UPPERCASE hex
	const hmac = createHmac("sha256", integritySalt);
	hmac.update(hashString, "utf8");
	return hmac.digest("hex").toUpperCase();
}

/**
 * Verifies that a response payload's pp_SecureHash matches the calculated hash.
 *
 * @param response JazzCash response payload
 * @param integritySalt The secret integrity salt
 * @returns boolean true if signature is authentic, false otherwise
 */
export function verifySecureHash(response: Record<string, unknown>, integritySalt: string): boolean {
	const receivedHash = response.pp_SecureHash;
	if (typeof receivedHash !== "string" || !receivedHash) {
		return false;
	}

	const computedHash = calculateSecureHash(response, integritySalt);
	return receivedHash.toUpperCase() === computedHash;
}
