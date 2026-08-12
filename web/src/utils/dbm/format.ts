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
 * Number formatting shared by every Database Monitoring screen.
 *
 * One module so the same quantity reads identically everywhere: a duration in
 * the Databases table and the same duration on a Top Queries row must not
 * disagree about units or precision, or the two screens look like two products.
 */

/**
 * Durations arrive in NANOSECONDS from the rollup (`total_time_ns`, `p95_ns`).
 *
 * Style deliberately matches `formatTimeWithSuffix` (utils/formatters.ts), the
 * app's norm for span/query latency — ASCII `us`, two decimals with trailing
 * zeros kept, `0us` for a measured zero — because the Service Catalog prints
 * its p50/p95/p99 one tab over and the two must not disagree about a duration.
 * The ASCII `us` also parses back through the traces `UNIT_ALIASES` table,
 * which does not accept the Greek mu.
 *
 * Two tiers the norm lacks are kept, because DBM genuinely reaches both ends:
 * `ns` for sub-microsecond queries (the norm collapses them to `0.00us`) and
 * `h` for database time, which on a busy instance runs to hours (the norm
 * would print three of them as `180.00m`).
 */
export const formatNs = (ns: number | undefined | null): string => {
  if (ns === undefined || ns === null || !Number.isFinite(ns)) return "—";
  if (ns <= 0) return "0us";

  const units: [limit: number, divisor: number, suffix: string][] = [
    [1_000, 1, "ns"],
    [1_000_000, 1_000, "us"],
    [1_000_000_000, 1_000_000, "ms"],
    [60 * 1_000_000_000, 1_000_000_000, "s"],
  ];
  for (const [limit, divisor, suffix] of units) {
    if (ns < limit) return `${(ns / divisor).toFixed(2)}${suffix}`;
  }
  const minutes = ns / (60 * 1_000_000_000);
  return minutes < 60 ? `${minutes.toFixed(2)}m` : `${(minutes / 60).toFixed(2)}h`;
};

/** 3 significant figures without trailing zeros: 1.23, 12.3, 123. */
const trim = (value: number): string => {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return String(Number(value.toFixed(decimals)));
};

/** Grouped integer, or an em dash when the metric was never emitted. */
export const formatCount = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
};

/**
 * Compact counts for dense cells: 1.2k, 3.4M. Below 1000 the exact number is
 * shown, because rounding "847" to "0.8k" loses information for no space.
 */
export const formatCompact = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1000) return String(Math.round(value));
  const units: [threshold: number, suffix: string][] = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "k"],
  ];
  for (const [threshold, suffix] of units) {
    if (Math.abs(value) >= threshold) return `${trim(value / threshold)}${suffix}`;
  }
  return String(value);
};

/**
 * A share as a percentage. Small-but-nonzero shares render as `<0.1%` rather
 * than `0.0%`, so a row that genuinely contributes never claims to contribute
 * nothing.
 */
export const formatPercent = (share: number | undefined | null, decimals = 1): string => {
  if (share === undefined || share === null || !Number.isFinite(share)) return "—";
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(decimals)}%`;
};

/**
 * Queries per second over a window, given the window's length in
 * MICROSECONDS (the unit every DBM endpoint takes its range in).
 */
export const computeQps = (
  calls: number | undefined,
  startTimeUs: number,
  endTimeUs: number,
): number | null => {
  const seconds = (endTimeUs - startTimeUs) / 1_000_000;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return (calls ?? 0) / seconds;
};

/** QPS keeps two decimals below 10 — a 0.05 QPS query is not "0". */
export const formatRate = (value: number | null | undefined): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value < 0.01) return "<0.01";
  return trim(value);
};

/**
 * Error rate as a share of calls. Returns `null` — not `0` — when there were no
 * calls, because "no errors out of nothing" is not a zero error rate.
 */
export const errorRate = (errors: number | undefined, calls: number | undefined): number | null => {
  const total = calls ?? 0;
  if (total <= 0) return null;
  return (errors ?? 0) / total;
};

/**
 * The N+1 multiplier, rendered with the `≈` that `traces_upper_bound` forces:
 * trace counts are an upper bound, so calls-per-trace is a LOWER bound and the
 * number must never be printed as exact.
 */
export const formatCallsPerTrace = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `≈ ×${value >= 10 ? Math.round(value) : trim(value)}`;
};

/**
 * The same quantity for a dense table cell: `15×`.
 *
 * The `≈` is dropped here and the caveat moves to the column's tooltip and the
 * coverage panel. In a cell it read as part of the number rather than as a
 * qualifier, and the honesty it bought was spent on a symbol most readers
 * cannot decode at 11px — while the plain-language rule bans the glyph from
 * visible copy outright. The value is still a lower bound; the tooltip says so
 * in words.
 */
export const formatMultiplier = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${value >= 10 ? Math.round(value) : trim(value)}×`;
};

/**
 * What the Failed column prints: an all-clear, or a count.
 *
 * The total-failure row used to print `all`, which is a category word standing
 * in a column of numbers — and on the row it fired on, the row chip was already
 * shouting ALL 769 FAILED a few inches away. So the column restated the
 * chip's claim in vaguer words while throwing the count away.
 *
 * The split now follows what each surface is good at: the COLUMN carries the
 * quantity, which is scannable down a column and comparable between rows, and
 * the CHIP carries the reason, which is not. The row keeps its red rail, so the
 * every-call-failed case stays legible without needing the word.
 *
 * `"none"` survives for zero because that is the one value where the reader's
 * question really is yes/no — and a bare `0` in a column of counts reads as a
 * measurement, where "none" reads as an all-clear.
 */
export const failedCellKind = (errors: number | undefined | null): "none" | "count" =>
  errors === undefined || errors === null || !Number.isFinite(errors) || errors <= 0
    ? "none"
    : "count";

/** A count, plus whether it is the whole number or only as much as we could read. */
export interface DbmCountClaim {
  count: number;
  /** `false` = the read hit its cap, so `count` is a floor and not a total. */
  complete: boolean;
}

/**
 * What a count is allowed to claim about itself.
 *
 * The event endpoints cap the rows they read and disclose it with `truncated`.
 * A count taken off a capped read is a FLOOR, so every sentence built on it has
 * to say "at least" rather than "every" — the difference between a completeness
 * claim and an undercount presented as a total.
 */
export const countClaim = (count: number, truncated?: boolean): DbmCountClaim => ({
  count,
  complete: !truncated,
});

/**
 * What a tab badge is allowed to print.
 *
 * The badges are counts off the SAME capped reads the sentences use, and they
 * were the one surface that ignored the cap. Measured against a live backend:
 * `/blocking` at its default `limit` of 100 answers `total: 100,
 * truncated: true`, while the identical window at `limit=1000` answers
 * `total: 545, truncated: false`. The Blocked tab therefore rendered a flat
 * `100` — a CEILING shown as a POPULATION. Worse than merely wrong, it is
 * STABLE: it reads 100 today and 100 tomorrow while the real number moves
 * between 300 and 900, so the badge looks like a measurement that is not
 * changing rather than one that is not being taken.
 *
 * `+` is the disclosure: the count is a floor, the truth is at or above it.
 * That keeps the badge to the few characters a tab can hold while refusing the
 * false precision. This is the badge-sized form of the rule `countClaim`
 * already states for prose — a capped read says "at least", never "every".
 *
 * `null` for an unknown count, never `"0"`: every page's `catch` sets the count
 * to `null` when the read FAILED, and a zero badge would claim a quiet database
 * on the strength of a request that never landed. A measured zero is a real
 * answer and still prints.
 *
 * Accepts a bare `number` so the badges with no cap to report (the database
 * count, which is not a row-limited read) keep passing what they always passed.
 */
export const badgeCount = (value: DbmCountClaim | number | null | undefined): string | null => {
  if (value == null) return null;
  if (typeof value === "number") return String(value);
  return value.complete ? String(value.count) : `${value.count}+`;
};

/**
 * Below this, "runs per request" is not worth ink.
 *
 * A query that runs once per request is what every reader already assumes, and
 * on real data that is the large majority of rows — so printing `1×` down the
 * column produces a wall of identical glyphs the eye has to filter through
 * before it can find the row that actually loops. Suppressing the default
 * inverts the column: it is blank except where there is something to see.
 *
 * The cut sits at 2×, well below the N+1 insight's 10×, because the two answer
 * different questions. 10× is "loud enough to interrupt someone"; 2× is "worth
 * a glance while you are already reading this row". A query running 3× per
 * request is a real fan-out even though it never earns a chip.
 */
export const PER_REQUEST_FLOOR = 2;

/**
 * Whether the Per request cell prints a value at all.
 *
 * `null` means we could not compute the ratio (no traces on the row), which is
 * a different thing from 1× and renders the same way — as an em dash — because
 * in both cases the honest answer is "nothing to report here".
 */
export const showsPerRequest = (callsPerTrace: number | null | undefined): boolean =>
  callsPerTrace !== null &&
  callsPerTrace !== undefined &&
  Number.isFinite(callsPerTrace) &&
  callsPerTrace >= PER_REQUEST_FLOOR;

/** A signed percentage for the Δ column: +42%, -18%. */
export const formatSignedPercent = (ratio: number | undefined | null): string => {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  if (Math.abs(pct) > 0 && Math.abs(pct) < 0.1) return `${pct > 0 ? "+" : "-"}<0.1%`;
  return `${sign}${pct.toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%`;
};

/**
 * Collapse a normalized statement to one line for a table cell. The stored text
 * can be 4 KB and carries newlines from the original source, which would
 * otherwise blow out the row height.
 */
export const oneLine = (text: string | undefined | null): string =>
  (text ?? "").replace(/\s+/g, " ").trim();

/**
 * The part of a statement that tells one row apart from another.
 *
 * Plain head-truncation is close to useless on a table of SQL: the first 60
 * characters of a wide SELECT are a column list, and every row in an ORM-backed
 * schema opens the same way — so a column of previews reads as a column of
 * identical strings. What actually discriminates is the TABLE and the
 * PREDICATE, which live from the FROM clause onward.
 *
 * So the preview is anchored at the clause that carries the identity, and the
 * skipped projection is elided rather than dropped, which keeps the statement
 * honestly readable ("SELECT … FROM order_items WHERE order_id = ?") instead of
 * silently implying the query starts at FROM.
 *
 * Statements with no such clause (INSERT, most non-SQL) are already
 * discriminating at their head and are returned unchanged.
 */
const ANCHOR_CLAUSE = /\b(from|into|update|table)\b/i;
/** Below this the whole statement fits a cell, so nothing needs eliding. */
const ANCHOR_MIN_LENGTH = 56;
/** Only skip a projection long enough to be the reason rows look alike. */
const ANCHOR_MIN_SKIP = 24;

export const discriminatingPart = (text: string | undefined | null): string => {
  const line = oneLine(text);
  if (line.length <= ANCHOR_MIN_LENGTH) return line;

  const match = ANCHOR_CLAUSE.exec(line);
  if (!match || match.index < ANCHOR_MIN_SKIP) return line;

  return `… ${line.slice(match.index)}`;
};

/**
 * Replication lag in BYTES of WAL, as `postgresql.replication.data_delay`
 * reports it. Its MySQL counterpart is in seconds under the same role, so the
 * two have separate formatters rather than one that guesses.
 *
 * One decimal only where the leading digit alone would misrepresent the size:
 * "1 KB" for 1536 bytes reads as half of what it is.
 */
export const formatLagBytes = (bytes: number | null | undefined): string => {
  // A negative delay is not a distance behind — it is an unusable reading
  // (clock skew, or a replica reported ahead of its primary). Printing its
  // magnitude would state the opposite of the truth.
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value < 10 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[unit]}`;
};

/**
 * Replication lag in SECONDS, as `mysql.replica.time_behind_source` reports
 * it. Broken into the two largest units because "4096s behind" is a number a
 * reader has to do arithmetic on before it means anything.
 */
export const formatLagSeconds = (seconds: number | null | undefined): string => {
  // Same reasoning as the byte form: a negative lag is unusable, and rendering
  // it as "0s" would claim a caught-up replica we cannot vouch for.
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
