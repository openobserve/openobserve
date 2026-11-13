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

const MICROS_PER_SECOND = 1_000_000;
const MICROS_PER_MS = 1_000;
const KEY_PREFIX = "o2.searchAroundChoice";

/** Half-widths offered, in seconds; `s` choices name seconds and `t` choices minutes, as stored before. */
export const SEARCH_AROUND_SECONDS = [5, 30, 60, 300, 900] as const;
export const SEARCH_AROUND_RECORDS = [10, 20, 50, 100, 200, 500, 1000] as const;

/** `s30` is ± 30 seconds, `t5` is ± 5 minutes around the row, `r20` is the 20 records around it. */
export type SearchAroundChoice = `s${number}` | `t${number}` | `r${number}`;

export const DEFAULT_SEARCH_AROUND: SearchAroundChoice = "t5";

export const WINDOW_QUERY_VIEWS: readonly string[] = ["logs", "drilldown"];

/** An unfiltered query sent instead of `typedQuery` while its window is on screen. */
export interface WindowQuery {
  query: string;
  typedQuery: string;
  view: string;
  startUs: number;
  endUs: number;
  pinned: boolean;
}

/** What a grid run is about to send; null bounds for a relative range. */
export interface WindowQueryRun {
  query: string;
  view: string;
  startUs: number | null;
  endUs: number | null;
}

/** The choice that names a half-width: whole minutes as `t`, anything shorter as `s`. */
export const searchAroundTimeChoice = (seconds: number): SearchAroundChoice =>
  seconds % 60 === 0 ? `t${seconds / 60}` : `s${seconds}`;

export const parseSearchAroundChoice = (
  value: unknown,
): { kind: "time"; seconds: number } | { kind: "records"; count: number } | null => {
  if (typeof value !== "string") return null;
  const match = value.match(/^([str])(\d+)$/);
  if (!match) return null;
  const amount = Number(match[2]);
  if (match[1] === "r") {
    return (SEARCH_AROUND_RECORDS as readonly number[]).includes(amount)
      ? { kind: "records", count: amount }
      : null;
  }
  const seconds = match[1] === "t" ? amount * 60 : amount;
  const offered =
    (SEARCH_AROUND_SECONDS as readonly number[]).includes(seconds) &&
    searchAroundTimeChoice(seconds) === value;
  return offered ? { kind: "time", seconds } : null;
};

export const searchAroundSecondsLabel = (seconds: number, t: TranslateFn): I18nText =>
  seconds < 60
    ? t("dateTime.aroundSeconds", { n: seconds })
    : t("dateTime.aroundMinutes", { n: seconds / 60 });

export const searchAroundTimeOptions = (
  t: TranslateFn,
): { label: I18nText; value: SearchAroundChoice }[] =>
  SEARCH_AROUND_SECONDS.map((seconds) => ({
    label: searchAroundSecondsLabel(seconds, t),
    value: searchAroundTimeChoice(seconds),
  }));

/** The window (µs) of `seconds` either side of a row's timestamp. */
export const searchAroundWindow = (
  timestampUs: number,
  seconds: number,
): { startUs: number; endUs: number } => ({
  startUs: timestampUs - seconds * MICROS_PER_SECOND,
  endUs: timestampUs + seconds * MICROS_PER_SECOND,
});

/** The picker's anchor row for a remembered choice, so a pasted instant starts on the same window. */
export const searchAroundAnchorId = (
  choice: SearchAroundChoice,
): "5m" | "1m" | "30s" | "5s" | null => {
  const parsed = parseSearchAroundChoice(choice);
  if (parsed?.kind !== "time") return null;
  const ids: Record<number, "5m" | "1m" | "30s" | "5s"> = {
    5: "5s",
    30: "30s",
    60: "1m",
    300: "5m",
  };
  return ids[parsed.seconds] ?? null;
};

export const currentSearchAroundUser = (state: { userInfo?: { email?: unknown } }): string =>
  String(state.userInfo?.email ?? "");

// The picker may floor the start to ms and cut the end at now, so the first run pins what it applied.
// Null once the run's range, view or typed query moved on; it never comes back.
export const windowQueryForRun = (
  window: WindowQuery | null | undefined,
  run: WindowQueryRun,
): WindowQuery | null => {
  if (!window || run.view !== window.view || run.query.trim() !== window.typedQuery.trim())
    return null;
  if (run.startUs === null || run.endUs === null) return null;
  if (window.pinned)
    return run.startUs === window.startUs && run.endUs === window.endUs ? window : null;
  const appliedHere =
    Math.abs(run.startUs - window.startUs) < MICROS_PER_MS &&
    run.endUs < window.endUs + MICROS_PER_MS &&
    run.endUs > run.startUs;
  return appliedHere ? { ...window, startUs: run.startUs, endUs: run.endUs, pinned: true } : null;
};

export const searchAroundKey = (user: string): string => `${KEY_PREFIX}.${user}`;

/** The user's last choice, or ± 5 minutes when none was kept or it is no longer offered. */
export const readSearchAroundChoice = (user: string): SearchAroundChoice => {
  try {
    const stored = window.localStorage.getItem(searchAroundKey(user));
    return parseSearchAroundChoice(stored) ? (stored as SearchAroundChoice) : DEFAULT_SEARCH_AROUND;
  } catch {
    return DEFAULT_SEARCH_AROUND;
  }
};

export const writeSearchAroundChoice = (user: string, choice: SearchAroundChoice): void => {
  try {
    window.localStorage.setItem(searchAroundKey(user), choice);
  } catch {
    // A refused write only means the choice is not remembered next time.
  }
};
