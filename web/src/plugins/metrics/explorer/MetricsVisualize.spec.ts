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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// A fresh panel-data object per test so mounting can reset it in place and the
// assertions see the metrics defaults the container applied.
const makePanelData = () => ({
  data: {
    type: "",
    queryType: "",
    queries: [{ customQuery: true, fields: { stream_type: "", stream: "" } }],
  },
  layout: { showQueryBar: false },
});

const panelData = vi.hoisted(() => ({ current: null as any }));
const resetDashboardPanelData = vi.hoisted(() => vi.fn());
const validatePanel = vi.hoisted(() => vi.fn());

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: panelData.current,
    resetDashboardPanelData,
    validatePanel,
  }),
}));

// The real PanelEditor pulls in ECharts + the whole dashboard config surface;
// none of that is what this container's own logic needs. Stub it, but keep its
// emit so the add-to-dashboard handshake can be driven.
vi.mock("@/components/dashboards/PanelEditor", () => ({
  PanelEditor: {
    name: "PanelEditor",
    emits: ["add-to-dashboard", "chart-api-error"],
    template:
      '<div data-test="panel-editor-stub"><button data-test="stub-add" @click="$emit(\'add-to-dashboard\')" /></div>',
  },
}));

vi.mock("../AddToDashboard.vue", () => ({
  default: {
    name: "AddToDashboard",
    props: ["open", "dashboardPanelData"],
    template: '<div data-test="add-to-dashboard-stub" />',
  },
}));

const showErrorNotification = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification }),
}));

vi.mock("@/utils/streamPersist", () => ({
  restoreMetricsStream: vi.fn(() => ""),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org1" },
      zoConfig: { auto_query_enabled: false },
    },
  }),
}));

import MetricsVisualize from "./MetricsVisualize.vue";

const mountVisualize = () =>
  mount(MetricsVisualize, {
    global: {
      stubs: {
        // any leftover global component; PanelEditor + AddToDashboard are mocked
      },
    },
  });

describe("MetricsVisualize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panelData.current = makePanelData();
  });

  it("applies the metrics panel defaults on mount (line + promql + query bar)", async () => {
    mountVisualize();
    await flushPromises();

    expect(resetDashboardPanelData).toHaveBeenCalled();
    expect(panelData.current.data.type).toBe("line");
    expect(panelData.current.data.queryType).toBe("promql");
    expect(panelData.current.data.queries[0].customQuery).toBe(false);
    expect(panelData.current.data.queries[0].fields.stream_type).toBe(
      "metrics",
    );
    expect(panelData.current.layout.showQueryBar).toBe(true);
  });

  it("opens the add-to-dashboard dialog only when the panel validates", async () => {
    validatePanel.mockImplementation(() => {}); // no errors pushed
    const wrapper = mountVisualize();
    await flushPromises();

    await wrapper.find('[data-test="stub-add"]').trigger("click");
    expect(validatePanel).toHaveBeenCalled();
    // The dialog is shown (open prop true) and no error toast fired.
    expect(
      wrapper.findComponent({ name: "AddToDashboard" }).props("open"),
    ).toBe(true);
    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  it("blocks the dialog and surfaces the error when the panel is invalid", async () => {
    validatePanel.mockImplementation((errors: string[]) => {
      errors.push("Add a query first");
    });
    const wrapper = mountVisualize();
    await flushPromises();

    await wrapper.find('[data-test="stub-add"]').trigger("click");
    expect(showErrorNotification).toHaveBeenCalledWith("Add a query first");
    expect(
      wrapper.findComponent({ name: "AddToDashboard" }).props("open"),
    ).toBe(false);
  });
});
