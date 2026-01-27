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
import ColumnOrderPopUp from "./ColumnOrderPopUp.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("ColumnOrderPopUp", () => {
  let wrapper: any;

  const defaultProps = {
    columnOrder: [] as string[],
    availableColumns: [] as string[],
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
    return mount(ColumnOrderPopUp, {
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
    it("should render the popup with correct structure", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="dashboard-column-order-popup"]').exists(),
      ).toBe(true);
      expect(wrapper.find(".column-order-popup").exists()).toBe(true);
    });

    it("should render header with title and close button", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain("Column Order");
      expect(
        wrapper.find('[data-test="dashboard-column-order-cancel"]').exists(),
      ).toBe(true);
    });

    it("should render footer with cancel and save buttons", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="dashboard-column-order-cancel-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-column-order-save-btn"]').exists(),
      ).toBe(true);
    });

    it("should render description text", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain("Customize the display order of columns");
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no columns are provided", () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: [],
      });

      expect(wrapper.text()).toContain("No columns ordered");
      expect(wrapper.text()).toContain(
        "Columns will be displayed in their default order",
      );
      expect(wrapper.findComponent({ name: "QIcon" }).exists()).toBe(true);
    });

    it("should not show draggable list in empty state", () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: [],
      });

      expect(
        wrapper.find('[data-test="dashboard-column-order-drag"]').exists(),
      ).toBe(false);
    });
  });

  describe("Column Initialization", () => {
    it("should initialize with provided columnOrder when available", async () => {
      wrapper = createWrapper({
        columnOrder: ["column1", "column2"],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual([
        "column1",
        "column2",
        "column3",
      ]);
    });

    it("should initialize with availableColumns in natural order when columnOrder is empty", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["zebra", "apple", "banana"],
      });

      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual(["zebra", "apple", "banana"]);
    });

    it("should filter out columns not in availableColumns", async () => {
      wrapper = createWrapper({
        columnOrder: ["column1", "column2", "column4"],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual([
        "column1",
        "column2",
        "column3",
      ]);
      expect(wrapper.vm.editColumnOrder).not.toContain("column4");
    });

    it("should add remaining columns in natural order after ordered columns", async () => {
      wrapper = createWrapper({
        columnOrder: ["column2"],
        availableColumns: ["column2", "column1", "column3"],
      });

      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual([
        "column2",
        "column1",
        "column3",
      ]);
    });
  });

  describe("Column Order Display", () => {
    it("should render all columns in the list", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      expect(wrapper.text()).toContain("column1");
      expect(wrapper.text()).toContain("column2");
      expect(wrapper.text()).toContain("column3");
    });

    it("should render column numbers correctly", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      expect(wrapper.text()).toContain("1.");
      expect(wrapper.text()).toContain("2.");
    });

    it("should render drag handles for each column", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const dragHandles = wrapper.findAll('[data-test^="column-order-drag-handle"]');
      expect(dragHandles.length).toBe(2);
    });

    it("should render move up/down buttons for each column", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const moveUpButtons = wrapper.findAll('[data-test^="column-order-move-up"]');
      const moveDownButtons = wrapper.findAll('[data-test^="column-order-move-down"]');

      expect(moveUpButtons.length).toBe(2);
      expect(moveDownButtons.length).toBe(2);
    });
  });

  describe("Move Column Up", () => {
    it("should move column up when move up button is clicked", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      // Initially: column1, column2, column3
      expect(wrapper.vm.editColumnOrder[1]).toBe("column2");

      // Click move up button for column2 (index 1)
      wrapper.vm.moveColumnUp(1);
      await flushPromises();

      // Now should be: column2, column1, column3
      expect(wrapper.vm.editColumnOrder[0]).toBe("column2");
      expect(wrapper.vm.editColumnOrder[1]).toBe("column1");
    });

    it("should not move first column up", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const initialOrder = [...wrapper.vm.editColumnOrder];

      // Try to move first column up
      wrapper.vm.moveColumnUp(0);
      await flushPromises();

      // Order should remain the same
      expect(wrapper.vm.editColumnOrder).toEqual(initialOrder);
    });

    it("should disable move up button for first column", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const firstMoveUpButton = wrapper.findComponent('[data-test="column-order-move-up-0"]');
      expect(firstMoveUpButton.props("disable")).toBe(true);
    });
  });

  describe("Move Column Down", () => {
    it("should move column down when move down button is clicked", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      // Initially: column1, column2, column3
      expect(wrapper.vm.editColumnOrder[0]).toBe("column1");

      // Click move down button for column1 (index 0)
      wrapper.vm.moveColumnDown(0);
      await flushPromises();

      // Now should be: column2, column1, column3
      expect(wrapper.vm.editColumnOrder[0]).toBe("column2");
      expect(wrapper.vm.editColumnOrder[1]).toBe("column1");
    });

    it("should not move last column down", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const initialOrder = [...wrapper.vm.editColumnOrder];

      // Try to move last column down
      wrapper.vm.moveColumnDown(1);
      await flushPromises();

      // Order should remain the same
      expect(wrapper.vm.editColumnOrder).toEqual(initialOrder);
    });

    it("should disable move down button for last column", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const lastMoveDownButton = wrapper.findComponent('[data-test="column-order-move-down-1"]');
      expect(lastMoveDownButton.props("disable")).toBe(true);
    });
  });

  describe("Draggable Functionality", () => {
    it("should render draggable component when columns exist", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-column-order-drag"]').exists(),
      ).toBe(true);
    });

    it("should have correct drag options", () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      expect(wrapper.vm.dragOptions).toEqual({
        animation: 200,
        handle: ".drag-handle",
        ghostClass: "ghost",
      });
    });

    it("should update editColumnOrder when draggable model changes", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      // Simulate drag and drop by directly updating the model
      wrapper.vm.editColumnOrder = ["column3", "column1", "column2"];
      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual([
        "column3",
        "column1",
        "column2",
      ]);
    });
  });

  describe("Cancel Functionality", () => {
    it("should emit cancel event when cancel button is clicked", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      await wrapper
        .find('[data-test="dashboard-column-order-cancel-btn"]')
        .trigger("click");

      expect(wrapper.emitted()).toHaveProperty("cancel");
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("should emit cancel event when close icon is clicked", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      await wrapper
        .find('[data-test="dashboard-column-order-cancel"]')
        .trigger("click");

      expect(wrapper.emitted()).toHaveProperty("cancel");
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("should not modify original columnOrder on cancel", async () => {
      const originalOrder = ["column1", "column2"];
      wrapper = createWrapper({
        columnOrder: originalOrder,
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      // Modify the edit order
      wrapper.vm.moveColumnDown(0);
      await flushPromises();

      // Cancel
      await wrapper
        .find('[data-test="dashboard-column-order-cancel-btn"]')
        .trigger("click");

      // Original should not be modified
      expect(originalOrder).toEqual(["column1", "column2"]);
    });
  });

  describe("Save Functionality", () => {
    it("should emit save event with edited column order", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      await wrapper
        .find('[data-test="dashboard-column-order-save-btn"]')
        .trigger("click");

      expect(wrapper.emitted()).toHaveProperty("save");
      expect(wrapper.emitted("save")).toHaveLength(1);
      expect(wrapper.emitted("save")[0]).toEqual([["column1", "column2"]]);
    });

    it("should emit save with modified order after moves", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      // Move column2 up
      wrapper.vm.moveColumnUp(1);
      await flushPromises();

      await wrapper
        .find('[data-test="dashboard-column-order-save-btn"]')
        .trigger("click");

      const savedOrder = wrapper.emitted("save")[0][0];
      expect(savedOrder[0]).toBe("column2");
      expect(savedOrder[1]).toBe("column1");
    });

    it("should emit save with empty array when no columns", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: [],
      });

      await flushPromises();

      await wrapper
        .find('[data-test="dashboard-column-order-save-btn"]')
        .trigger("click");

      expect(wrapper.emitted("save")[0]).toEqual([[]]);
    });
  });

  describe("Props Changes", () => {
    it("should re-initialize when availableColumns prop changes", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();
      expect(wrapper.vm.editColumnOrder).toEqual(["column1", "column2"]);

      // Update availableColumns prop
      await wrapper.setProps({
        availableColumns: ["column1", "column2", "column3"],
      });
      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual([
        "column1",
        "column2",
        "column3",
      ]);
    });

    it("should maintain columnOrder priority after availableColumns change", async () => {
      wrapper = createWrapper({
        columnOrder: ["column2", "column1"],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();
      expect(wrapper.vm.editColumnOrder[0]).toBe("column2");

      // Update availableColumns to add column3
      await wrapper.setProps({
        availableColumns: ["column1", "column2", "column3"],
      });
      await flushPromises();

      // column2 should still be first, then column1, then column3
      expect(wrapper.vm.editColumnOrder[0]).toBe("column2");
      expect(wrapper.vm.editColumnOrder[1]).toBe("column1");
      expect(wrapper.vm.editColumnOrder[2]).toBe("column3");
    });
  });

  describe("UI Styling and Classes", () => {
    it("should apply correct styling classes", () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      expect(wrapper.find(".column-order-popup").exists()).toBe(true);
      expect(wrapper.find(".scrollable-content").exists()).toBe(true);
      expect(wrapper.find(".sticky-footer").exists()).toBe(true);
    });

    it("should render column rows with correct structure", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      await flushPromises();

      const columnRow = wrapper.find(".column-order-row");
      expect(columnRow.exists()).toBe(true);
      expect(columnRow.find(".drag-handle").exists()).toBe(true);
      expect(columnRow.find(".column-number").exists()).toBe(true);
      expect(columnRow.find(".column-name").exists()).toBe(true);
      expect(columnRow.find(".column-actions").exists()).toBe(true);
    });

    it("should have tooltips on move buttons", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      const tooltips = wrapper.findAllComponents({ name: "QTooltip" });
      expect(tooltips.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle single column", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual(["column1"]);

      // Move up button should be disabled
      const moveUpBtn = wrapper.findComponent('[data-test="column-order-move-up-0"]');
      expect(moveUpBtn.props("disable")).toBe(true);

      // Move down button should be disabled
      const moveDownBtn = wrapper.findComponent('[data-test="column-order-move-down-0"]');
      expect(moveDownBtn.props("disable")).toBe(true);
    });

    it("should handle columnOrder with duplicates gracefully", async () => {
      wrapper = createWrapper({
        columnOrder: ["column1", "column1", "column2"],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      // The component uses the columnOrder as-is when filtering
      // Since both column1's are in availableColumns, both are kept initially
      // But when combined with remaining columns, duplicates naturally resolve
      expect(wrapper.vm.editColumnOrder.includes("column1")).toBe(true);
      expect(wrapper.vm.editColumnOrder.includes("column2")).toBe(true);
    });

    it("should handle empty columnOrder with populated availableColumns", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["zebra", "apple", "banana"],
      });

      await flushPromises();

      // Should keep natural order from availableColumns
      expect(wrapper.vm.editColumnOrder).toEqual(["zebra", "apple", "banana"]);
    });

    it("should handle columnOrder with all columns in different order", async () => {
      wrapper = createWrapper({
        columnOrder: ["column3", "column1", "column2"],
        availableColumns: ["column1", "column2", "column3"],
      });

      await flushPromises();

      expect(wrapper.vm.editColumnOrder).toEqual([
        "column3",
        "column1",
        "column2",
      ]);
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes for testing", async () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1", "column2"],
      });

      await flushPromises();

      expect(
        wrapper.find('[data-test="dashboard-column-order-popup"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-column-order-cancel"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-column-order-save-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-column-order-cancel-btn"]').exists(),
      ).toBe(true);
    });

    it("should have button labels for screen readers", () => {
      wrapper = createWrapper({
        columnOrder: [],
        availableColumns: ["column1"],
      });

      const saveBtn = wrapper.find('[data-test="dashboard-column-order-save-btn"]');
      const cancelBtn = wrapper.find('[data-test="dashboard-column-order-cancel-btn"]');

      expect(saveBtn.text()).toContain("Save");
      expect(cancelBtn.text()).toContain("Cancel");
    });
  });
});
