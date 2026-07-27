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

/**
 * The rate as a display percentage, or `null` when the input isn't a usable
 * rate yet (empty, non-numeric, or outside 0–1) — the caller then falls back
 * to the static example hint instead of previewing a nonsense percentage.
 *
 * Rounded to one decimal so 1/3 reads as `33.3` rather than `33.33333333333333`,
 * and float artifacts (0.29 * 100 = 28.999999999999996) collapse to `29`.
 */
export function samplingRatePercent(value: string | number): number | null {
  const input = String(value).trim();
  if (!input) return null;

  const rate = Number(input);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return null;

  return Math.round(rate * 1000) / 10;
}

/** Validate and return the scalar rate used by the eval-job API. */
export function parseSamplingRate(value: string | number, label: string): number {
  const input = String(value).trim();
  const rate = Number(input);

  if (!input || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`${label} must be a number between 0 and 1`);
  }

  return rate;
}
