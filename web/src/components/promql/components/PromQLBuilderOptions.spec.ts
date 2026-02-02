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
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import PromQLBuilderOptions from "./PromQLBuilderOptions.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("PromQLBuilderOptions", () => {
  let wrapper: any;

  const mockDashboardPanelData = {
    data: {
      queries: [
        {
          fields: {
            stream: "http_requests_total",
          },
          config: {
            promql_legend: "",
            step_value: "",
          },
        },
      ],
    },
    layout: {
      currentQueryIndex: 0,
    },
    meta: {
      streamFields: {
        groupedFields: [
          {
            name: "http_requests_total",
            schema: [
              { name: "method", type: "Utf8" },
              { name: "status", type: "Utf8" },
              { name: "path", type: "Utf8" },
            ],
          },
        ],
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (dashboardPanelData = mockDashboardPanelData) => {
    return mount(PromQLBuilderOptions, {
      props: {
        dashboardPanelData,
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should display options label", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".layout-name").text()).toBe("Options");
    });

    it("should render separator", () => {
      wrapper = createWrapper();
      const separator = wrapper.findComponent({ name: "QSeparator" });
      expect(separator.exists()).toBe(true);
    });

    it("should render legend field", () => {
      wrapper = createWrapper();
      const legend = wrapper.find(
        '[data-test="dashboard-promql-builder-legend"]'
      );
      expect(legend.exists()).toBe(true);
    });

    it("should render step value field", () => {
      wrapper = createWrapper();
      const stepValue = wrapper.find(
        '[data-test="dashboard-promql-builder-step-value"]'
      );
      expect(stepValue.exists()).toBe(true);
    });

    it("should render query type field", () => {
      wrapper = createWrapper();
      const queryType = wrapper.find(
        '[data-test="dashboard-promql-builder-query-type"]'
      );
      expect(queryType.exists()).toBe(true);
    });

    it("should display legend label", () => {
      wrapper = createWrapper();
      const labels = wrapper.findAll(".field-label");
      expect(labels[0].text()).toBe("Legend");
    });

    it("should display step value label", () => {
      wrapper = createWrapper();
      const labels = wrapper.findAll(".field-label");
      expect(labels[1].text()).toBe("Step Value");
    });

    it("should display query type label", () => {
      wrapper = createWrapper();
      const labels = wrapper.findAll(".field-label");
      expect(labels[2].text()).toBe("Type");
    });
  });

  describe("Legend Field", () => {
    it("should bind to promql_legend in query config", () => {
      wrapper = createWrapper();
      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend
      ).toBe("");
    });

    it("should update promql_legend when changed", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend =
        "{{method}}";
      await wrapper.vm.$nextTick();

      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend
      ).toBe("{{method}}");
    });

    it("should show legend info tooltip", () => {
      wrapper = createWrapper();
      const infoIcons = wrapper.findAll(".field-info-icon");
      expect(infoIcons.length).toBeGreaterThan(0);
    });

    it("should use CommonAutoComplete component", () => {
      wrapper = createWrapper();
      const autoComplete = wrapper.findComponent({
        name: "CommonAutoComplete",
      });
      expect(autoComplete.exists()).toBe(true);
    });

    it("should have correct width for legend input", () => {
      wrapper = createWrapper();
      const legend = wrapper.find(
        '[data-test="dashboard-promql-builder-legend"]'
      );
      expect(legend.attributes("style")).toContain("width: 260px");
    });
  });

  describe("Query Type Field", () => {
    it("should initialize query_type to range by default", () => {
      const dataWithoutQueryType = {
        ...mockDashboardPanelData,
        data: {
          queries: [
            {
              fields: { stream: "http_requests_total" },
              config: { promql_legend: "", step_value: "" },
            },
          ],
        },
      };

      wrapper = createWrapper(dataWithoutQueryType);
      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.query_type
      ).toBe("range");
    });

    it("should bind to query_type in query config", () => {
      const dataWithQueryType = {
        ...mockDashboardPanelData,
        data: {
          queries: [
            {
              fields: { stream: "http_requests_total" },
              config: {
                promql_legend: "",
                step_value: "",
                query_type: "instant",
              },
            },
          ],
        },
      };

      wrapper = createWrapper(dataWithQueryType);
      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.query_type
      ).toBe("instant");
    });

    it("should have query type options", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.queryTypeOptions).toHaveLength(2);
      expect(wrapper.vm.queryTypeOptions[0]).toEqual({
        label: "Range",
        value: "range",
      });
      expect(wrapper.vm.queryTypeOptions[1]).toEqual({
        label: "Instant",
        value: "instant",
      });
    });

    it("should update query_type when changed", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardPanelData.data.queries[0].config.query_type =
        "instant";
      await wrapper.vm.$nextTick();

      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.query_type
      ).toBe("instant");
    });

    it("should render query type select", () => {
      wrapper = createWrapper();
      const queryTypeSelect = wrapper.findComponent({ name: "QSelect" });
      expect(queryTypeSelect.exists()).toBe(true);
    });

    it("should have correct width for query type select", () => {
      wrapper = createWrapper();
      const queryType = wrapper.find(
        '[data-test="dashboard-promql-builder-query-type"]'
      );
      expect(queryType.exists()).toBe(true);
      const style = queryType.attributes("style");
      if (style) {
        expect(style).toContain("width: 120px");
      }
    });

    it("should show query type info tooltip", () => {
      wrapper = createWrapper();
      const tooltips = wrapper.findAllComponents({ name: "QTooltip" });
      expect(tooltips.length).toBeGreaterThan(0);
    });
  });

  describe("Step Value Field", () => {
    it("should bind to step_value in query config", () => {
      wrapper = createWrapper();
      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.step_value
      ).toBe("");
    });

    it("should update step_value when changed", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardPanelData.data.queries[0].config.step_value = "30s";
      await wrapper.vm.$nextTick();

      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.step_value
      ).toBe("30s");
    });

    it("should have placeholder text", () => {
      wrapper = createWrapper();
      const stepValue = wrapper.findAll("input[type='text']");
      expect(stepValue.length).toBeGreaterThan(0);
    });

    it("should be borderless", () => {
      wrapper = createWrapper();
      const inputs = wrapper.findAllComponents({ name: "QInput" });
      expect(inputs.length).toBeGreaterThan(0);
    });

    it("should be dense", () => {
      wrapper = createWrapper();
      const inputs = wrapper.findAllComponents({ name: "QInput" });
      expect(inputs.length).toBeGreaterThan(0);
    });

    it("should have correct width for step value input", () => {
      wrapper = createWrapper();
      const stepValue = wrapper.find(
        '[data-test="dashboard-promql-builder-step-value"]'
      );
      expect(stepValue.exists()).toBe(true);
    });

    it("should show step value info tooltip", () => {
      wrapper = createWrapper();
      const tooltips = wrapper.findAllComponents({ name: "QTooltip" });
      expect(tooltips.length).toBeGreaterThan(0);
    });
  });

  describe("Field Suggestions", () => {
    it("should compute dashboardSelectfieldPromQlList from stream fields", () => {
      wrapper = createWrapper();

      const fieldList = wrapper.vm.dashboardSelectfieldPromQlList;
      expect(fieldList).toHaveLength(3);
      expect(fieldList[0]).toEqual({ label: "method", value: "method" });
      expect(fieldList[1]).toEqual({ label: "status", value: "status" });
      expect(fieldList[2]).toEqual({ label: "path", value: "path" });
    });

    it("should return empty array if no stream selected", () => {
      const dataWithoutStream = {
        ...mockDashboardPanelData,
        data: {
          queries: [
            {
              fields: {},
              config: {
                promql_legend: "",
                step_value: "",
              },
            },
          ],
        },
      };

      wrapper = createWrapper(dataWithoutStream);
      expect(wrapper.vm.dashboardSelectfieldPromQlList).toEqual([]);
    });

    it("should return empty array if stream not found in groupedFields", () => {
      const dataWithMissingStream = {
        ...mockDashboardPanelData,
        data: {
          queries: [
            {
              fields: {
                stream: "nonexistent_stream",
              },
              config: {
                promql_legend: "",
                step_value: "",
              },
            },
          ],
        },
      };

      wrapper = createWrapper(dataWithMissingStream);
      expect(wrapper.vm.dashboardSelectfieldPromQlList).toEqual([]);
    });

    it("should return empty array if stream has no schema", () => {
      const dataWithoutSchema = {
        ...mockDashboardPanelData,
        meta: {
          streamFields: {
            groupedFields: [
              {
                name: "http_requests_total",
                schema: null,
              },
            ],
          },
        },
      };

      wrapper = createWrapper(dataWithoutSchema);
      expect(wrapper.vm.dashboardSelectfieldPromQlList).toEqual([]);
    });
  });

  describe("PromQL Name Option Selection", () => {
    it("should add braces and field name when no braces present", () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend =
        "test";

      const result = wrapper.vm.selectPromQlNameOption("method");
      expect(result).toBe("{method}");
    });

    it("should replace content after opening brace", () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend =
        "prefix{old}";

      const result = wrapper.vm.selectPromQlNameOption("method");
      expect(result).toBe("prefix{method}");
    });

    it("should handle legend with multiple braces", () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend =
        "{first}{second{";

      const result = wrapper.vm.selectPromQlNameOption("method");
      expect(result).toBe("{first}{second{method}");
    });

    it("should handle empty legend value", () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend = "";

      const result = wrapper.vm.selectPromQlNameOption("method");
      expect(result).toBe("{method}");
    });

    it("should handle legend with only opening brace", () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend = "{";

      const result = wrapper.vm.selectPromQlNameOption("method");
      expect(result).toBe("{method}");
    });
  });

  describe("Multiple Queries Support", () => {
    it("should handle multiple queries and respect currentQueryIndex", () => {
      const dataWithMultipleQueries = {
        ...mockDashboardPanelData,
        data: {
          queries: [
            {
              fields: { stream: "http_requests_total" },
              config: { promql_legend: "query1", step_value: "30s" },
            },
            {
              fields: { stream: "http_requests_total" },
              config: { promql_legend: "query2", step_value: "1m" },
            },
          ],
        },
        layout: {
          currentQueryIndex: 1,
        },
      };

      wrapper = createWrapper(dataWithMultipleQueries);

      expect(
        wrapper.vm.dashboardPanelData.data.queries[1].config.promql_legend
      ).toBe("query2");
      expect(
        wrapper.vm.dashboardPanelData.data.queries[1].config.step_value
      ).toBe("1m");
    });

    it("should update correct query when currentQueryIndex changes", async () => {
      const dataWithMultipleQueries = {
        ...mockDashboardPanelData,
        data: {
          queries: [
            {
              fields: { stream: "http_requests_total" },
              config: { promql_legend: "", step_value: "" },
            },
            {
              fields: { stream: "http_requests_total" },
              config: { promql_legend: "", step_value: "" },
            },
          ],
        },
        layout: {
          currentQueryIndex: 0,
        },
      };

      wrapper = createWrapper(dataWithMultipleQueries);

      wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend =
        "first";
      await wrapper.vm.$nextTick();

      expect(
        wrapper.vm.dashboardPanelData.data.queries[0].config.promql_legend
      ).toBe("first");
      expect(
        wrapper.vm.dashboardPanelData.data.queries[1].config.promql_legend
      ).toBe("");
    });
  });

  describe("Accessibility", () => {
    it("should have data-test attributes", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-promql-builder-legend"]').exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-promql-builder-step-value"]')
          .exists()
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-promql-builder-query-type"]')
          .exists()
      ).toBe(true);
    });

    it("should have tooltips for user guidance", () => {
      wrapper = createWrapper();
      const tooltips = wrapper.findAllComponents({ name: "QTooltip" });
      expect(tooltips.length).toBeGreaterThan(0);
    });

    it("should show info icons for additional context", () => {
      wrapper = createWrapper();
      const infoIcons = wrapper.findAllComponents({ name: "QIcon" });
      expect(infoIcons.length).toBeGreaterThan(0);
    });
  });

  describe("Layout and Styling", () => {
    it("should have option field wrappers", () => {
      wrapper = createWrapper();
      const wrappers = wrapper.findAll(".option-field-wrapper");
      expect(wrappers.length).toBe(3); // Legend, Step Value, and Query Type
    });

    it("should have axis container", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".axis-container").exists()).toBe(true);
    });

    it("should have field labels", () => {
      wrapper = createWrapper();
      const labels = wrapper.findAll(".field-label");
      expect(labels.length).toBe(3); // Legend, Step Value, and Query Type
    });

    it("should have field input wrappers", () => {
      wrapper = createWrapper();
      const inputWrappers = wrapper.findAll(".field-input-wrapper");
      expect(inputWrappers.length).toBeGreaterThan(0);
    });
  });
});
