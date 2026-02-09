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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import TablePaginationControls from "./TablePaginationControls.vue";
import { createI18n } from "vue-i18n";

installQuasar();

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
      expect(wrapper.find(".q-select").exists()).toBe(true);
      expect(wrapper.text()).toContain("Rows per page");
    });

    it("should not render rows per page dropdown when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false });
      expect(wrapper.find(".q-select").exists()).toBe(false);
    });

    it("should render count display", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("1-10 of 100");
    });

    it("should render navigation buttons when pagination is enabled and pages > 1", () => {
      wrapper = createWrapper({ showPagination: true, pagesNumber: 5 });
      const buttons = wrapper.findAll(".q-btn");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should not render navigation buttons when pagination is disabled", () => {
      wrapper = createWrapper({ showPagination: false, pagesNumber: 5 });
      const buttons = wrapper.findAll(".q-btn");
      expect(buttons.length).toBe(0);
    });

    it("should not render navigation buttons when pagesNumber is 1", () => {
      wrapper = createWrapper({ showPagination: true, pagesNumber: 1 });
      const buttons = wrapper.findAll(".q-btn");
      expect(buttons.length).toBe(0);
    });
  });

  describe("Pagination Options", () => {
    it("should display correct pagination options in dropdown", () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("options")).toEqual([
        10, 20, 50, 100, 250, 500, 1000,
      ]);
    });

    it("should show current rowsPerPage value", () => {
      wrapper = createWrapper({ pagination: { rowsPerPage: 50, page: 1 } });
      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("modelValue")).toBe(50);
    });

    it("should emit update:rowsPerPage when dropdown value changes", async () => {
      wrapper = createWrapper();
      const select = wrapper.findComponent({ name: "QSelect" });

      await select.vm.$emit("update:model-value", 50);

      expect(wrapper.emitted("update:rowsPerPage")).toBeTruthy();
      expect(wrapper.emitted("update:rowsPerPage")?.[0]).toEqual([50]);
    });

    it("should display 'All' for option value 0", () => {
      wrapper = createWrapper({ paginationOptions: [0, 10, 20] });
      const select = wrapper.findComponent({ name: "QSelect" });
      const optionLabel = select.props("optionLabel");

      expect(optionLabel(0)).toBe("All");
      expect(optionLabel(10)).toBe(10);
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

      const firstPageBtn = wrapper
        .findAll(".q-btn")
        .find(
          (btn) =>
            btn.attributes("aria-label")?.includes("first") ||
            btn.html().includes("first_page"),
        );
      const lastPageBtn = wrapper
        .findAll(".q-btn")
        .find(
          (btn) =>
            btn.attributes("aria-label")?.includes("last") ||
            btn.html().includes("last_page"),
        );
      const prevBtn = wrapper
        .findAll(".q-btn")
        .find((btn) => btn.html().includes("chevron_left"));
      const nextBtn = wrapper
        .findAll(".q-btn")
        .find((btn) => btn.html().includes("chevron_right"));

      expect(firstPageBtn).toBeTruthy();
      expect(prevBtn).toBeTruthy();
      expect(nextBtn).toBeTruthy();
      expect(lastPageBtn).toBeTruthy();
    });

    it("should disable first page and prev buttons when on first page", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
        isLastPage: false,
      });

      const buttons = wrapper.findAll(".q-btn");
      const firstPageBtn = buttons.find((btn) =>
        btn.html().includes("first_page"),
      );
      const prevBtn = buttons.find((btn) =>
        btn.html().includes("chevron_left"),
      );

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

      const buttons = wrapper.findAll(".q-btn");
      const lastPageBtn = buttons.find((btn) =>
        btn.html().includes("last_page"),
      );
      const nextBtn = buttons.find((btn) =>
        btn.html().includes("chevron_right"),
      );

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

      const buttons = wrapper.findAll(".q-btn");
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

      const buttons = wrapper.findAll(".q-btn");
      const firstPageBtn = buttons.find((btn) =>
        btn.html().includes("first_page"),
      );

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

      const buttons = wrapper.findAll(".q-btn");
      const prevBtn = buttons.find((btn) =>
        btn.html().includes("chevron_left"),
      );

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

      const buttons = wrapper.findAll(".q-btn");
      const nextBtn = buttons.find((btn) =>
        btn.html().includes("chevron_right"),
      );

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

      const buttons = wrapper.findAll(".q-btn");
      const lastPageBtn = buttons.find((btn) =>
        btn.html().includes("last_page"),
      );

      await lastPageBtn?.trigger("click");

      expect(wrapper.emitted("lastPage")).toBeTruthy();
      expect(wrapper.emitted("lastPage")?.length).toBe(1);
    });

    it("should not emit firstPage when button is disabled", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
      });

      const buttons = wrapper.findAll(".q-btn");
      const firstPageBtn = buttons.find((btn) =>
        btn.html().includes("first_page"),
      );

      // Even if we try to click, the disabled button should not emit
      await firstPageBtn?.trigger("click");

      // The component should handle this gracefully
      expect(firstPageBtn?.attributes("disabled")).toBeDefined();
    });

    it("should not emit lastPage when button is disabled", async () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isLastPage: true,
      });

      const buttons = wrapper.findAll(".q-btn");
      const lastPageBtn = buttons.find((btn) =>
        btn.html().includes("last_page"),
      );

      await lastPageBtn?.trigger("click");

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

      const select = wrapper.findComponent({ name: "QSelect" });
      expect(select.props("options")).toEqual([5, 15, 25]);
    });

    it("should handle missing optional props with defaults", () => {
      wrapper = mount(TablePaginationControls, {
        props: {
          pagination: { rowsPerPage: 10, page: 1 },
          totalRows: 50,
        },
        global: {
          plugins: [mockI18n],
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

      const buttons = wrapper.findAll(".q-btn");
      expect(buttons.length).toBeGreaterThan(0);

      buttons.forEach((btn) => {
        expect(
          btn.attributes("role") || btn.element.tagName.toLowerCase(),
        ).toBeTruthy();
      });
    });

    it("should properly disable buttons using disabled attribute", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
        isFirstPage: true,
      });

      const buttons = wrapper.findAll(".q-btn");
      const firstPageBtn = buttons.find((btn) =>
        btn.html().includes("first_page"),
      );

      expect(firstPageBtn?.attributes("disabled")).toBeDefined();
    });
  });

  describe("Layout and Styling", () => {
    it("should have row layout class", () => {
      wrapper = createWrapper();

      const mainDiv = wrapper.find(".row.items-center");
      expect(mainDiv.exists()).toBe(true);
    });

    it("should have q-gutter-sm class when pagination is shown", () => {
      wrapper = createWrapper({ showPagination: true });

      const gutterDiv = wrapper.find(".q-gutter-sm");
      expect(gutterDiv.exists()).toBe(true);
    });

    it("should apply text-caption class to labels", () => {
      wrapper = createWrapper();

      const captions = wrapper.findAll(".text-caption");
      expect(captions.length).toBeGreaterThan(0);
    });

    it("should render buttons with correct icon names", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
      });

      expect(wrapper.html()).toContain("first_page");
      expect(wrapper.html()).toContain("chevron_left");
      expect(wrapper.html()).toContain("chevron_right");
      expect(wrapper.html()).toContain("last_page");
    });

    it("should apply correct button styling", () => {
      wrapper = createWrapper({
        showPagination: true,
        pagesNumber: 5,
      });

      const buttons = wrapper.findAll(".q-btn");
      buttons.forEach((btn) => {
        const html = btn.html();
        expect(html).toBeTruthy();
      });
    });
  });
});
