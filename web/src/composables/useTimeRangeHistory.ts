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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";
import { parseRollingPeriod } from "@/utils/dateTimeRangeParse";

export const TIME_RANGE_HISTORY_LIMIT = 15;

const KEY_PREFIX = "o2.timeRangeHistory";

export interface AbsoluteHistoryEntry {
  startUs: number;
  endUs: number;
}

/** A rolling `<n><unit>` period or a calendar token, re-resolved against now when picked. */
export interface RelativeHistoryEntry {
  relative: string;
}

/** `source` names the page that applied the range, for Recent's `from {page}`. */
export type TimeRangeHistoryEntry = (AbsoluteHistoryEntry | RelativeHistoryEntry) & {
  source?: string;
};

// Bumped on every write so each mounted picker re-reads the shared list.
const version = ref(0);
// Holds the list only while localStorage refuses writes (private mode, quota, disabled storage).
const memory = new Map<string, TimeRangeHistoryEntry[]>();

export const timeRangeHistoryKey = (org: string, user: string): string =>
  `${KEY_PREFIX}.${org}.${user}`;

export const isRelativeHistoryEntry = (
  entry: TimeRangeHistoryEntry,
): entry is RelativeHistoryEntry => "relative" in entry;

export const isValidRelativePeriod = (period: unknown): period is string =>
  typeof period === "string" &&
  (parseRollingPeriod(period) !== null || parseCalendarToken(period) !== null);

export const isValidHistoryEntry = (value: unknown): value is TimeRangeHistoryEntry => {
  if (!value || typeof value !== "object") return false;
  const { startUs, endUs, relative } = value as Record<string, unknown>;
  if (relative !== undefined) return isValidRelativePeriod(relative);
  return (
    typeof startUs === "number" &&
    typeof endUs === "number" &&
    Number.isFinite(startUs) &&
    Number.isFinite(endUs) &&
    startUs < endUs
  );
};

const normalizeEntry = (entry: TimeRangeHistoryEntry): TimeRangeHistoryEntry => {
  const range: TimeRangeHistoryEntry = isRelativeHistoryEntry(entry)
    ? { relative: entry.relative }
    : { startUs: entry.startUs, endUs: entry.endUs };
  return typeof entry.source === "string" && entry.source
    ? { ...range, source: entry.source }
    : range;
};

export const readTimeRangeHistory = (key: string): TimeRangeHistoryEntry[] => {
  const unsaved = memory.get(key);
  if (unsaved) return unsaved;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidHistoryEntry)
      .map(normalizeEntry)
      .slice(0, TIME_RANGE_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const writeTimeRangeHistory = (key: string, entries: TimeRangeHistoryEntry[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
    memory.delete(key);
  } catch {
    memory.set(key, entries);
  }
  version.value += 1;
};

export const sameHistoryEntry = (a: TimeRangeHistoryEntry, b: TimeRangeHistoryEntry): boolean => {
  if (isRelativeHistoryEntry(a) || isRelativeHistoryEntry(b)) {
    return isRelativeHistoryEntry(a) && isRelativeHistoryEntry(b) && a.relative === b.relative;
  }
  return a.startUs === b.startUs && a.endUs === b.endUs;
};

let watchingOtherTabs = false;

// Another tab's write reaches this one only as a storage event, which the version bump turns into a re-read.
const watchOtherTabs = () => {
  if (watchingOtherTabs || typeof window === "undefined") return;
  watchingOtherTabs = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) version.value += 1;
  });
};

/** Recently applied ranges and periods, newest first, shared by every time picker of the current org and user. */
export default function useTimeRangeHistory() {
  const store = useStore();
  watchOtherTabs();

  const storageKey = computed(() =>
    timeRangeHistoryKey(
      store.state.selectedOrganization?.identifier ?? "",
      store.state.userInfo?.email ?? "",
    ),
  );

  const entries = computed<TimeRangeHistoryEntry[]>(() => {
    void version.value;
    return readTimeRangeHistory(storageKey.value);
  });

  const push = (entry: TimeRangeHistoryEntry) => {
    if (!isValidHistoryEntry(entry)) return;
    const stored = normalizeEntry(entry);
    const rest = readTimeRangeHistory(storageKey.value).filter((e) => !sameHistoryEntry(e, stored));
    writeTimeRangeHistory(storageKey.value, [stored, ...rest].slice(0, TIME_RANGE_HISTORY_LIMIT));
  };

  const add = (startUs: number, endUs: number, source?: string) =>
    push({ startUs: Math.round(startUs), endUs: Math.round(endUs), source });

  const addRelative = (period: string, source?: string) => push({ relative: period, source });

  const remove = (entry: TimeRangeHistoryEntry) => {
    const rest = readTimeRangeHistory(storageKey.value).filter((e) => !sameHistoryEntry(e, entry));
    writeTimeRangeHistory(storageKey.value, rest);
  };

  return { entries, add, addRelative, remove };
}
