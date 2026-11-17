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

export type ScheduleOverlapKind = "overlap" | "equal" | "gaps";

/** How consecutive checks' look-back windows relate: shared minutes, or unread minutes between them. */
export function scheduleOverlap(
  periodMin: number,
  frequencyMin: number,
): { kind: ScheduleOverlapKind; minutes: number } {
  const diff = periodMin - frequencyMin;
  if (diff > 0) return { kind: "overlap", minutes: diff };
  if (diff < 0) return { kind: "gaps", minutes: -diff };
  return { kind: "equal", minutes: 0 };
}
