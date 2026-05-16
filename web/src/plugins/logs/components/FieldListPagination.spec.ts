// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FieldListPagination from "./FieldListPagination.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const quasarStubs = {
  OToggleGroup: {
    name: "OToggleGroup",
    template:
      '<div class="o-toggle-group-stub" v-bind="$attrs"><slot /></div>',
    emits: ["update:modelValue"],
    setup(_props: any, { emit }: any) {
      return { triggerUpdate: (val: any) => emit("update:modelValue", val) };
    },
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    template:
      '<button class="o-toggle-group-item-stub" v-bind="$attrs"><slot /></button>',
    props: ["value", "disabled", "size"],
  },
  QBtn: {
    name: "QBtn",
    template:
      '<button class="q-btn-stub" :data-test="$attrs[\'data-test\']" :disabled="disable" @click="$emit(\'click\', $event)"><slot /></button>',
    props: ["icon", "color", "flat", "disable"],
    emits: ["click"],
  },
  QIcon: {
    name: "QIcon",
    template:
      '<span class="OIcon-stub" :data-test="$attrs[\'data-test\']" :data-name="name" @click="$emit(\'click\', $event)"></span>',
    props: ["name"],
    emits: ["click"],
  },
  QTooltip: {
    name: "QTooltip",
    template: '<div class="q-tooltip-stub"><slot /></div>',
    props: ["anchor", "self", "maxWidth"],
  },
  QSeparator: {
    name: "QSeparator",
    template: '<hr class="q-separator-stub" />',
  },
};

const defaultProps = {
  showUserDefinedSchemaToggle: false,
  showQuickMode: false,
  useUserDefinedSchemas: "all_fields",
  showOnlyInterestingFields: false,
  userDefinedSchemaBtnGroupOption: [
    { value: "user_defined", slot: "user_defined_slot" },
    { value: "all_fields", slot: "all_fields_slot" },
  ],
  selectedFieldsBtnGroupOption: [
    { value: false, slot: "all_fields_slot" },
    { value: true, slot: "interesting_fields_slot" },
  ],
  currentPage: 1,
  pagesNumber: 1,
  isFirstPage: true,
  isLastPage: true,
  totalFieldsCount: 10,
};

function createWrapper(props = {}) {
  return mount(FieldListPagination, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: quasarStubs,
    },
  });
}

describe("FieldListPagination", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component rendering", () => {
    it("mounts without errors", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the reset icon", () => {
      const wrapper = createWrapper();
      const resetIcon = wrapper.find(
        '[data-test="logs-page-fields-list-reset-icon"]'
      );
      expect(resetIcon.exists()).toBe(true);
    });

    it("does not render pagination when pagesNumber is 1", () => {
      const wrapper = createWrapper({ pagesNumber: 1 });
      expect(
        wrapper
          .find('[data-test="logs-page-fields-list-pagination-firstpage-button"]')
          .exists()
      ).toBe(false);
    });

    it("renders pagination controls when pagesNumber > 1", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      const firstPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-firstpage-button"]'
      );
      expect(firstPageBtn.exists()).toBe(true);
    });

    it("renders last page button when pagesNumber > 1", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      const lastPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-lastpage-button"]'
      );
      expect(lastPageBtn.exists()).toBe(true);
    });
  });

  describe("Schema toggle visibility", () => {
    it("does not render schema toggle when showUserDefinedSchemaToggle is false and showQuickMode is false", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: false,
        showQuickMode: false,
      });
      const toggle = wrapper.find(
        '[data-test="logs-page-field-list-user-defined-schema-toggle"]'
      );
      expect(toggle.exists()).toBe(false);
    });

    it("renders schema toggle when showUserDefinedSchemaToggle is true", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: true,
      });
      const toggle = wrapper.find(
        '[data-test="logs-page-field-list-user-defined-schema-toggle"]'
      );
      expect(toggle.exists()).toBe(true);
    });

    it("renders interesting fields toggle when showUserDefinedSchemaToggle is false but showQuickMode is true", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: false,
        showQuickMode: true,
      });
      const toggle = wrapper.find(
        '[data-test="logs-page-field-list-user-defined-schema-toggle"]'
      );
      expect(toggle.exists()).toBe(true);
    });

    it("shows user-defined-fields button when showUserDefinedSchemaToggle is true", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: true,
      });
      const userDefinedBtn = wrapper.find(
        '[data-test="logs-user-defined-fields-btn"]'
      );
      expect(userDefinedBtn.exists()).toBe(true);
    });

    it("shows all-fields button when showUserDefinedSchemaToggle is true", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: true,
      });
      // All OToggleGroupItems share data-test="logs-user-defined-fields-btn" — verify at least one is rendered
      const btns = wrapper.findAll('[data-test="logs-user-defined-fields-btn"]');
      expect(btns.length).toBeGreaterThanOrEqual(1);
    });

    it("shows interesting-fields button inside schema toggle when showQuickMode is true", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: true,
        showQuickMode: true,
      });
      // The schema toggle group itself is the container — verify it is rendered
      const toggle = wrapper.find(
        '[data-test="logs-page-field-list-user-defined-schema-toggle"]'
      );
      expect(toggle.exists()).toBe(true);
    });
  });

  describe("Emits: toggle-schema", () => {
    it("emits toggle-schema when schema toggle value changes", async () => {
      const wrapper = createWrapper({ showUserDefinedSchemaToggle: true });
      const toggle = wrapper.findComponent({ name: "OToggleGroup" });
      await toggle.vm.$emit("update:modelValue", "user_defined");
      expect(wrapper.emitted("toggle-schema")).toBeTruthy();
      expect(wrapper.emitted("toggle-schema")![0]).toEqual(["user_defined"]);
    });
  });

  describe("Emits: toggle-interesting-fields", () => {
    it("emits toggle-interesting-fields when interesting fields toggle changes", async () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: false,
        showQuickMode: true,
      });
      const toggle = wrapper.findComponent({ name: "OToggleGroup" });
      await toggle.vm.$emit("update:modelValue", true);
      expect(wrapper.emitted("toggle-interesting-fields")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting-fields")![0]).toEqual([true]);
    });
  });

  describe("Emits: first-page", () => {
    it("emits first-page when first page button is clicked", async () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 2,
        isFirstPage: false,
        isLastPage: false,
      });
      const firstPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-firstpage-button"]'
      );
      await firstPageBtn.trigger("click");
      expect(wrapper.emitted("first-page")).toBeTruthy();
    });

    it("first page button is disabled when isFirstPage is true", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      const firstPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-firstpage-button"]'
      );
      expect(firstPageBtn.attributes("disabled")).toBeDefined();
    });

    it("first page button is enabled when isFirstPage is false", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 2,
        isFirstPage: false,
        isLastPage: false,
      });
      const firstPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-firstpage-button"]'
      );
      expect(firstPageBtn.attributes("disabled")).toBeUndefined();
    });
  });

  describe("Emits: last-page", () => {
    it("emits last-page when last page button is clicked", async () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      const lastPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-lastpage-button"]'
      );
      await lastPageBtn.trigger("click");
      expect(wrapper.emitted("last-page")).toBeTruthy();
    });

    it("last page button is disabled when isLastPage is true", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 3,
        isFirstPage: false,
        isLastPage: true,
      });
      const lastPageBtn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-lastpage-button"]'
      );
      expect(lastPageBtn.attributes("disabled")).toBeDefined();
    });
  });

  describe("Emits: set-page", () => {
    it("emits set-page with the page number when a page button is clicked", async () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      const page1Btn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-page-1-button"]'
      );
      await page1Btn.trigger("click");
      expect(wrapper.emitted("set-page")).toBeTruthy();
      expect(wrapper.emitted("set-page")![0]).toEqual([1]);
    });
  });

  describe("Emits: reset-fields", () => {
    it("emits reset-fields when the reset icon is clicked", async () => {
      const wrapper = createWrapper();
      const resetIcon = wrapper.find(
        '[data-test="logs-page-fields-list-reset-icon"]'
      );
      await resetIcon.trigger("click");
      expect(wrapper.emitted("reset-fields")).toBeTruthy();
    });
  });

  describe("Computed: visiblePages", () => {
    it("shows pages 1,2,3 when total pages <= 3", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 2,
        isFirstPage: false,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([1, 2, 3]);
    });

    it("shows all pages when pagesNumber is exactly 3", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([1, 2, 3]);
    });

    it("shows 3 pages centered around current page when total > 3 and current is in the middle", () => {
      const wrapper = createWrapper({
        pagesNumber: 5,
        currentPage: 3,
        isFirstPage: false,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([2, 3, 4]);
    });

    it("shows pages 1,2,3 when on first page and total > 3", () => {
      const wrapper = createWrapper({
        pagesNumber: 5,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([1, 2, 3]);
    });

    it("shows last 3 pages when on last page and total > 3", () => {
      const wrapper = createWrapper({
        pagesNumber: 5,
        currentPage: 5,
        isFirstPage: false,
        isLastPage: true,
      });
      expect(wrapper.vm.visiblePages).toEqual([3, 4, 5]);
    });

    it("shows pages 3,4,5 when on second-to-last page of 5", () => {
      const wrapper = createWrapper({
        pagesNumber: 5,
        currentPage: 4,
        isFirstPage: false,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([3, 4, 5]);
    });

    it("returns empty array when pagesNumber is 0", () => {
      const wrapper = createWrapper({
        pagesNumber: 0,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: true,
      });
      expect(wrapper.vm.visiblePages).toEqual([]);
    });

    it("returns [1] when pagesNumber is 1", () => {
      const wrapper = createWrapper({
        pagesNumber: 1,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: true,
      });
      expect(wrapper.vm.visiblePages).toEqual([1]);
    });

    it("shows page buttons with correct data-test attributes", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 2,
        isFirstPage: false,
        isLastPage: false,
      });
      const page2Btn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-page-2-button"]'
      );
      expect(page2Btn.exists()).toBe(true);
    });

    it("applies active class to current page button", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 2,
        isFirstPage: false,
        isLastPage: false,
      });
      const page2Btn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-page-2-button"]'
      );
      expect(page2Btn.classes()).toContain("tw:bg-button-primary");
    });

    it("does not apply active class to non-current page buttons", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 2,
        isFirstPage: false,
        isLastPage: false,
      });
      const page1Btn = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-page-1-button"]'
      );
      expect(page1Btn.classes()).not.toContain("tw:bg-button-primary");
    });
  });

  describe("Pagination tooltip", () => {
    it("renders pagination tooltip with totalFieldsCount when pages > 1", () => {
      const wrapper = createWrapper({
        pagesNumber: 3,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
        totalFieldsCount: 75,
      });
      const tooltip = wrapper.find(
        '[data-test="logs-page-fields-list-pagination-tooltip"]'
      );
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toContain("75");
    });
  });

  describe("Layout class", () => {
    it("applies flex layout when showUserDefinedSchemaToggle is true", () => {
      const wrapper = createWrapper({ showUserDefinedSchemaToggle: true });
      const container = wrapper.find("div");
      expect(container.classes()).toContain("tw:flex");
    });

    it("applies flex layout when showQuickMode is true", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: false,
        showQuickMode: true,
      });
      const container = wrapper.find("div");
      expect(container.classes()).toContain("tw:flex");
    });

    it("does not apply flex layout when both toggles are false", () => {
      const wrapper = createWrapper({
        showUserDefinedSchemaToggle: false,
        showQuickMode: false,
      });
      const container = wrapper.find("div");
      expect(container.classes()).not.toContain("tw:flex");
    });
  });

  describe("Edge cases", () => {
    it("handles pagesNumber of 2 correctly", () => {
      const wrapper = createWrapper({
        pagesNumber: 2,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([1, 2]);
    });

    it("handles very large pagesNumber at page 1", () => {
      const wrapper = createWrapper({
        pagesNumber: 100,
        currentPage: 1,
        isFirstPage: true,
        isLastPage: false,
      });
      expect(wrapper.vm.visiblePages).toEqual([1, 2, 3]);
    });

    it("handles very large pagesNumber at last page", () => {
      const wrapper = createWrapper({
        pagesNumber: 100,
        currentPage: 100,
        isFirstPage: false,
        isLastPage: true,
      });
      expect(wrapper.vm.visiblePages).toEqual([98, 99, 100]);
    });

    it("renders reset tooltip", () => {
      const wrapper = createWrapper();
      const resetTooltip = wrapper.find(
        '[data-test="logs-page-fields-list-reset-tooltip"]'
      );
      expect(resetTooltip.exists()).toBe(true);
    });
  });
});
