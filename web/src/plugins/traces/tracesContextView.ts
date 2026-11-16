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
import { searchAroundSecondsLabel, type SearchAroundPrevious } from "@/utils/searchAroundWindow";
import { timestampToTimezoneDate } from "@/utils/timezone";

/** Traces' Search around context view (ui-spec §4): the unfiltered window around one row. */
export interface TracesContextView {
  typedQuery: string;
  anchorUs: number;
  seconds: number;
  previous: SearchAroundPrevious;
}

/** Editing the query leaves the view: it shows only while the query bar holds what it was opened with. */
export const contextViewOn = (view: TracesContextView | null, editorValue: string): boolean =>
  !!view && String(editorValue ?? "").trim() === view.typedQuery.trim();

/** Span rows carry nanoseconds, trace rows microseconds. */
export const rowAnchorUs = (row: Record<string, unknown>, mode: string): number | null => {
  const raw = mode === "spans" ? Number(row.start_time) / 1000 : Number(row.trace_start_time);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
};

export const contextViewStripText = (
  view: TracesContextView,
  zone: string,
  t: TranslateFn,
): I18nText =>
  t("timeRangeHost.contextStripTraces", {
    window: searchAroundSecondsLabel(view.seconds, t),
    instant: timestampToTimezoneDate(view.anchorUs / 1000, zone, "HH:mm:ss.SSS"),
  });
