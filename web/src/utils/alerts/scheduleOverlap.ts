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

import type { I18nText, TranslateFn } from "@/types/i18n";
import { durationWords, everyWords } from "./alertCopy";

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

/** Checks further apart than the look back leave minutes no check reads; the fix checks as often as
 * the look back, unless the org's minimum interval is longer. */
export function checkGapNote(
  periodMin: number,
  frequencyMin: number,
  floorMin: number,
  t: TranslateFn,
): { text: I18nText; fix: I18nText | null; fixMinutes: number | null } | null {
  if (!(periodMin > 0) || !(frequencyMin > 0)) return null;
  const { kind, minutes } = scheduleOverlap(periodMin, frequencyMin);
  if (kind !== "gaps") return null;
  const fixable = periodMin >= floorMin;
  return {
    text: t("alerts.form.schedule.gapNote", { minutes: durationWords(minutes, t) }, minutes),
    fix: fixable ? t("alerts.guard.checkEvery", { every: everyWords(periodMin, t) }) : null,
    fixMinutes: fixable ? periodMin : null,
  };
}
