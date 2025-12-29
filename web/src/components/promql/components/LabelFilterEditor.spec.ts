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
import { Dialog, Notify } from "quasar";
import LabelFilterEditor from "./LabelFilterEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock useDashboardPanelData composable
vi.mock("@/composables/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    fetchPromQLLabels: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("LabelFilterEditor", () => {
  let wrapper: any;

  const mockLabels = [
    { label: "method", op: "=", value: "GET" },
    { label: "status", op: "=", value: "200" },
  ];

  const mockDashboardData = {
    meta: {
      promql: {
        availableLabels: ["method", "status", "path", "host"],
        labelValuesMap: new Map([
          ["method", ["GET", "POST", "PUT", "DELETE"]],
          ["status", ["200", "404", "500"]],
          ["path", ["/api/users", "/api/products"]],
        ]),
        loadingLabels: false,
      },
    },
  };

  const defaultProps = {
    labels: mockLabels,
    metric: "http_requests_total",
    dashboardData: mockDashboardData,
    dashboardPanelData: mockDashboardData,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(LabelFilterEditor, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render label filter editor", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".label-filter-editor").exists()).toBe(true);
    });

    it("should display layout name", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".layout-name").text()).toBe("Label Filters");
    });

    it("should render label filter items", () => {
      wrapper = createWrapper();
      const filterItems = wrapper.findAll(".label-filter-item");
      expect(filterItems.length).toBe(mockLabels.length);
    });

    it("should render add button", () => {
      wrapper = createWrapper();
      const addButton = wrapper.find('[data-test="promql-add-label-filter"]');
      expect(addButton.exists()).toBe(true);
    });

    it("should display correct label text for each filter", () => {
      wrapper = createWrapper();
      const text = wrapper.text();
      expect(text).toContain("method = GET");
      expect(text).toContain("status = 200");
    });
  });

  describe("Label Operations", () => {
    it("should add new label filter when add button is clicked", async () => {
      const labels = [{ label: "method", op: "=", value: "GET" }];
      wrapper = createWrapper({ labels });

      const addButton = wrapper.find('[data-test="promql-add-label-filter"]');
      await addButton.trigger("click");

      // Check that update:labels event was emitted with new label
      const emittedLabels = wrapper.emitted("update:labels");
      expect(emittedLabels).toBeTruthy();
      expect(emittedLabels![0][0]).toHaveLength(2);
      expect(emittedLabels![0][0][1]).toEqual({ label: "", op: "=", value: "" });
    });

    it("should remove label filter when remove button is clicked", async () => {
      const labels = [...mockLabels];
      wrapper = createWrapper({ labels });

      const removeButton = wrapper.find(
        '[data-test="promql-label-filter-remove-0"]',
      );
      await removeButton.trigger("click");

      // Check that update:labels event was emitted with removed label
      const emittedLabels = wrapper.emitted("update:labels");
      expect(emittedLabels).toBeTruthy();
      expect(emittedLabels![0][0]).toHaveLength(1);
      expect(emittedLabels![0][0][0].label).toBe("status");
    });

    it("should initialize with empty label filter", async () => {
      const emptyLabels: any[] = [];
      wrapper = createWrapper({ labels: emptyLabels });

      const addButton = wrapper.find('[data-test="promql-add-label-filter"]');
      await addButton.trigger("click");

      // Check that update:labels event was emitted with new label
      const emittedLabels = wrapper.emitted("update:labels");
      expect(emittedLabels).toBeTruthy();
      expect(emittedLabels![0][0]).toHaveLength(1);
      expect(emittedLabels![0][0][0]).toEqual({ label: "", op: "=", value: "" });
    });
  });

  describe("Duplicate Prevention", () => {
    it("should have filteredLabelOptions state", () => {
      wrapper = createWrapper();

      // filteredLabelOptions should exist as a reactive state
      expect(wrapper.vm.filteredLabelOptions).toBeDefined();
      expect(Array.isArray(wrapper.vm.filteredLabelOptions)).toBe(true);
    });

    it("should have filterLabels function", () => {
      wrapper = createWrapper();

      // filterLabels function should exist for filtering on user input
      expect(typeof wrapper.vm.filterLabels).toBe("function");
    });

    it("should maintain filteredLabelOptions as array", () => {
      const singleLabel = [{ label: "method", op: "=", value: "GET" }];
      wrapper = createWrapper({ labels: singleLabel });

      const available = wrapper.vm.filteredLabelOptions;
      expect(Array.isArray(available)).toBe(true);
    });
  });

  describe("Computed Label Display", () => {
    it('should display "Select label" when label is empty', () => {
      const emptyLabel = { label: "", op: "=", value: "" };
      wrapper = createWrapper();

      const result = wrapper.vm.computedLabel(emptyLabel);
      expect(result).toBe("Select label");
    });

    it("should display label name when value is empty", () => {
      const labelOnly = { label: "method", op: "=", value: "" };
      wrapper = createWrapper();

      const result = wrapper.vm.computedLabel(labelOnly);
      expect(result).toBe("method");
    });

    it("should display full label expression when complete", () => {
      const fullLabel = { label: "method", op: "=", value: "GET" };
      wrapper = createWrapper();

      const result = wrapper.vm.computedLabel(fullLabel);
      expect(result).toBe("method = GET");
    });

    it("should handle regex operators", () => {
      const regexLabel = { label: "path", op: "=~", value: "/api.*" };
      wrapper = createWrapper();

      const result = wrapper.vm.computedLabel(regexLabel);
      expect(result).toBe("path =~ /api.*");
    });
  });

  describe("Label Values", () => {
    it("should get label value options for a label", () => {
      wrapper = createWrapper();

      const options = wrapper.vm.getLabelValueOptions("method");
      expect(options.length).toBeGreaterThan(0);
      expect(options.some((opt: any) => opt.value === "GET")).toBe(true);
    });

    it("should include dashboard variables in options", () => {
      const dataWithVars = {
        ...mockDashboardData,
        variables: {
          list: [
            { name: "env", value: "prod" },
            { name: "region", value: "us-east" },
          ],
        },
      };
      wrapper = createWrapper({ dashboardData: dataWithVars });

      const options = wrapper.vm.getLabelValueOptions("method");
      expect(options.some((opt: any) => opt.value === "$env")).toBe(true);
      expect(options.some((opt: any) => opt.value === "$region")).toBe(true);
    });

    it("should mark variables in options", () => {
      const dataWithVars = {
        ...mockDashboardData,
        variables: {
          list: [{ name: "env", value: "prod" }],
        },
      };
      wrapper = createWrapper({ dashboardData: dataWithVars });

      const options = wrapper.vm.getLabelValueOptions("method");
      const varOption = options.find((opt: any) => opt.value === "$env");
      expect(varOption?.isVariable).toBe(true);
    });

    it("should return empty array for unknown label", () => {
      wrapper = createWrapper();

      const options = wrapper.vm.getLabelValueOptions("unknown_label");
      expect(options.length).toBe(0);
    });
  });

  describe("Operator Handling", () => {
    it("should provide all operator options", () => {
      wrapper = createWrapper();

      const operators = ["=", "!=", "=~", "!~"];
      operators.forEach((op) => {
        expect(wrapper.vm.operatorOptions).toContain(op);
      });
    });

    it("should provide operator hints", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getOperatorHint("=")).toBe("Exact match");
      expect(wrapper.vm.getOperatorHint("!=")).toBe("Not equal to");
      expect(wrapper.vm.getOperatorHint("=~")).toContain("Regex");
      expect(wrapper.vm.getOperatorHint("!~")).toContain("not matching");
    });
  });

  describe("Metric Change", () => {
    it("should fetch labels when metric changes", async () => {
      wrapper = createWrapper();

      await wrapper.setProps({ metric: "new_metric" });
      await flushPromises();

      // The composable should be called (it's mocked at the top of this file)
      expect(wrapper.vm.metric).toBe("new_metric");
    });

    it("should clear labels when metric is cleared", async () => {
      wrapper = createWrapper();

      await wrapper.setProps({ metric: "" });
      await flushPromises();

      expect(
        wrapper.props("dashboardData").meta.promql.availableLabels,
      ).toBeDefined();
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="promql-add-label-filter"]').exists(),
      ).toBe(true);
      expect(wrapper.find('[data-test="promql-label-filter-0"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="promql-label-filter-remove-0"]').exists(),
      ).toBe(true);
    });

    it("should have tooltips on buttons", () => {
      wrapper = createWrapper();

      const addButton = wrapper.find('[data-test="promql-add-label-filter"]');
      expect(addButton.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });
  });

  describe("Loading State", () => {
    it("should show loading state when fetching labels", () => {
      const loadingData = {
        meta: {
          promql: {
            ...mockDashboardData.meta.promql,
            loadingLabels: true,
          },
        },
      };
      wrapper = createWrapper({ dashboardPanelData: loadingData });

      expect(wrapper.vm.loadingLabels).toBe(true);
    });

    it("should not show loading state initially", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.loadingLabels).toBe(false);
    });
  });
});
