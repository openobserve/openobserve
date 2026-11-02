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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, reactive, nextTick } from "vue";

const spies = vi.hoisted(() => ({
  updateAllKeywords: vi.fn(),
  setValuesTimeRange: vi.fn(),
  panel: null as any,
}));

vi.mock("@/services/function_template", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock("@/composables/useFunctions", () => ({
  default: vi.fn(() => ({
    getAllFunctions: vi.fn().mockResolvedValue([]),
    functions: { value: [] },
    isLoading: { value: false },
  })),
}));

vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: { name: "CodeQueryEditor", template: "<div></div>" },
}));

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: spies.panel,
    promqlMode: false,
    addQuery: vi.fn(),
    removeQuery: vi.fn(),
    selectedStreamFieldsBasedOnUserDefinedSchema: { value: [] },
  })),
}));

vi.mock("@/composables/usePromqlSuggestions", () => ({
  default: vi.fn(() => ({
    autoCompleteData: {
      value: { query: "", position: { cursorIndex: 0 }, popup: { open: vi.fn(), close: vi.fn() } },
    },
    autoCompletePromqlKeywords: { value: [] },
    getSuggestions: vi.fn(),
    updateMetricKeywords: vi.fn(),
  })),
}));

// setValuesTimeRange is Lane C's addition to useSuggestions; mocked here to its agreed signature.
vi.mock("@/composables/useSuggestions", () => ({
  default: vi.fn(() => ({
    autoCompleteData: {
      value: {
        org: "",
        streamType: "",
        streamName: "",
        query: "",
        cursorIndex: 0,
        popup: { open: vi.fn(), close: vi.fn() },
      },
    },
    resolveFieldValues: vi.fn(async () => []),
    autoCompleteKeywords: { value: [] },
    autoCompleteSuggestions: { value: [] },
    effectiveKeywords: { value: [] },
    effectiveSuggestions: { value: [] },
    getSuggestions: vi.fn(),
    updateAllKeywords: spies.updateAllKeywords,
    updateStreamKeywords: vi.fn(),
    setValuesTimeRange: spies.setValuesTimeRange,
  })),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({ showErrorNotification: vi.fn(), showPositiveNotification: vi.fn() })),
}));

import DashboardQueryEditor from "@/components/dashboards/addPanel/DashboardQueryEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { RECENT_SEARCHES_EDITOR_HOST } from "@/composables/queryHistory/useRecentSearchesEditorHost";

// Panel pages store Date objects whose getTime() is already in microseconds.
const MINUTE_US = 60_000_000;
const START_US = 1_760_000_040_000_000;
const END_US = START_US + 7 * 86_400_000_000;

const makePanel = () =>
  reactive({
    data: {
      type: "line",
      queryType: "sql",
      queries: [
        {
          query: 'SELECT code FROM "default"',
          customQuery: true,
          fields: { stream: "default", stream_type: "logs" },
          vrlFunctionQuery: "",
        },
      ],
    },
    layout: { currentQueryIndex: 0, vrlFunctionToggle: false, showQueryBar: true },
    meta: {
      errors: { queryErrors: [] },
      dateTime: { start_time: new Date(START_US), end_time: new Date(END_US) },
      stream: { customQueryFields: [] as any[], streamResults: [] },
      streamFields: { groupedFields: [] as any[] },
    },
  });

const lastFields = (): any[] => {
  const calls = spies.updateAllKeywords.mock.calls;
  return calls[calls.length - 1][0];
};

describe("DashboardQueryEditor completion inputs", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    spies.panel = makePanel();
    store.state.selectedOrganization = { identifier: "test-org" };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const mountEditor = () =>
    mount(DashboardQueryEditor, {
      global: {
        plugins: [i18n, store, router],
        provide: { dashboardPanelDataPageKey: "dashboard" },
        stubs: { QueryTypeSelector: true, QueryEditor: true },
      },
    });

  describe("field list", () => {
    it("keeps the schema type of a column also named in the SELECT list", async () => {
      spies.panel.meta.stream.customQueryFields = [{ name: "code", type: "" }];
      spies.panel.meta.streamFields.groupedFields = [
        { name: "default", schema: [{ name: "code", type: "Utf8" }] },
      ];
      wrapper = mountEditor();
      await flushPromises();

      const code = lastFields().filter((f: any) => f.name === "code");
      expect(code).toEqual([{ name: "code", type: "Utf8" }]);
    });

    it("keeps the type when the SELECT list changes after the schema loaded", async () => {
      spies.panel.meta.streamFields.groupedFields = [
        { name: "default", schema: [{ name: "level", type: "Utf8" }] },
      ];
      wrapper = mountEditor();
      await flushPromises();
      spies.panel.meta.stream.customQueryFields = [{ name: "level", type: "" }];
      await nextTick();

      expect(lastFields().find((f: any) => f.name === "level")?.type).toBe("Utf8");
    });

    it("leaves builder aliases out of the field list", async () => {
      spies.panel.meta.stream.customQueryFields = [
        { name: "x_axis_1", type: "" },
        { name: "y_axis_1", type: "" },
        { name: "code", type: "" },
      ];
      spies.panel.meta.streamFields.groupedFields = [
        { name: "default", schema: [{ name: "code", type: "Utf8" }] },
      ];
      wrapper = mountEditor();
      await flushPromises();

      expect(lastFields().map((f: any) => f.name)).toEqual(["code"]);
    });
  });

  describe("values time range", () => {
    it("hands the panel range to the value lookup in microseconds", async () => {
      wrapper = mountEditor();
      await flushPromises();

      expect(spies.setValuesTimeRange).toHaveBeenLastCalledWith({
        startTime: START_US,
        endTime: END_US,
      });
    });

    it("follows the panel when its range changes", async () => {
      wrapper = mountEditor();
      await flushPromises();
      spies.panel.meta.dateTime = {
        start_time: new Date(START_US - 7 * 86_400_000_000),
        end_time: new Date(END_US),
      };
      await nextTick();

      expect(spies.setValuesTimeRange).toHaveBeenLastCalledWith({
        startTime: START_US - 7 * 86_400_000_000,
        endTime: END_US,
      });
    });

    it("keeps the same range when a live-preview rerun only moves 'now' within the minute", async () => {
      spies.panel.meta.dateTime = {
        start_time: new Date(START_US + 5_000_000),
        end_time: new Date(END_US + 5_000_000),
      };
      wrapper = mountEditor();
      await flushPromises();
      const calls = spies.setValuesTimeRange.mock.calls.length;
      spies.panel.meta.dateTime = {
        start_time: new Date(START_US + 30_000_000),
        end_time: new Date(END_US + 30_000_000),
      };
      await nextTick();

      expect(spies.setValuesTimeRange.mock.calls.length).toBe(calls);
    });

    it("widens an unaligned range to whole minutes", async () => {
      spies.panel.meta.dateTime = {
        start_time: new Date(START_US + 5_000_000),
        end_time: new Date(END_US + 5_000_000),
      };
      wrapper = mountEditor();
      await flushPromises();

      expect(spies.setValuesTimeRange).toHaveBeenLastCalledWith({
        startTime: START_US,
        endTime: END_US + MINUTE_US,
      });
    });

    it("gives the editor the same range so its value menu names it", async () => {
      wrapper = mountEditor();
      await flushPromises();

      expect(wrapper.findComponent({ name: "QueryEditor" }).props("valuesTimeRange")).toEqual({
        startTime: START_US,
        endTime: END_US,
      });
    });

    it("gives the editor null while the panel has no usable range", async () => {
      spies.panel.meta.dateTime = { start_time: "", end_time: "" };
      wrapper = mountEditor();
      await flushPromises();

      expect(wrapper.findComponent({ name: "QueryEditor" }).props("valuesTimeRange")).toBeNull();
    });

    it("sends null while the panel has no usable range yet", async () => {
      spies.panel.meta.dateTime = { start_time: "", end_time: "" };
      wrapper = mountEditor();
      await flushPromises();

      expect(spies.setValuesTimeRange).toHaveBeenLastCalledWith(null);
    });

    it("clears the range on unmount so Logs and Traces fall back to their default", async () => {
      wrapper = mountEditor();
      await flushPromises();
      wrapper.unmount();
      wrapper = null;

      expect(spies.setValuesTimeRange).toHaveBeenLastCalledWith(null);
    });
  });

  describe("recent searches from the Metrics page", () => {
    const QueryEditorStub = {
      name: "QueryEditor",
      props: ["recentQueries"],
      emits: ["focus", "user-edit"],
      template: "<div />",
    };
    const mountWith = (provide: Record<string | symbol, unknown>) =>
      mount(DashboardQueryEditor, {
        global: {
          plugins: [i18n, store, router],
          provide: { dashboardPanelDataPageKey: "metrics", ...provide },
          stubs: { QueryTypeSelector: true, QueryEditor: QueryEditorStub },
        },
      });

    it("offers the page's recent queries and reports focus and edits", async () => {
      const host = {
        queries: computed(() => ["rate(http_requests_total[5m])"]),
        onFocus: vi.fn(),
        onEdit: vi.fn(),
        onKeydown: vi.fn(),
      };
      wrapper = mountWith({ [RECENT_SEARCHES_EDITOR_HOST as symbol]: host });
      await flushPromises();
      const editor = wrapper.findComponent({ name: "QueryEditor" });
      expect(editor.props("recentQueries")).toEqual(["rate(http_requests_total[5m])"]);

      editor.vm.$emit("focus");
      expect(host.onFocus).toHaveBeenCalledWith(expect.any(HTMLElement));
      editor.vm.$emit("user-edit");
      expect(host.onEdit).toHaveBeenCalled();
    });

    it("offers nothing on a dashboard, which provides no host", async () => {
      wrapper = mountWith({});
      await flushPromises();
      expect(wrapper.findComponent({ name: "QueryEditor" }).props("recentQueries")).toEqual([]);
    });
  });
});
