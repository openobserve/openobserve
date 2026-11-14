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
import useTimeRangeHost, { type TimeRangeHostOptions } from "./useTimeRangeHost";
import type { TimeRange, TimeRangeApplyMeta } from "@/utils/timeRangeModel";

const route = { query: {} as Record<string, unknown> };
const replace = vi.fn();
const toastSpy = vi.fn();
const storeState = {
  timezone: "UTC",
  organizationData: { organizationSettings: { range_guard_days: 0 } },
};

vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => ({ replace }) }));
vi.mock("vuex", () => ({ useStore: () => ({ state: storeState }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (o: unknown) => toastSpy(o) }));

const PANEL: TimeRangeApplyMeta = { source: "panel", run: false };
const LAST_15M: TimeRange = { kind: "rolling", span: "15m" };
const LAST_1H: TimeRange = { kind: "rolling", span: "1h" };

const host = (options: Partial<TimeRangeHostOptions> = {}) => {
  const scope = effectScope();
  const result = scope.run(() =>
    useTimeRangeHost({
      preset: "explorer-auto",
      source: "Logs",
      initial: () => LAST_15M,
      ...options,
    }),
  )!;
  return { ...result, stop: () => scope.stop() };
};

beforeEach(() => {
  route.query = {};
  replace.mockReset();
  toastSpy.mockReset();
  storeState.organizationData.organizationSettings.range_guard_days = 0;
});

afterEach(() => vi.useRealTimers());

describe("useTimeRangeHost: intake", () => {
  it("opens on the URL's range", () => {
    route.query = { period: "calendar:week:-1" };
    const h = host();
    expect(h.range.value).toEqual({ kind: "calendar", unit: "week", offset: -1 });
    h.stop();
  });

  it("opens an unreadable link on the default with one toast", () => {
    route.query = { from: "200", to: "100" };
    const h = host();
    expect(h.range.value).toEqual(LAST_15M);
    expect(h.invalidLink.value).toBe(true);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("never reads the URL on a form", () => {
    route.query = { period: "1h" };
    const h = host({ preset: "form" });
    expect(h.range.value).toEqual(LAST_15M);
    h.stop();
  });
});

describe("useTimeRangeHost: apply", () => {
  it("replaces the URL and runs at once on explorer-auto", () => {
    const run = vi.fn();
    const h = host({ run });
    h.onApply(LAST_1H, PANEL);
    expect(replace).toHaveBeenCalledWith({ query: { period: "1h" } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.queried.value).toEqual(LAST_1H);
    h.stop();
  });

  it("does nothing for the range already applied", () => {
    const run = vi.fn();
    const h = host({ run });
    h.onApply(LAST_15M, PANEL);
    expect(run).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    h.stop();
  });

  it("waits for Run query on explorer-manual when results are on screen", () => {
    const run = vi.fn();
    const h = host({ preset: "explorer-manual", run, hasResults: () => true });
    h.markQueried();
    h.onApply(LAST_1H, PANEL);
    expect(run).not.toHaveBeenCalled();
    expect(h.stale.value).toBe(true);
    h.runQuery();
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.stale.value).toBe(false);
    h.stop();
  });

  it("runs on explorer-manual for ⌘↵, drag-zoom, an empty page and auto-refresh", () => {
    const run = vi.fn();
    const hasResults = vi.fn(() => true);
    const autoRefreshSeconds = ref(0);
    const h = host({ preset: "explorer-manual", run, hasResults, autoRefreshSeconds });
    h.onApply(LAST_1H, { source: "panel", run: true });
    h.onApply({ kind: "rolling", span: "2h" }, { source: "drag-zoom", run: false });
    hasResults.mockReturnValue(false);
    h.onApply({ kind: "rolling", span: "3h" }, PANEL);
    hasResults.mockReturnValue(true);
    autoRefreshSeconds.value = 60;
    h.onApply({ kind: "rolling", span: "4h" }, PANEL);
    expect(run).toHaveBeenCalledTimes(4);
    h.stop();
  });

  it("runs an undo on explorer-manual only when the range it returns to had run", () => {
    const run = vi.fn();
    const h = host({ preset: "explorer-manual", run, hasResults: () => true });
    h.onApply(LAST_1H, { source: "undo", run: false, undoRuns: false });
    expect(run).not.toHaveBeenCalled();
    h.onApply(LAST_15M, { source: "undo", run: false, undoRuns: true });
    expect(run).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("never runs or writes the URL on a form", () => {
    const run = vi.fn();
    const h = host({ preset: "form", run });
    h.onApply(LAST_1H, PANEL);
    expect(run).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(h.range.value).toEqual(LAST_1H);
    h.stop();
  });

  it("cancels in-flight dashboard queries on undo", () => {
    const cancel = vi.fn();
    const h = host({ preset: "dashboard", cancel, run: vi.fn() });
    h.onApply(LAST_1H, { source: "undo", run: false, undoRuns: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    h.stop();
  });
});

describe("useTimeRangeHost: guards", () => {
  it("holds a range over the org guard until confirmed", () => {
    storeState.organizationData.organizationSettings.range_guard_days = 30;
    const run = vi.fn();
    const h = host({ preset: "dashboard", run, panelCount: () => 6 });
    h.onApply({ kind: "rolling", span: "90d" }, PANEL);
    expect(run).not.toHaveBeenCalled();
    expect(h.guard.value).toMatchObject({ from: LAST_15M, days: 30, panels: 6 });
    h.confirmGuard();
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.guard.value).toBeNull();
    h.stop();
  });

  it("goes back to the old range when the guard is dismissed", () => {
    storeState.organizationData.organizationSettings.range_guard_days = 30;
    const h = host({ preset: "explorer-auto", run: vi.fn() });
    h.onApply({ kind: "rolling", span: "90d" }, PANEL);
    h.dismissGuard();
    expect(h.range.value).toEqual(LAST_15M);
    expect(replace).toHaveBeenLastCalledWith({ query: { period: "15m" } });
    h.stop();
  });

  it("raises auto-refresh to the floor of a wider range, once", () => {
    const autoRefreshSeconds = ref(5);
    const h = host({ autoRefreshSeconds, run: vi.fn() });
    h.onApply({ kind: "rolling", span: "30d" }, PANEL);
    expect(autoRefreshSeconds.value).toBe(3600);
    expect(h.refreshFloorRaised.value).toEqual({ from: 5, to: 3600 });
    h.stop();
  });

  it("reports an ended range", () => {
    const h = host();
    h.onApply({ kind: "calendar", unit: "day", offset: -1 }, PANEL);
    expect(h.rangeEnded.value).toBe(true);
    h.stop();
  });
});
