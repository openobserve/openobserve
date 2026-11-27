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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, reactive } from "vue";

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(),
  useDashboardPanelData: vi.fn(),
}));

// Every section open, so each section's own components (colour picker, drilldown, ...) mount too.
vi.mock("@/utils/dashboard/searchLabelsConfig", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const allExpanded = Object.fromEntries(
    Object.keys(actual.DEFAULT_EXPANDED_SECTIONS as Record<string, boolean>).map((k) => [k, true]),
  );
  return { ...actual, DEFAULT_EXPANDED_SECTIONS: allExpanded };
});

import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import OverrideConfig from "@/components/dashboards/addPanel/OverrideConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { getDefaultDashboardPanelData } from "@/composables/dashboard/useDashboardPanelDefaults";
import {
  applyEditorMountDefaults,
  applyPanelConfigDefaults,
} from "@/utils/dashboard/panelConfigDefaults";

vi.setConfig({ testTimeout: 30000 });

// The server drops null fields, so a panel made in the UI comes back without them.
const withoutNulls = (value: any): any => {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  }
  return value;
};

const clone = (value: any) => JSON.parse(JSON.stringify(value));

const savedPanel = (type: string, change: (data: any) => void = () => {}) => {
  const panel = getDefaultDashboardPanelData(store);
  panel.data = withoutNulls({ ...panel.data, id: "p1", type, title: "Saved" });
  change(panel.data);
  const state = reactive(panel);
  // Same rule as usePanelFields, so the pivot watcher sees pivot mode the way the app does.
  const isPivotMode = computed(() => {
    const fields = state.data.queries[state.layout.currentQueryIndex]?.fields;
    return (
      state.data.type === "table" &&
      fields?.x?.length > 0 &&
      fields?.y?.length > 0 &&
      fields?.breakdown?.length > 0
    );
  });
  vi.mocked(useDashboardPanelData).mockReturnValue({
    dashboardPanelData: state,
    promqlMode: computed(() => false),
    isPivotMode,
    selectedStreamFields: [],
  } as any);
  return { state, isPivotMode };
};

// What AddPanel's unsaved check compares: the panel with every mount-time default applied.
const normalised = (data: any, isPivotMode: boolean) => {
  const copy = clone(data);
  applyPanelConfigDefaults(copy, store, isPivotMode);
  applyEditorMountDefaults(copy);
  return copy;
};

const mountOptions = {
  global: { plugins: [i18n, store], provide: { dashboardPanelDataPageKey: "dashboard" } },
};

describe("Config sidebar mount-time writes match the unsaved check (#7454)", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const openConfig = async (state: any, isPivotMode: any) => {
    const before = clone(state.data);
    wrapper = mount(ConfigPanel, {
      props: { variablesData: { values: [] }, panelData: {} },
      ...mountOptions,
    });
    await flushPromises();
    const after = clone(state.data);
    expect(after).not.toEqual(before);
    expect(normalised(after, isPivotMode.value)).toEqual(normalised(before, isPivotMode.value));
    return after;
  };

  it.each(["line", "bar", "table", "custom_chart"])("%s panel", async (type) => {
    const { state, isPivotMode } = savedPanel(type);
    const after = await openConfig(state, isPivotMode);
    expect(after.config.legends_position).toBeNull();
  });

  it.each(["line", "hostmap"])("%s panel saved without a colour config", async (type) => {
    const { state, isPivotMode } = savedPanel(type, (data) => {
      delete data.config.color;
    });
    const after = await openConfig(state, isPivotMode);
    expect(after.config.color.mode).toBeTruthy();
  });

  it("pivot table saved without its pivot keys", async () => {
    const { state, isPivotMode } = savedPanel("table", (data) => {
      Object.assign(data.queries[0].fields, {
        x: [{ alias: "x", column: "x" }],
        y: [{ alias: "y", column: "y", aggregationFunction: "count" }],
        breakdown: [{ alias: "b", column: "b" }],
      });
      for (const key of Object.keys(data.config)) {
        if (key.startsWith("table_pivot_")) delete data.config[key];
      }
      data.config.table_transpose = true;
    });
    expect(isPivotMode.value).toBe(true);
    const after = await openConfig(state, isPivotMode);
    expect(after.config).toMatchObject({
      table_transpose: false,
      table_pivot_show_row_totals: false,
      table_pivot_sticky_col_totals: false,
    });
  });

  it("scroll legend saved with a width", async () => {
    const { state, isPivotMode } = savedPanel("line", (data) => {
      data.config.legends_type = "scroll";
      data.config.legend_width = { value: 200, unit: "px" };
    });
    const after = await openConfig(state, isPivotMode);
    expect(after.config.legend_width).toEqual({ value: null, unit: "px" });
  });

  it("table saved without overrides, once OverrideConfig mounts", async () => {
    const { state, isPivotMode } = savedPanel("table", (data) => {
      delete data.config.override_config;
    });
    const before = clone(state.data);
    wrapper = mount(OverrideConfig, { props: { mode: "table", panelData: {} }, ...mountOptions });
    await flushPromises();
    const after = clone(state.data);
    expect(after.config.override_config).toEqual([]);
    expect(normalised(after, isPivotMode.value)).toEqual(normalised(before, isPivotMode.value));
  });
});
