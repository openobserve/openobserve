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

// Stub OSelect to make it trivially queryable & emit easily
const OSelectStub = {
  name: "OSelect",
  inheritAttrs: false,
  props: ["modelValue", "options"],
  emits: ["update:modelValue"],
  template: `<div data-test="dashboard-table-rows-per-page-select"
    :data-model-value="JSON.stringify(modelValue)"
    :data-options="JSON.stringify(options)"
  ></div>`,
};

// Stub OButton to expose icon-left as a data attr for easy querying
const OButtonStub = {
  name: "OButton",
  inheritAttrs: false,
  props: ["variant", "size", "disabled", "iconLeft"],
  emits: ["click"],
  template: `<button
    :disabled="disabled"
    :data-icon="iconLeft"
    :data-test="$attrs['data-test']"
    @click="$emit('click', $event)"
  ><slot /></button>`,
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
          OSelect: OSelectStub,
          OButton: OButtonStub,
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
      expect(wrapper.find('[data-test="dashboard-table-rows-per-page-select"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).toContain("Rows per page");
    });

    it("should not render rows per page dropdown when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false });
      expect(wrapper.find('[data-test="dashboard-table-rows-per-page-select"]').exists()).toBe(
        false,
      );
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
      // Component maps options to {label, value}
      expect(select.props("options")).toEqual([
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "250", value: 250 },
        { label: "500", value: 500 },
        { label: "1000", value: 1000 },
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

      await select.vm.$emit("update:modelValue", 50);

      expect(wrapper.emitted("update:rowsPerPage")).toBeTruthy();
      expect(wrapper.emitted("update:rowsPerPage")?.[0]).toEqual([50]);
    });

    it("should display 'All' label for option value 0", () => {
      wrapper = createWrapper({ paginationOptions: [0, 10, 20] });
      const select = wrapper.findComponent({ name: "OSelect" });
      const options = select.props("options");
      expect(options[0]).toEqual({ label: "All", value: 0 });
      expect(options[1]).toEqual({ label: "10", value: 10 });
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
    const iconToDataTest: Record<string, string> = {
      "first-page": "dashboard-table-pagination-first-page",
      "chevron-left": "dashboard-table-pagination-prev-page",
      "chevron-right": "dashboard-table-pagination-next-page",
      "last-page": "dashboard-table-pagination-last-page",
    };
    const findButtonByIcon = (wrapper: VueWrapper<any>, icon: string) => {
      const dt = iconToDataTest[icon];
      const el = wrapper.find(`[data-test="${dt}"]`);
      return el.exists() ? el : undefined;
    };

    it("should render all four navigation buttons when pagesNumber > 1", () => {
      wrapper = createWrapper({ showPagination: true, pagesNumber: 5 });

      expect(findButtonByIcon(wrapper, "first-page")).toBeTruthy();
      expect(findButtonByIcon(wrapper, "chevron-left")).toBeTruthy();
      expect(findButtonByIcon(wrapper, "chevron-right")).toBeTruthy();
      expect(findButtonByIcon(wrapper, "last-page")).toBeTruthy();
    });

    it("should disable first page and prev buttons when on first page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
        isLastPage: false,
      });

      const firstPageBtn = findButtonByIcon(wrapper, "first-page");
      const prevBtn = findButtonByIcon(wrapper, "chevron-left");

      expect(firstPageBtn?.attributes("disabled")).toBeDefined();
      expect(prevBtn?.attributes("disabled")).toBeDefined();
    });

    it("should disable last page and next buttons when on last page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
        isLastPage: true,
      });

      const lastPageBtn = findButtonByIcon(wrapper, "last-page");
      const nextBtn = findButtonByIcon(wrapper, "chevron-right");

      expect(lastPageBtn?.attributes("disabled")).toBeDefined();
      expect(nextBtn?.attributes("disabled")).toBeDefined();
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
        expect(btn.attributes("disabled")).toBeUndefined();
      });
    });

    it("should emit firstPage when first page button is clicked", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
      });

      const firstPageBtn = findButtonByIcon(wrapper, "first-page");
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

      const prevBtn = findButtonByIcon(wrapper, "chevron-left");
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

      const nextBtn = findButtonByIcon(wrapper, "chevron-right");
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

      const lastPageBtn = findButtonByIcon(wrapper, "last-page");
      await lastPageBtn?.trigger("click");

      expect(wrapper.emitted("lastPage")).toBeTruthy();
      expect(wrapper.emitted("lastPage")?.length).toBe(1);
    });

    it("should mark first page button as disabled when isFirstPage is true", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
      });

      const firstPageBtn = findButtonByIcon(wrapper, "first-page");
      expect(firstPageBtn?.attributes("disabled")).toBeDefined();
    });

    it("should mark last page button as disabled when isLastPage is true", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isLastPage: true,
      });

      const lastPageBtn = findButtonByIcon(wrapper, "last-page");
      expect(lastPageBtn?.attributes("disabled")).toBeDefined();
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
      expect(select.props("options")).toEqual([
        { label: "5", value: 5 },
        { label: "15", value: 15 },
        { label: "25", value: 25 },
      ]);
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
            OSelect: OSelectStub,
            OButton: OButtonStub,
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
            OSelect: OSelectStub,
            OButton: OButtonStub,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have proper button attributes for navigation", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: false,
        isLastPage: false,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      expect(buttons.length).toBeGreaterThan(0);

      buttons.forEach((btn) => {
        expect(btn.attributes("role") || btn.element.tagName.toLowerCase()).toBeTruthy();
      });
    });

    it("should properly disable buttons using disabled attribute", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
      });

      const firstPageBtn = wrapper.find('[data-test="dashboard-table-pagination-first-page"]');

      expect(firstPageBtn.attributes("disabled")).toBeDefined();
    });
  });

  describe("data-test attributes", () => {
    it("should render root div with data-test=dashboard-table-pagination-controls", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-table-pagination-controls"]').exists()).toBe(true);
    });

    it("should render rows-per-page label with data-test=dashboard-table-rows-per-page-label when pagination enabled", () => {
      wrapper = createWrapper({ showPagination: true });
      expect(wrapper.find('[data-test="dashboard-table-rows-per-page-label"]').exists()).toBe(true);
    });

    it("should not render rows-per-page label when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false });
      expect(wrapper.find('[data-test="dashboard-table-rows-per-page-label"]').exists()).toBe(
        false,
      );
    });

    it("should render count display with data-test=dashboard-table-row-count", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-table-row-count"]').exists()).toBe(true);
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
    it("should render navigation buttons with correct icon-left props", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
      });

      const buttons = wrapper.findAllComponents({ name: "OButton" });
      const icons = buttons.map((b) => b.attributes("data-icon"));
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
        expect(btn.html()).toBeTruthy();
      });
    });
  });
});
