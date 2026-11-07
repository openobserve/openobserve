// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from "vitest";
import { createDashboardsContextProvider } from "./dashboardsContextProvider";

describe("createDashboardsContextProvider", () => {
  it("should create context for viewing dashboard", () => {
    const route = {
      query: {
        dashboard: "dash-123",
        tab: "tab-1",
      },
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: "org-456",
        },
      },
    };

    const currentDashboardData = {
      data: {
        title: "Test Dashboard",
        tabs: [
          { tabId: "tab-1", name: "Overview" },
          { tabId: "tab-2", name: "Errors" },
        ],
      },
    };

    const provider = createDashboardsContextProvider(
      route,
      store,
      undefined,
      undefined,
      currentDashboardData,
    );
    const context = provider.getContext();

    expect(context.currentPage).toBe("Dashboards");
    expect(context.dashboardId).toBe("dash-123");
    expect(context.organization_identifier).toBe("org-456");
    expect(context.user_intent).toBe("view dashboard");
    expect(context.dashboardName).toBe("Test Dashboard");
    expect(context.tabId).toBe("tab-1");
    expect(context.tabName).toBe("Overview");
  });

  it("should create context for editing panel", () => {
    const route = {
      query: {
        dashboard: "dash-123",
        panelId: "panel-456",
      },
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: "org-789",
        },
      },
    };

    const dashboardPanelData = {
      data: {
        title: "Test Panel",
      },
    };

    const provider = createDashboardsContextProvider(route, store, dashboardPanelData, true);
    const context = provider.getContext();

    expect(context.currentPage).toBe("Dashboards");
    expect(context.panelId).toBe("panel-456");
    expect(context.user_intent).toBe("edit existing panel");
    expect(context.panelName).toBe("Test Panel");
  });

  it("should create context for creating new panel", () => {
    const route = {
      query: {
        dashboard: "dash-123",
      },
    };

    const store = {
      state: {
        selectedOrganization: {
          identifier: "org-abc",
        },
      },
    };

    const dashboardPanelData = {
      data: {
        title: "New Panel",
      },
    };

    const provider = createDashboardsContextProvider(route, store, dashboardPanelData, false);
    const context = provider.getContext();

    expect(context.currentPage).toBe("Dashboards");
    expect(context.user_intent).toBe("create new panel");
    expect(context.panelName).toBe("New Panel");
  });

  it("should handle missing data gracefully", () => {
    const route = { query: {} };
    const store = { state: { selectedOrganization: null } };

    const provider = createDashboardsContextProvider(route, store);
    const context = provider.getContext();

    expect(context.currentPage).toBe("Dashboards");
    expect(context.dashboardId).toBe("");
    expect(context.organization_identifier).toBe("");
    expect(context.user_intent).toBe("view dashboard");
  });
  it("sends the range the dashboard applies, not the 15 min fallback", () => {
    // pickerValueToTimeObj builds these Dates from microsecond timestamps.
    const startMicros = Date.parse("2026-11-07T00:00:00Z") * 1000;
    const endMicros = Date.parse("2026-11-07T06:00:00Z") * 1000;
    const start = new Date(startMicros);
    const end = new Date(endMicros);
    const provider = createDashboardsContextProvider(
      { query: { dashboard: "d1" } },
      { state: {} },
      undefined,
      false,
      { data: { title: "QA inpage dash", tabs: [] } },
      () => ({ start_time: start, end_time: end, relativeTimePeriod: "6h" }),
    );

    expect(provider.getContext().timeRange).toEqual({
      type: "relative",
      relativeTimePeriod: "6h",
      startTime: startMicros,
      endTime: endMicros,
    });
  });

  it("sends an absolute range without a period", () => {
    const start = new Date(1_000_000);
    const end = new Date(2_000_000);
    const provider = createDashboardsContextProvider(
      { query: {} },
      { state: {} },
      undefined,
      false,
      { data: {} },
      () => ({ start_time: start, end_time: end }),
    );

    expect(provider.getContext().timeRange).toEqual({
      type: "absolute",
      startTime: 1_000_000,
      endTime: 2_000_000,
    });
  });

  it("scopes a viewed dashboard to its panels' streams on the open tab, never a made-up default", () => {
    const dashboard = {
      title: "QA inpage dash",
      tabs: [
        {
          tabId: "t1",
          panels: [
            {
              queryType: "sql",
              queries: [{ fields: { stream: "app_logs", stream_type: "logs" } }],
            },
            { queryType: "sql", queries: [{ fields: { stream: "app_logs" } }] },
          ],
        },
        { tabId: "t2", panels: [{ queries: [{ fields: { stream: "other" } }] }] },
      ],
    };
    const context = createDashboardsContextProvider(
      { query: { dashboard: "d1", tab: "t1" } },
      { state: {} },
      undefined,
      false,
      { data: dashboard },
    ).getContext();

    expect(context.dashboardName).toBe("QA inpage dash");
    expect(context.selectedStreams).toEqual(["app_logs"]);
    expect(context.streamType).toBe("logs");
  });

  it("scopes to the first tab when the URL names none, and omits the type of a mixed scope", () => {
    const dashboard = {
      tabs: [
        {
          tabId: "t1",
          panels: [
            { queryType: "sql", queries: [{ fields: { stream: "app_logs" } }] },
            { queryType: "promql", queries: [{ fields: { stream: "cpu_usage" } }] },
          ],
        },
        { tabId: "t2", panels: [{ queries: [{ fields: { stream: "hidden" } }] }] },
      ],
    };
    const context = createDashboardsContextProvider(
      { query: { dashboard: "d1" } },
      { state: {} },
      undefined,
      false,
      { data: dashboard },
    ).getContext();

    expect(context.selectedStreams).toEqual(["app_logs", "cpu_usage"]);
    expect(context.streamType).toBeUndefined();
  });

  it("sends no stream when neither the dashboard nor the panel names one", () => {
    const viewed = createDashboardsContextProvider(
      { query: { dashboard: "d1" } },
      { state: {} },
      undefined,
      false,
      { data: { title: "Empty", tabs: [{ tabId: "t1", panels: [] }] } },
    ).getContext();
    const editing = createDashboardsContextProvider(
      { query: { dashboard: "d1" } },
      { state: {} },
      { data: { queries: [{ fields: { stream: "" } }] }, layout: { currentQueryIndex: 0 } },
      false,
    ).getContext();

    expect(viewed.selectedStreams).toBeUndefined();
    expect(editing.selectedStreams).toBeUndefined();
    expect(viewed.timeRange).toBeUndefined();
  });

  it("reads a metrics panel's stream type from its query type", () => {
    const context = createDashboardsContextProvider(
      { query: { dashboard: "d1" } },
      { state: {} },
      {
        data: { queryType: "promql", queries: [{ fields: { stream: "cpu" } }] },
        layout: { currentQueryIndex: 0 },
      },
      false,
    ).getContext();

    expect(context.selectedStreams).toEqual(["cpu"]);
    expect(context.streamType).toBe("metrics");
  });
});
