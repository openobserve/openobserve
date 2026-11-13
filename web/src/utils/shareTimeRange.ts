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

import { formatRangeLabel, formatZoneOffset, type RangeLabelSurface } from "@/utils/timeRangeLabel";

/** A fixed link pins the window it was copied with; a live one re-resolves its period when opened. */
export type ShareTimeKind = "fixed" | "live";

/** The same link with the time held as a relative period instead of fixed bounds; null when it cannot be. */
export const withRollingPeriod = (
  url: string,
  period: string | null | undefined,
): string | null => {
  if (!url || !period) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete("from");
    parsed.searchParams.delete("to");
    parsed.searchParams.set("period", period);
    return parsed.href;
  } catch {
    return null;
  }
};

/** The kinds a share menu offers, the page default first; a range that is already fixed offers only fixed. */
export const shareTimeKinds = (defaultKind: ShareTimeKind, hasLive: boolean): ShareTimeKind[] => {
  if (!hasLive) return ["fixed"];
  return defaultKind === "live" ? ["live", "fixed"] : ["fixed", "live"];
};

/** The line naming what a shared link opens: `{context} · {range} · {kind}`. */
export const rangeLineText = (options: { context: string; range: string; kind: string }): string =>
  [options.context, options.range, options.kind].filter(Boolean).join(" · ");

/** Two lines for a ticket: the link, then the range line, so the reader knows what it opens. */
export const linkWithRangeText = (options: {
  url: string;
  context: string;
  range: string;
  kind: string;
}): string => `${options.url}\n${rangeLineText(options)}`;

/** Bounds of a dashboard time object, whose Dates carry microseconds where milliseconds would be. */
export const dashboardTimeUs = (
  time: { start_time?: Date; end_time?: Date } | null | undefined,
): { startUs: number; endUs: number } | null => {
  const startUs = time?.start_time?.getTime?.();
  const endUs = time?.end_time?.getTime?.();
  if (!startUs || !endUs || !(endUs > startUs)) return null;
  return { startUs, endUs };
};

/** A fixed link's window as the menu, toast and copied line name it: the range, then its zone. */
export const fixedShareLabel = (
  startUs: number,
  endUs: number,
  timezone: string | null | undefined,
  surface: RangeLabelSurface = "toast",
): string => {
  if (!(startUs > 0 && endUs > startUs)) return "";
  const range = formatRangeLabel({ startUs, endUs }, { timezone, surface });
  return `${range} ${formatZoneOffset(timezone, endUs / 1000)}`;
};
