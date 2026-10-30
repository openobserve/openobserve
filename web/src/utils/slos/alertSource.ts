// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * The alert-SLI source picker's arithmetic (S-16 §5.1, §5.3).
 *
 * Pure, so the two rules that decide what the form shows — which slice a
 * cadence implies, and where a run stops covering — are testable without a
 * component.
 */

const MICROS = 1_000_000;

/** Slice widths the SLO model supports (S-4), narrowest first. */
const LEGAL_SLICES = [60, 300];

/**
 * The slice a source with this cadence should be measured on: the smallest
 * legal one at least as wide as the cadence (§5.1.3).
 *
 * NOT the cadence itself — slices are pinned to 60/300, so a 30s or 120s
 * cadence has no matching slice. `null` means no legal slice exists: above
 * 300s the source can never fully cover the grid, and at or below zero §5.3's
 * forward extension is zero-width so coverage never accrues at all.
 */
export function smallestLegalSlice(frequencySecs: number): number | null {
  if (!Number.isFinite(frequencySecs) || frequencySecs <= 0) return null;
  return LEGAL_SLICES.find((slice) => frequencySecs <= slice) ?? null;
}

/** One ledger interval as the preview endpoint returns it. */
export interface AlertEvalInterval {
  /** `AlertLevel`'s wire spelling, or null when the build cannot read it. */
  level: string | null;
  frequency_secs: number;
  from_us: number;
  to_us: number;
}

export type UptimeBandState = "good" | "bad" | "unmeasured";

/** One stretch of the ribbon, positioned as a percentage of the range. */
export interface UptimeBand {
  state: UptimeBandState;
  startPct: number;
  widthPct: number;
}

/**
 * §5.2: good is `Ok` and nothing else; `NoData` means "could not tell", which
 * is a gap rather than downtime. A level this build cannot read is a gap too —
 * it must never be drawn green.
 */
function classify(level: string | null): UptimeBandState | null {
  if (level === "ok") return "good";
  if (level === "warning" || level === "critical") return "bad";
  return null;
}

/**
 * Turn ledger intervals into the ribbon's bands.
 *
 * Each run covers `[from_us, to_us + frequency_secs)` — an evaluation is an
 * assessment that stands until the next one is due (§5.3) — under the same two
 * clamps the server's fold applies: never past the range end, and never past
 * the next run's start. Whatever is left over is **unmeasured**, and drawn as
 * such: a pause is neither good nor bad, and colouring it either way is the
 * reading this whole feature exists to prevent (D34).
 *
 * Unlike the server fold this does not apply §5.5's thin-slice rule — a ribbon
 * shows where measurement happened, not which slices cleared the floor.
 */
export function uptimeBands(
  intervals: AlertEvalInterval[],
  rangeStartSecs: number,
  rangeEndSecs: number,
): UptimeBand[] {
  const startUs = rangeStartSecs * MICROS;
  const endUs = rangeEndSecs * MICROS;
  const spanUs = endUs - startUs;
  if (spanUs <= 0) return [];

  // Sorted rather than trusted: the clamp reads the SUCCESSOR, so the answer
  // would otherwise depend on the order the rows arrived in.
  const sorted = [...intervals].sort((a, b) => a.from_us - b.from_us || a.to_us - b.to_us);

  const measured: { from: number; to: number; state: UptimeBandState }[] = [];
  sorted.forEach((iv, idx) => {
    const state = classify(iv.level);
    // An unmeasured run still BOUNDS its predecessor — a run exists at that
    // instant, so the previous one had ended — hence the `continue`, not a
    // filter before the loop.
    if (!state) return;
    const extension = Math.max(0, iv.frequency_secs) * MICROS;
    let to = Math.min(iv.to_us + extension, endUs);
    const next = sorted[idx + 1];
    if (next) to = Math.min(to, next.from_us);
    const from = Math.max(iv.from_us, startUs);
    if (to <= from) return;

    const last = measured[measured.length - 1];
    if (last && last.state === state && last.to >= from) {
      last.to = Math.max(last.to, to);
      return;
    }
    measured.push({ from, to, state });
  });

  const bands: UptimeBand[] = [];
  const push = (from: number, to: number, state: UptimeBandState) => {
    if (to <= from) return;
    bands.push({
      state,
      startPct: ((from - startUs) / spanUs) * 100,
      widthPct: ((to - from) / spanUs) * 100,
    });
  };

  let cursor = startUs;
  for (const run of measured) {
    push(cursor, run.from, "unmeasured");
    push(run.from, run.to, run.state);
    cursor = run.to;
  }
  push(cursor, endUs, "unmeasured");
  return bands;
}
