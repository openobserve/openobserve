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
import { resolveZonedCivil, type ParsedTimeInput } from "@/utils/dateTimeRangeParse";
import { searchAroundSecondsLabel } from "@/utils/searchAroundWindow";

const MICROS_PER_SECOND = 1_000_000;

export const ANCHOR_WINDOWS: readonly { id: AnchorWindowId; halfWidthUs: number }[] = [
  { id: "5m", halfWidthUs: 300 * MICROS_PER_SECOND },
  { id: "1m", halfWidthUs: 60 * MICROS_PER_SECOND },
  { id: "30s", halfWidthUs: 30 * MICROS_PER_SECOND },
  { id: "5s", halfWidthUs: 5 * MICROS_PER_SECOND },
];

export const DEFAULT_ANCHOR_WINDOW: AnchorWindowId = "5m";

export type AnchorWindowId = "5m" | "1m" | "30s" | "5s";

export interface AnchorRow {
  id: AnchorWindowId | "to-now";
  startUs: number;
  endUs: number;
}

/** Rows offered for a lone instant: the four windows around it, then from it to now (fixed when applied). */
export const anchorRows = (centreUs: number, nowUs: number): AnchorRow[] => {
  const windows: AnchorRow[] = ANCHOR_WINDOWS.map(({ id, halfWidthUs }) => ({
    id,
    startUs: centreUs - halfWidthUs,
    endUs: centreUs + halfWidthUs,
  }));
  return centreUs < nowUs
    ? [...windows, { id: "to-now", startUs: centreUs, endUs: nowUs }]
    : windows;
};

/** The instant a reading was widened around, or null when it is not a lone instant. */
export const readingAnchorMicros = (reading: ParsedTimeInput, timezone: string): number | null => {
  if (reading.type === "relative") return null;
  if (reading.type === "timestamp") return reading.centreMicros ?? null;
  if (!reading.centre) return null;
  if (reading.exact) return (reading.exact.startMicros + reading.exact.endMicros) / 2;
  return resolveZonedCivil(reading.centre.date, reading.centre.time, timezone).micros;
};

export const anchorWindowLabel = (id: AnchorRow["id"], t: TranslateFn): I18nText => {
  if (id === "to-now") return t("dateTime.fromHereToNow");
  const seconds =
    (ANCHOR_WINDOWS.find((window) => window.id === id)?.halfWidthUs ?? 0) / MICROS_PER_SECOND;
  return searchAroundSecondsLabel(seconds, t);
};
