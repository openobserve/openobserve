// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import QueryBuilder from "./QueryBuilder.vue";

installQuasar({ plugins: [Notify] });

// Mock the child components
vi.mock("@/components/promql/components/MetricSelector.vue", () => ({
  default: {
    name: "MetricSelector",
    template: '<div class="metric-selector-mock">MetricSelector</div>',
    props: ["metric", "datasource"],
    emits: ["update:metric"],
  },
}));

vi.mock("@/components/promql/components/LabelFilterEditor.vue", () => ({
  default: {
    name: "LabelFilterEditor",
    template: '<div class="label-filter-mock">LabelFilterEditor</div>',
    props: ["labels", "metric"],
    emits: ["update:labels"],
  },
}));

vi.mock("@/components/promql/components/OperationsList.vue", () => ({
  default: {
    name: "OperationsList",
    template: '<div class="operations-list-mock">OperationsList</div>',
    props: ["operations"],
    emits: ["update:operations"],
  },
}));

// Mock the query modeller
vi.mock("@/components/promql/operations/queryModeller", () => ({
  promQueryModeller: {
    renderQuery: vi.fn((query) => {
      if (!query.metric) return "";
      let result = query.metric;
      if (query.labels && query.labels.length > 0) {
        result += `{${query.labels.map((l: any) => `${l.key}="${l.value}"`).join(",")}}`;
      }
      if (query.operations && query.operations.length > 0) {
        query.operations.forEach((op: any) => {
          result = `${op.type}(${result})`;
        });
      }
      return result;
    }),
  },
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("QueryBuilder", () => {
  let wrapper: any;

  const createWrapper = () => {
    return mount(QueryBuilder, {
      global: {
        stubs: {
          QCard: false,
          QCardSection: false,
          QSeparator: false,
          QBtn: false,
          MetricSelector: true,
          LabelFilterEditor: true,
          OperationsList: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".promql-query-builder").exists()).toBe(true);
    });

    it("should display the title and subtitle", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("PromQL Query Builder");
      expect(wrapper.text()).toContain("Build and test PromQL queries visually");
    });

    it("should render all child components", () => {
      wrapper = createWrapper();
      // Child components are stubbed, so check if they exist by component name
      expect(wrapper.findComponent({ name: "MetricSelector" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "LabelFilterEditor" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OperationsList" }).exists()).toBe(true);
    });

    it("should render action buttons", () => {
      wrapper = createWrapper();
      const buttons = wrapper.findAll("button");
      expect(buttons.length).toBeGreaterThanOrEqual(3);
      expect(wrapper.text()).toContain("Copy Query");
      expect(wrapper.text()).toContain("Clear All");
      expect(wrapper.text()).toContain("Test Query");
    });

    it("should show placeholder text when no query is built", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("No query built yet");
    });
  });

  describe("Query Generation", () => {
    it("should generate query from metric only", async () => {
      wrapper = createWrapper();

      // Update the metric
      wrapper.vm.visualQuery.metric = "http_requests_total";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.generatedQuery).toBe("http_requests_total");
      expect(wrapper.text()).toContain("http_requests_total");
    });

    it("should generate query with labels", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "http_requests_total";
      wrapper.vm.visualQuery.labels = [
        { key: "job", value: "api-server" },
        { key: "method", value: "GET" },
      ];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.generatedQuery).toContain('job="api-server"');
      expect(wrapper.vm.generatedQuery).toContain('method="GET"');
    });

    it("should generate query with operations", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "http_requests_total";
      wrapper.vm.visualQuery.operations = [
        { type: "rate" },
        { type: "sum" },
      ];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.generatedQuery).toContain("sum(rate(http_requests_total))");
    });

    it("should return empty string when metric and labels are empty", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "";
      wrapper.vm.visualQuery.labels = [];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.generatedQuery).toBe("");
    });

    it("should update query display when visual query changes", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "cpu_usage";
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("cpu_usage");
    });
  });

  describe("Copy Query Functionality", () => {
    it("should copy query to clipboard", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      await wrapper.vm.copyQuery();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test_metric");
    });

    it("should show notification after copying", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      const notifySpy = vi.spyOn(wrapper.vm.$q, "notify");
      await wrapper.vm.copyQuery();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Query copied to clipboard!",
        })
      );
    });

    it("should disable copy button when no query is generated", () => {
      wrapper = createWrapper();

      const copyButton = wrapper.findAll("button").find((btn: any) =>
        btn.text().includes("Copy Query")
      );

      expect(copyButton?.element.disabled).toBe(true);
    });

    it("should enable copy button when query is generated", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      const copyButton = wrapper.findAll("button").find((btn: any) =>
        btn.text().includes("Copy Query")
      );

      expect(copyButton?.element.disabled).toBe(false);
    });
  });

  describe("Clear Query Functionality", () => {
    it("should clear all query data", async () => {
      wrapper = createWrapper();

      // Set some data
      wrapper.vm.visualQuery.metric = "test_metric";
      wrapper.vm.visualQuery.labels = [{ key: "job", value: "test" }];
      wrapper.vm.visualQuery.operations = [{ type: "rate" }];
      wrapper.vm.queryResult = "some result";
      await wrapper.vm.$nextTick();

      // Clear
      await wrapper.vm.clearQuery();

      expect(wrapper.vm.visualQuery.metric).toBe("");
      expect(wrapper.vm.visualQuery.labels).toEqual([]);
      expect(wrapper.vm.visualQuery.operations).toEqual([]);
      expect(wrapper.vm.queryResult).toBe(null);
    });

    it("should show notification after clearing", async () => {
      wrapper = createWrapper();

      const notifySpy = vi.spyOn(wrapper.vm.$q, "notify");
      await wrapper.vm.clearQuery();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          message: "Query cleared",
        })
      );
    });

    it("should clear button should always be enabled", () => {
      wrapper = createWrapper();

      const clearButton = wrapper.findAll("button").find((btn: any) =>
        btn.text().includes("Clear All")
      );

      expect(clearButton?.element.disabled).toBe(false);
    });
  });

  describe("Test Query Functionality", () => {
    it("should execute test query and show result", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      await wrapper.vm.testQuery();

      expect(wrapper.vm.queryResult).toBeDefined();
      expect(wrapper.vm.queryResult).toContain("success");
    });

    it("should show notification when testing query", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      const notifySpy = vi.spyOn(wrapper.vm.$q, "notify");
      await wrapper.vm.testQuery();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          message: "Query testing will be implemented soon",
        })
      );
    });

    it("should display query result after testing", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      // Initially no result
      expect(wrapper.text()).not.toContain("Query Result Preview");

      await wrapper.vm.testQuery();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("Query Result Preview");
    });

    it("should disable test button when no query is generated", () => {
      wrapper = createWrapper();

      const testButton = wrapper.findAll("button").find((btn: any) =>
        btn.text().includes("Test Query")
      );

      expect(testButton?.element.disabled).toBe(true);
    });

    it("should enable test button when query is generated", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      const testButton = wrapper.findAll("button").find((btn: any) =>
        btn.text().includes("Test Query")
      );

      expect(testButton?.element.disabled).toBe(false);
    });
  });

  describe("Datasource Options", () => {
    it("should have default datasource options", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.datasourceOptions).toEqual({
        type: "prometheus",
        url: "",
      });
    });

    it("should pass datasource options to MetricSelector", () => {
      wrapper = createWrapper();

      const metricSelector = wrapper.findComponent({ name: "MetricSelector" });
      expect(metricSelector.props("datasource")).toEqual({
        type: "prometheus",
        url: "",
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty metric with labels", async () => {
      wrapper = createWrapper();

      wrapper.vm.visualQuery.metric = "";
      wrapper.vm.visualQuery.labels = [{ key: "job", value: "test" }];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.generatedQuery).toBe("");
    });

    it("should handle null query result", () => {
      wrapper = createWrapper();

      wrapper.vm.queryResult = null;

      expect(wrapper.text()).not.toContain("Query Result Preview");
    });

    it("should handle copy when clipboard API fails", async () => {
      wrapper = createWrapper();

      (navigator.clipboard.writeText as any).mockRejectedValueOnce(new Error("Clipboard error"));

      wrapper.vm.visualQuery.metric = "test_metric";
      await wrapper.vm.$nextTick();

      // copyQuery is not async, so just call it - it should not throw
      expect(() => wrapper.vm.copyQuery()).not.toThrow();
    });
  });
});
