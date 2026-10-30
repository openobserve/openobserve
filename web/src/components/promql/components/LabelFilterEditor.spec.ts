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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import LabelFilterEditor from "./LabelFilterEditor.vue";

const panelApi = vi.hoisted(() => ({
  fetchPromQLLabels: vi.fn().mockResolvedValue(undefined),
  fetchPromQLLabelValues: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => panelApi),
}));

const valueStore = vi.hoisted(() => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
  requestFieldValues: vi.fn().mockResolvedValue(["api", "web"]),
}));
vi.mock("@/composables/fieldValueStore", () => valueStore);

const fetchQuery = vi.hoisted(() => vi.fn());
vi.mock("@/composables/query/queryClient", () => ({ queryClient: { fetchQuery } }));

const DT = "promql-label-filter-builder";

const panelData = () => ({
  meta: {
    promql: {
      availableLabels: ["method", "status", "path"],
      labelValuesMap: new Map([["method", ["GET", "POST"]]]),
      loadingLabels: false,
    },
  },
});

let wrapper: VueWrapper | null = null;

function mountEditor(props: Record<string, unknown>) {
  wrapper = mount(LabelFilterEditor, {
    attachTo: document.body,
    props: { labels: [], metric: "http_requests_total", ...props } as any,
    global: { plugins: [i18n, store] },
  });
  return wrapper;
}

const builder = () => wrapper!.findComponent(FilterBuilder);
const emitted = () => wrapper!.emitted("update:labels") as unknown[][] | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  fetchQuery.mockResolvedValue({
    schema: [{ name: "job" }, { name: "value" }, { name: "_timestamp" }, { name: "instance" }],
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("LabelFilterEditor", () => {
  it("keeps its label and edits matchers with the PromQL builder profile", () => {
    mountEditor({ dashboardPanelData: panelData() });
    expect(wrapper!.find('[data-test="promql-labelfilter-editor-label"]').text()).toBe(
      "Label filters",
    );
    expect(builder().props("profile")).toBe("promql-builder");
    expect(builder().props("dataTest")).toBe(DT);
  });

  it("shows each saved matcher as a chip", () => {
    mountEditor({
      dashboardPanelData: panelData(),
      labels: [
        { label: "method", op: "=", value: "GET" },
        { label: "path", op: "=~", value: "/api/.*" },
      ],
    });
    expect(wrapper!.find(`[data-test="${DT}-chip-method"]`).text()).toContain("GET");
    expect(wrapper!.find(`[data-test="${DT}-chip-path"]`).text()).toContain("/api/.*");
  });

  it("removing a matcher keeps the others as saved", async () => {
    const labels = [
      { label: "method", op: "=", value: "GET" },
      { label: "status", op: "!~", value: "5.." },
    ];
    mountEditor({ dashboardPanelData: panelData(), labels });
    await wrapper!.find(`[data-test="${DT}-chip-method-remove"]`).trigger("click");
    await flushPromises();
    expect(emitted()!.at(-1)![0]).toEqual([labels[1]]);
  });

  describe("in a dashboard panel", () => {
    it("offers the panel's labels as fields", () => {
      mountEditor({ dashboardPanelData: panelData() });
      expect(builder().props("fields")).toEqual([
        { name: "method", type: "string" },
        { name: "status", type: "string" },
        { name: "path", type: "string" },
      ]);
    });

    it("reads the label list when the metric changes, not on every render", async () => {
      mountEditor({ dashboardPanelData: panelData() });
      await flushPromises();
      expect(panelApi.fetchPromQLLabels).toHaveBeenCalledTimes(1);
      await wrapper!.setProps({ labels: [{ label: "method", op: "=", value: "GET" }] });
      expect(panelApi.fetchPromQLLabels).toHaveBeenCalledTimes(1);
      await wrapper!.setProps({ metric: "cpu_usage" });
      await flushPromises();
      expect(panelApi.fetchPromQLLabels).toHaveBeenLastCalledWith("cpu_usage");
    });

    it("loads a label's values only when they are asked for", async () => {
      mountEditor({ dashboardPanelData: panelData() });
      expect(panelApi.fetchPromQLLabelValues).not.toHaveBeenCalled();
      const values = await builder().props("loadValues")!("method", "");
      expect(panelApi.fetchPromQLLabelValues).toHaveBeenCalledWith("http_requests_total", "method");
      expect(values).toEqual(["GET", "POST"]);
    });

    it("offers the dashboard's variables before the loaded values", () => {
      mountEditor({
        dashboardPanelData: panelData(),
        dashboardData: { variables: { list: [{ name: "env" }, { name: "region" }] } },
      });
      expect(builder().props("extraValueSuggestions")!("method")).toEqual(["$env", "$region"]);
    });
  });

  describe("on the PromQL builder page", () => {
    it("reads the metric's labels from its schema, leaving out value and time columns", async () => {
      mountEditor({});
      await flushPromises();
      expect(panelApi.fetchPromQLLabels).not.toHaveBeenCalled();
      expect(builder().props("fields")).toEqual([
        { name: "instance", type: "string" },
        { name: "job", type: "string" },
      ]);
    });

    it("asks the values API when no values are cached", async () => {
      mountEditor({});
      const values = await builder().props("loadValues")!("job", "");
      expect(valueStore.getFieldValuesForSuggestion).toHaveBeenCalled();
      expect(valueStore.requestFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({ streamType: "metrics", streamName: "http_requests_total" }),
        "job",
      );
      expect(values).toEqual(["api", "web"]);
    });

    it("has no labels and asks for nothing without a metric", async () => {
      mountEditor({ metric: "" });
      await flushPromises();
      expect(fetchQuery).not.toHaveBeenCalled();
      expect(builder().props("fields")).toEqual([]);
      await expect(builder().props("loadValues")!("job", "")).resolves.toEqual([]);
    });

    it("an unreadable schema leaves the label list empty", async () => {
      fetchQuery.mockRejectedValueOnce(new Error("boom"));
      mountEditor({});
      await flushPromises();
      expect(builder().props("fields")).toEqual([]);
      expect(builder().props("fieldsLoading")).toBe(false);
    });
  });
});
