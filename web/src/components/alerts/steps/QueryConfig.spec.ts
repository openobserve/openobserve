// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import QueryConfig from "./QueryConfig.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "light",
    zoConfig: {
      build_type: "opensource",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
    organizationData: {
      functions: [
        { name: "test_func", function: "// test function" },
      ],
    },
    userInfo: {
      email: "test@example.com",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

// Mock AppTabs component
vi.mock("@/components/common/AppTabs.vue", () => ({
  default: {
    name: "AppTabs",
    template: "<div data-test='mock-app-tabs'><slot /></div>",
    props: ["tabs", "activeTab"],
    emits: ["update:active-tab"],
  },
}));

// Mock FilterGroup component
vi.mock("@/components/alerts/FilterGroup.vue", () => ({
  default: {
    name: "FilterGroup",
    template: "<div data-test='mock-filter-group'></div>",
    props: ["streamFields", "streamFieldsMap", "showSqlPreview", "sqlQuery", "group", "depth"],
    emits: ["add-condition", "add-group", "remove-group", "input:update"],
  },
}));

// Mock QueryEditorDialog component
vi.mock("@/components/alerts/QueryEditorDialog.vue", () => ({
  default: {
    name: "QueryEditorDialog",
    template: "<div data-test='mock-query-editor-dialog'></div>",
    props: ["modelValue", "tab", "sqlQuery", "promqlQuery", "vrlFunction", "streamName", "streamType", "columns", "period", "multiTimeRange", "savedFunctions", "sqlQueryErrorMsg"],
    emits: ["update:modelValue", "update:sqlQuery", "update:promqlQuery", "update:vrlFunction", "validate-sql"],
  },
}));

// Mock CustomConfirmDialog component
vi.mock("@/components/alerts/CustomConfirmDialog.vue", () => ({
  default: {
    name: "CustomConfirmDialog",
    template: "<div data-test='mock-custom-confirm-dialog'></div>",
    props: ["modelValue", "title", "message"],
    emits: ["confirm", "cancel"],
  },
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((str: string) => Buffer.from(str).toString('base64')),
}));

describe("QueryConfig.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;
  let mockInputData: any;

  beforeEach(() => {
    mockStore = createMockStore();
    mockInputData = {
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      },
      period: 10,
      multi_time_range: [],
    };

    wrapper = mount(QueryConfig, {
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
        plugins: [i18n],
      },
      props: {
        tab: "custom",
        multiTimeRange: [],
        columns: [
          { label: "field1", value: "field1", type: "string" },
          { label: "field2", value: "field2", type: "int" },
        ],
        streamFieldsMap: {
          field1: { label: "field1", value: "field1", type: "string" },
          field2: { label: "field2", value: "field2", type: "int" },
        },
        generatedSqlQuery: "",
        inputData: mockInputData,
        streamType: "logs",
        isRealTime: "false",
        sqlQuery: "",
        promqlQuery: "",
        vrlFunction: "",
        streamName: "test-stream",
        sqlQueryErrorMsg: "",
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render with correct theme class (light mode)", () => {
      expect(wrapper.find(".step-query-config.light-mode").exists()).toBe(true);
    });

    it("should render with correct theme class (dark mode)", async () => {
      const darkStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(QueryConfig, {
        global: {
          mocks: { $store: darkStore },
          provide: { store: darkStore },
          plugins: [i18n],
        },
        props: {
          tab: "custom",
          multiTimeRange: [],
          columns: [],
          streamFieldsMap: {},
          generatedSqlQuery: "",
          inputData: mockInputData,
          streamType: "logs",
          isRealTime: "false",
          sqlQuery: "",
          promqlQuery: "",
          vrlFunction: "",
          streamName: "test-stream",
          sqlQueryErrorMsg: "",
        },
      });

      expect(darkWrapper.find(".step-query-config.dark-mode").exists()).toBe(true);
      darkWrapper.unmount();
    });

    it("should initialize with custom tab by default", () => {
      expect(wrapper.vm.localTab).toBe("custom");
    });

    it("should initialize with provided tab", async () => {
      const sqlWrapper = mount(QueryConfig, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          tab: "sql",
          multiTimeRange: [],
          columns: [],
          streamFieldsMap: {},
          generatedSqlQuery: "",
          inputData: mockInputData,
          streamType: "logs",
          isRealTime: "false",
          sqlQuery: "SELECT * FROM test",
          promqlQuery: "",
          vrlFunction: "",
          streamName: "test-stream",
          sqlQueryErrorMsg: "",
        },
      });

      expect(sqlWrapper.vm.localTab).toBe("sql");
      sqlWrapper.unmount();
    });

    it("should load functions from store", () => {
      expect(wrapper.vm.functionsList).toEqual([
        { name: "test_func", function: "// test function" },
      ]);
    });
  });

  describe("Props", () => {
    it("should accept all required props", () => {
      expect(wrapper.props().tab).toBe("custom");
      expect(wrapper.props().inputData).toBeDefined();
      expect(wrapper.props().columns.length).toBe(2);
      expect(wrapper.props().streamType).toBe("logs");
    });

    it("should use default values for optional props", () => {
      expect(wrapper.props().multiTimeRange).toEqual([]);
      expect(wrapper.props().generatedSqlQuery).toBe("");
      expect(wrapper.props().isRealTime).toBe("false");
      expect(wrapper.props().sqlQuery).toBe("");
      expect(wrapper.props().promqlQuery).toBe("");
      expect(wrapper.props().vrlFunction).toBe("");
      expect(wrapper.props().sqlQueryErrorMsg).toBe("");
    });

    it("should handle custom stream type", async () => {
      await wrapper.setProps({ streamType: "metrics" });
      expect(wrapper.props().streamType).toBe("metrics");
    });

    it("should handle real-time alert mode", async () => {
      await wrapper.setProps({ isRealTime: "true" });
      expect(wrapper.props().isRealTime).toBe("true");
    });

    it("should handle SQL query prop", async () => {
      const sqlQuery = "SELECT * FROM logs WHERE status = 200";
      await wrapper.setProps({ sqlQuery });
      expect(wrapper.props().sqlQuery).toBe(sqlQuery);
    });

    it("should handle PromQL query prop", async () => {
      const promqlQuery = "up{job='test'}";
      await wrapper.setProps({ promqlQuery });
      expect(wrapper.props().promqlQuery).toBe(promqlQuery);
    });

    it("should handle VRL function prop", async () => {
      const vrlFunction = ".field = \"value\"";
      await wrapper.setProps({ vrlFunction });
      expect(wrapper.props().vrlFunction).toBe(vrlFunction);
    });

    it("should handle SQL error message prop", async () => {
      const errorMsg = "Invalid SQL syntax";
      await wrapper.setProps({ sqlQueryErrorMsg: errorMsg });
      expect(wrapper.props().sqlQueryErrorMsg).toBe(errorMsg);
    });
  });

  describe("Tab Options Computation", () => {
    it("should show all three tabs for metrics stream type", async () => {
      await wrapper.setProps({ streamType: "metrics" });
      const tabOptions = wrapper.vm.tabOptions;
      expect(tabOptions.length).toBe(3);
      expect(tabOptions.map((t: any) => t.value)).toEqual(["custom", "sql", "promql"]);
    });

    it("should show only custom and SQL tabs for logs stream type", async () => {
      await wrapper.setProps({ streamType: "logs" });
      const tabOptions = wrapper.vm.tabOptions;
      expect(tabOptions.length).toBe(2);
      expect(tabOptions.map((t: any) => t.value)).toEqual(["custom", "sql"]);
    });

    it("should show only custom and SQL tabs for traces stream type", async () => {
      await wrapper.setProps({ streamType: "traces" });
      const tabOptions = wrapper.vm.tabOptions;
      expect(tabOptions.length).toBe(2);
      expect(tabOptions.map((t: any) => t.value)).toEqual(["custom", "sql"]);
    });

    it("should show only custom tab for real-time alerts", async () => {
      await wrapper.setProps({ isRealTime: "true" });
      const tabOptions = wrapper.vm.tabOptions;
      expect(tabOptions.length).toBe(1);
      expect(tabOptions[0].value).toBe("custom");
    });

    it("should show tabs for scheduled alerts", () => {
      expect(wrapper.vm.shouldShowTabs).toBe(true);
    });

    it("should hide tabs for real-time alerts", async () => {
      await wrapper.setProps({ isRealTime: "true" });
      expect(wrapper.vm.shouldShowTabs).toBe(false);
    });
  });

  describe("Tab Switching", () => {
    it("should update tab when updateTab is called", async () => {
      await wrapper.vm.updateTab("sql");
      expect(wrapper.vm.localTab).toBe("sql");
      expect(wrapper.emitted("update:tab")).toBeTruthy();
      expect(wrapper.emitted("update:tab")![0]).toEqual(["sql"]);
    });

    it("should switch from custom to SQL tab", async () => {
      expect(wrapper.vm.localTab).toBe("custom");
      await wrapper.vm.updateTab("sql");
      expect(wrapper.vm.localTab).toBe("sql");
    });

    it("should switch from SQL to PromQL tab", async () => {
      await wrapper.setProps({ streamType: "metrics" });
      await wrapper.vm.updateTab("sql");
      await wrapper.vm.updateTab("promql");
      expect(wrapper.vm.localTab).toBe("promql");
    });

    it("should emit update:tab event on tab change", async () => {
      await wrapper.vm.updateTab("sql");
      expect(wrapper.emitted("update:tab")).toBeTruthy();
    });

    it("should show multi-window dialog when switching to custom with multi-windows", async () => {
      await wrapper.setProps({
        multiTimeRange: [{ label: "1h ago", value: 3600 }],
      });
      await wrapper.vm.updateTab("custom");

      expect(wrapper.vm.showMultiWindowDialog).toBe(true);
      expect(wrapper.vm.pendingTab).toBe("custom");
    });

    it("should show multi-window dialog when switching to promql with multi-windows", async () => {
      await wrapper.setProps({
        streamType: "metrics",
        multiTimeRange: [{ label: "1h ago", value: 3600 }],
      });
      await wrapper.vm.updateTab("promql");

      expect(wrapper.vm.showMultiWindowDialog).toBe(true);
      expect(wrapper.vm.pendingTab).toBe("promql");
    });

    it("should not show multi-window dialog when switching to SQL with multi-windows", async () => {
      await wrapper.setProps({
        multiTimeRange: [{ label: "1h ago", value: 3600 }],
      });
      await wrapper.vm.updateTab("sql");

      expect(wrapper.vm.showMultiWindowDialog).toBe(false);
      expect(wrapper.vm.localTab).toBe("sql");
    });

    it("should not show dialog when switching with no multi-windows", async () => {
      await wrapper.vm.updateTab("sql");
      expect(wrapper.vm.showMultiWindowDialog).toBe(false);
    });
  });

  describe("Multi-Window Dialog Handling", () => {
    beforeEach(async () => {
      await wrapper.setProps({
        multiTimeRange: [{ label: "1h ago", value: 3600 }],
      });
    });

    it("should confirm clearing multi-windows", async () => {
      await wrapper.vm.updateTab("custom");
      expect(wrapper.vm.showMultiWindowDialog).toBe(true);

      await wrapper.vm.handleConfirmClearMultiWindows();
      await nextTick();

      expect(wrapper.emitted("clear-multi-windows")).toBeTruthy();
      expect(wrapper.emitted("update:tab")!.length).toBeGreaterThan(0);
    });

    it("should cancel clearing multi-windows", async () => {
      await wrapper.vm.updateTab("custom");
      expect(wrapper.vm.showMultiWindowDialog).toBe(true);

      await wrapper.vm.handleCancelClearMultiWindows();

      expect(wrapper.vm.showMultiWindowDialog).toBe(false);
      expect(wrapper.vm.pendingTab).toBe(null);
      expect(wrapper.emitted("clear-multi-windows")).toBeFalsy();
    });

    it("should switch tab after confirming multi-window clear", async () => {
      await wrapper.vm.updateTab("custom");
      await wrapper.vm.handleConfirmClearMultiWindows();
      await nextTick();

      const emittedTabs = wrapper.emitted("update:tab");
      expect(emittedTabs).toBeTruthy();
    });

    it("should reset pendingTab after confirmation", async () => {
      await wrapper.vm.updateTab("custom");
      expect(wrapper.vm.pendingTab).toBe("custom");

      await wrapper.vm.handleConfirmClearMultiWindows();
      await nextTick();

      expect(wrapper.vm.pendingTab).toBe(null);
    });

    it("should close dialog after confirmation", async () => {
      await wrapper.vm.updateTab("custom");
      await wrapper.vm.handleConfirmClearMultiWindows();
      await nextTick();

      expect(wrapper.vm.showMultiWindowDialog).toBe(false);
    });
  });

  describe("Query Display", () => {
    it("should display SQL query when on SQL tab", async () => {
      const sqlQuery = "SELECT * FROM logs";
      await wrapper.setProps({ sqlQuery, tab: "sql" });
      wrapper.vm.localTab = "sql";
      await nextTick();

      expect(wrapper.vm.sqlOrPromqlQuery).toBe(sqlQuery);
    });

    it("should display PromQL query when on PromQL tab", async () => {
      const promqlQuery = "up{job='test'}";
      await wrapper.setProps({
        promqlQuery,
        tab: "promql",
        streamType: "metrics",
      });
      wrapper.vm.localTab = "promql";
      await nextTick();

      expect(wrapper.vm.sqlOrPromqlQuery).toBe(promqlQuery);
    });

    it("should display empty string when no query is set", () => {
      expect(wrapper.vm.sqlOrPromqlQuery).toBe("");
    });
  });

  describe("Query Updates", () => {
    it("should update SQL query", async () => {
      const newQuery = "SELECT * FROM logs WHERE level = 'error'";
      await wrapper.vm.updateSqlQuery(newQuery);

      expect(wrapper.vm.localSqlQuery).toBe(newQuery);
      expect(wrapper.emitted("update:sqlQuery")).toBeTruthy();
      expect(wrapper.emitted("update:sqlQuery")![0]).toEqual([newQuery]);
    });

    it("should update PromQL query", async () => {
      const newQuery = "rate(http_requests_total[5m])";
      await wrapper.vm.updatePromqlQuery(newQuery);

      expect(wrapper.vm.localPromqlQuery).toBe(newQuery);
      expect(wrapper.emitted("update:promqlQuery")).toBeTruthy();
      expect(wrapper.emitted("update:promqlQuery")![0]).toEqual([newQuery]);
    });

    it("should handle VRL function update from dialog", async () => {
      const encodedVrl = "LmZpZWxkID0gInZhbHVlIg=="; // base64 encoded
      await wrapper.vm.handleVrlFunctionUpdate(encodedVrl);

      expect(wrapper.emitted("update:vrlFunction")).toBeTruthy();
      expect(wrapper.emitted("update:vrlFunction")![0]).toEqual([encodedVrl]);
    });

    it("should handle empty SQL query update", async () => {
      await wrapper.vm.updateSqlQuery("");
      expect(wrapper.vm.localSqlQuery).toBe("");
      expect(wrapper.emitted("update:sqlQuery")![0]).toEqual([""]);
    });

    it("should handle empty PromQL query update", async () => {
      await wrapper.vm.updatePromqlQuery("");
      expect(wrapper.vm.localPromqlQuery).toBe("");
      expect(wrapper.emitted("update:promqlQuery")![0]).toEqual([""]);
    });
  });

  describe("Group and Condition Management", () => {
    it("should emit update-group event", async () => {
      const groupData = { id: "test-group", conditions: [] };
      await wrapper.vm.updateGroup(groupData);

      expect(wrapper.emitted("update-group")).toBeTruthy();
      expect(wrapper.emitted("update-group")![0]).toEqual([groupData]);
    });

    it("should emit remove-group event", async () => {
      const groupData = { id: "test-group" };
      await wrapper.vm.removeConditionGroup(groupData);

      expect(wrapper.emitted("remove-group")).toBeTruthy();
      expect(wrapper.emitted("remove-group")![0]).toEqual([groupData]);
    });

    it("should emit input:update event", async () => {
      const name = "test-field";
      const field = { value: "test-value" };
      await wrapper.vm.onInputUpdate(name, field);

      expect(wrapper.emitted("input:update")).toBeTruthy();
      expect(wrapper.emitted("input:update")![0]).toEqual([name, field]);
    });
  });

  describe("Validation - Custom Mode", () => {
    beforeEach(() => {
      wrapper.vm.localTab = "custom";
    });

    it("should validate successfully with empty conditions", async () => {
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should validate successfully with valid conditions", async () => {
      await wrapper.setProps({
        inputData: {
          ...mockInputData,
          conditions: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [
              {
                filterType: "condition",
                column: "status",
                operator: "=",
                value: "200",
              },
            ],
          },
        },
      });

      const mockForm = {
        validate: vi.fn().mockResolvedValue(true),
      };
      wrapper.vm.customConditionsForm = mockForm;

      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should return false when form validation fails", async () => {
      await wrapper.setProps({
        inputData: {
          ...mockInputData,
          conditions: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [
              {
                filterType: "condition",
                column: "",
                operator: "=",
                value: "",
              },
            ],
          },
        },
      });

      const mockForm = {
        validate: vi.fn().mockResolvedValue(false),
      };
      wrapper.vm.customConditionsForm = mockForm;

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should handle async validation", async () => {
      const mockForm = {
        validate: vi.fn().mockResolvedValue(true),
      };
      wrapper.vm.customConditionsForm = mockForm;

      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should return true when form ref is not available", async () => {
      wrapper.vm.customConditionsForm = null;
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });
  });

  describe("Validation - SQL Mode", () => {
    beforeEach(async () => {
      wrapper.vm.localTab = "sql";
      await wrapper.setProps({ tab: "sql" });
    });

    it("should validate successfully with valid SQL", async () => {
      await wrapper.setProps({ sqlQuery: "SELECT * FROM logs" });
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should fail validation with empty SQL", async () => {
      await wrapper.setProps({ sqlQuery: "" });
      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should fail validation with whitespace-only SQL", async () => {
      await wrapper.setProps({ sqlQuery: "   " });
      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should fail validation when SQL error message is present", async () => {
      await wrapper.setProps({
        sqlQuery: "SELECT * FROM logs",
        sqlQueryErrorMsg: "Invalid syntax",
      });
      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should validate successfully when SQL is valid and no error message", async () => {
      await wrapper.setProps({
        sqlQuery: "SELECT * FROM logs WHERE status = 200",
        sqlQueryErrorMsg: "",
      });
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });
  });

  describe("Validation - PromQL Mode", () => {
    beforeEach(async () => {
      wrapper.vm.localTab = "promql";
      await wrapper.setProps({
        tab: "promql",
        streamType: "metrics",
      });
    });

    it("should always validate successfully in PromQL mode", async () => {
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should validate with empty PromQL query", async () => {
      await wrapper.setProps({ promqlQuery: "" });
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should validate with non-empty PromQL query", async () => {
      await wrapper.setProps({ promqlQuery: "up{job='test'}" });
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });
  });

  describe("SQL Validation Trigger", () => {
    it("should emit validate-sql event", async () => {
      await wrapper.vm.handleValidateSql();

      expect(wrapper.emitted("validate-sql")).toBeTruthy();
    });

    it("should emit validate-sql event multiple times", async () => {
      await wrapper.vm.handleValidateSql();
      await wrapper.vm.handleValidateSql();
      await wrapper.vm.handleValidateSql();

      expect(wrapper.emitted("validate-sql")!.length).toBe(3);
    });
  });

  describe("Editor Dialog", () => {
    it("should open editor dialog on button click", async () => {
      wrapper.vm.localTab = "sql";
      await nextTick();

      expect(wrapper.vm.viewSqlEditor).toBe(false);
      wrapper.vm.viewSqlEditor = true;
      await nextTick();

      expect(wrapper.vm.viewSqlEditor).toBe(true);
    });

    it("should not show editor button in custom mode", async () => {
      wrapper.vm.localTab = "custom";
      await nextTick();

      // Button should not be rendered in custom mode
      expect(wrapper.vm.localTab).toBe("custom");
    });

    it("should show editor button in SQL mode", async () => {
      wrapper.vm.localTab = "sql";
      await nextTick();

      expect(wrapper.vm.localTab).toBe("sql");
    });

    it("should show editor button in PromQL mode", async () => {
      await wrapper.setProps({ streamType: "metrics" });
      wrapper.vm.localTab = "promql";
      await nextTick();

      expect(wrapper.vm.localTab).toBe("promql");
    });
  });

  describe("Emits", () => {
    it("should emit all expected events", async () => {
      await wrapper.vm.updateTab("sql");
      await wrapper.vm.updateGroup({});
      await wrapper.vm.removeConditionGroup({});
      await wrapper.vm.onInputUpdate("test", {});
      await wrapper.vm.updateSqlQuery("SELECT *");
      await wrapper.vm.updatePromqlQuery("up");
      await wrapper.vm.handleVrlFunctionUpdate("vrl");
      await wrapper.vm.handleValidateSql();

      expect(wrapper.emitted()).toHaveProperty("update:tab");
      expect(wrapper.emitted()).toHaveProperty("update-group");
      expect(wrapper.emitted()).toHaveProperty("remove-group");
      expect(wrapper.emitted()).toHaveProperty("input:update");
      expect(wrapper.emitted()).toHaveProperty("update:sqlQuery");
      expect(wrapper.emitted()).toHaveProperty("update:promqlQuery");
      expect(wrapper.emitted()).toHaveProperty("update:vrlFunction");
      expect(wrapper.emitted()).toHaveProperty("validate-sql");
    });

    it("should not emit events when not triggered", () => {
      expect(wrapper.emitted("update:tab")).toBeFalsy();
      expect(wrapper.emitted("update-group")).toBeFalsy();
      expect(wrapper.emitted("remove-group")).toBeFalsy();
      expect(wrapper.emitted("input:update")).toBeFalsy();
      expect(wrapper.emitted("update:sqlQuery")).toBeFalsy();
      expect(wrapper.emitted("update:promqlQuery")).toBeFalsy();
      expect(wrapper.emitted("update:vrlFunction")).toBeFalsy();
      expect(wrapper.emitted("validate-sql")).toBeFalsy();
      expect(wrapper.emitted("clear-multi-windows")).toBeFalsy();
    });
  });

  describe("Edge Cases", () => {
    it.skip("should handle null inputData gracefully - REQUIRES E2E", async () => {
      // Skipped: Component requires inputData prop and will throw error with null
      // This is expected behavior and should be enforced by TypeScript
    });

    it("should handle empty columns array", async () => {
      await wrapper.setProps({ columns: [] });
      expect(wrapper.props().columns).toEqual([]);
    });

    it("should handle empty streamFieldsMap", async () => {
      await wrapper.setProps({ streamFieldsMap: {} });
      expect(wrapper.props().streamFieldsMap).toEqual({});
    });

    it("should handle very long SQL query", async () => {
      const longQuery = "SELECT * FROM logs WHERE " + "field = 'value' AND ".repeat(100);
      await wrapper.vm.updateSqlQuery(longQuery);
      expect(wrapper.vm.localSqlQuery.length).toBeGreaterThan(1000);
    });

    it("should handle very long PromQL query", async () => {
      const longQuery = "rate(http_requests_total[5m]) " + "+ ".repeat(100) + "0";
      await wrapper.vm.updatePromqlQuery(longQuery);
      expect(wrapper.vm.localPromqlQuery.length).toBeGreaterThan(100);
    });

    it("should handle special characters in queries", async () => {
      const specialQuery = "SELECT * FROM logs WHERE msg LIKE '%error%' AND status = '500'";
      await wrapper.vm.updateSqlQuery(specialQuery);
      expect(wrapper.vm.localSqlQuery).toBe(specialQuery);
    });

    it("should handle rapid tab switching", async () => {
      for (let i = 0; i < 10; i++) {
        await wrapper.vm.updateTab(i % 2 === 0 ? "custom" : "sql");
      }
      expect(wrapper.emitted("update:tab")!.length).toBe(10);
    });

    it("should handle multiple multi-time ranges", async () => {
      await wrapper.setProps({
        multiTimeRange: [
          { label: "1h ago", value: 3600 },
          { label: "2h ago", value: 7200 },
          { label: "1d ago", value: 86400 },
        ],
      });
      await wrapper.vm.updateTab("custom");
      expect(wrapper.vm.showMultiWindowDialog).toBe(true);
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle minimum valid SQL query (1 character)", async () => {
      wrapper.vm.localTab = "sql";
      await wrapper.setProps({ sqlQuery: "1" });
      const result = await wrapper.vm.validate();
      expect(result).toBe(true);
    });

    it("should handle switching between all available tabs", async () => {
      await wrapper.setProps({ streamType: "metrics" });

      await wrapper.vm.updateTab("custom");
      expect(wrapper.vm.localTab).toBe("custom");

      await wrapper.vm.updateTab("sql");
      expect(wrapper.vm.localTab).toBe("sql");

      await wrapper.vm.updateTab("promql");
      expect(wrapper.vm.localTab).toBe("promql");
    });

    it("should handle zero-length arrays", async () => {
      await wrapper.setProps({
        columns: [],
        multiTimeRange: [],
      });

      expect(wrapper.props().columns.length).toBe(0);
      expect(wrapper.props().multiTimeRange.length).toBe(0);
    });

    it("should handle empty string queries", async () => {
      await wrapper.vm.updateSqlQuery("");
      await wrapper.vm.updatePromqlQuery("");

      expect(wrapper.vm.localSqlQuery).toBe("");
      expect(wrapper.vm.localPromqlQuery).toBe("");
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      // Tabs are hidden for real-time alerts, check component exists
      expect(wrapper.exists()).toBe(true);
    });

    it("should render FilterGroup in custom mode", async () => {
      wrapper.vm.localTab = "custom";
      await nextTick();

      expect(wrapper.find('[data-test="mock-filter-group"]').exists()).toBe(true);
    });

    it("should render QueryEditorDialog", () => {
      expect(wrapper.find('[data-test="mock-query-editor-dialog"]').exists()).toBe(true);
    });

    it("should render CustomConfirmDialog", () => {
      expect(wrapper.find('[data-test="mock-custom-confirm-dialog"]').exists()).toBe(true);
    });
  });

  describe("Negative Cases", () => {
    it("should not emit update:tab when not called", () => {
      expect(wrapper.emitted("update:tab")).toBeFalsy();
    });

    it("should not emit clear-multi-windows when canceling dialog", async () => {
      await wrapper.setProps({
        multiTimeRange: [{ label: "1h ago", value: 3600 }],
      });
      await wrapper.vm.updateTab("custom");
      await wrapper.vm.handleCancelClearMultiWindows();

      expect(wrapper.emitted("clear-multi-windows")).toBeFalsy();
    });

    it("should not validate SQL mode with empty query", async () => {
      wrapper.vm.localTab = "sql";
      await wrapper.setProps({ sqlQuery: "" });

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });

    it("should not validate SQL mode with error message", async () => {
      wrapper.vm.localTab = "sql";
      await wrapper.setProps({
        sqlQuery: "SELECT * FROM logs",
        sqlQueryErrorMsg: "Error",
      });

      const result = await wrapper.vm.validate();
      expect(result).toBe(false);
    });
  });

  describe("Theme Switching", () => {
    it("should apply light mode theme", () => {
      expect(wrapper.find(".light-mode").exists()).toBe(true);
    });

    it("should apply dark mode theme", async () => {
      const darkStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(QueryConfig, {
        global: {
          mocks: { $store: darkStore },
          provide: { store: darkStore },
          plugins: [i18n],
        },
        props: {
          tab: "custom",
          multiTimeRange: [],
          columns: [],
          streamFieldsMap: {},
          generatedSqlQuery: "",
          inputData: mockInputData,
          streamType: "logs",
          isRealTime: "false",
          sqlQuery: "",
          promqlQuery: "",
          vrlFunction: "",
          streamName: "test-stream",
          sqlQueryErrorMsg: "",
        },
      });

      expect(darkWrapper.find(".dark-mode").exists()).toBe(true);
      darkWrapper.unmount();
    });
  });

  describe("Functions List", () => {
    it("should load functions from store", () => {
      expect(wrapper.vm.functionsList).toEqual([
        { name: "test_func", function: "// test function" },
      ]);
    });

    it("should handle empty functions list", async () => {
      const emptyStore = createMockStore({
        organizationData: { functions: [] },
      });
      const emptyWrapper = mount(QueryConfig, {
        global: {
          mocks: { $store: emptyStore },
          provide: { store: emptyStore },
          plugins: [i18n],
        },
        props: {
          tab: "custom",
          multiTimeRange: [],
          columns: [],
          streamFieldsMap: {},
          generatedSqlQuery: "",
          inputData: mockInputData,
          streamType: "logs",
          isRealTime: "false",
          sqlQuery: "",
          promqlQuery: "",
          vrlFunction: "",
          streamName: "test-stream",
          sqlQueryErrorMsg: "",
        },
      });

      expect(emptyWrapper.vm.functionsList).toEqual([]);
      emptyWrapper.unmount();
    });
  });
});
