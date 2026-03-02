/**
 * Epoch Timestamp Detection and Decoding Utilities
 *
 * Detects numeric values that look like epoch timestamps and provides
 * human-readable decoding. Applied as hover tooltips — additive only,
 * never replacing the original value.
 *
 * Plausibility range: 2000-01-01 to 2100-01-01
 */

// Plausibility bounds in seconds
const EPOCH_MIN_S = 946684800; // 2000-01-01T00:00:00Z
const EPOCH_MAX_S = 4102444800; // 2100-01-01T00:00:00Z

export type EpochUnit = "seconds" | "ms" | "us" | "ns";

/**
 * Known system fields that already have human-readable display elsewhere.
 * Excluded from epoch tooltip to avoid redundant noise.
 */
const SYSTEM_FIELDS = new Set([
  "_timestamp",
  "duration",
  "busy_ns",
  "idle_ns",
]);

/**
 * Determine if a value looks like an epoch timestamp.
 * Returns the detected unit or false if not a plausible timestamp.
 */
export function detectEpochUnit(
  value: string | number | unknown,
  fieldKey?: string,
): EpochUnit | false {
  // Skip known system fields
  if (fieldKey && SYSTEM_FIELDS.has(fieldKey)) return false;

  if (value === null || value === undefined) return false;

  const str = String(value).trim();

  // Must be purely numeric (allow leading minus for detection, then skip negatives)
  if (!/^\d+$/.test(str)) return false;

  const len = str.length;

  // Seconds: 9-10 digits — safe for Number
  if (len >= 9 && len <= 10) {
    const num = Number(str);
    if (!Number.isFinite(num) || num < 0) return false;
    if (num >= EPOCH_MIN_S && num <= EPOCH_MAX_S) return "seconds";
    return false;
  }

  // Milliseconds: 12-13 digits — safe for Number
  if (len >= 12 && len <= 13) {
    const num = Number(str);
    if (!Number.isFinite(num) || num < 0) return false;
    const asSeconds = num / 1000;
    if (asSeconds >= EPOCH_MIN_S && asSeconds <= EPOCH_MAX_S) return "ms";
    return false;
  }

  // Microseconds: 15-16 digits — use BigInt to avoid precision loss
  if (len >= 15 && len <= 16) {
    const big = BigInt(str);
    const asSeconds = Number(big / BigInt(1_000_000));
    if (asSeconds >= EPOCH_MIN_S && asSeconds <= EPOCH_MAX_S) return "us";
    return false;
  }

  // Nanoseconds: 18-19 digits — use BigInt to avoid precision loss
  if (len >= 18 && len <= 19) {
    const big = BigInt(str);
    const asSeconds = Number(big / BigInt(1_000_000_000));
    if (asSeconds >= EPOCH_MIN_S && asSeconds <= EPOCH_MAX_S) return "ns";
    return false;
  }

  return false;
}

/**
 * Convert an epoch value to milliseconds (precision-safe).
 */
export function epochToMs(value: number | string, unit: EpochUnit): number {
  const str = String(value).trim();
  switch (unit) {
    case "seconds":
      return Number(str) * 1000;
    case "ms":
      return Number(str);
    case "us":
      return Number(BigInt(str) / BigInt(1_000));
    case "ns":
      return Number(BigInt(str) / BigInt(1_000_000));
  }
}

/**
 * Decode an epoch value to a human-readable UTC datetime string.
 */
export function decodeEpoch(value: number | string, unit: EpochUnit): string {
  const ms = epochToMs(value, unit);
  const iso = new Date(ms).toISOString(); // "2024-01-15T12:34:56.789Z"
  return iso.replace("T", " ").replace("Z", " UTC");
}

/**
 * Format a millisecond timestamp as a local datetime string.
 */
export function decodeEpochMs(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Convenience: detect and decode in one call.
 * Returns null if not a plausible epoch timestamp.
 */
export function tryDecodeEpoch(
  value: string | number | unknown,
  fieldKey?: string,
): { decoded: string; unit: EpochUnit; ms: number } | null {
  const unit = detectEpochUnit(value, fieldKey);
  if (!unit) return null;
  const ms = epochToMs(value as number | string, unit);
  return {
    decoded: decodeEpoch(value as number | string, unit),
    unit,
    ms,
  };
}

/**
 * Get the unit label for display in tooltip.
 */
export function epochUnitLabel(unit: EpochUnit): string {
  switch (unit) {
    case "seconds":
      return "epoch seconds";
    case "ms":
      return "epoch ms";
    case "us":
      return "epoch µs";
    case "ns":
      return "epoch ns";
  }
}
