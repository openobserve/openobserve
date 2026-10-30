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

/** What "Why N?" reads: the page summary, the popover's own query, and the funnel result. */
export interface WhyInput {
  /** Non-synthetic sessions in range, before any app filter. */
  total: number;
  synthetic: number;
  /** Sessions the built-in bot rule keeps. */
  builtinKept: number;
  /** Sessions every app filter keeps; equals `total` while hidden traffic is included. */
  kept: number;
  opened: number;
  inFilter: number;
  entered: number;
  /** Units each exclusion removed (`xr{j}`), in `x` order. */
  removed: (number | null)[];
  /** Per exclusion, whether it removes at step 1 (a within row anchored on step 1), so before entry. */
  atStep1: boolean[];
  hasFilters: boolean;
}

export type WhyLineId =
  | "app"
  | "synthetic"
  | "bots"
  | "appFilters"
  | "step1"
  | "filters"
  | "conditions"
  | "excludedStep1"
  | "entered"
  | "excluded";

export interface WhyLine {
  id: WhyLineId;
  count: number;
}

export interface WhyLines {
  lines: WhyLine[];
  /** False when the removal lines do not add up to the entry count. */
  exact: boolean;
}

/** The "Why N?" lines in SQL order; every removal line subtracts from the one above it. */
export function whyLines(w: WhyInput): WhyLines {
  const sum = (keep: boolean) =>
    w.removed.reduce<number>((t, n, j) => t + ((w.atStep1[j] ?? false) === keep ? (n ?? 0) : 0), 0);
  const step1Excluded = sum(true);
  const later = sum(false);
  const conditions = w.inFilter - step1Excluded - w.entered;
  const lines: WhyLine[] = [
    { id: "app", count: w.total + w.synthetic },
    { id: "synthetic", count: w.synthetic },
    { id: "bots", count: w.total - w.builtinKept },
    { id: "appFilters", count: w.builtinKept - w.kept },
    { id: "step1", count: w.kept - w.opened },
    ...(w.hasFilters ? [{ id: "filters" as const, count: w.opened - w.inFilter }] : []),
    // Step 1's time, frustration and error options remove sessions the raw step-1 match kept.
    ...(conditions > 0 ? [{ id: "conditions" as const, count: conditions }] : []),
    ...(w.atStep1.some(Boolean) ? [{ id: "excludedStep1" as const, count: step1Excluded }] : []),
    { id: "entered", count: w.entered },
    ...(w.atStep1.some((a) => !a) ? [{ id: "excluded" as const, count: later }] : []),
  ];
  // Step-1 exclusions that remove the same session overcount, which surfaces as a negative conditions line.
  const exact =
    lines.every((l) => l.count >= 0) && conditions >= 0 && w.removed.length === w.atStep1.length;
  return { lines, exact };
}
