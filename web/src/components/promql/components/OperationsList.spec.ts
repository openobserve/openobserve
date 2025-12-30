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
import OperationsList from "./OperationsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { PromOperationId } from "@/components/promql/types";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("OperationsList", () => {
  let wrapper: any;

  const mockOperations = [
    { id: PromOperationId.Rate, params: ["5m"] },
    { id: PromOperationId.Sum, params: [["method", "status"]] },
  ];

  const mockDashboardData = {
    meta: {
      promql: {
        availableLabels: ["method", "status", "path", "host"],
        labelValuesMap: new Map([
          ["method", ["GET", "POST"]],
          ["status", ["200", "404"]],
        ]),
        loadingLabels: false,
      },
    },
  };

  const defaultProps = {
    operations: mockOperations,
    dashboardData: mockDashboardData,
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
    return mount(OperationsList, {
      props: {
        ...defaultProps,
        ...props,
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
    it("should render operations list container", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".tw\\:py-\\[0\\.25rem\\]").exists()).toBe(true);
    });

    it("should display layout name", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".layout-name").text()).toBe("Operations");
    });

    it("should render operation items", () => {
      wrapper = createWrapper();
      const operations = wrapper.findAll(".operation-item");
      expect(operations.length).toBe(mockOperations.length);
    });

    it("should render add operation button", () => {
      wrapper = createWrapper();
      const addButton = wrapper.find('[data-test="promql-add-operation"]');
      expect(addButton.exists()).toBe(true);
    });

    it("should render drag handles for operations", () => {
      wrapper = createWrapper();
      const dragHandles = wrapper.findAll(".drag-handle");
      expect(dragHandles.length).toBe(mockOperations.length);
    });
  });

  describe("Operation Display", () => {
    it("should display operation names correctly", () => {
      wrapper = createWrapper();
      const text = wrapper.text();
      expect(text).toContain("Rate");
      expect(text).toContain("Sum");
    });

    it("should display operation with parameters", () => {
      wrapper = createWrapper();

      const label = wrapper.vm.computedLabel(mockOperations[0]);
      expect(label).toContain("Rate");
      expect(label).toContain("5m");
    });

    it("should display operation with array parameters", () => {
      wrapper = createWrapper();

      const label = wrapper.vm.computedLabel(mockOperations[1]);
      expect(label).toContain("Sum");
      expect(label).toContain("method");
      expect(label).toContain("status");
    });

    it("should display operation name only when no params", () => {
      const opsWithNoParams = [{ id: PromOperationId.Abs, params: [] }];
      wrapper = createWrapper({ operations: opsWithNoParams });

      const label = wrapper.vm.computedLabel(opsWithNoParams[0]);
      expect(label).toBe("Abs");
    });
  });

  describe("Operation Management", () => {
    it("should add new operation when add button clicked", async () => {
      const operations: any[] = [];
      wrapper = createWrapper({ operations });

      const addButton = wrapper.find('[data-test="promql-add-operation"]');
      await addButton.trigger("click");

      expect(wrapper.vm.showOperationSelector).toBe(true);
    });

    it("should remove operation when remove button clicked", async () => {
      const operations = [...mockOperations];
      wrapper = createWrapper({ operations });

      const removeButton = wrapper.find(
        '[data-test="promql-operation-remove-0"]',
      );
      await removeButton.trigger("click");

      // Check that update:operations event was emitted with removed operation
      const emitted = wrapper.emitted("update:operations");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toHaveLength(1);
      expect(emitted![0][0][0].id).toBe(PromOperationId.Sum);
    });

    it("should add operation with default params", () => {
      const operations: any[] = [];
      wrapper = createWrapper({ operations });

      const opDef = {
        id: PromOperationId.Rate,
        name: "Rate",
        params: [{ name: "Range", type: "string" as const }],
        defaultParams: ["5m"],
        category: "Range Functions",
      };

      wrapper.vm.addOperation(opDef);

      // Check that update:operations event was emitted with new operation
      const emitted = wrapper.emitted("update:operations");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toHaveLength(1);
      expect(emitted![0][0][0].id).toBe(PromOperationId.Rate);
      expect(emitted![0][0][0].params).toEqual(["5m"]);
    });
  });

  describe("Drag and Drop", () => {
    it("should handle drag update", () => {
      const operations = [...mockOperations];
      wrapper = createWrapper({ operations });

      const reordered = [mockOperations[1], mockOperations[0]];
      wrapper.vm.handleDragUpdate(reordered);

      // Check that update:operations event was emitted with reordered operations
      const emitted = wrapper.emitted("update:operations");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0][0].id).toBe(PromOperationId.Sum);
      expect(emitted![0][0][1].id).toBe(PromOperationId.Rate);
    });

    it("should emit update event on drag", () => {
      const operations = [...mockOperations];
      wrapper = createWrapper({ operations });

      const reordered = [mockOperations[1], mockOperations[0]];
      wrapper.vm.handleDragUpdate(reordered);

      expect(wrapper.emitted("update:operations")).toBeTruthy();
    });

    it("should have unique keys for draggable items", () => {
      wrapper = createWrapper();

      const key1 = wrapper.vm.getItemKey(mockOperations[0], 0);
      const key2 = wrapper.vm.getItemKey(mockOperations[1], 1);

      expect(key1).not.toBe(key2);
      expect(key1).toContain("0");
      expect(key2).toContain("1");
    });
  });

  describe("Operation Selector Dialog", () => {
    it("should show operation selector dialog", async () => {
      wrapper = createWrapper();

      const addButton = wrapper.find('[data-test="promql-add-operation"]');
      await addButton.trigger("click");

      expect(wrapper.vm.showOperationSelector).toBe(true);
    });

    it("should close dialog after adding operation", () => {
      const operations: any[] = [];
      wrapper = createWrapper({ operations });

      wrapper.vm.showOperationSelector = true;

      const opDef = {
        id: PromOperationId.Rate,
        name: "Rate",
        params: [],
        defaultParams: ["5m"],
        category: "Range Functions",
      };

      wrapper.vm.addOperation(opDef);

      expect(wrapper.vm.showOperationSelector).toBe(false);
    });

    it("should clear search query after adding operation", () => {
      const operations: any[] = [];
      wrapper = createWrapper({ operations });

      wrapper.vm.searchQuery = "rate";

      const opDef = {
        id: PromOperationId.Rate,
        name: "Rate",
        params: [],
        defaultParams: ["5m"],
        category: "Range Functions",
      };

      wrapper.vm.addOperation(opDef);

      expect(wrapper.vm.searchQuery).toBe("");
    });

    it("should filter operations by search query", () => {
      wrapper = createWrapper();

      wrapper.vm.searchQuery = "rate";

      const filtered = wrapper.vm.getFilteredOperationsForCategory(
        "Range Functions",
      );
      expect(filtered.some((op: any) => op.id === PromOperationId.Rate)).toBe(
        true,
      );
    });

    it("should show all operations when search is empty", () => {
      wrapper = createWrapper();

      wrapper.vm.searchQuery = "";

      const filtered = wrapper.vm.getFilteredOperationsForCategory(
        "Range Functions",
      );
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe("Operation Parameters", () => {
    it("should handle number parameter type", () => {
      const ops = [{ id: PromOperationId.TopK, params: [10, []] }];
      wrapper = createWrapper({ operations: ops });

      const opDef = wrapper.vm.getOperationDef(PromOperationId.TopK);
      expect(opDef?.params[0].type).toBe("number");
    });

    it("should handle string parameter type", () => {
      const ops = [{ id: PromOperationId.Rate, params: ["5m"] }];
      wrapper = createWrapper({ operations: ops });

      const opDef = wrapper.vm.getOperationDef(PromOperationId.Rate);
      expect(opDef?.params[0].type).toBe("string");
    });

    it("should handle select parameter type with multi-select", () => {
      const ops = [{ id: PromOperationId.Sum, params: [["method"]] }];
      wrapper = createWrapper({ operations: ops });

      const opDef = wrapper.vm.getOperationDef(PromOperationId.Sum);
      expect(opDef?.params[0].type).toBe("select");
    });

    it("should display parameter hints for select type", () => {
      wrapper = createWrapper();

      const text = wrapper.html();
      // Should show hint when labels are available
      expect(wrapper.vm.availableLabels.length).toBeGreaterThan(0);
    });
  });

  describe("Categories", () => {
    it("should get all operation categories", () => {
      wrapper = createWrapper();

      const categories = wrapper.vm.categories;
      expect(categories).toContain("Range Functions");
      expect(categories).toContain("Aggregations");
      expect(categories).toContain("Functions");
    });

    it("should get operations for specific category", () => {
      wrapper = createWrapper();

      const rangeOps = wrapper.vm.getFilteredOperationsForCategory(
        "Range Functions",
      );
      expect(rangeOps.length).toBeGreaterThan(0);
    });
  });

  describe("Label Integration", () => {
    it("should access available labels from dashboard data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.availableLabels).toEqual([
        "method",
        "status",
        "path",
        "host",
      ]);
    });

    it("should handle empty available labels", () => {
      const dataWithoutLabels = {
        meta: {
          promql: {
            availableLabels: [],
            labelValuesMap: new Map(),
            loadingLabels: false,
          },
        },
      };
      wrapper = createWrapper({ dashboardData: dataWithoutLabels });

      expect(wrapper.vm.availableLabels).toEqual([]);
    });

    it("should expose available labels for parent access", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.availableLabels).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle operation with empty params", () => {
      const ops = [{ id: PromOperationId.Abs, params: [] }];
      wrapper = createWrapper({ operations: ops });

      const label = wrapper.vm.computedLabel(ops[0]);
      expect(label).toBe("Abs");
    });

    it("should handle operation with null params", () => {
      const ops = [{ id: PromOperationId.Abs, params: [null] }];
      wrapper = createWrapper({ operations: ops });

      const label = wrapper.vm.computedLabel(ops[0]);
      expect(label).toBe("Abs");
    });

    it("should handle operation with undefined params", () => {
      const ops = [{ id: PromOperationId.Abs, params: [undefined] }];
      wrapper = createWrapper({ operations: ops });

      const label = wrapper.vm.computedLabel(ops[0]);
      expect(label).toBe("Abs");
    });

    it("should handle unknown operation id", () => {
      const ops = [{ id: "unknown_op", params: [] }];
      wrapper = createWrapper({ operations: ops });

      const label = wrapper.vm.computedLabel(ops[0]);
      expect(label).toBe("unknown_op");
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="promql-add-operation"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="promql-operation-0"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="promql-operation-remove-0"]').exists(),
      ).toBe(true);
    });

    it("should have tooltips", () => {
      wrapper = createWrapper();

      const addButton = wrapper.find('[data-test="promql-add-operation"]');
      expect(addButton.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });

    it("should have drag handle tooltips", () => {
      wrapper = createWrapper();

      const dragHandle = wrapper.find(".drag-handle");
      expect(dragHandle.findComponent({ name: "QTooltip" }).exists()).toBe(
        true,
      );
    });
  });
});
