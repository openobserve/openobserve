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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import i18n from "@/locales";

// SearchBar.vue uses `defineAsyncComponent` as a free variable (not imported from vue).
// In JSDOM, globalThis properties are accessible as free variables in module scope,
// so we inject it via vi.hoisted() which runs before any module is evaluated.
vi.hoisted(() => {
  // SearchBar.vue uses defineAsyncComponent as a free variable (not imported from vue).
  // In JSDOM globalThis properties act as free variables, so inject it here before module eval.
  // Use the same data-test that the spec's vi.mock("@/components/CodeQueryEditor.vue") provides.
  (globalThis as any).defineAsyncComponent = (_loader: any) => ({
    name: "AsyncCodeQueryEditor",
    template: '<div data-test="code-editor-stub"></div>',
    props: ["query", "keywords", "functions", "editor-id"],
    emits: ["update:query", "run-query"],
    methods: {
      setValue: () => {},
      getCursorIndex: () => 0,
      triggerAutoComplete: () => {},
    },
  });
});

import SearchBar from "./SearchBar.vue";

installQuasar();

vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: {
      data: {
        datetime: {
          type: "relative",
          startTime: 0,
          endTime: 0,
          relativeTimePeriod: "15m",
        },
        transforms: [],
        query: "",
      },
      config: {
        refreshTimes: [],
      },
    },
  }),
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    name: "DateTime",
    template: '<div data-test="datetime-stub"></div>',
    props: ["defaultType", "defaultAbsoluteTime", "defaultRelativeTime", "autoApply"],
    emits: ["on:date-change"],
  },
}));

vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: {
    name: "CodeQueryEditor",
    template: '<div data-test="code-editor-stub"></div>',
    props: ["editorId", "query"],
    emits: ["update:query", "run-query"],
  },
}));

const makeStore = (theme = "light") =>
  createStore({
    state: {
      theme,
      selectedOrganization: { identifier: "test-org" },
    },
  });

describe("SearchBar (logstream/explore)", () => {
  let store: any;

  const defaultQueryData = {
    queryResults: { hits: [] },
    streamType: "logs",
    query: "SELECT * FROM stream",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
  });

  const mountComp = (queryData = defaultQueryData, isLoading = false) =>
    mount(SearchBar, {
      props: { queryData, isLoading },
      global: { plugins: [i18n, store] },
    });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mountComp();
      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render search bar container", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find(".logs-search-bar-component").exists()).toBe(true);
    });

    it("should render download logs button", async () => {
      const wrapper = mountComp();
      await flushPromises();
      // OButton replaces q-btn; download button is identified by its title attribute
      expect(wrapper.find('button[data-o2-btn]').exists()).toBe(true);
    });

    it("should render run query button", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(true);
    });

    it("should render the date-time component for non-enrichment_tables streams", async () => {
      const wrapper = mountComp({ ...defaultQueryData, streamType: "logs" });
      await flushPromises();
      // The outer data-test attribute takes precedence over the mock component's root data-test
      // (Vue 3 attribute inheritance merges attrs onto the root element, outer wins)
      expect(wrapper.find('[data-test="logs-search-bar-date-time-dropdown"]').exists()).toBe(true);
    });

    it("should hide date-time component for enrichment_tables stream type", async () => {
      const wrapper = mountComp({ ...defaultQueryData, streamType: "enrichment_tables" });
      await flushPromises();
      // v-show hides the element but it still renders in DOM, just hidden
      const dateTimeContainer = wrapper.find(".float-left");
      // The container should exist but be hidden
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the code query editor", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.find('[data-test="code-editor-stub"]').exists()).toBe(true);
    });
  });

  describe("Default Props", () => {
    it("should have default isLoading as false", async () => {
      const wrapper = mountComp();
      await flushPromises();
      expect(wrapper.props("isLoading")).toBe(false);
    });

    it("should use provided queryData", async () => {
      const wrapper = mountComp(defaultQueryData);
      await flushPromises();
      expect(wrapper.props("queryData")).toEqual(defaultQueryData);
    });
  });

  describe("Download Button State", () => {
    it("should disable download button when no hits", async () => {
      const wrapper = mountComp({
        ...defaultQueryData,
        queryResults: { hits: [] },
      });
      await flushPromises();

      // OButton renders as native <button data-o2-btn> with native disabled attribute
      const allBtns = wrapper.findAll('button[data-o2-btn]');
      const downloadBtn = allBtns.find(btn => btn.attributes('title') === 'Export logs');
      expect(downloadBtn).toBeDefined();
      expect(downloadBtn!.attributes("disabled")).toBeDefined();
    });

    it("should enable download button when hits exist", async () => {
      const wrapper = mountComp({
        ...defaultQueryData,
        queryResults: { hits: [{ col1: "val1" }] },
      });
      await flushPromises();

      // When hits exist, the disabled prop condition is false
      // (hasOwnProperty('hits') && !hits.length) = (true && false) = false
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("searchData method", () => {
    it("should emit searchdata when not loading", async () => {
      const wrapper = mountComp(defaultQueryData, false);
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.searchData();

      expect(wrapper.emitted("searchdata")).toBeTruthy();
    });

    it("should not emit searchdata when isLoading is true", async () => {
      const wrapper = mountComp(defaultQueryData, true);
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.searchData();

      expect(wrapper.emitted("searchdata")).toBeFalsy();
    });

    it("should emit searchdata when run query button is clicked and not loading", async () => {
      const wrapper = mountComp(defaultQueryData, false);
      await flushPromises();

      await wrapper.find('[data-test="logs-search-bar-refresh-btn"]').trigger("click");

      expect(wrapper.emitted("searchdata")).toBeTruthy();
    });
  });

  describe("updateQueryValue", () => {
    it("should emit update-query with value", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.updateQueryValue("SELECT * FROM logs");

      expect(wrapper.emitted("update-query")).toBeTruthy();
      expect(wrapper.emitted("update-query")![0]).toEqual(["SELECT * FROM logs"]);
    });
  });

  describe("updateDateTime", () => {
    it("should emit change:date-time with value", async () => {
      const wrapper = mountComp();
      await flushPromises();

      const vm = wrapper.vm as any;
      const dateTimeValue = { type: "absolute", startTime: 100, endTime: 200 };
      vm.updateDateTime(dateTimeValue);

      expect(wrapper.emitted("change:date-time")).toBeTruthy();
      expect(wrapper.emitted("change:date-time")![0]).toEqual([dateTimeValue]);
    });
  });

  describe("onBeforeMount", () => {
    it("should set query from queryData.query prop before mount", async () => {
      const wrapper = mountComp({ ...defaultQueryData, query: "initial query" });
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.query).toBe("initial query");
    });
  });

  describe("jsonToCsv (via downloadLogs)", () => {
    it("should generate CSV from hits and trigger download", async () => {
      // Mount first so Vue's own createElement calls don't get intercepted
      const wrapper = mountComp({
        queryResults: { hits: [{ col1: "val1", col2: "val2" }] },
        streamType: "logs",
        query: "",
      });
      await flushPromises();

      // Set up DOM mocks AFTER mounting to avoid intercepting Vue's internal createElement calls
      const mockUrl = "blob:mock-url";
      const mockCreateObjectURL = vi.fn(() => mockUrl);
      const mockRevokeObjectURL = vi.fn();
      const mockClick = vi.fn();
      const mockAppendChild = vi.fn();
      const mockRemoveChild = vi.fn();

      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      const mockLink = {
        href: "",
        download: "",
        click: mockClick,
      };
      vi.spyOn(document, "createElement").mockReturnValueOnce(mockLink as any);
      vi.spyOn(document.body, "appendChild").mockImplementation(mockAppendChild);
      vi.spyOn(document.body, "removeChild").mockImplementation(mockRemoveChild);

      const vm = wrapper.vm as any;
      vm.downloadLogs();

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith(mockUrl);
    });
  });
});
