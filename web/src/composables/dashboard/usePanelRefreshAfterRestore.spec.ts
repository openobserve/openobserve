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

import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { usePanelRefreshAfterRestore } from "./usePanelRefreshAfterRestore";
import { createDashboardFreshOnOpen, DASHBOARD_FRESH_ON_OPEN } from "./dashboardFreshOnOpen";

const restoredState = () =>
  reactive({
    data: [["restored"]] as any,
    metadata: { queries: [] } as any,
    resultMetaData: [] as any,
    annotations: [] as any,
    errorDetail: { message: "", code: "" } as any,
    sparklineData: [] as any,
    sparklineWarning: "",
    lastTriggeredAt: 1000 as any,
    isCachedDataDifferWithCurrentTimeRange: false,
    isPartialData: false,
    loading: false,
    isOperationCancelled: false,
  });

const setup = ({ autoRun = true, relative = true } = {}) => {
  const state = restoredState();
  const visit = createDashboardFreshOnOpen({
    isAutoRunOn: () => autoRun,
    isRelativeRange: () => relative,
  });
  let refresh: any;
  const Panel = defineComponent({
    setup() {
      refresh = usePanelRefreshAfterRestore({
        state,
        panelSchema: ref({ id: "P1" }),
        dashboardId: ref("D1"),
      });
      return () => h("div");
    },
  });
  mount(
    defineComponent({
      setup() {
        provide(DASHBOARD_FRESH_ON_OPEN, visit);
        return () => h(Panel);
      },
    }),
  );
  return { state, visit, refresh };
};

const WINDOW = { start_time: new Date(1_000_000), end_time: new Date(1_900_000) };

// Simulates an executor starting the refresh run.
const startRun = (state: any, refresh: any) => {
  refresh.holdIfQueued();
  state.loading = true;
  state.data = [];
};

describe("usePanelRefreshAfterRestore", () => {
  it("never queues outside a dashboard view", () => {
    const state = restoredState();
    const refresh = usePanelRefreshAfterRestore({ state, panelSchema: ref({ id: "P1" }) });

    expect(refresh.queueRefresh()).toBe(false);
    refresh.holdIfQueued();
    expect(refresh.isRefreshingInBackground.value).toBe(false);
  });

  it("holds only a queued refresh", () => {
    const { state, refresh } = setup();

    refresh.holdIfQueued();
    expect(refresh.isRefreshingInBackground.value).toBe(false);

    expect(refresh.queueRefresh()).toBe(true);
    startRun(state, refresh);
    expect(refresh.isRefreshingInBackground.value).toBe(true);
    expect(refresh.shownResult.data.value).toEqual([["restored"]]);
  });

  it("shows a write made while holding, and the run's result once it settles", () => {
    const { state, refresh } = setup();
    refresh.queueRefresh();
    startRun(state, refresh);

    refresh.shownResult.errorDetail.value = { message: "render failed", code: "" };
    expect(refresh.shownResult.errorDetail.value.message).toBe("render failed");

    state.data = [["fresh"]];
    state.loading = false;
    expect(refresh.isRefreshingInBackground.value).toBe(false);
    expect(refresh.shownResult.data.value).toEqual([["fresh"]]);
    expect(refresh.shownResult.errorDetail.value.message).toBe("");
  });

  it("puts the restored result back when released early", () => {
    const { state, refresh } = setup();
    refresh.queueRefresh();
    startRun(state, refresh);

    expect(refresh.release(true)).toBe(true);
    expect(state.data).toEqual([["restored"]]);
    expect(state.lastTriggeredAt).toBe(1000);
    expect(refresh.release(true)).toBe(false);
  });

  it("accepts any cached window for a relative range and outside dashboards", () => {
    const { refresh } = setup();
    const outside = usePanelRefreshAfterRestore({
      state: restoredState(),
      panelSchema: ref({ id: "P1" }),
    });

    expect(refresh.acceptsCachedWindow({ start_time: 1, end_time: 2 }, WINDOW)).toBe(true);
    expect(outside.acceptsCachedWindow({ start_time: 1, end_time: 2 }, WINDOW)).toBe(true);
  });

  it("accepts only the exact window for an absolute range, whatever the auto-run setting", () => {
    const { refresh } = setup({ autoRun: false, relative: false });
    const sameWindow = {
      start_time: WINDOW.start_time.getTime(),
      end_time: WINDOW.end_time.getTime(),
    };
    const sameLengthLater = {
      start_time: sameWindow.start_time + 60_000,
      end_time: sameWindow.end_time + 60_000,
    };

    expect(refresh.acceptsCachedWindow(sameWindow, WINDOW)).toBe(true);
    expect(refresh.acceptsCachedWindow(sameLengthLater, WINDOW)).toBe(false);
    expect(refresh.acceptsCachedWindow(undefined, WINDOW)).toBe(false);
  });

  it("marks only a complete, error-free result as refreshed", () => {
    const { state, visit, refresh } = setup();

    state.errorDetail = { message: "boom", code: 500 };
    refresh.markIfComplete();
    expect(visit.wasRefreshed("D1/P1")).toBe(false);

    state.errorDetail = { message: "", code: "" };
    state.isPartialData = true;
    refresh.markIfComplete();
    expect(visit.wasRefreshed("D1/P1")).toBe(false);

    state.isPartialData = false;
    refresh.markIfComplete();
    expect(visit.wasRefreshed("D1/P1")).toBe(true);
  });
});
