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

const MICROS_PER_SECOND = 1_000_000;
const KEY_PREFIX = "o2.searchAroundChoice";

/** Half-widths offered, in seconds; `s` choices name seconds and `t` choices minutes, as stored before. */
export const SEARCH_AROUND_SECONDS = [5, 30, 60, 300, 900] as const;
export const SEARCH_AROUND_RECORDS = [10, 20, 50, 100] as const;

/** `s30` is ± 30 seconds, `t5` is ± 5 minutes around the row, `r20` is the 20 records around it. */
export type SearchAroundChoice = `s${number}` | `t${number}` | `r${number}`;

export const DEFAULT_SEARCH_AROUND: SearchAroundChoice = "t5";

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
