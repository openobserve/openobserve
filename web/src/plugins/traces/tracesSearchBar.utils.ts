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
 * Pure helpers for the traces SearchBar change-detection logic
 * (mount-replay filter), kept separate so they can be unit-tested without
 * mounting the full SFC (which pulls in monaco / vuex).
 */

import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";

/** Subset of `searchObj.data.datetime` that the comparison cares about. */
export interface DatetimeSnapshot {
  startTime: number | string;
  endTime: number | string;
  relativeTimePeriod?: string | null;
  type?: "relative" | "absolute" | string;
}

/** Subset of the value emitted by `<DateTime>` `on:date-change`. */
export interface DatetimeEmit {
  startTime: number | string;
  endTime: number | string;
  relativeTimePeriod?: string | null;
}

/**
 * Decide whether a `<DateTime>` `on:date-change` emit represents a real
 * user-driven change (worth firing a search for) vs the mount-replay
 * the component fires once on its own onMounted.
 *
 * Why this matters:
 *   - The DateTime component emits `on:date-change` once on mount with
 *     its current value (no actual change). Without filtering, a tab
 *     switch that remounts the picker triggers a redundant search.
 *   - For RELATIVE ranges, comparing raw startTime/endTime is unreliable:
 *     the picker recomputes them from `Date.now()` every mount, so the
 *     timestamps drift even when the user's intent ("Past 12 Hours") is
 *     unchanged. We compare `relativeTimePeriod` instead.
 *   - For ABSOLUTE ranges, the user-set boundaries are stable across
 *     remounts, so direct startTime/endTime comparison is correct.
 *
 * @example isDatetimeChanged({startTime:1,endTime:2,relativeTimePeriod:"15m"},
 *                           {startTime:99,endTime:100,relativeTimePeriod:"15m"})
 *   // false — relative period unchanged, mount-replay
 *
 * @example isDatetimeChanged({startTime:1,endTime:2,relativeTimePeriod:"15m"},
 *                           {startTime:99,endTime:100,relativeTimePeriod:"12h"})
 *   // true — user picked a different period
 *
 * @example isDatetimeChanged({startTime:1,endTime:2},      // absolute range
 *                           {startTime:1,endTime:2})
 *   // false — same absolute window
 */
export function isDatetimeChanged(
  prev: DatetimeSnapshot | null | undefined,
  value: DatetimeEmit,
): boolean {
  if (!prev) return true;
  const isRelative = !!value.relativeTimePeriod;
  if (isRelative) {
    if (prev.relativeTimePeriod !== value.relativeTimePeriod || prev.type === "absolute")
      return true;
    // A calendar period's start moves with the timezone, so the same token can name another window.
    const prevStart = Number(prev.startTime);
    const nextStart = Number(value.startTime);
    return (
      parseCalendarToken(value.relativeTimePeriod) !== null &&
      Number.isFinite(prevStart) &&
      Number.isFinite(nextStart) &&
      prevStart !== nextStart
    );
  }
  return prev.startTime !== value.startTime || prev.endTime !== value.endTime;
}

/** The part of the search state a Run applies; a difference from the last Run is a staged change. */
export interface TracesRunState {
  editorValue?: string | null;
  stream?: string | null;
  sqlMode?: boolean;
  datetime: DatetimeSnapshot;
}

export function tracesRunSignature(state: TracesRunState): string {
  const { datetime } = state;
  const period = datetime.relativeTimePeriod;
  const relative = datetime.type !== "absolute" && !!period;
  // A calendar period's window moves with the timezone, so its start is part of what ran.
  const window = relative
    ? [period, parseCalendarToken(period) !== null ? String(datetime.startTime) : ""]
    : [String(datetime.startTime), String(datetime.endTime)];
  return JSON.stringify([
    (state.editorValue ?? "").trim(),
    state.stream ?? "",
    !!state.sqlMode,
    relative,
    ...window,
  ]);
}

/** Run signature of the traces `searchObj`; Index records it per Run and SearchBar compares against it. */
export function tracesSearchRunSignature(searchObj: {
  meta: { sqlMode?: boolean };
  data: {
    editorValue?: string | null;
    stream: { selectedStream?: { value?: string } | null };
    datetime: DatetimeSnapshot;
  };
}): string {
  return tracesRunSignature({
    editorValue: searchObj.data.editorValue,
    stream: searchObj.data.stream.selectedStream?.value,
    sqlMode: searchObj.meta.sqlMode,
    datetime: searchObj.data.datetime,
  });
}

/** True when auto-run is off and the search state differs from the last Run, so the edit waits for Run. */
export function tracesRunIsStaged(
  searchObj: Parameters<typeof tracesSearchRunSignature>[0] & {
    meta: { liveMode?: boolean; lastRunSignature?: string | null };
  },
  autoQueryEnabled: boolean | undefined,
): boolean {
  const autoRunOn = !!autoQueryEnabled && !!searchObj.meta.liveMode;
  const lastRun = searchObj.meta.lastRunSignature;
  return !autoRunOn && !!lastRun && tracesSearchRunSignature(searchObj) !== lastRun;
}

export type TracesToolbarStage = "full" | "compactButtons" | "iconToggle" | "resetInMenu";

// Approximate rendered widths of the left-section items; the only width table the toolbar collapse reads.
export const TRACES_TOOLBAR_WIDTHS = {
  gap: 6,
  buffer: 60,
  toggle: { enterprise: { text: 422, icon: 150 }, oss: { text: 298, icon: 114 } },
  drillDown: { text: 97, icon: 36 },
  reset: { text: 72, icon: 36 },
  more: 70,
  metricsPinned: 78,
  savedViewsPinned: 93,
};

export interface TracesToolbarInput {
  available: number;
  serviceGraph: boolean;
  drillDown: boolean;
  reset: boolean;
  pinnedWidth: number;
}

const LABEL_STAGES: TracesToolbarStage[] = ["full", "compactButtons", "iconToggle"];

function tracesToolbarBaseWidth(input: TracesToolbarInput, stage: TracesToolbarStage): number {
  const w = TRACES_TOOLBAR_WIDTHS;
  const toggle = input.serviceGraph ? w.toggle.enterprise : w.toggle.oss;
  const label = stage === "full" ? "text" : "icon";
  const widths = [
    stage === "full" || stage === "compactButtons" ? toggle.text : toggle.icon,
    w.more,
  ];
  if (input.drillDown) widths.push(w.drillDown[label]);
  if (input.reset && stage !== "resetInMenu") widths.push(w.reset[label]);
  return widths.reduce((sum, x) => sum + x, 0) + (widths.length - 1) * w.gap;
}

/** Picks the collapse stage for a left-section width; labels shrink before a pinned group drops into More. */
export function tracesToolbarLayout(input: TracesToolbarInput): {
  stage: TracesToolbarStage;
  pinnedBudget: number;
} {
  const fits = (stage: TracesToolbarStage, extra: number) =>
    tracesToolbarBaseWidth(input, stage) + extra + TRACES_TOOLBAR_WIDTHS.buffer <= input.available;
  const stage: TracesToolbarStage =
    LABEL_STAGES.find((s) => fits(s, input.pinnedWidth)) ??
    (fits("iconToggle", 0) || !input.reset ? "iconToggle" : "resetInMenu");
  return { stage, pinnedBudget: input.available - tracesToolbarBaseWidth(input, stage) };
}
