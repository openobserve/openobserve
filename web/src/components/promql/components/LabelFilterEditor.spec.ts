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

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/services/product_analytics", () => ({ default: analytics }));

const fetchQuery = vi.hoisted(() => vi.fn());
vi.mock("@/composables/query/queryClient", () => ({ queryClient: { fetchQuery } }));

const DT = "promql-label-filter-builder";

const panelData = () => ({
  meta: {
    promql: {
      availableLabels: ["method", "status", "path"],
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
  valueStore.requestFieldValues.mockReset().mockResolvedValue(["api", "web"]);
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
    expect(analytics.track).not.toHaveBeenCalled();
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
      await flushPromises();
      expect(valueStore.requestFieldValues).not.toHaveBeenCalled();
      const values = await builder().props("loadValues")!("method", "");
      expect(valueStore.requestFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({ streamType: "metrics", streamName: "http_requests_total" }),
        "method",
      );
      expect(values).toEqual(["api", "web"]);
    });

    it("reads the values of the metric now selected, not the panel's values for an earlier one", async () => {
      mountEditor({ dashboardPanelData: panelData() });
      const load = builder().props("loadValues")!;
      await load("method", "");
      await wrapper!.setProps({ metric: "cpu_usage" });
      valueStore.requestFieldValues.mockResolvedValueOnce(["PUT"]);
      expect(await load("method", "")).toEqual(["PUT"]);
      expect(valueStore.requestFieldValues).toHaveBeenLastCalledWith(
        expect.objectContaining({ streamName: "cpu_usage" }),
        "method",
      );
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

  describe("OR groups", () => {
    const grouped = [
      { label: "job", op: "=", value: "api" },
      { label: "code", op: "=", value: "500", group: 1 },
      { label: "env", op: "=", value: "prod", group: 2, negate: true },
    ];
    const negated = Array.from({ length: 16 }, (_, i) => ({
      label: `l${i}`,
      op: "=",
      value: "v",
      group: 1,
      negate: true,
    }));
    const TOO_MANY = '[data-test="promql-labelfilter-too-many-branches"]';

    it("renders each group in its own box, joined by or", () => {
      mountEditor({ dashboardPanelData: panelData(), labels: grouped });
      expect(wrapper!.find(`[data-test="${DT}-group-1"]`).text()).toContain("code");
      expect(wrapper!.find(`[data-test="${DT}-group-2"]`).text()).toContain("env");
      expect(wrapper!.find(`[data-test="${DT}-group-join-1"]`).text()).toBe("and any of");
      expect(wrapper!.find(`[data-test="${DT}-group-join-2"]`).text()).toBe("or");
    });

    it("toggles NOT on every matcher of the group and no other", async () => {
      mountEditor({ dashboardPanelData: panelData(), labels: grouped });
      await wrapper!.find(`[data-test="${DT}-group-not-1"]`).trigger("click");
      const labels = emitted()!.at(-1)![0] as typeof grouped;
      expect(labels[1]).toEqual({ label: "code", op: "=", value: "500", group: 1, negate: true });
      expect(labels[2]).toEqual(grouped[2]);

      await wrapper!.setProps({ labels });
      await wrapper!.find(`[data-test="${DT}-group-not-1"]`).trigger("click");
      expect((emitted()!.at(-1)![0] as typeof grouped)[1]).toEqual(grouped[1]);
    });

    const suggestRow = (key: string) =>
      document.body.querySelector<HTMLElement>(`[data-test="${DT}-suggest-item-${key}"]`);
    const rowExists = (key: string) => Boolean(suggestRow(key));
    const pick = async (key: string) => {
      suggestRow(key)!.click();
      await flushPromises();
    };
    const pickMethodGet = async () => {
      valueStore.requestFieldValues.mockResolvedValueOnce(["GET", "POST"]);
      await pick("method");
      await pick("eq");
      await vi.waitFor(() => expect(rowExists("GET")).toBe(true));
      await pick("GET");
    };
    const fieldRows = () =>
      Array.from(document.body.querySelectorAll(`[data-test^="${DT}-suggest-item-"]`)).map((row) =>
        row.getAttribute("data-test")!.replace(`${DT}-suggest-item-`, ""),
      );

    it("offers + OR group only once there is a filter to OR against", async () => {
      mountEditor({ dashboardPanelData: panelData() });
      expect(wrapper!.find(`[data-test="${DT}-add-group"]`).exists()).toBe(false);
      await wrapper!.setProps({ labels: grouped.slice(0, 1) });
      await flushPromises();
      expect(wrapper!.find(`[data-test="${DT}-add-group"]`).text()).toBe("+ OR group");
    });

    it("adds a new OR group after the highest one", async () => {
      mountEditor({ dashboardPanelData: panelData(), labels: grouped });
      await wrapper!.find(`[data-test="${DT}-add-group"]`).trigger("click");
      await flushPromises();
      await pickMethodGet();
      expect((emitted()!.at(-1)![0] as typeof grouped).at(-1)).toEqual({
        label: "method",
        op: "=",
        value: "GET",
        group: 3,
      });
      expect(analytics.track).toHaveBeenCalledWith("promql_builder_label_filter_added", {
        new_group: true,
      });
    });

    it("adds a filter inside a negated group as negated too", async () => {
      mountEditor({ dashboardPanelData: panelData(), labels: grouped });
      await wrapper!.find(`[data-test="${DT}-group-add-2"]`).trigger("click");
      await flushPromises();
      await pickMethodGet();
      expect((emitted()!.at(-1)![0] as typeof grouped).at(-1)).toEqual({
        label: "method",
        op: "=",
        value: "GET",
        group: 2,
        negate: true,
      });
      expect(analytics.track).toHaveBeenCalledWith("promql_builder_label_filter_added", {
        new_group: false,
      });
    });

    it("lets another group reuse a label the base list already uses", async () => {
      const labels = [
        { label: "method", op: "=", value: "GET" },
        { label: "status", op: "=", value: "500", group: 1 },
      ];
      mountEditor({ dashboardPanelData: panelData(), labels });
      await wrapper!.find(`[data-test="${DT}-group-add-1"]`).trigger("click");
      await flushPromises();
      expect(fieldRows()).toContain("method");
      expect(fieldRows()).not.toContain("status");
    });

    it("hides a label from the base list that the base list already uses", async () => {
      const labels = [
        { label: "method", op: "=", value: "GET" },
        { label: "status", op: "=", value: "500", group: 1 },
      ];
      mountEditor({ dashboardPanelData: panelData(), labels });
      await wrapper!.find(`[data-test="${DT}-input"]`).trigger("click");
      await flushPromises();
      expect(fieldRows()).not.toContain("method");
      expect(fieldRows()).toContain("status");
    });

    it("says why the query will not run past the branch cap", () => {
      const labels = [...negated, { ...negated[0], label: "l16" }];
      mountEditor({ dashboardPanelData: panelData(), labels });
      expect(wrapper!.find(TOO_MANY).text()).toContain("17");
    });

    it("refuses an add that would pass the branch cap, and says why", async () => {
      mountEditor({ dashboardPanelData: panelData(), labels: negated });
      builder().vm.$emit("update:modelValue", [...negated, { ...negated[0], label: "l16" }]);
      await flushPromises();
      expect(emitted()).toBeUndefined();
      expect(wrapper!.find(TOO_MANY).text()).toContain("17");
    });

    it("lets a removal land while over the branch cap", async () => {
      const labels = [...negated, { ...negated[0], label: "l16" }, { ...negated[0], label: "l17" }];
      mountEditor({ dashboardPanelData: panelData(), labels });
      builder().vm.$emit("update:modelValue", labels.slice(1));
      await flushPromises();
      expect(emitted()).toHaveLength(1);
    });

    it("drops a refused edit's banner when another query's labels arrive", async () => {
      mountEditor({ dashboardPanelData: panelData(), labels: negated });
      builder().vm.$emit("update:modelValue", [...negated, { ...negated[0], label: "l16" }]);
      await flushPromises();
      expect(wrapper!.find(TOO_MANY).exists()).toBe(true);

      await wrapper!.setProps({ labels: [{ label: "job", op: "=", value: "api" }] });
      expect(wrapper!.find(TOO_MANY).exists()).toBe(false);
    });

    it("shows no group chrome for a plain AND list", () => {
      mountEditor({ dashboardPanelData: panelData() });
      expect(wrapper!.find(`[data-test^="${DT}-group-"]`).exists()).toBe(false);
      expect(wrapper!.find(TOO_MANY).exists()).toBe(false);
    });
  });
});
