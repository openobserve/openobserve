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
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PanelContainer from "@/components/dashboards/PanelContainer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { panelCsvRegistry } from "@/utils/panelDownloadRegistry";

vi.mock("@/services/short_url", () => ({
  default: { create: vi.fn().mockResolvedValue({ data: { short_url: "" } }) },
}));
vi.mock("@/utils/commons", () => ({ addPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

const downloadCsv = vi.fn();
const downloadJson = vi.fn();

const PanelSchemaRendererStub = {
  name: "PanelSchemaRenderer",
  props: ["panelSchema", "selectedTimeObj", "width", "height"],
  template: '<div data-test="panel-schema-renderer"></div>',
  methods: {
    downloadDataAsCSV(this: any, title: string) {
      downloadCsv(this.panelSchema?.id, title);
    },
    downloadDataAsJSON(this: any, title: string) {
      downloadJson(this.panelSchema?.id, title);
    },
    getPanelCsvData(this: any, title: string) {
      return { id: this.panelSchema?.id, title, csv: "a,b" };
    },
  },
};

// Renders every item inline so a menu entry can be selected without a pointer-driven popover.
const ODropdownStub = { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" };
const ODropdownItemStub = {
  name: "ODropdownItem",
  emits: ["select"],
  template: '<div v-bind="$attrs" @click="$emit(\'select\')"><slot /></div>',
};

const panel = (title: string, id = "panel-1") => ({
  id,
  title,
  description: "",
  type: "line",
  queries: [{ query: "SELECT * FROM t", queryType: "sql" }],
  layout: { x: 0, y: 0, w: 6, h: 4 },
});

const variables = (...values: any[]) => ({ isVariablesLoading: false, values });

describe("PanelContainer title variables", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountPanel = (title: string, variablesData: any, id = "panel-1", config?: any) =>
    mount(PanelContainer, {
      attachTo: document.body,
      props: {
        data: config ? { ...panel(title, id), config } : panel(title, id),
        variablesData,
        currentVariablesData: variablesData,
        selectedTimeDate: { start_time: new Date(0), end_time: new Date(1), type: "relative" },
        viewOnly: false,
        width: 6,
        height: 4,
        dashboardId: "d1",
        folderId: "f1",
        runId: "r1",
        tabId: "tab-1",
        tabName: "Tab",
      },
      global: {
        plugins: [i18n, store, router],
        stubs: {
          PanelSchemaRenderer: PanelSchemaRendererStub,
          ODropdown: ODropdownStub,
          ODropdownItem: ODropdownItemStub,
          ODialog: { template: "<div />" },
          QueryInspector: { template: "<div />" },
          SinglePanelMove: { template: "<div />" },
        },
      },
    });

  const header = () => wrapper!.find('[data-test="dashboard-panel-header"]');

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = { identifier: "org" };
    (store.state as any).zoConfig = {};
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  it("shows the resolved title in the header and keeps the template on the data attribute", () => {
    wrapper = mountPanel("GPU temperature — $cdu", variables({ name: "cdu", value: "cdu-3" }));
    expect(header().text()).toBe("GPU temperature — cdu-3");
    expect(
      wrapper.find('[data-test="dashboard-panel-container"]').attributes("data-test-panel-title"),
    ).toBe("GPU temperature — $cdu");
  });

  it("shows All, joins multi values and drops an empty value with its separator", async () => {
    wrapper = mountPanel(
      "Errors — $sw ($dc) — $row",
      variables(
        { name: "sw", value: ["leaf-07", "leaf-08"] },
        { name: "dc", value: [SELECT_ALL_VALUE] },
        { name: "row", value: "" },
      ),
    );
    expect(header().text()).toBe("Errors — leaf-07, leaf-08 (All)");
  });

  it("puts the full resolved title in the tooltip when the header is cut", async () => {
    vi.useFakeTimers();
    const values = Array.from({ length: 30 }, (_, i) => `host-${i}`);
    wrapper = mountPanel("CPU — $host", variables({ name: "host", value: values }));
    const el = header().element as HTMLElement;
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 100 });
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(700);
    await nextTick();
    await nextTick();
    const bubble = document.body.querySelector('[data-test="o-tooltip-content"]');
    expect(bubble?.textContent).toContain(`CPU — ${values.join(", ")}`);
    expect(bubble?.textContent).not.toContain("$host");
  });

  it("renders a variable value as text, never as HTML", () => {
    const payload = "<img src=x onerror=alert(1)>";
    wrapper = mountPanel("Panel $v", variables({ name: "v", value: payload }));
    expect(header().find("img").exists()).toBe(false);
    expect(header().text()).toBe(`Panel ${payload}`);
  });

  it("holds the last resolved title while a referenced variable reloads", async () => {
    const loaded = { name: "cdu", type: "query_values", value: "cdu-1", isLoading: false };
    wrapper = mountPanel("GPU — $cdu", variables(loaded));
    expect(header().text()).toBe("GPU — cdu-1");

    await wrapper.setProps({
      variablesData: variables({ ...loaded, value: null, isLoading: true }),
    });
    expect(header().text()).toBe("GPU — cdu-1");

    await wrapper.setProps({ variablesData: variables({ ...loaded, value: "cdu-2" }) });
    expect(header().text()).toBe("GPU — cdu-2");
  });

  it("shows the template, not a half-resolved title, before the first load", () => {
    wrapper = mountPanel(
      "GPU — $cdu",
      variables({ name: "cdu", type: "query_values", value: null, isLoading: true }),
    );
    expect(header().text()).toBe("GPU — $cdu");
  });

  it("names CSV and JSON downloads after the resolved title", async () => {
    wrapper = mountPanel("Port errors — $sw", variables({ name: "sw", value: "leaf-07" }));
    await wrapper.vm.metaDataValue({ queries: [{ query: "SELECT * FROM t" }] });
    await nextTick();

    await wrapper.find('[data-test="dashboard-panel-download-as-csv-btn"]').trigger("click");
    await wrapper.find('[data-test="dashboard-panel-download-as-json-btn"]').trigger("click");
    expect(downloadCsv).toHaveBeenCalledWith("panel-1", "Port errors — leaf-07");
    expect(downloadJson).toHaveBeenCalledWith("panel-1", "Port errors — leaf-07");
  });

  it("caps a long resolved title in download names while the header keeps it whole", async () => {
    const hosts = Array.from({ length: 10 }, (_, i) => `gpu-node-${i}.dc1.example.com`);
    wrapper = mountPanel("GPU power — $host", variables({ name: "host", value: hosts }));
    await wrapper.vm.metaDataValue({ queries: [{ query: "SELECT * FROM t" }] });
    await nextTick();

    await wrapper.find('[data-test="dashboard-panel-download-as-csv-btn"]').trigger("click");
    const fileName = downloadCsv.mock.calls[0][1] as string;
    expect(fileName.length).toBeLessThanOrEqual(100);
    expect(fileName.startsWith("GPU power — gpu-node-0.dc1.example.com")).toBe(true);
    expect(header().text()).toBe(`GPU power — ${hosts.join(", ")}`);
  });

  it("names each panel's download after its own title when two panels are mounted", async () => {
    const data = variables({ name: "cdu", value: "cdu-2" }, { name: "sw", value: "leaf-07" });
    const gpu = mountPanel("GPU temperature — $cdu", data, "panel-gpu");
    wrapper = mountPanel("Port errors — $sw", data, "panel-port");
    try {
      for (const w of [gpu, wrapper]) {
        await w.vm.metaDataValue({ queries: [{ query: "SELECT * FROM t" }] });
      }
      await nextTick();

      await wrapper.find('[data-test="dashboard-panel-download-as-json-btn"]').trigger("click");
      await gpu.find('[data-test="dashboard-panel-download-as-json-btn"]').trigger("click");
      expect(downloadJson.mock.calls).toEqual([
        ["panel-port", "Port errors — leaf-07"],
        ["panel-gpu", "GPU temperature — cdu-2"],
      ]);
      expect(panelCsvRegistry.get("panel-port")?.()).toMatchObject({
        id: "panel-port",
        title: "Port errors — leaf-07",
      });
      expect(panelCsvRegistry.get("panel-gpu")?.()).toMatchObject({
        id: "panel-gpu",
        title: "GPU temperature — cdu-2",
      });
    } finally {
      gpu.unmount();
    }
  });

  it("lets the title take the cut before the freshness label", () => {
    wrapper = mountPanel("GPU — $cdu", variables({ name: "cdu", value: "cdu-1" }));
    expect(header().classes()).toContain("shrink-[1000]");
  });

  it("shows a stamped title meta once, right after the title, in the secondary style", () => {
    wrapper = mountPanel("Rate", variables(), "panel-1", { title_meta: "spans/s" });
    const metas = wrapper.findAll('[data-test="dashboard-panel-header-meta"]');
    expect(metas).toHaveLength(1);
    expect(metas[0].text()).toBe("spans/s");
    expect(metas[0].classes()).toEqual(expect.arrayContaining(["text-text-secondary", "shrink-0"]));
    expect(header().element.nextElementSibling).toBe(metas[0].element);
    expect(header().text()).toBe("Rate");
    expect(
      wrapper.find('[data-test="dashboard-panel-container"]').attributes("data-test-panel-title"),
    ).toBe("Rate");
  });

  it("renders the panel bar exactly as before when no title meta is stamped", () => {
    wrapper = mountPanel("Rate", variables(), "panel-1", { unit: "custom", unit_custom: "" });
    expect(wrapper.find('[data-test="dashboard-panel-header-meta"]').exists()).toBe(false);
    expect(header().classes()).toContain("me-5");
    expect(header().classes()).toEqual(
      expect.arrayContaining(["min-w-0", "truncate", "text-text-heading", "shrink-[1000]"]),
    );
    expect(header().attributes("data-o-tooltip-trigger")).toBe("overflow");
    expect(header().text()).toBe("Rate");
  });
});
