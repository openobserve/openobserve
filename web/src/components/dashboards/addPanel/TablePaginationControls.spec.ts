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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import TablePaginationControls from "./TablePaginationControls.vue";
import { createI18n } from "vue-i18n";

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      dashboard: {
        rowsPerPage: "Rows per page",
      },
    },
  },
});

// Stubs for the new OButton & OSelect components used in TablePaginationControls.vue
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "iconLeft", "loading", "active", "block"],
  emits: ["click"],
  template: `<button :data-test="$attrs['data-test']" :disabled="disabled" @click="$emit('click', $event)"><span :data-icon="iconLeft">{{ iconLeft }}</span><slot /></button>`,
};

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options"],
  emits: ["update:modelValue"],
  template: `<select :data-test="$attrs['data-test']" :value="modelValue" @change="$emit('update:modelValue', Number($event.target.value))"><option v-for="opt in options" :value="typeof opt === 'object' ? opt.value : opt" :key="typeof opt === 'object' ? opt.value : opt">{{ typeof opt === 'object' ? opt.label : opt }}</option></select>`,
};

describe("TablePaginationControls", () => {
  let wrapper: VueWrapper<any>;

  const defaultProps = {
    showPagination: true,
    pagination: { rowsPerPage: 10, page: 1 },
    paginationOptions: [10, 20, 50, 100, 250, 500, 1000],
    totalRows: 100,
    pagesNumber: 10,
    isFirstPage: true,
    isLastPage: false,
  };

  const createWrapper = (props = {}) => {
    return mount(TablePaginationControls, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [mockI18n],
        stubs: {
          OButton: OButtonStub,
          OSelect: OSelectStub,
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
    });

    it("should render rows per page dropdown when pagination is enabled", () => {
      wrapper = createWrapper({ showPagination: true });
      expect(wrapper.findComponent({ name: "OSelect" }).exists()).toBe(true);
      expect(wrapper.text()).toContain("Rows per page");
    });

    it("should not render rows per page dropdown when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false });
      expect(wrapper.findComponent({ name: "OSelect" }).exists()).toBe(false);
    });

    it("should render count display", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("1-10 of 100");
    });

    it("should render navigation buttons when pagination is enabled and pages > 1", () => {
      wrapper = createWrapper({ showPagination: true, pagesNumber: 5 });
      const buttons = wrapper.findAllComponents({ name: "OButton" });
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should not render navigation buttons when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false, pagesNumber: 5 });
      const buttons = wrapper.findAllComponents({ name: "OButton" });
      expect(buttons.length).toBe(0);
    });

    it("should not render navigation buttons when pagesNumber is 1", () => {
      wrapper = createWrapper({ showPagination: true, pagesNumber: 1 });
      const buttons = wrapper.findAllComponents({ name: "OButton" });
      expect(buttons.length).toBe(0);
    });
  });

  describe("Pagination Options", () => {
    it("should display correct pagination options in dropdown", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "OSelect" });
      // The source maps paginationOptions into { label, value } objects
      const options = select.props("options") as Array<{ label: string; value: number }>;
      expect(options.map((o) => o.value)).toEqual([
        10, 20, 50, 100, 250, 500, 1000,
      ]);
    });

    it("should show current rowsPerPage value", () => {
      wrapper = createWrapper({ pagination: { rowsPerPage: 50, page: 1 } });
      const select = wrapper.findComponent({ name: "OSelect" });
      expect(select.props("modelValue")).toBe(50);
    });

    it("should emit update:rowsPerPage when dropdown value changes", async () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "OSelect" });

      await select.vm.$emit("update:model-value", 50);

      expect(wrapper.emitted("update:rowsPerPage")).toBeTruthy();
      expect(wrapper.emitted("update:rowsPerPage")?.[0]).toEqual([50]);
    });

    it("should display 'All' for option value 0", () => {
      wrapper = createWrapper({ paginationOptions: [0, 10, 20] });
      const select = wrapper.findComponent({ name: "OSelect" });
      const options = select.props("options") as Array<{ label: string; value: number }>;

      // formattedPaginationOptions maps 0 -> { label: 'All', value: 0 }
      const allOpt = options.find((o) => o.value === 0);
      const tenOpt = options.find((o) => o.value === 10);
      expect(allOpt?.label).toBe("All");
      expect(tenOpt?.label).toBe("10");
    });
  });

  describe("Count Display", () => {
    it("should show correct count when pagination is enabled", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("1-10 of 100");
    });

    it("should show correct count for middle page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 3 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("21-30 of 100");
    });

    it("should show correct count for last page with partial results", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 10 },
        totalRows: 95,
      });

      expect(wrapper.text()).toContain("91-95 of 95");
    });

    it("should show correct count when rowsPerPage is 0 (All)", () => {
      wrapper = createWrapper({
        showPagination: false,
        pagination: { rowsPerPage: 0, page: 1 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("1-100 of 100");
    });

    it("should show correct count when pagination is disabled", () => {
      wrapper = createWrapper({
        showPagination: false,
        pagination: { rowsPerPage: 0, page: 1 },
        totalRows: 50,
      });

      expect(wrapper.text()).toContain("1-50 of 50");
    });

    it("should handle empty results", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 0,
      });

      expect(wrapper.text()).toContain("0 of 0");
    });

    it("should handle single page with fewer rows than rowsPerPage", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 50, page: 1 },
        totalRows: 25,
      });

      expect(wrapper.text()).toContain("1-25 of 25");
    });

    it("should calculate end correctly when on last page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 20, page: 5 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("81-100 of 100");
    });
  });

  describe("Navigation Buttons", () => {
    it("should render all four navigation buttons when pagesNumber > 1", () => {
      wrapper = createWrapper({ showPagination: true, pagesNumber: 5 });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      expect(buttons.length).toBe(4);

      const icons = buttons.map((b) => b.props("iconLeft"));
      expect(icons).toContain("first-page");
      expect(icons).toContain("chevron-left");
      expect(icons).toContain("chevron-right");
      expect(icons).toContain("last-page");
    });

    it("should disable first page and prev buttons when on first page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
        isLastPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const firstPageBtn = buttons.find((b) => b.props("iconLeft") === "first-page");
      const prevBtn = buttons.find((b) => b.props("iconLeft") === "chevron-left");

      expect(firstPageBtn?.props("disabled")).toBe(true);
      expect(prevBtn?.props("disabled")).toBe(true);
    });

    it("should disable last page and next buttons when on last page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
        isLastPage: true,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const lastPageBtn = buttons.find((b) => b.props("iconLeft") === "last-page");
      const nextBtn = buttons.find((b) => b.props("iconLeft") === "chevron-right");

      expect(lastPageBtn?.props("disabled")).toBe(true);
      expect(nextBtn?.props("disabled")).toBe(true);
    });

    it("should enable all buttons when on middle page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
        isLastPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      buttons.forEach((btn) => {
        expect(btn.props("disabled")).toBe(false);
      });
    });

    it("should emit firstPage when first page button is clicked", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const firstPageBtn = buttons.find((b) => b.props("iconLeft") === "first-page");

      await firstPageBtn?.trigger("click");

      expect(wrapper.emitted("firstPage")).toBeTruthy();
      expect(wrapper.emitted("firstPage")?.length).toBe(1);
    });

    it("should emit prevPage when previous button is clicked", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const prevBtn = buttons.find((b) => b.props("iconLeft") === "chevron-left");

      await prevBtn?.trigger("click");

      expect(wrapper.emitted("prevPage")).toBeTruthy();
      expect(wrapper.emitted("prevPage")?.length).toBe(1);
    });

    it("should emit nextPage when next button is clicked", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isLastPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const nextBtn = buttons.find((b) => b.props("iconLeft") === "chevron-right");

      await nextBtn?.trigger("click");

      expect(wrapper.emitted("nextPage")).toBeTruthy();
      expect(wrapper.emitted("nextPage")?.length).toBe(1);
    });

    it("should emit lastPage when last page button is clicked", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isLastPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const lastPageBtn = buttons.find((b) => b.props("iconLeft") === "last-page");

      await lastPageBtn?.trigger("click");

      expect(wrapper.emitted("lastPage")).toBeTruthy();
      expect(wrapper.emitted("lastPage")?.length).toBe(1);
    });

    it("should mark first page button disabled when isFirstPage is true", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const firstPageBtn = buttons.find((b) => b.props("iconLeft") === "first-page");
      expect(firstPageBtn?.props("disabled")).toBe(true);
    });

    it("should mark last page button disabled when isLastPage is true", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isLastPage: true,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const lastPageBtn = buttons.find((b) => b.props("iconLeft") === "last-page");
      expect(lastPageBtn?.props("disabled")).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle totalRows of 1", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 1,
        pagesNumber: 1,
      });

      expect(wrapper.text()).toContain("1-1 of 1");
    });

    it("should handle very large totalRows", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 100, page: 1 },
        totalRows: 10000,
        pagesNumber: 100,
      });

      expect(wrapper.text()).toContain("1-100 of 10000");
    });

    it("should handle page number larger than 1 with rowsPerPage 0", () => {
      wrapper = createWrapper({
        showPagination: false,
        pagination: { rowsPerPage: 0, page: 5 },
        totalRows: 100,
      });

      // When rowsPerPage is 0, it should still show all rows
      expect(wrapper.text()).toContain("1-100 of 100");
    });

    it("should properly calculate start and end for various page sizes", () => {
      const testCases = [
        { rowsPerPage: 25, page: 2, totalRows: 100, expected: "26-50 of 100" },
        { rowsPerPage: 50, page: 1, totalRows: 100, expected: "1-50 of 100" },
        { rowsPerPage: 100, page: 1, totalRows: 100, expected: "1-100 of 100" },
        {
          rowsPerPage: 10,
          page: 10,
          totalRows: 100,
          expected: "91-100 of 100",
        },
      ];

      testCases.forEach(({ rowsPerPage, page, totalRows, expected }) => {
        wrapper = createWrapper({
          showPagination: true,
          pagination: { rowsPerPage, page },
          totalRows,
        });

        expect(wrapper.text()).toContain(expected);
        wrapper.unmount();
      });
    });

    it("should handle custom pagination options", () => {
      wrapper = createWrapper({
        paginationOptions: [5, 15, 25],
      });

      const select = wrapper.findComponent({ name: "OSelect" });
      const options = select.props("options") as Array<{ label: string; value: number }>;
      expect(options.map((o) => o.value)).toEqual([5, 15, 25]);
    });

    it("should handle missing optional props with defaults", () => {
      wrapper = mount(TablePaginationControls, {
        props: {
          pagination: { rowsPerPage: 10, page: 1 },
          totalRows: 50,
        },
        global: {
          plugins: [mockI18n],
          stubs: {
            OButton: OButtonStub,
            OSelect: OSelectStub,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("1-50 of 50");
    });
  });

  describe("Props Validation", () => {
    it("should accept showPagination as boolean", () => {
      wrapper = createWrapper({ showPagination: true });
      expect(wrapper.props("showPagination")).toBe(true);

      wrapper.unmount();

      wrapper = createWrapper({ showPagination: false });
      expect(wrapper.props("showPagination")).toBe(false);
    });

    it("should accept pagination object with required properties", () => {
      const pagination = { rowsPerPage: 25, page: 3 };
      wrapper = createWrapper({ pagination });

      expect(wrapper.props("pagination")).toEqual(pagination);
    });

    it("should accept paginationOptions as array", () => {
      const options = [5, 10, 15];
      wrapper = createWrapper({ paginationOptions: options });

      expect(wrapper.props("paginationOptions")).toEqual(options);
    });

    it("should accept totalRows as number", () => {
      wrapper = createWrapper({ totalRows: 250 });

      expect(wrapper.props("totalRows")).toBe(250);
    });

    it("should accept pagesNumber as number", () => {
      wrapper = createWrapper({ pagesNumber: 15 });

      expect(wrapper.props("pagesNumber")).toBe(15);
    });

    it("should accept isFirstPage as boolean", () => {
      wrapper = createWrapper({ isFirstPage: false });

      expect(wrapper.props("isFirstPage")).toBe(false);
    });

    it("should accept isLastPage as boolean", () => {
      wrapper = createWrapper({ isLastPage: true });

      expect(wrapper.props("isLastPage")).toBe(true);
    });
  });

  describe("Computed Properties", () => {
    it("should recalculate countDisplay when pagination changes", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("1-10 of 100");

      await wrapper.setProps({
        pagination: { rowsPerPage: 10, page: 2 },
      });

      expect(wrapper.text()).toContain("11-20 of 100");
    });

    it("should recalculate countDisplay when totalRows changes", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("1-10 of 100");

      await wrapper.setProps({
        totalRows: 50,
      });

      expect(wrapper.text()).toContain("1-10 of 50");
    });

    it("should recalculate countDisplay when showPagination changes", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 100,
      });

      expect(wrapper.text()).toContain("1-10 of 100");

      await wrapper.setProps({
        showPagination: false,
        pagination: { rowsPerPage: 0, page: 1 },
      });

      expect(wrapper.text()).toContain("1-100 of 100");
    });
  });

  describe("Internationalization", () => {
    it("should use i18n for rows per page label", () => {
      wrapper = createWrapper({ showPagination: true });

      expect(wrapper.text()).toContain("Rows per page");
    });

    it("should handle missing translations gracefully", () => {
      const customI18n = createI18n({
        locale: "en",
        messages: {
          en: {},
        },
      });

      wrapper = mount(TablePaginationControls, {
        props: defaultProps,
        global: {
          plugins: [customI18n],
          stubs: {
            OButton: OButtonStub,
            OSelect: OSelectStub,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should render navigation buttons", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
        isLastPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should properly disable buttons via disabled prop", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const firstPageBtn = buttons.find((b) => b.props("iconLeft") === "first-page");

      expect(firstPageBtn?.props("disabled")).toBe(true);
    });
  });

  describe("data-test attributes", () => {
    it("should render root div with data-test=dashboard-table-pagination-controls", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-table-pagination-controls"]').exists(),
      ).toBe(true);
    });

    it("should render rows-per-page label with data-test=dashboard-table-rows-per-page-label when pagination enabled", () => {
      wrapper = createWrapper({ showPagination: true });
      expect(
        wrapper
          .find('[data-test="dashboard-table-rows-per-page-label"]')
          .exists(),
      ).toBe(true);
    });

    it("should not render rows-per-page label when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false });
      expect(
        wrapper
          .find('[data-test="dashboard-table-rows-per-page-label"]')
          .exists(),
      ).toBe(false);
    });

    it("should render count display with data-test=dashboard-table-row-count", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-table-row-count"]').exists(),
      ).toBe(true);
    });

    it("should show correct count text in the dashboard-table-row-count element", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagination: { rowsPerPage: 10, page: 1 },
        totalRows: 50,
      });
      const countEl = wrapper.find('[data-test="dashboard-table-row-count"]');
      expect(countEl.text()).toContain("1-10 of 50");
    });
  });

  describe("Layout and Styling", () => {
    it("should render with flex layout", () => {
      wrapper = createWrapper();

      const mainDiv = wrapper.find('[data-test="dashboard-table-pagination-controls"]');
      expect(mainDiv.exists()).toBe(true);
    });

    it("should render OSelect with data-test attribute when pagination is shown", () => {
      wrapper = createWrapper({ showPagination: true });

      expect(
        wrapper
          .find('[data-test="dashboard-table-rows-per-page-select"]')
          .exists(),
      ).toBe(true);
    });

    it("should render OButton components with correct iconLeft values", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const icons = buttons.map((b) => b.props("iconLeft"));
      expect(icons).toContain("first-page");
      expect(icons).toContain("chevron-left");
      expect(icons).toContain("chevron-right");
      expect(icons).toContain("last-page");
    });

    it("should apply correct button styling", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      buttons.forEach((btn) => {
        expect(btn.props("variant")).toBe("ghost");
        expect(btn.props("size")).toBe("icon");
      });
    });
  });
});
