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
import {
  isRelativeHistoryEntry,
  isValidHistoryEntry,
  sameHistoryEntry,
  type TimeRangeHistoryEntry,
} from "@/composables/useTimeRangeHistory";

const KEY_PREFIX = "o2.timeRangePins";
const MAX_NAME_LENGTH = 80;

/** A range the user pinned, with the name they gave it; empty means the label falls back to the range. */
export interface TimeRangePin {
  id: string;
  name: string;
  range: TimeRangeHistoryEntry;
}

// Bumped on every write so each mounted picker re-reads the shared list.
const version = ref(0);
// Holds the list only while localStorage refuses writes (private mode, quota, disabled storage).
const memory = new Map<string, TimeRangePin[]>();

export const timeRangePinsKey = (org: string, user: string): string =>
  `${KEY_PREFIX}.${org}.${user}`;

const isValidPin = (value: unknown): value is TimeRangePin => {
  if (!value || typeof value !== "object") return false;
  const { id, name, range } = value as Record<string, unknown>;
  return (
    typeof id === "string" && id !== "" && typeof name === "string" && isValidHistoryEntry(range)
  );
};

const normalizePin = (pin: TimeRangePin): TimeRangePin => ({
  id: pin.id,
  name: pin.name.slice(0, MAX_NAME_LENGTH),
  range: isRelativeHistoryEntry(pin.range)
    ? { relative: pin.range.relative }
    : { startUs: pin.range.startUs, endUs: pin.range.endUs },
});

export const readTimeRangePins = (key: string): TimeRangePin[] => {
  const unsaved = memory.get(key);
  if (unsaved) return unsaved;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isValidPin).map(normalizePin) : [];
  } catch {
    return [];
  }
};

const writeTimeRangePins = (key: string, pins: TimeRangePin[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(pins));
    memory.delete(key);
  } catch {
    memory.set(key, pins);
  }
  version.value += 1;
};

const newPinId = (pins: TimeRangePin[]): string => {
  let id = Date.now().toString(36);
  while (pins.some((pin) => pin.id === id)) id = `${id}x`;
  return id;
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

/** Pinned ranges of the current org and user, newest first; kept apart from Recent so its limit never evicts them. */
export default function useTimeRangePins() {
  const store = useStore();
  watchOtherTabs();

  const storageKey = computed(() =>
    timeRangePinsKey(
      store.state.selectedOrganization?.identifier ?? "",
      store.state.userInfo?.email ?? "",
    ),
  );

  const pins = computed<TimeRangePin[]>(() => {
    void version.value;
    return readTimeRangePins(storageKey.value);
  });

  /** Pins the range at the top, or returns the id it is already pinned under. */
  const pin = (range: TimeRangeHistoryEntry): string | null => {
    if (!isValidHistoryEntry(range)) return null;
    const current = readTimeRangePins(storageKey.value);
    const existing = current.find((item) => sameHistoryEntry(item.range, range));
    if (existing) return existing.id;
    const created = normalizePin({ id: newPinId(current), name: "", range });
    writeTimeRangePins(storageKey.value, [created, ...current]);
    return created.id;
  };

  const rename = (id: string, name: string) => {
    const current = readTimeRangePins(storageKey.value);
    writeTimeRangePins(
      storageKey.value,
      current.map((item) =>
        item.id === id ? { ...item, name: name.trim().slice(0, MAX_NAME_LENGTH) } : item,
      ),
    );
  };

  const unpin = (id: string) => {
    const current = readTimeRangePins(storageKey.value);
    writeTimeRangePins(
      storageKey.value,
      current.filter((item) => item.id !== id),
    );
  };

  return { pins, pin, rename, unpin };
}
