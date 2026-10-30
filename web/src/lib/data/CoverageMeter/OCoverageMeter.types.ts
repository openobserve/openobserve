/**
 * OCoverageMeter.types.ts — public types for OCoverageMeter.
 *
 * A confidence read-out for a partially-observed dataset: how much of a total
 * the shown rows account for, and which qualifiers apply to the numbers beside
 * it. Generic by design — it knows nothing about any domain; the call site maps
 * its own API metadata onto these props.
 */

import type { I18nText } from "@/types/i18n";

/**
 * How much of the whole the meter can honestly claim to describe.
 *
 * - `measured`  — the share is computable and the remainder is quantified.
 * - `subset`    — the scope is narrower than the grain the total reconciles at,
 *                 so NO share can be computed. The bar reads as indeterminate
 *                 rather than showing a number that would be a lie.
 * - `unknown`   — no coverage information available yet (loading, or a source
 *                 that carries no coverage metadata).
 */
export type CoverageState = "measured" | "subset" | "unknown";

/**
 * A qualifier attached to the numbers the meter describes. Tone is a
 * consequence of meaning, not a style knob:
 *
 * - `neutral` — approximate, but nothing is missing (an estimate).
 * - `info`    — a distinct-but-fine provenance (a live, not-yet-aggregated tail).
 * - `warning` — the shown numbers describe less than the caller may assume.
 * - `error`   — data is genuinely MISSING from the range in front of you.
 */
export type CoverageNoteTone = "neutral" | "info" | "warning" | "error";

export interface CoverageNote {
  /** Stable id — used as the list key and emitted on click. */
  id: string;
  /** Short chip text. */
  label: I18nText;
  /** Why it fired and what it means for the numbers. Shown on hover. */
  description?: I18nText;
  tone?: CoverageNoteTone;
}

export interface CoverageMeterProps {
  /**
   * Share of the whole accounted for by the shown rows, `0`–`1`. Required for
   * `state: "measured"`; ignored otherwise.
   */
  value?: number;
  /** Coverage state. Default: `"measured"`. */
  state?: CoverageState;
  /** Strip label (e.g. "Coverage"). */
  label?: I18nText;
  /**
   * One line explaining what the shown share is made of, and one explaining the
   * remainder. Rendered under the bar as the meter's own reasoning — this is
   * what makes it a read-out rather than a gauge.
   */
  accountedFor?: I18nText;
  remainder?: I18nText;
  /** Replaces both lines when `state` is not `"measured"`. */
  stateNote?: I18nText;
  /** Qualifier chips: estimated percentiles, truncation, live tail, gaps. */
  notes?: CoverageNote[];
  /** Right-aligned freshness read-out (e.g. "data through 14:37"). */
  freshnessLabel?: I18nText;
  /** Freshness tone — `warning`/`error` when the data is behind. */
  freshnessTone?: CoverageNoteTone;
  /**
   * Below this share the bar switches to the warning tone. Default `0.8` — the
   * point at which the unshown remainder is large enough to change a reading.
   */
  warnBelow?: number;
  /** Below this share the bar switches to the danger tone. Default `0.5`. */
  dangerBelow?: number;
  /** Label for the trailing "explain this" affordance. Omit to hide it. */
  detailsLabel?: I18nText;
  /** `data-test` prefix for this instance. */
  dataTest?: string;
}

export interface CoverageMeterEmits {
  /** The details affordance was activated. */
  (e: "details"): void;
  /** A qualifier chip was activated, with its `CoverageNote.id`. */
  (e: "note", id: string): void;
}
