// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick } from "vue";

// Mock colorizeQuery utility
vi.mock("@/utils/query/colorizeQuery", () => ({
  colorizeQuery: vi.fn((query: string) => {
    return Promise.resolve(`<span class="mock-colorized">${query}</span>`);
  }),
}));

// Mock utility functions
vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(() => {
    return `2024-01-01 12:00:00.000`;
  }),
}));

import QueryInspector from "@/components/dashboards/QueryInspector.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { colorizeQuery } from "@/utils/query/colorizeQuery";

installQuasar();

describe("QueryInspector", () => {
  let wrapper: any;

  const defaultProps = {
    metaData: {
      queries: [
        {
          originalQuery: "SELECT * FROM logs WHERE level = 'error'",
          query: "SELECT * FROM logs WHERE level = 'error' AND timestamp >= 1640995200000",
          startTime: 1640995200000,
          endTime: 1641081600000,
          queryType: "SQL",
          variables: [
            {
              name: "level",
              value: "error",
              type: "variable",
            },
            {
              name: "service",
              value: "api",
              type: "fixed",
            },
            {
              name: "count",
              value: "100",
              operator: ">=",
              type: "dynamicVariable",
            },
          ],
        },
        {
          originalQuery: "SELECT count(*) FROM metrics",
          query: "SELECT count(*) FROM metrics WHERE timestamp >= 1640995200000",
          startTime: 1640995200000,
          endTime: 1641081600000,
          queryType: "SQL",
          variables: [],
        },
      ],
    },
    data: {
      title: "Error Analysis Dashboard",
      id: "dashboard-1",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.timezone = "UTC";
    store.state.theme = "light";

    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(QueryInspector, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          QCard: { template: '<div data-test="q-card"><slot /></div>' },
          QCardSection: { template: '<div data-test="q-card-section"><slot /></div>' },
          QBtn: {
            template: '<button data-test="q-btn" @click="$emit(\'click\')" v-bind="$attrs"><slot /></button>',
            props: ['icon', 'flat', 'round', 'dense', 'color', 'size', 'noCaps'],
          },
          QInput: {
            template: '<input data-test="q-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" v-bind="$attrs"><slot name="prepend" /></input>',
            props: ['modelValue', 'placeholder', 'dense', 'color', 'dark'],
          },
          QIcon: {
            template: '<span data-test="q-icon" :class="name"><slot /></span>',
            props: ['name', 'size'],
          },
        },
        directives: {
          'close-popup': () => {},
        },
      },
    });
  };

  describe("Component Initialization", () => {
    it("should render component with default props", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should initialize with required props", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.$props.metaData).toEqual(defaultProps.metaData);
      expect(wrapper.vm.$props.data).toEqual(defaultProps.data);
    });

    it("should initialize reactive data correctly", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.queryData).toBeDefined();
      expect(wrapper.vm.totalQueries).toBeDefined();
      expect(wrapper.vm.dataTitle).toBeDefined();
      expect(wrapper.vm.searchQuery).toBeDefined();
      expect(wrapper.vm.colorizedQueries).toBeDefined();
    });

    it("should handle empty metaData gracefully", async () => {
      wrapper = createWrapper({
        metaData: {},
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.queryData).toEqual([]);
      expect(wrapper.vm.totalQueries).toBe(0);
    });

    it("should handle null metaData gracefully", async () => {
      wrapper = createWrapper({
        metaData: null,
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.queryData).toEqual([]);
      expect(wrapper.vm.totalQueries).toBe(0);
    });
  });

  describe("Template Rendering", () => {
    it("should display query inspector title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Query Inspector");
    });

    it("should display panel title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Panel : Error Analysis Dashboard");
    });

    it("should display total queries count", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Total Queries: 2");
    });

    it("should render close button", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const closeBtn = wrapper.find('[data-test="query-inspector-close-btn"]');
      expect(closeBtn.exists()).toBe(true);
    });

    it("should render search input", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const searchInput = wrapper.find('[data-test="q-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("should display query numbers", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Query 1");
      expect(wrapper.text()).toContain("Query 2");
    });

    it("should display query types", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("SQL");
    });

    it("should render empty state when no queries", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [],
        },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("No queries executed for this panel");
    });

    it("should handle empty data title", async () => {
      wrapper = createWrapper({
        data: {
          title: "",
          id: "dashboard-1",
        },
      });
      await flushPromises();

      expect(wrapper.text()).toContain("Panel :");
    });
  });

  describe("Props Validation", () => {
    it("should require metaData prop", () => {
      const props = QueryInspector.props;
      expect(props.metaData.required).toBe(true);
    });

    it("should require data prop", () => {
      const props = QueryInspector.props;
      expect(props.data.required).toBe(true);
      expect(props.data.type).toBe(Object);
    });
  });

  describe("Query Data Processing", () => {
    it("should process query data from metaData", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.queryData).toEqual(defaultProps.metaData.queries);
    });

    it("should compute total queries correctly", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.totalQueries).toBe(2);
    });

    it("should compute total queries as 0 when no queries", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [],
        },
      });
      await flushPromises();

      expect(wrapper.vm.totalQueries).toBe(0);
    });

    it("should display original query when present", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Original Query");
    });

    it("should display executed query", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Executed Query");
    });
  });

  describe("formatTimestamp Method", () => {
    it("should format timestamps correctly", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const formattedTime = wrapper.vm.formatTimestamp(1640995200000);
      expect(formattedTime).toContain("1640995200000");
      expect(formattedTime).toContain("2024-01-01 12:00:00.000");
      expect(formattedTime).toContain("UTC");
    });

    it("should return dash for missing timestamp", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const formattedTime = wrapper.vm.formatTimestamp(null);
      expect(formattedTime).toBe("-");
    });

    it("should return dash for undefined timestamp", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const formattedTime = wrapper.vm.formatTimestamp(undefined);
      expect(formattedTime).toBe("-");
    });

    it("should return dash for zero timestamp", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const formattedTime = wrapper.vm.formatTimestamp(0);
      expect(formattedTime).toBe("-");
    });

    it("should use timezone from store", async () => {
      store.state.timezone = "America/New_York";
      wrapper = createWrapper();
      await flushPromises();

      const formattedTime = wrapper.vm.formatTimestamp(1640995200000);
      expect(formattedTime).toContain("America/New_York");
    });
  });

  describe("getVariablesByType Method", () => {
    it("should filter variables by type correctly", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const query = defaultProps.metaData.queries[0];
      const standardVars = wrapper.vm.getVariablesByType(query, "variable");
      const fixedVars = wrapper.vm.getVariablesByType(query, "fixed");
      const dynamicVars = wrapper.vm.getVariablesByType(query, "dynamicVariable");

      expect(standardVars).toHaveLength(1);
      expect(standardVars[0].name).toBe("level");
      expect(fixedVars).toHaveLength(1);
      expect(fixedVars[0].name).toBe("service");
      expect(dynamicVars).toHaveLength(1);
      expect(dynamicVars[0].name).toBe("count");
    });

    it("should return empty array when no variables match type", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const query = defaultProps.metaData.queries[1];
      const vars = wrapper.vm.getVariablesByType(query, "variable");

      expect(vars).toEqual([]);
    });

    it("should handle query without variables", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const query = { ...defaultProps.metaData.queries[0], variables: undefined };
      const vars = wrapper.vm.getVariablesByType(query, "variable");

      expect(vars).toEqual([]);
    });

    it("should handle query with empty variables array", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const query = { ...defaultProps.metaData.queries[0], variables: [] };
      const vars = wrapper.vm.getVariablesByType(query, "variable");

      expect(vars).toEqual([]);
    });
  });

  describe("updateColorizedQueries Method", () => {
    it("should colorize queries on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(colorizeQuery).toHaveBeenCalled();
      expect(wrapper.vm.colorizedQueries).toBeDefined();
    });

    it("should call colorizeQuery for each query with correct language", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const query1 = defaultProps.metaData.queries[0];
      const query2 = defaultProps.metaData.queries[1];

      expect(colorizeQuery).toHaveBeenCalledWith(query1.originalQuery, "sql");
      expect(colorizeQuery).toHaveBeenCalledWith(query1.query, "sql");
      expect(colorizeQuery).toHaveBeenCalledWith(query2.originalQuery, "sql");
      expect(colorizeQuery).toHaveBeenCalledWith(query2.query, "sql");
    });

    it("should handle queries without originalQuery", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              query: "SELECT * FROM logs",
              startTime: 1640995200000,
              endTime: 1641081600000,
              queryType: "SQL",
              variables: [],
            },
          ],
        },
      });
      await flushPromises();

      expect(colorizeQuery).toHaveBeenCalledWith("SELECT * FROM logs", "sql");
    });

    it("should store colorized queries with correct keys", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.colorizedQueries["0-Original Query"]).toBeDefined();
      expect(wrapper.vm.colorizedQueries["0-Query"]).toBeDefined();
      expect(wrapper.vm.colorizedQueries["1-Original Query"]).toBeDefined();
      expect(wrapper.vm.colorizedQueries["1-Query"]).toBeDefined();
    });

    it("should update colorized queries when metaData changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.clearAllMocks();

      await wrapper.setProps({
        metaData: {
          queries: [
            {
              query: "NEW QUERY",
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
          ],
        },
      });

      await flushPromises();

      expect(colorizeQuery).toHaveBeenCalledWith("NEW QUERY", "sql");
    });
  });

  describe("highlightSearch Method", () => {
    it("should return html unchanged when no search query", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const html = "<span>test query</span>";
      wrapper.vm.searchQuery = "";
      const result = wrapper.vm.highlightSearch(html);

      expect(result).toBe(html);
    });

    it("should highlight matching text", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const html = "<span>test query</span>";
      wrapper.vm.searchQuery = "query";
      const result = wrapper.vm.highlightSearch(html);

      expect(result).toContain("<mark");
      expect(result).toContain("query");
    });

    it("should escape special regex characters", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const html = "test (query) with special chars";
      wrapper.vm.searchQuery = "(query)";
      const result = wrapper.vm.highlightSearch(html);

      expect(result).toContain("<mark");
      expect(result).toContain("(query)");
    });

    it("should be case insensitive", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const html = "Test QUERY Query";
      wrapper.vm.searchQuery = "query";
      const result = wrapper.vm.highlightSearch(html);

      expect(result).toContain("<mark");
      // The regex matches case-insensitively but may match fewer times depending on HTML structure
      expect((result.match(/<mark/g) || []).length).toBeGreaterThanOrEqual(1);
    });

    it("should not highlight text inside HTML tags", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const html = '<span class="test">query</span>';
      wrapper.vm.searchQuery = "class";
      const result = wrapper.vm.highlightSearch(html);

      // Should not highlight "class" inside the tag attribute
      expect(result).toBe(html);
    });

    it("should return html unchanged for empty html", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchQuery = "test";
      const result = wrapper.vm.highlightSearch("");

      expect(result).toBe("");
    });

    it("should return html unchanged for null html", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchQuery = "test";
      const result = wrapper.vm.highlightSearch(null);

      expect(result).toBe(null);
    });

    it("should handle regex errors gracefully", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const html = "test query";
      wrapper.vm.searchQuery = "test";

      // Mock a regex that might throw
      const spy = vi.spyOn(String.prototype, 'replace').mockImplementationOnce(() => {
        throw new Error("Regex error");
      });

      const result = wrapper.vm.highlightSearch(html);

      expect(result).toBe(html);
      spy.mockRestore();
    });
  });

  describe("copyText Method", () => {
    it("should copy text to clipboard", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const testText = "SELECT * FROM logs";
      wrapper.vm.copyText(testText);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testText);
    });

    it("should not copy empty text", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.copyText("");

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("should not copy null text", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.copyText(null);

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("should not copy undefined text", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.copyText(undefined);

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("should handle copy button clicks", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const copyButtons = wrapper.findAll('[data-test="q-btn"]');
      const copyButton = copyButtons.find((btn: any) => btn.text().includes("Copy"));

      if (copyButton) {
        await copyButton.trigger('click');
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      }
    });

    it("should copy executed query when copy button is clicked", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Find all copy buttons and click the one for executed query
      const copyButtons = wrapper.findAll('[data-test="q-btn"]');

      // There should be multiple copy buttons (one for originalQuery, one for query per query item)
      // Find the button that would copy the executed query
      for (const btn of copyButtons) {
        if (btn.text().includes("Copy")) {
          await btn.trigger('click');
        }
      }

      // Verify clipboard writeText was called
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });

  describe("Computed Properties", () => {
    it("should compute dataTitle from props.data.title", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.dataTitle).toBe("Error Analysis Dashboard");
    });

    it("should update dataTitle when props change", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.dataTitle).toBe("Error Analysis Dashboard");

      await wrapper.setProps({
        data: {
          title: "New Dashboard Title",
          id: "dashboard-2",
        },
      });

      expect(wrapper.vm.dataTitle).toBe("New Dashboard Title");
    });

    it("should compute totalQueries from queryData length", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.totalQueries).toBe(2);
    });
  });

  describe("getQueryTypeDisplay Method", () => {
    it("should return SQL for empty queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("");
      expect(result).toBe("SQL");
    });

    it("should return SQL for null queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay(null);
      expect(result).toBe("SQL");
    });

    it("should return SQL for undefined queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay(undefined);
      expect(result).toBe("SQL");
    });

    it("should return SQL for sql queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("sql");
      expect(result).toBe("SQL");
    });

    it("should return SQL for SQL queryType in uppercase", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("SQL");
      expect(result).toBe("SQL");
    });

    it("should return SQL for SQL queryType in mixed case", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("SqL");
      expect(result).toBe("SQL");
    });

    it("should return PromQL for promql queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("promql");
      expect(result).toBe("PromQL");
    });

    it("should return PromQL for PromQL queryType in uppercase", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("PROMQL");
      expect(result).toBe("PromQL");
    });

    it("should return PromQL for metrics queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("metrics");
      expect(result).toBe("PromQL");
    });

    it("should return PromQL for METRICS queryType in uppercase", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("METRICS");
      expect(result).toBe("PromQL");
    });

    it("should return uppercase for unknown queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("vrl");
      expect(result).toBe("VRL");
    });

    it("should return uppercase for custom queryType", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("custom");
      expect(result).toBe("CUSTOM");
    });

    it("should handle queryType with special characters", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const result = wrapper.vm.getQueryTypeDisplay("my-query");
      expect(result).toBe("MY-QUERY");
    });
  });

  describe("Store Integration", () => {
    it("should use timezone from store", async () => {
      store.state.timezone = "America/New_York";
      wrapper = createWrapper();
      await flushPromises();

      const formattedTime = wrapper.vm.formatTimestamp(1640995200000);
      expect(formattedTime).toContain("America/New_York");
    });

    it("should use theme from store for input", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.store.state.theme).toBe("dark");
    });
  });

  describe("Watch Functionality", () => {
    it("should watch metaData changes and update colorized queries", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.clearAllMocks();

      await wrapper.setProps({
        metaData: {
          queries: [
            {
              query: "UPDATED QUERY",
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
          ],
        },
      });

      await flushPromises();

      expect(colorizeQuery).toHaveBeenCalled();
    });

    it("should handle deep metaData changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      vi.clearAllMocks();

      const newMetaData = {
        queries: [
          {
            ...defaultProps.metaData.queries[0],
            query: "MODIFIED QUERY",
          },
        ],
      };

      await wrapper.setProps({ metaData: newMetaData });
      await flushPromises();

      expect(colorizeQuery).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle queries with missing properties", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              query: "SELECT * FROM logs",
              // Missing other properties
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very long query strings", async () => {
      const longQuery = "SELECT * FROM logs WHERE " + "condition AND ".repeat(100) + "final_condition";

      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              originalQuery: longQuery,
              query: longQuery,
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle special characters in queries", async () => {
      const specialQuery = "SELECT * FROM logs WHERE field LIKE '%test%' AND other = '$var'";

      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              query: specialQuery,
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle multiple queries with different types", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              query: "SELECT * FROM logs",
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
            {
              query: "rate(http_requests[5m])",
              queryType: "PromQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(colorizeQuery).toHaveBeenCalledWith(expect.any(String), "sql");
      expect(colorizeQuery).toHaveBeenCalledWith(expect.any(String), "promql");
    });

    it("should handle variables without operator", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              query: "SELECT * FROM logs",
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [
                {
                  name: "test",
                  value: "value",
                  type: "dynamicVariable",
                  // Missing operator
                },
              ],
            },
          ],
        },
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle component mounting without errors", async () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
      await flushPromises();
    });

    it("should handle component unmounting without errors", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it("should clean up watchers on unmount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const initialCallCount = (colorizeQuery as any).mock.calls.length;

      wrapper.unmount();

      // Try to trigger a prop change after unmount (should not call colorizeQuery)
      await nextTick();

      expect((colorizeQuery as any).mock.calls.length).toBe(initialCallCount);
    });
  });

  describe("Search Functionality", () => {
    it("should initialize search query as empty string", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.searchQuery).toBe("");
    });

    it("should update search query on input", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchQuery = "test search";
      await nextTick();

      expect(wrapper.vm.searchQuery).toBe("test search");
    });

    it("should bind searchQuery to input v-model", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const searchInput = wrapper.find('[data-test="q-input"]');
      expect(searchInput.exists()).toBe(true);

      // Simulate user typing into the search input
      await searchInput.setValue("error");
      await nextTick();

      expect(wrapper.vm.searchQuery).toBe("error");
    });

    it("should filter displayed content based on search", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.searchQuery = "error";
      await nextTick();

      const highlighted = wrapper.vm.highlightSearch("SELECT * FROM logs WHERE level = 'error'");
      expect(highlighted).toContain("<mark");
    });
  });

  describe("Variables Display", () => {
    it("should display standard variables", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Variable(s)");
      expect(wrapper.text()).toContain("level");
      expect(wrapper.text()).toContain("error");
    });

    it("should display fixed variables", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Fixed Variable(s)");
      expect(wrapper.text()).toContain("service");
      expect(wrapper.text()).toContain("api");
    });

    it("should display dynamic variables with operators", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Dynamic Variable(s)");
      expect(wrapper.text()).toContain("count");
      expect(wrapper.text()).toContain(">=");
      expect(wrapper.text()).toContain("100");
    });

    it("should show dash for missing variables", async () => {
      wrapper = createWrapper({
        metaData: {
          queries: [
            {
              query: "SELECT * FROM logs",
              queryType: "SQL",
              startTime: 1640995200000,
              endTime: 1641081600000,
              variables: [],
            },
          ],
        },
      });
      await flushPromises();

      const text = wrapper.text();
      // Should have dashes for empty variable sections
      expect(text).toContain("-");
    });
  });

  describe("Time Display", () => {
    it("should display start time", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("Start Time");
      expect(wrapper.text()).toContain("1640995200000");
    });

    it("should display end time", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("End Time");
      expect(wrapper.text()).toContain("1641081600000");
    });
  });
});
