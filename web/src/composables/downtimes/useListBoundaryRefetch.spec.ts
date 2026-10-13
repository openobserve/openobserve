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

import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DowntimeListItem } from "@/services/downtimes";
import { nextListBoundary } from "@/services/downtimes.queries";
import { useListBoundaryRefetch } from "./useListBoundaryRefetch";

const NOW_MS = 1_770_000_000_000;
const NOW_MICROS = NOW_MS * 1000;
const SECOND = 1_000_000;

const item = (overrides: Partial<DowntimeListItem>): DowntimeListItem =>
  ({
    id: "dt",
    status: "scheduled",
    current_window: null,
    next_window: null,
    ...overrides,
  }) as DowntimeListItem;

describe("nextListBoundary", () => {
  it("picks the nearest future start or end across rows", () => {
    const rows = [
      item({ next_window: { start: NOW_MICROS + 30 * SECOND, end: NOW_MICROS + 90 * SECOND } }),
      item({
        status: "active",
        current_window: { start: NOW_MICROS - SECOND, end: NOW_MICROS + 10 * SECOND },
      }),
    ];
    expect(nextListBoundary(rows, NOW_MICROS)).toBe(NOW_MICROS + 10 * SECOND);
  });

  it("ignores past instants and cancelled rows", () => {
    const rows = [
      item({ next_window: { start: NOW_MICROS - SECOND, end: NOW_MICROS } }),
      item({ status: "cancelled", next_window: { start: NOW_MICROS + SECOND, end: 0 } }),
    ];
    expect(nextListBoundary(rows, NOW_MICROS)).toBeUndefined();
  });
});

describe("useListBoundaryRefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => vi.useRealTimers());

  it("refetches one second past the earliest boundary", async () => {
    const refetch = vi.fn();
    const items = ref([item({ next_window: { start: NOW_MICROS + 2 * SECOND, end: 0 } })]);
    const scope = effectScope();
    scope.run(() =>
      useListBoundaryRefetch(
        items,
        () => 1,
        refetch,
        () => Date.now(),
      ),
    );

    await vi.advanceTimersByTimeAsync(2_999);
    expect(refetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("arms nothing for a boundary more than an hour out, and stops on dispose", async () => {
    const refetch = vi.fn();
    const items = ref([item({ next_window: { start: NOW_MICROS + 2 * 3600 * SECOND, end: 0 } })]);
    const scope = effectScope();
    scope.run(() =>
      useListBoundaryRefetch(
        items,
        () => 1,
        refetch,
        () => Date.now(),
      ),
    );
    scope.stop();

    await vi.advanceTimersByTimeAsync(3 * 3600 * 1000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("still refetches at a boundary two hours out while the list stays open", async () => {
    const refetch = vi.fn();
    const start = NOW_MICROS + 2 * 3600 * SECOND;
    const items = ref([item({ next_window: { start, end: start + 3600 * SECOND } })]);
    const scope = effectScope();
    scope.run(() =>
      useListBoundaryRefetch(
        items,
        () => 1,
        refetch,
        () => Date.now(),
        0,
      ),
    );

    await vi.advanceTimersByTimeAsync(2 * 3600 * 1000 + 900);
    expect(refetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("re-arms on the server clock when the skew arrives after the list", async () => {
    const refetch = vi.fn();
    const skew = ref(0);
    const serverNow = () => Date.now() + skew.value;
    // The browser runs five minutes behind; the row starts two seconds after server now.
    const start = (NOW_MS + 5 * 60_000) * 1000 + 2 * SECOND;
    const items = ref([item({ next_window: { start, end: start + 3600 * SECOND } })]);
    const scope = effectScope();
    scope.run(() => useListBoundaryRefetch(items, () => 1, refetch, serverNow, skew));

    skew.value = 5 * 60_000;
    await vi.advanceTimersByTimeAsync(2_900);
    expect(refetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("refetches at once when the corrected clock shows the armed boundary already passed", async () => {
    const refetch = vi.fn();
    const skew = ref(0);
    const serverNow = () => Date.now() + skew.value;
    const start = NOW_MICROS + 2 * SECOND;
    const items = ref([item({ next_window: { start, end: start + 3600 * SECOND } })]);
    const scope = effectScope();
    scope.run(() => useListBoundaryRefetch(items, () => 1, refetch, serverNow, skew));

    skew.value = 10_000;
    await vi.advanceTimersByTimeAsync(0);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("refetches when a skew over an hour arrives after a start the capped timer was waiting on", async () => {
    const refetch = vi.fn();
    const skew = ref(0);
    const serverNow = () => Date.now() + skew.value;
    // The browser runs two hours behind; the row starts two seconds after server now.
    const start = (NOW_MS + 2 * 3600_000) * 1000 + 2 * SECOND;
    const items = ref([item({ next_window: { start, end: start + 3600 * SECOND } })]);
    const scope = effectScope();
    scope.run(() => useListBoundaryRefetch(items, () => 1, refetch, serverNow, skew));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(refetch).not.toHaveBeenCalled();
    skew.value = 2 * 3600_000;
    await vi.advanceTimersByTimeAsync(0);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});
