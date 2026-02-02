// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FieldListPagination from "@/plugins/logs/components/FieldListPagination.vue";
import i18n from "@/locales";
import { Quasar } from "quasar";

describe("FieldListPagination.vue", () => {
  const defaultProps = {
    showUserDefinedSchemaToggle: false,
    showQuickMode: false,
    useUserDefinedSchemas: "user_defined_schema",
    showOnlyInterestingFields: false,
    userDefinedSchemaBtnGroupOption: [
      { label: "User Defined", value: "user_defined_schema", slot: "user_defined_slot" },
      { label: "All Fields", value: "all_fields", slot: "all_fields_slot" },
    ],
    selectedFieldsBtnGroupOption: [
      { label: "All Fields", value: false, slot: "all_fields_slot" },
      { label: "Interesting", value: true, slot: "interesting_fields_slot" },
    ],
    currentPage: 1,
    pagesNumber: 1,
    isFirstPage: true,
    isLastPage: true,
    totalFieldsCount: 50,
  };

  describe("schema toggle", () => {
    it("should render user defined schema toggle when enabled", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          showUserDefinedSchemaToggle: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find('[data-test="logs-page-field-list-user-defined-schema-toggle"]').exists()).toBe(true);
    });

    it("should not render user defined schema toggle when disabled", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          showUserDefinedSchemaToggle: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find('[data-test="logs-user-defined-fields-btn"]').exists()).toBe(false);
    });

    it("should emit toggle-schema event when schema toggle changes", async () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          showUserDefinedSchemaToggle: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const toggle = wrapper.findComponent({ name: "q-btn-toggle" });
      await toggle.vm.$emit("update:model-value", "all_fields");

      expect(wrapper.emitted("toggle-schema")).toBeTruthy();
      expect(wrapper.emitted("toggle-schema")?.[0]).toEqual(["all_fields"]);
    });
  });

  describe("interesting fields toggle", () => {
    it("should render interesting fields toggle when quick mode enabled and no user schema", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          showQuickMode: true,
          showUserDefinedSchemaToggle: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find('[data-test="logs-interesting-fields-btn"]').exists()).toBe(true);
    });

    it("should emit toggle-interesting-fields event when interesting fields toggle changes", async () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          showQuickMode: true,
          showUserDefinedSchemaToggle: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const toggle = wrapper.findComponent({ name: "q-btn-toggle" });
      await toggle.vm.$emit("update:model-value", true);

      expect(wrapper.emitted("toggle-interesting-fields")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting-fields")?.[0]).toEqual([true]);
    });
  });

  describe("pagination controls", () => {
    it("should not show pagination when only one page", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 1,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find(".field-list-pagination").exists()).toBe(false);
    });

    it("should show pagination when multiple pages", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 1,
          isFirstPage: true,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find(".field-list-pagination").exists()).toBe(true);
    });

    it("should disable first page button when on first page", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 1,
          isFirstPage: true,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const firstBtn = wrapper.find('[data-test="logs-page-fields-list-pagination-firstpage-button"]');
      expect(firstBtn.attributes("aria-disabled")).toBe("true");
    });

    it("should disable last page button when on last page", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 5,
          isFirstPage: false,
          isLastPage: true,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const lastBtn = wrapper.find('[data-test="logs-page-fields-list-pagination-lastpage-button"]');
      expect(lastBtn.attributes("aria-disabled")).toBe("true");
    });

    it("should emit first-page event when first page button clicked", async () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 3,
          isFirstPage: false,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const firstBtn = wrapper.find('[data-test="logs-page-fields-list-pagination-firstpage-button"]');
      await firstBtn.trigger("click");

      expect(wrapper.emitted("first-page")).toBeTruthy();
    });

    it("should emit last-page event when last page button clicked", async () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 3,
          isFirstPage: false,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const lastBtn = wrapper.find('[data-test="logs-page-fields-list-pagination-lastpage-button"]');
      await lastBtn.trigger("click");

      expect(wrapper.emitted("last-page")).toBeTruthy();
    });

    it("should emit set-page event when page button clicked", async () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 1,
          isFirstPage: true,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const pageBtn = wrapper.find('[data-test="logs-page-fields-list-pagination-page-2-button"]');
      await pageBtn.trigger("click");

      expect(wrapper.emitted("set-page")).toBeTruthy();
      expect(wrapper.emitted("set-page")?.[0]).toEqual([2]);
    });
  });

  describe("visible pages computation", () => {
    it("should show all pages when 3 or fewer", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 3,
          currentPage: 1,
          isFirstPage: true,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find('[data-test="logs-page-fields-list-pagination-page-1-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-page-fields-list-pagination-page-2-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-page-fields-list-pagination-page-3-button"]').exists()).toBe(true);
    });

    it("should show 3 pages centered around current page", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 10,
          currentPage: 5,
          isFirstPage: false,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      // Should show pages 4, 5, 6
      expect(wrapper.find('[data-test="logs-page-fields-list-pagination-page-4-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-page-fields-list-pagination-page-5-button"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-page-fields-list-pagination-page-6-button"]').exists()).toBe(true);
    });

    it("should highlight current page", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 3,
          isFirstPage: false,
          isLastPage: false,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const currentBtn = wrapper.find('[data-test="logs-page-fields-list-pagination-page-3-button"]');
      expect(currentBtn.classes()).toContain("pagination-page-active");
    });
  });

  describe("reset fields", () => {
    it("should render reset icon", () => {
      const wrapper = mount(FieldListPagination, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
        },
      });

      expect(wrapper.find('[data-test="logs-page-fields-list-reset-icon"]').exists()).toBe(true);
    });

    it("should emit reset-fields event when reset icon clicked", async () => {
      const wrapper = mount(FieldListPagination, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
        },
      });

      const resetIcon = wrapper.find('[data-test="logs-page-fields-list-reset-icon"]');
      await resetIcon.trigger("click");

      expect(wrapper.emitted("reset-fields")).toBeTruthy();
    });
  });

  describe("pagination wrapper element", () => {
    it("should render pagination wrapper with tooltip", () => {
      const wrapper = mount(FieldListPagination, {
        props: {
          ...defaultProps,
          pagesNumber: 5,
          currentPage: 1,
          isFirstPage: true,
          isLastPage: false,
          totalFieldsCount: 123,
        },
        global: {
          plugins: [i18n, Quasar],
        },
      });

      // Pagination wrapper is shown
      const pagination = wrapper.find(".field-list-pagination");
      expect(pagination.exists()).toBe(true);
    });
  });
});
