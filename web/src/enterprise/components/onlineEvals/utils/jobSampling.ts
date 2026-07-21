// Copyright 2026 OpenObserve Inc.

/**
 * Convert the canonical scalar rate, or the legacy `{ rate }` shape, into the
 * text value used by the job form.
 */
export function samplingRateForForm(value: unknown): string {
  const rate =
    typeof value === "number"
      ? value
      : value && typeof value === "object"
        ? (value as { rate?: unknown }).rate
        : undefined;

  return typeof rate === "number" && Number.isFinite(rate) ? String(rate) : "";
}

/** Validate and return the scalar rate used by the eval-job API. */
export function parseSamplingRate(
  value: string | number,
  label: string,
): number {
  const input = String(value).trim();
  const rate = Number(input);

  if (!input || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`${label} must be a number between 0 and 1`);
  }

  return rate;
}
