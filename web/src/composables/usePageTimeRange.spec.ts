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

import { effectScope } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import usePageTimeRange, { heldGuard, type PageTimeRangeOptions } from "./usePageTimeRange";
import type { TimeRange, TimeRangeApplyMeta } from "@/utils/timeRangeModel";

const route = { query: {} as Record<string, unknown> };
const replace = vi.fn();
const storeState = {
  timezone: "UTC",
  organizationData: { organizationSettings: { range_guard_days: 0 } },
};

vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => ({ replace }) }));
vi.mock("vuex", () => ({ useStore: () => ({ state: storeState }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const PANEL: TimeRangeApplyMeta = { source: "panel", run: false };
const LAST_15M: TimeRange = { kind: "rolling", span: "15m" };
const LAST_1H: TimeRange = { kind: "rolling", span: "1h" };
const LAST_90D: TimeRange = { kind: "rolling", span: "90d" };

const page = (options: Partial<PageTimeRangeOptions> = {}) => {
  const onRange = vi.fn();
  const scope = effectScope();
  const result = scope.run(() =>
    usePageTimeRange({
      preset: "explorer-auto",
      source: "Alert history",
      url: false,
      initial: () => LAST_15M,
      onRange,
      ...options,
    }),
  )!;
  return { ...result, onRange, stop: () => scope.stop() };
};

beforeEach(() => {
  route.query = {};
  replace.mockReset();
  storeState.organizationData.organizationSettings.range_guard_days = 0;
});

describe("usePageTimeRange: run rules reach the page's own handler", () => {
  it("runs the page's handler once with the applied range on an explorer-auto apply", () => {
    const p = page();
    p.onApply(LAST_1H, PANEL);
    p.onDateChange({ relativeTimePeriod: "1h", valueType: "relative", userChangedValue: true });
    expect(p.onRange).toHaveBeenCalledTimes(1);
    expect(p.onRange.mock.calls[0][0]).toMatchObject({
      relativeTimePeriod: "1h",
      valueType: "relative",
      userChangedValue: true,
    });
    p.stop();
  });

  it("treats a user on:date-change with no apply before it as the apply", () => {
    const p = page();
    p.onDateChange({ relativeTimePeriod: "1h", valueType: "relative", userChangedValue: true });
    expect(p.onRange).toHaveBeenCalledTimes(1);
    expect(p.range.value).toEqual(LAST_1H);
    p.stop();
  });

  it("passes a fixed range as absolute instants", () => {
    const p = page();
    const fixed: TimeRange = { kind: "fixed", startUs: 1_000_000, endUs: 2_000_000 };
    p.onApply(fixed, PANEL);
    expect(p.onRange.mock.calls[0][0]).toMatchObject({
      startTime: 1_000_000,
      endTime: 2_000_000,
      valueType: "absolute",
    });
    p.stop();
  });

  it("forwards picker setters and the mount replay, and follows them without writing the URL", () => {
    const p = page({ url: true });
    p.onDateChange({
      relativeTimePeriod: "1h",
      valueType: "relative",
      startTime: 1,
      endTime: 2,
      userChangedValue: false,
    });
    expect(p.onRange).toHaveBeenCalledTimes(1);
    expect(p.range.value).toEqual(LAST_1H);
    expect(replace).not.toHaveBeenCalled();
    p.stop();
  });

  it("writes the URL with replace on a user apply when the page owns no URL writer", () => {
    const p = page({ url: true });
    p.onApply(LAST_1H, PANEL);
    expect(replace).toHaveBeenCalledWith({ query: expect.objectContaining({ period: "1h" }) });
    p.stop();
  });

  it("waits for Run query on explorer-manual while results are on screen", () => {
    const p = page({ preset: "explorer-manual", hasResults: () => true });
    p.onApply(LAST_1H, PANEL);
    expect(p.onRange).not.toHaveBeenCalled();
    expect(p.stale.value).toBe(false);
    p.runQuery();
    expect(p.onRange).toHaveBeenCalledTimes(1);
    p.stop();
  });
});

describe("usePageTimeRange: a page with no separate run", () => {
  it("resolves a rolling range at the moment it runs, not at the last clock tick", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const t0 = Date.UTC(2026, 10, 16, 10, 0, 0);
    vi.setSystemTime(t0);
    const p = page();
    vi.setSystemTime(t0 + 4_000);
    p.onApply(LAST_1H, PANEL);
    expect(p.onRange.mock.calls[0][0]).toMatchObject({
      startTime: (t0 + 4_000 - 3_600_000) * 1000,
      endTime: (t0 + 4_000) * 1000,
    });
    p.stop();
    vi.useRealTimers();
  });
});

describe("usePageTimeRange: a page whose Run query is separate from storing the range", () => {
  it("stores every apply but runs only by the explorer-manual rule", () => {
    const run = vi.fn();
    const p = page({ preset: "explorer-manual", hasResults: () => true, run });
    p.onApply(LAST_1H, PANEL);
    expect(p.onRange).toHaveBeenCalledTimes(1);
    expect(p.onRange.mock.calls[0][0]).toMatchObject({ relativeTimePeriod: "1h" });
    expect(run).not.toHaveBeenCalled();
    expect(p.stale.value).toBe(false);
    p.runQuery();
    expect(run).toHaveBeenCalledTimes(1);
    expect(p.onRange).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("runs at once when nothing is on screen", () => {
    const run = vi.fn();
    const p = page({ preset: "explorer-manual", hasResults: () => false, run });
    p.onApply(LAST_1H, PANEL);
    expect(run).toHaveBeenCalledTimes(1);
    expect(p.queried.value).toEqual(LAST_1H);
    p.stop();
  });
});

describe("usePageTimeRange: org range guard", () => {
  it("holds a range over the guard, then runs it on confirm", () => {
    storeState.organizationData.organizationSettings.range_guard_days = 30;
    const p = page();
    p.onApply(LAST_90D, PANEL);
    expect(p.onRange).not.toHaveBeenCalled();
    expect(p.guard.value).toMatchObject({ from: LAST_15M, to: LAST_90D, days: 30 });
    p.confirmGuard();
    expect(p.onRange).toHaveBeenCalledTimes(1);
    expect(p.onRange.mock.calls[0][0]).toMatchObject({ relativeTimePeriod: "90d" });
    expect(p.guard.value).toBeNull();
    p.stop();
  });

  it("goes back to the old range without re-running it when the picker echoes the move", () => {
    storeState.organizationData.organizationSettings.range_guard_days = 30;
    const p = page();
    p.onApply(LAST_90D, PANEL);
    p.dismissGuard();
    expect(p.range.value).toEqual(LAST_15M);
    p.onDateChange({ relativeTimePeriod: "15m", valueType: "relative", userChangedValue: false });
    expect(p.onRange).not.toHaveBeenCalled();
    expect(p.guard.value).toBeNull();
    p.stop();
  });
});

describe("heldGuard", () => {
  it("reads a dashboard gate's held pair as model ranges", () => {
    const held = {
      from: { valueType: "relative", relativeTimePeriod: "7d", startTime: 1, endTime: 2 },
      to: { valueType: "absolute", startTime: 1_000_000, endTime: 9_000_000 },
    };
    expect(heldGuard(held, 30, 6)).toEqual({
      from: { kind: "rolling", span: "7d" },
      to: { kind: "fixed", startUs: 1_000_000, endUs: 9_000_000 },
      days: 30,
      panels: 6,
    });
  });

  it("is null while nothing is held or the org has no guard", () => {
    expect(heldGuard(null, 30, 6)).toBeNull();
    expect(heldGuard({ from: {}, to: {} }, null, 6)).toBeNull();
  });
});
