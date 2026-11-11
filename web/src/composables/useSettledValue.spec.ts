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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { resolveSettled, useSettledValue } from "@/composables/useSettledValue";
import { STALE_DIM_DELAY_MS } from "@/lib/styles/motion";

describe("resolveSettled", () => {
  it("writes the value when not busy", () => {
    const next = resolveSettled({ value: 3, busy: false, key: "a" }, null);
    expect(next.state).toEqual({ value: 3, stale: false, loading: false });
    expect(next.snapshot).toEqual({ key: "a", value: 3 });
  });

  it("keeps the previous value, marked stale, while a refetch runs under the same key", () => {
    const next = resolveSettled({ value: 9, busy: true, key: "a" }, { key: "a", value: 3 });
    expect(next.state).toEqual({ value: 3, stale: true, loading: false });
  });

  it("drops the previous value when the key changes, so the caller shows its loading marker", () => {
    const next = resolveSettled({ value: null, busy: true, key: "b" }, { key: "a", value: 3 });
    expect(next.state).toEqual({ value: null, stale: false, loading: true });
    expect(next.snapshot).toBeNull();
  });

  it("keeps nothing after a settle with no value", () => {
    const settledEmpty = resolveSettled(
      { value: null, busy: false, key: "a" },
      { key: "a", value: 3 },
    );
    expect(settledEmpty.snapshot).toBeNull();
    const next = resolveSettled({ value: null, busy: true, key: "a" }, settledEmpty.snapshot);
    expect(next.state.loading).toBe(true);
  });
});

describe("useSettledValue", () => {
  let scope = effectScope();
  const input = reactive({ value: 1 as number | null, busy: false, key: "a", live: false });

  beforeEach(() => {
    scope = effectScope();
    vi.useFakeTimers();
    Object.assign(input, { value: 1, busy: false, key: "a", live: false });
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  const run = () => scope.run(() => useSettledValue(() => ({ ...input })))!;

  it("writes the value once, on settle, however often it changes while busy", async () => {
    const { state } = run();
    const seen: (number | null)[] = [state.value.value];
    input.busy = true;
    for (const value of [2, 3, 4]) {
      input.value = value;
      await nextTick();
      seen.push(state.value.value);
    }
    input.busy = false;
    await nextTick();
    seen.push(state.value.value);
    expect([...new Set(seen)]).toEqual([1, 4]);
  });

  it("dims the kept value only after the shared delay, and undims at once on settle", async () => {
    const { state, dimmed } = run();
    input.busy = true;
    await nextTick();
    expect(state.value.stale).toBe(true);
    vi.advanceTimersByTime(STALE_DIM_DELAY_MS - 1);
    expect(dimmed.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(dimmed.value).toBe(true);
    input.busy = false;
    await nextTick();
    expect(dimmed.value).toBe(false);
  });

  it("never dims in live mode", async () => {
    const { state, dimmed } = run();
    input.live = true;
    input.busy = true;
    await nextTick();
    vi.advanceTimersByTime(STALE_DIM_DELAY_MS * 4);
    expect(state.value.stale).toBe(true);
    expect(dimmed.value).toBe(false);
  });

  it("shows no previous value for a new key", async () => {
    const { state, dimmed } = run();
    input.key = "b";
    input.busy = true;
    await nextTick();
    vi.advanceTimersByTime(STALE_DIM_DELAY_MS);
    expect(state.value).toEqual({ value: null, stale: false, loading: true });
    expect(dimmed.value).toBe(false);
  });
});
