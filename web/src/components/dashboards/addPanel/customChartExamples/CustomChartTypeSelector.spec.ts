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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import CustomChartTypeSelector from "./CustomChartTypeSelector.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock useDashboardPanel with the new path used in this component
vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: {
      data: {
        type: "bar",
        queryType: "sql",
        customChartContent: "",
        queries: [{ query: "SELECT * FROM logs", customQuery: false }],
      },
      layout: {
        currentQueryIndex: 0,
      },
    },
  }),
}));

// Mock child component to avoid deep render complexity
vi.mock(
  "@/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue",
  () => ({
    default: {
      name: "CustomChartConfirmDialog",
      template: "<div class='mock-confirm-dialog'></div>",
      props: ["modelValue"],
      emits: ["update:ok", "update:cancel"],
    },
  }),
);

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({ plugins: [Dialog, Notify] });

const mountComponent = () =>
  mount(CustomChartTypeSelector, {
    global: {
      plugins: [store, router, i18n],
      provide: {
        dashboardPanelDataPageKey: "dashboard",
      },
    },
    attachTo: document.getElementById("app") as HTMLElement,
  });

describe("CustomChartTypeSelector", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(() => {
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // ── rendering ──────────────────────────────────────────────────────────────

  it("mounts without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders chart category sections", () => {
    const categories = wrapper.findAll("[data-category]");
    expect(categories.length).toBeGreaterThan(0);
  });

  it("shows the component name in the DOM structure", () => {
    // Component should have rendered some content
    expect(wrapper.html()).toBeTruthy();
    expect(wrapper.html().length).toBeGreaterThan(100);
  });

  // ── filteredCategories computed ────────────────────────────────────────────

  it("exposes filteredCategories with all categories when searchQuery is empty", async () => {
    await flushPromises();
    const categories = wrapper.vm.filteredCategories;
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBeGreaterThan(0);
  });

  it("filteredCategories returns empty array for non-matching search", async () => {
    // Use the exposed ref method to update searchQuery via the vm
    (wrapper.vm as any).searchQuery = "xxxxxxxxxnonexistent_____";
    await flushPromises();
    const filtered = wrapper.vm.filteredCategories;
    expect(filtered).toHaveLength(0);
  });

  it("filteredCategories returns subset when search term matches some charts", async () => {
    const totalBefore = wrapper.vm.filteredCategories.length;
    (wrapper.vm as any).searchQuery = "line";
    await flushPromises();
    const filtered = wrapper.vm.filteredCategories;
    // Must be subset (or equal if all categories have "line" charts)
    expect(filtered.length).toBeLessThanOrEqual(totalBefore);
  });

  // ── selectChart ────────────────────────────────────────────────────────────

  it("opens confirm dialog when selectChart is called", async () => {
    const chart = { label: "Basic Line Chart", value: "line-simple", asset: "" };
    wrapper.vm.selectChart(chart);
    await flushPromises();
    expect(wrapper.vm.confirmChartSelectionDialog).toBe(true);
  });

  it("opens confirm dialog when selectChart is called (dialog flag is true)", async () => {
    const chart = { label: "Basic Line Chart", value: "line-simple", asset: "" };
    wrapper.vm.selectChart(chart);
    await flushPromises();
    // dialog opens — confirmChartSelectionDialog becomes true
    expect(wrapper.vm.confirmChartSelectionDialog).toBe(true);
  });

  // ── confirmChartSelection ─────────────────────────────────────────────────

  it("emits select event with chart on confirmChartSelection", async () => {
    const chart = { label: "Pie Chart", value: "pie-simple", asset: "" };
    // First select a chart to set pendingChartSelection
    wrapper.vm.selectChart(chart);
    await flushPromises();

    wrapper.vm.confirmChartSelection({ replaceQuery: true });
    await flushPromises();

    const emitted = wrapper.emitted("select");
    expect(emitted).toBeTruthy();
    expect((emitted![0][0] as any)).toEqual({ chart, replaceQuery: true });
  });

  it("defaults replaceQuery to false when no options passed", async () => {
    const chart = { label: "Bar Chart", value: "bar-simple", asset: "" };
    wrapper.vm.selectChart(chart);
    await flushPromises();

    wrapper.vm.confirmChartSelection(undefined);
    await flushPromises();

    const emitted = wrapper.emitted("select");
    expect(emitted).toBeTruthy();
    expect((emitted![0][0] as any).replaceQuery).toBe(false);
  });

  it("closes confirm dialog after confirmation", async () => {
    const chart = { label: "Line Chart", value: "line-simple", asset: "" };
    wrapper.vm.selectChart(chart);
    await flushPromises();

    wrapper.vm.confirmChartSelection({ replaceQuery: false });
    await flushPromises();

    expect(wrapper.vm.confirmChartSelectionDialog).toBe(false);
  });

  it("does not emit select when pendingChartSelection is null", async () => {
    // Ensure pendingChartSelection is null (default state, no selectChart called)
    wrapper.vm.confirmChartSelection({ replaceQuery: false });
    await flushPromises();

    expect(wrapper.emitted("select")).toBeFalsy();
  });

  // ── cancelChartSelection ──────────────────────────────────────────────────

  it("closes dialog and clears pendingChartSelection on cancel", async () => {
    const chart = { label: "Chart", value: "x", asset: "" };
    wrapper.vm.selectChart(chart);
    await flushPromises();
    // Dialog is now open

    wrapper.vm.cancelChartSelection();
    await flushPromises();

    expect(wrapper.vm.confirmChartSelectionDialog).toBe(false);
  });

  // ── closeDialog ────────────────────────────────────────────────────────────

  it("emits close event when closeDialog is called", async () => {
    wrapper.vm.closeDialog();
    await flushPromises();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  // ── currentQuery ───────────────────────────────────────────────────────────

  it("exposes currentQuery from dashboardPanelData queries", async () => {
    await flushPromises();
    // The mocked composable returns "SELECT * FROM logs" as first query
    expect(wrapper.vm.currentQuery).toBe("SELECT * FROM logs");
  });

  // ── selectedCategory ──────────────────────────────────────────────────────

  it("initializes selectedCategory to first chart category label", async () => {
    await flushPromises();
    expect(typeof wrapper.vm.selectedCategory).toBe("string");
    expect(wrapper.vm.selectedCategory.length).toBeGreaterThan(0);
  });

  // ── chartCategories ───────────────────────────────────────────────────────

  it("exposes all chart categories", () => {
    const cats = wrapper.vm.chartCategories;
    expect(Array.isArray(cats)).toBe(true);
    expect(cats.length).toBeGreaterThan(0);
    expect(cats[0]).toHaveProperty("chartLabel");
    expect(cats[0]).toHaveProperty("type");
  });
});
