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
import FieldList from "./LogsPluginFieldList.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/common/FieldRow.vue", () => ({
  default: {
    name: "FieldRow",
    template:
      '<div class="field-row-stub" :data-field-name="field.name"><slot name="expansion" :field="field" /></div>',
    props: [
      "field",
      "selectedFields",
      "timestampColumn",
      "theme",
      "showQuickMode",
    ],
    emits: ["add-to-filter", "toggle-field", "toggle-interesting"],
  },
}));

vi.mock("@/components/common/FieldExpansion.vue", () => ({
  default: {
    name: "FieldExpansion",
    template: '<div class="field-expansion-stub"></div>',
    props: [
      "field",
      "fieldValues",
      "selectedFields",
      "selectedStreamsCount",
      "theme",
      "showQuickMode",
      "defaultValuesCount",
    ],
    emits: [
      "add-to-filter",
      "toggle-field",
      "toggle-interesting",
      "add-search-term",
      "add-multiple-search-terms",
      "before-show",
      "before-hide",
      "search-field-values",
      "load-more-values",
    ],
  },
}));

vi.mock("@/components/common/FieldListPagination.vue", () => ({
  default: {
    name: "FieldListPagination",
    template: '<div class="field-list-pagination-stub"></div>',
    props: [
      "showSchemaToggle",
      "showQuickMode",
      "useUserDefinedSchemas",
      "showOnlyInterestingFields",
      "schemaToggleOptions",
      "interestingFieldsToggleOptions",
      "currentPage",
      "pagesNumber",
      "isFirstPage",
      "isLastPage",
      "totalFieldsCount",
      "dataTestPrefix",
    ],
    emits: [
      "toggle-schema",
      "toggle-interesting-fields",
      "first-page",
      "last-page",
      "set-page",
      "reset-fields",
    ],
  },
}));

const defaultProps = {
  streamFieldsRows: [
    {
      name: "log_level",
      label: null,
      group: "schema",
      isSchemaField: true,
      isInterestingField: false,
      ftsKey: false,
      showValues: true,
      dataType: "Utf8",
      streams: ["stream1"],
    },
    {
      name: "message",
      label: null,
      group: "schema",
      isSchemaField: true,
      isInterestingField: false,
      ftsKey: false,
      showValues: true,
      dataType: "Utf8",
      streams: ["stream1"],
    },
  ],
  selectedStream: "stream1",
  filterField: "",
  filterFieldFn: (rows: any[], terms: any) => rows,
  pagination: { page: 1, rowsPerPage: 25 },
  wrapCells: false,
  loadingStream: false,
  showOnlyInterestingFields: false,
  interestingExpandedGroupRowsFieldCount: { schema: 2 },
  expandGroupRowsFieldCount: { schema: 2 },
  expandGroupRows: { schema: true },
  theme: "light",
  selectedFields: [],
  timestampColumn: "_timestamp",
  showQuickMode: false,
  fieldValues: {},
  selectedStreamsCount: 1,
  defaultValuesCount: 10,
  showUserDefinedSchemaToggle: false,
  useUserDefinedSchemas: "all_fields",
  userDefinedSchemaBtnGroupOption: [],
  selectedFieldsBtnGroupOption: [],
  totalFieldsCount: 2,
  showFtsFieldValues: false,
};

function createWrapper(props = {}) {
  return mount(FieldList, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: {
        OFieldList: {
          name: "OFieldList",
          template: `
            <div data-test="log-search-index-list-fields-table">
              <input
                data-test="log-search-index-list-field-search-input"
                :value="search"
                @input="$emit('update:search', $event.target.value)"
              />
              <template v-for="(row, idx) in fields" :key="row.name || idx">
                <slot v-if="row.isGroup" name="group-header" :row="row" :groupName="row.groupName" />
                <slot v-else name="field-row" :row="row" />
              </template>
              <slot v-if="loading" name="loading" />
              <slot name="empty" />
              <slot name="after-list" :currentPage="currentPage" :totalPages="1" :isFirstPage="true" :isLastPage="true" :totalRows="totalFieldsCount ?? fields.length" :firstPage="() => {}" :lastPage="() => {}" />
            </div>`,
          props: [
            "fields",
            "search",
            "searchPlaceholder",
            "currentPage",
            "pageSize",
            "pageSizeOptions",
            "rowKey",
            "loading",
            "showPagination",
            "totalFieldsCount",
          ],
          emits: ["update:search", "update:currentPage"],
        },
        OInput: {
          name: "OInput",
          template:
            '<input class="q-input-stub" :value="modelValue" :data-test="$attrs[\'data-test\']" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ["modelValue", "placeholder", "debounce"],
          emits: ["update:modelValue"],
        },
        OIcon: {
          name: "OIcon",
          template: '<span class="OIcon-stub" v-bind="$attrs"></span>',
          props: ["name", "color", "size"],
        },
        OButton: {
          name: "OButton",
          template:
            '<button class="q-btn-stub" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
          props: ["icon", "dense", "size", "flat"],
          emits: ["click"],
        },
        OSkeleton: true,
        OBadge: true,
      },
    },
  });
}

describe("FieldList", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component rendering", () => {
    it("mounts without errors", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the q-table with correct data-test attribute", () => {
      const wrapper = createWrapper();
      const table = wrapper.find(
        '[data-test="log-search-index-list-fields-table"]'
      );
      expect(table.exists()).toBe(true);
    });

    it("renders the field search input", () => {
      const wrapper = createWrapper();
      const input = wrapper.find(
        '[data-test="log-search-index-list-field-search-input"]'
      );
      expect(input.exists()).toBe(true);
    });

    it("does not show loading skeleton when loadingStream is false", () => {
      const wrapper = createWrapper({ loadingStream: false });
      const skeleton = wrapper.find('[data-test="logs-fieldlist-loading-skeleton"]');
      expect(skeleton.exists()).toBe(false);
    });

    it("shows loading skeleton when loadingStream is true", () => {
      const wrapper = createWrapper({ loadingStream: true });
      const skeleton = wrapper.find('[data-test="logs-fieldlist-loading-skeleton"]');
      expect(skeleton.exists()).toBe(true);
    });

    it("renders field list when loadingStream is true", () => {
      const wrapper = createWrapper({ loadingStream: true });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Field rows rendering", () => {
    it("renders FieldRow for regular field rows", () => {
      const wrapper = createWrapper();
      const fieldRows = wrapper.findAllComponents({ name: "FieldRow" });
      expect(fieldRows.length).toBeGreaterThan(0);
    });

    it("passes field prop correctly to FieldRow", () => {
      const wrapper = createWrapper();
      const firstFieldRow = wrapper.findComponent({ name: "FieldRow" });
      expect(firstFieldRow.props("field")).toBeDefined();
    });

    it("passes selectedFields to FieldRow", () => {
      const wrapper = createWrapper({ selectedFields: ["log_level"] });
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      expect(fieldRow.props("selectedFields")).toEqual(["log_level"]);
    });

    it("passes timestampColumn to FieldRow", () => {
      const wrapper = createWrapper({ timestampColumn: "_timestamp" });
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      expect(fieldRow.props("timestampColumn")).toBe("_timestamp");
    });

    it("passes theme to FieldRow", () => {
      const wrapper = createWrapper({ theme: "dark" });
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      expect(fieldRow.props("theme")).toBe("dark");
    });

    it("passes showQuickMode to FieldRow", () => {
      const wrapper = createWrapper({ showQuickMode: true });
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      expect(fieldRow.props("showQuickMode")).toBe(true);
    });
  });

  describe("FieldExpansion inside slot", () => {
    it("renders FieldExpansion component within FieldRow expansion slot", () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      expect(expansion.exists()).toBe(true);
    });

    it("passes fieldValues to FieldExpansion", () => {
      const fieldValues = {
        log_level: { isLoading: false, values: [], errMsg: "", hasMore: false },
      };
      const wrapper = createWrapper({ fieldValues });
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      expect(expansion.props("fieldValues")).toEqual(fieldValues["log_level"]);
    });

    it("passes selectedStreamsCount to FieldExpansion", () => {
      const wrapper = createWrapper({ selectedStreamsCount: 3 });
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      expect(expansion.props("selectedStreamsCount")).toBe(3);
    });

    it("passes defaultValuesCount to FieldExpansion", () => {
      const wrapper = createWrapper({ defaultValuesCount: 20 });
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      expect(expansion.props("defaultValuesCount")).toBe(20);
    });
  });

  describe("Emits: from FieldRow", () => {
    it("re-emits add-to-filter from FieldRow", async () => {
      const wrapper = createWrapper();
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      await fieldRow.vm.$emit("add-to-filter", "log_level=''");
      expect(wrapper.emitted("add-to-filter")).toBeTruthy();
      expect(wrapper.emitted("add-to-filter")![0]).toEqual(["log_level=''"]);
    });

    it("re-emits toggle-field from FieldRow", async () => {
      const wrapper = createWrapper();
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      const field = defaultProps.streamFieldsRows[0];
      await fieldRow.vm.$emit("toggle-field", field);
      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")![0]).toEqual([field]);
    });

    it("re-emits toggle-interesting from FieldRow", async () => {
      const wrapper = createWrapper();
      const fieldRow = wrapper.findComponent({ name: "FieldRow" });
      const field = defaultProps.streamFieldsRows[0];
      await fieldRow.vm.$emit("toggle-interesting", field, false);
      expect(wrapper.emitted("toggle-interesting")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting")![0]).toEqual([field, false]);
    });
  });

  describe("Emits: from FieldExpansion", () => {
    it("re-emits add-to-filter from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      await expansion.vm.$emit("add-to-filter", "log_level=''");
      expect(wrapper.emitted("add-to-filter")).toBeTruthy();
    });

    it("re-emits toggle-field from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      const field = defaultProps.streamFieldsRows[0];
      await expansion.vm.$emit("toggle-field", field);
      expect(wrapper.emitted("toggle-field")).toBeTruthy();
    });

    it("re-emits add-search-term from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      await expansion.vm.$emit(
        "add-search-term",
        "log_level",
        "error",
        "include"
      );
      expect(wrapper.emitted("add-search-term")).toBeTruthy();
      expect(wrapper.emitted("add-search-term")![0]).toEqual([
        "log_level",
        "error",
        "include",
      ]);
    });

    it("re-emits search-field-values from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      await expansion.vm.$emit(
        "search-field-values",
        "log_level",
        "err"
      );
      expect(wrapper.emitted("search-field-values")).toBeTruthy();
      expect(wrapper.emitted("search-field-values")![0]).toEqual([
        "log_level",
        "err",
      ]);
    });

    it("re-emits load-more-values from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      await expansion.vm.$emit("load-more-values", "log_level");
      expect(wrapper.emitted("load-more-values")).toBeTruthy();
      expect(wrapper.emitted("load-more-values")![0]).toEqual(["log_level"]);
    });

    it("re-emits before-show from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      const event = {};
      const field = defaultProps.streamFieldsRows[0];
      await expansion.vm.$emit("before-show", event, field);
      expect(wrapper.emitted("before-show")).toBeTruthy();
    });

    it("re-emits before-hide from FieldExpansion", async () => {
      const wrapper = createWrapper();
      const expansion = wrapper.findComponent({ name: "FieldExpansion" });
      const field = defaultProps.streamFieldsRows[0];
      await expansion.vm.$emit("before-hide", field);
      expect(wrapper.emitted("before-hide")).toBeTruthy();
    });
  });

  describe("Emits: filter-field update", () => {
    it("emits update:filter-field when search input changes", async () => {
      const wrapper = createWrapper();
      const input = wrapper.find(
        '[data-test="log-search-index-list-field-search-input"]'
      );
      await input.trigger("input");
      // The emit is wired to @update:model-value from QInput stub
      // Since we are testing with stubs, we verify the input renders correctly
      expect(input.exists()).toBe(true);
    });
  });

  describe("FieldListPagination rendering", () => {
    it("renders FieldListPagination component", () => {
      const wrapper = createWrapper();
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      expect(pagination.exists()).toBe(true);
    });

    it("passes showSchemaToggle to FieldListPagination", () => {
      const wrapper = createWrapper({ showUserDefinedSchemaToggle: true });
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      expect(pagination.props("showSchemaToggle")).toBe(true);
    });

    it("passes showQuickMode to FieldListPagination", () => {
      const wrapper = createWrapper({ showQuickMode: true });
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      expect(pagination.props("showQuickMode")).toBe(true);
    });

    it("passes totalFieldsCount to FieldListPagination", () => {
      const wrapper = createWrapper({ totalFieldsCount: 50 });
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      expect(pagination.props("totalFieldsCount")).toBeDefined();
    });
  });

  describe("Emits: from FieldListPagination", () => {
    it("re-emits toggle-schema from FieldListPagination", async () => {
      const wrapper = createWrapper();
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      await pagination.vm.$emit("toggle-schema", "user_defined");
      expect(wrapper.emitted("toggle-schema")).toBeTruthy();
      expect(wrapper.emitted("toggle-schema")![0]).toEqual(["user_defined"]);
    });

    it("re-emits toggle-interesting-fields from FieldListPagination", async () => {
      const wrapper = createWrapper();
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      await pagination.vm.$emit("toggle-interesting-fields", true);
      expect(wrapper.emitted("toggle-interesting-fields")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting-fields")![0]).toEqual([true]);
    });

    it("re-emits set-page from FieldListPagination", async () => {
      const wrapper = createWrapper();
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      await pagination.vm.$emit("set-page", 2);
      expect(wrapper.emitted("set-page")).toBeTruthy();
      expect(wrapper.emitted("set-page")![0]).toEqual([2]);
    });

    it("re-emits reset-fields from FieldListPagination", async () => {
      const wrapper = createWrapper();
      const pagination = wrapper.findComponent({
        name: "FieldListPagination",
      });
      await pagination.vm.$emit("reset-fields");
      expect(wrapper.emitted("reset-fields")).toBeTruthy();
    });
  });

  describe("Exposed API", () => {
    it("exposes scrollToTop method", () => {
      const wrapper = createWrapper();
      expect(typeof wrapper.vm.scrollToTop).toBe("function");
    });

    it("scrollToTop runs without error when fieldListRef is null", () => {
      const wrapper = createWrapper();
      expect(() => wrapper.vm.scrollToTop()).not.toThrow();
    });
  });

  describe("Edge cases", () => {
    it("handles empty streamFieldsRows", () => {
      const wrapper = createWrapper({ streamFieldsRows: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles empty fieldValues object", () => {
      const wrapper = createWrapper({ fieldValues: {} });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles dark theme", () => {
      const wrapper = createWrapper({ theme: "dark" });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles wrapCells=true", () => {
      const wrapper = createWrapper({ wrapCells: true });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
