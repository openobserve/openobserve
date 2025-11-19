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

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import StreamDataTable from "@/components/logstream/explore/StreamDataTable.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("StreamDataTable.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockColumns = [
    { name: "field1", label: "Field 1" },
    { name: "field2", label: "Field 2" },
    { name: "timestamp", label: "Timestamp" },
  ];

  const mockRows = [
    { field1: "value1", field2: "value2", timestamp: "2024-01-01" },
    { field1: "value3", field2: "value4", timestamp: "2024-01-02" },
    { field1: "value5", field2: "value6", timestamp: "2024-01-03" },
  ];

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountComponent = (props: any = {}) => {
    wrapper = mount(StreamDataTable, {
      attachTo: node,
      props: {
        rows: mockRows,
        columns: mockColumns,
        isLoading: false,
        pagination: {},
        ...props,
      },
      global: {
        plugins: [i18n, store],
      },
    });
  };

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct data-test attribute", () => {
      mountComponent();
      expect(
        wrapper.find('[data-test="logs-search-result-logs-table"]').exists(),
      ).toBe(true);
    });

    it("should have component name", () => {
      mountComponent();
      expect(wrapper.vm.$options.name).toBe("StreamDataTable");
    });
  });

  describe("Props", () => {
    it("should accept rows prop", () => {
      mountComponent({ rows: mockRows });
      expect(wrapper.props("rows")).toEqual(mockRows);
    });

    it("should accept columns prop", () => {
      mountComponent({ columns: mockColumns });
      expect(wrapper.props("columns")).toEqual(mockColumns);
    });

    it("should accept isLoading prop", () => {
      mountComponent({ isLoading: true });
      expect(wrapper.props("isLoading")).toBe(true);
    });

    it("should accept pagination prop", () => {
      const pagination = { page: 1, rowsPerPage: 20 };
      mountComponent({ pagination });
      expect(wrapper.props("pagination")).toEqual(pagination);
    });

    it("should have default values for props", () => {
      wrapper = mount(StreamDataTable, {
        attachTo: node,
        global: {
          plugins: [i18n, store],
        },
      });

      expect(wrapper.props("rows")).toEqual([]);
      expect(wrapper.props("columns")).toEqual([]);
      expect(wrapper.props("isLoading")).toBe(false);
    });
  });

  describe("Table Headers", () => {
    it("should render all column headers", async () => {
      mountComponent();
      await flushPromises();

      const headers = wrapper.findAll(".table-header");
      expect(headers.length).toBe(mockColumns.length);
    });

    it("should display correct column labels", async () => {
      mountComponent();
      await flushPromises();

      const tableText = wrapper.text();
      mockColumns.forEach((col) => {
        expect(tableText).toContain(col.label);
      });
    });

    it("should have thead with sticky class", () => {
      mountComponent();
      expect(wrapper.find("thead.thead-sticky").exists()).toBe(true);
    });
  });

  describe("Table Rows", () => {
    it("should pass rows to virtual scroll component", async () => {
      mountComponent();
      await flushPromises();

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")).toEqual(mockRows);
    });

    it("should have correct row count in items prop", () => {
      mountComponent();
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items").length).toBe(mockRows.length);
    });

    it("should configure virtual scroll for rendering rows", () => {
      mountComponent();
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("type")).toBe("table");
    });

    it("should handle rows with null values", () => {
      const rowsWithNull = [
        { field1: null, field2: "value2", timestamp: "2024-01-01" },
      ];
      mountComponent({ rows: rowsWithNull });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toBeNull();
    });

    it("should handle rows with long values", () => {
      const longValue = "a".repeat(100);
      const rowsWithLongValue = [
        { field1: longValue, field2: "value2", timestamp: "2024-01-01" },
      ];
      mountComponent({ rows: rowsWithLongValue });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1.length).toBe(100);
    });

    it("should handle rows with short values", () => {
      const shortValue = "short";
      const rows = [
        { field1: shortValue, field2: "value2", timestamp: "2024-01-01" },
      ];
      mountComponent({ rows });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toBe(shortValue);
    });
  });

  describe("Virtual Scroll", () => {
    it("should use QVirtualScroll component", () => {
      mountComponent();
      expect(wrapper.findComponent({ name: "QVirtualScroll" }).exists()).toBe(
        true,
      );
    });

    it("should have correct virtual scroll props", () => {
      mountComponent();
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });

      expect(virtualScroll.props("virtualScrollItemSize")).toBe(25);
      expect(virtualScroll.props("virtualScrollSliceSize")).toBe(150);
      expect(virtualScroll.props("virtualScrollSliceRatioBefore")).toBe(10);
    });

    it("should pass rows to virtual scroll", () => {
      mountComponent();
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")).toEqual(mockRows);
    });
  });

  describe("Scroll Event", () => {
    it("should emit update:scroll when scrolling near end", async () => {
      mountComponent();
      const vm = wrapper.vm as any;

      // Simulate scroll info that triggers emit
      const scrollInfo = {
        index: 8,
        ref: { items: { length: 10 } },
      };

      vm.onScroll(scrollInfo);
      await flushPromises();

      expect(wrapper.emitted("update:scroll")).toBeTruthy();
    });

    it("should not emit update:scroll when loading", async () => {
      mountComponent({ isLoading: true });
      const vm = wrapper.vm as any;

      const scrollInfo = {
        index: 8,
        ref: { items: { length: 10 } },
      };

      vm.onScroll(scrollInfo);
      await flushPromises();

      expect(wrapper.emitted("update:scroll")).toBeFalsy();
    });

    it("should not emit update:scroll when far from end", async () => {
      mountComponent();
      const vm = wrapper.vm as any;

      // Simulate scroll info that doesn't trigger emit
      const scrollInfo = {
        index: 2,
        ref: { items: { length: 100 } },
      };

      vm.onScroll(scrollInfo);
      await flushPromises();

      expect(wrapper.emitted("update:scroll")).toBeFalsy();
    });
  });

  describe("Empty State", () => {
    it("should handle empty rows", () => {
      mountComponent({ rows: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty columns", () => {
      mountComponent({ columns: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle both empty rows and columns", () => {
      mountComponent({ rows: [], columns: [] });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Cell Rendering", () => {
    it("should have table structure", () => {
      mountComponent();
      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.exists()).toBe(true);
    });

    it("should configure id for searchGrid", () => {
      mountComponent();
      expect(wrapper.attributes("id")).toBe("searchGridComponent");
    });

    it("should set proper class", () => {
      mountComponent();
      expect(wrapper.classes()).toContain("stream-data-table");
    });
  });

  describe("Data Display", () => {
    it("should handle rows with number values", () => {
      const rowsWithNumbers = [
        { field1: 123, field2: 456, timestamp: "2024-01-01" },
      ];
      mountComponent({ rows: rowsWithNumbers });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toBe(123);
      expect(virtualScroll.props("items")[0].field2).toBe(456);
    });

    it("should handle rows with boolean values", () => {
      const rowsWithBoolean = [
        { field1: true, field2: false, timestamp: "2024-01-01" },
      ];
      mountComponent({ rows: rowsWithBoolean });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toBe(true);
      expect(virtualScroll.props("items")[0].field2).toBe(false);
    });
  });

  describe("Refs", () => {
    it("should have searchTableRef", () => {
      mountComponent();
      const vm = wrapper.vm as any;
      expect(vm.searchTableRef).toBeDefined();
    });
  });

  describe("Large Dataset", () => {
    it("should handle large number of rows", () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        field1: `value${i}`,
        field2: `value${i}`,
        timestamp: `2024-01-01`,
      }));

      mountComponent({ rows: largeDataset });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle many columns", () => {
      const manyColumns = Array.from({ length: 20 }, (_, i) => ({
        name: `field${i}`,
        label: `Field ${i}`,
      }));

      mountComponent({ columns: manyColumns });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters in values", () => {
      const rowsWithSpecialChars = [
        {
          field1: "<script>alert('test')</script>",
          field2: "value & value",
          timestamp: "2024-01-01",
        },
      ];
      mountComponent({ rows: rowsWithSpecialChars });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toContain("script");
    });

    it("should handle unicode characters", () => {
      const rowsWithUnicode = [
        { field1: "こんにちは", field2: "🚀", timestamp: "2024-01-01" },
      ];
      mountComponent({ rows: rowsWithUnicode });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toBe("こんにちは");
      expect(virtualScroll.props("items")[0].field2).toBe("🚀");
    });

    it("should handle undefined values in row", () => {
      const rowsWithUndefined = [
        { field1: undefined, field2: "value2", timestamp: "2024-01-01" },
      ];
      mountComponent({ rows: rowsWithUndefined });

      const virtualScroll = wrapper.findComponent({ name: "QVirtualScroll" });
      expect(virtualScroll.props("items")[0].field1).toBeUndefined();
    });
  });
});
