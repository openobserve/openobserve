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

export const TIME_RANGE_HISTORY_LIMIT = 15;

const KEY_PREFIX = "o2.timeRangeHistory";

export interface TimeRangeHistoryEntry {
  startUs: number;
  endUs: number;
}

// Bumped on every write so each mounted picker re-reads the shared list.
const version = ref(0);
// Holds the list only while localStorage refuses writes (private mode, quota, disabled storage).
const memory = new Map<string, TimeRangeHistoryEntry[]>();

export const timeRangeHistoryKey = (org: string, user: string): string =>
  `${KEY_PREFIX}.${org}.${user}`;

export const isValidHistoryEntry = (value: unknown): value is TimeRangeHistoryEntry => {
  if (!value || typeof value !== "object") return false;
  const { startUs, endUs } = value as Record<string, unknown>;
  return (
    typeof startUs === "number" &&
    typeof endUs === "number" &&
    Number.isFinite(startUs) &&
    Number.isFinite(endUs) &&
    startUs < endUs
  );
};

export const readTimeRangeHistory = (key: string): TimeRangeHistoryEntry[] => {
  const unsaved = memory.get(key);
  if (unsaved) return unsaved;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidHistoryEntry)
      .map(({ startUs, endUs }) => ({ startUs, endUs }))
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

const sameRange = (a: TimeRangeHistoryEntry, b: TimeRangeHistoryEntry) =>
  a.startUs === b.startUs && a.endUs === b.endUs;

/** Recently applied absolute ranges, newest first, shared by every time picker of the current org and user. */
export default function useTimeRangeHistory() {
  const store = useStore();

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

  const add = (startUs: number, endUs: number) => {
    const entry = { startUs: Math.round(startUs), endUs: Math.round(endUs) };
    if (!isValidHistoryEntry(entry)) return;
    const rest = readTimeRangeHistory(storageKey.value).filter((e) => !sameRange(e, entry));
    writeTimeRangeHistory(storageKey.value, [entry, ...rest].slice(0, TIME_RANGE_HISTORY_LIMIT));
  };

  const remove = (entry: TimeRangeHistoryEntry) => {
    const rest = readTimeRangeHistory(storageKey.value).filter((e) => !sameRange(e, entry));
    writeTimeRangeHistory(storageKey.value, rest);
  };

  return { entries, add, remove };
}
