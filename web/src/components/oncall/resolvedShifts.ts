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

import type { UpcomingShift } from "@/components/oncall/OnCallCoverForm.vue";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";

/** How far a lookup reads past a drawn band; the server caps one read at 31 days. */
export const SHIFT_LOOKUP_MICROS = 28 * MICROS_PER_DAY;
/** How far before a band cut at the window's start a lookup reaches back for its real start. */
export const SHIFT_LOOKBACK_MICROS = 7 * MICROS_PER_DAY;

/** The window to read so a band cut at either edge of `window` comes back whole. [pure] */
export function shiftLookupWindow(
  segment: Pick<ResolvedSegment, "from" | "to">,
  window: { from: number; to: number },
): { from: number; to: number } | null {
  const cutStart = segment.from <= window.from;
  const cutEnd = segment.to >= window.to;
  if (!cutStart && !cutEnd) return null;
  const from = cutStart ? segment.from - SHIFT_LOOKBACK_MICROS : segment.from;
  return { from, to: from + SHIFT_LOOKUP_MICROS };
}

/** The resolved run holding `segment`'s person at its start, or the segment itself when none does. [pure] */
export function shiftAround(
  segment: ResolvedSegment,
  runs: readonly ResolvedSegment[],
): { from: number; to: number } {
  const who = segment.user_email ?? null;
  const run = runs.find(
    (one) =>
      one.from <= segment.from &&
      one.to > segment.from &&
      (one.user_email ?? null) === who &&
      (one.override_id ?? null) === (segment.override_id ?? null),
  );
  return run ? { from: run.from, to: run.to } : { from: segment.from, to: segment.to };
}

/** The roster's own turns from `from` on, as swappable shifts: gaps and covers trade nothing. [pure] */
export function swappableRuns(
  runs: readonly ResolvedSegment[],
  rotation: { id: string; name: string },
  from: number,
  max: number,
): UpcomingShift[] {
  return runs
    .filter((run) => !!run.user_email && !run.override_id && run.to > from)
    .slice(0, max)
    .map((run) => ({
      startMicros: run.from,
      endMicros: run.to,
      member: run.user_email ?? "",
      rule: run.rotation ?? undefined,
      rotationId: rotation.id,
      rotationName: rotation.name,
    }));
}

/** Identifies one drawn segment, so a span looked up for it can be found again. [pure] */
export function segmentSpanKey(
  segment: Pick<ResolvedSegment, "rotation_id" | "from" | "to">,
): string {
  return `${segment.rotation_id}:${segment.from}:${segment.to}`;
}

/** Who holds any of `window`, in order, and the one person holding all of it with no gap, if any. [pure] */
export function holdersOver(
  runs: readonly ResolvedSegment[],
  window: { from: number; to: number },
): { people: string[]; sole: string | null } {
  const inside = runs
    .filter((run) => run.to > window.from && run.from < window.to)
    .sort((a, b) => a.from - b.from);
  const people = [...new Set(inside.map((run) => run.user_email ?? "").filter(Boolean))];
  if (people.length !== 1) return { people, sole: null };
  let reached = window.from;
  for (const run of inside) {
    if (run.from > reached || !run.user_email) return { people, sole: null };
    reached = Math.max(reached, run.to);
  }
  return { people, sole: reached >= window.to ? people[0] : null };
}
