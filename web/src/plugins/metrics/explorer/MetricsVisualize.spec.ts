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
  layout: { showQueryBar: false, currentQueryIndex: 0 },
  // The panel's time window — the component writes the toolbar's range here and
  // the template binds PanelEditor's selected-date-time to it.
  meta: { dateTime: {} },
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

/** The stub's runQuery — the real PanelEditor exposes one, so the stub must too. */
const editorRunQuery = vi.hoisted(() => vi.fn());

// The real PanelEditor pulls in ECharts + the whole dashboard config surface;
// none of that is what this container's own logic needs. Stub it, but keep its
// emit so the add-to-dashboard handshake can be driven, and EXPOSE runQuery —
// the container drives the chart through `panelEditorRef.runQuery()`, so a stub
// without it makes the auto-run silently no-op and the test prove nothing.
vi.mock("@/components/dashboards/PanelEditor", () => ({
  PanelEditor: {
    name: "PanelEditor",
    props: ["allowedChartTypes"],
    emits: ["add-to-dashboard", "chart-api-error"],
    setup: (_: any, { expose }: any) => {
      expose({ runQuery: editorRunQuery });
      return {};
    },
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

const mountVisualize = (props: Record<string, any> = {}) =>
  mount(MetricsVisualize, {
    props,
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

  it("does not restrict chart types — matches AddPanel (ChartSelection's PromQL rules govern)", async () => {
    // The pane used to pass a narrow allowedChartTypes list, disabling stacked,
    // gauge, pie, heatmap, etc. AddPanel passes none; the metrics pane must not
    // silently drop chart types the dashboard offers for the same PromQL panel.
    const wrapper = mountVisualize();
    await flushPromises();

    const allowed = wrapper
      .findComponent({ name: "PanelEditor" })
      .props("allowedChartTypes");
    expect(allowed).toBeUndefined();
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

  /**
   * Opening a card in Visualize must PAINT the metric, not hand the user a fully
   * populated query bar above a blank chart and make them press Refresh to see
   * the thing they just clicked.
   */
  describe("a seeded open runs its query", () => {
    const SEED = {
      type: "line",
      queryType: "promql",
      queries: [
        {
          query: "avg(rate(apiserver_admission_webhook_request_total{}[5m]))",
          customQuery: true,
          fields: { stream: "apiserver_admission_webhook_request_total" },
        },
      ],
      config: {},
    };

    it("fires the query for a card's Open", async () => {
      const wrapper = mountVisualize({
        seed: SEED,
        selectedDateTime: { startTime: 1000, endTime: 2000 },
      });
      await flushPromises();
      await flushPromises();

      expect(editorRunQuery).toHaveBeenCalled();
      wrapper.unmount();
    });

    it("still fires when the parent nulls the seed on `seed-consumed` (as it really does)", async () => {
      // The REAL parent binds `@seed-consumed="visualizeSeed = null"`, and the
      // emit happens in the child's `onBeforeMount` — so the prop is already
      // gone by `onMounted`. Reproduce that exactly: a parent that nulls the
      // seed the instant the child asks it to. Mounting the child alone and
      // calling setProps afterwards is TOO LATE to catch this — the mutant
      // survives it.
      const Parent = {
        components: { MetricsVisualize },
        data: () => ({ seed: SEED as any }),
        template:
          '<MetricsVisualize :seed="seed" :selected-date-time="{ startTime: 1000, endTime: 2000 }" @seed-consumed="seed = null" />',
      };

      const wrapper = mount(Parent);
      await flushPromises();
      await flushPromises();

      // The component must remember it WAS seeded rather than re-read the prop.
      expect(editorRunQuery).toHaveBeenCalled();
      wrapper.unmount();
    });

    it("does NOT fire for a blank Visualize — there is no query to run", async () => {
      const wrapper = mountVisualize({
        selectedDateTime: { startTime: 1000, endTime: 2000 },
      });
      await flushPromises();
      await flushPromises();

      // Entering the tab directly just sets the window and waits for the user to
      // build a query; querying an empty panel would be a guaranteed error.
      expect(editorRunQuery).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });
});
