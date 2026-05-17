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
import FieldExpansion from "./FieldExpansion.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@quasar/extras/material-icons-outlined", () => ({
  "add": "add",
  "visibility": "visibility",
  "visibility-off": "visibility_off",
}));

vi.mock("@/components/common/FieldValuesPanel.vue", () => ({
  default: {
    name: "FieldValuesPanel",
    template: '<div class="field-values-panel-stub"></div>',
    props: [
      "fieldName",
      "fieldValues",
      "showMultiSelect",
      "defaultValuesCount",
      "theme",
    ],
    emits: [
      "add-search-term",
      "add-multiple-search-terms",
      "load-more-values",
      "search-field-values",
    ],
    expose: ["reset"],
    methods: {
      reset: vi.fn(),
    },
  },
}));

const defaultField = {
  name: "log_level",
  dataType: "Utf8",
  isSchemaField: true,
  isInterestingField: false,
  showValues: true,
  streams: ["stream1", "stream2"],
};

const defaultProps = {
  field: defaultField,
  fieldValues: {
    isLoading: false,
    values: [
      { key: "error", count: 10 },
      { key: "warn", count: 5 },
    ],
    errMsg: "",
    hasMore: false,
  },
  selectedFields: [],
  selectedStreamsCount: 2,
  theme: "light",
  showQuickMode: false,
  defaultValuesCount: 10,
};

function createWrapper(props = {}) {
  return mount(FieldExpansion, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: {
        QExpansionItem: {
          name: "QExpansionItem",
          template:
            '<div class="q-expansion-item-stub"><slot name="header" /><slot /></div>',
          props: ["modelValue", "label", "dense", "hideExpandIcon"],
          emits: ["before-show", "before-hide", "update:modelValue"],
        },
        QCard: {
          name: "QCard",
          template: '<div class="q-card-stub"><slot /></div>',
        },
        QCardSection: {
          name: "QCardSection",
          template: '<div class="q-card-section-stub"><slot /></div>',
        },
        QBtn: {
          name: "QBtn",
          template:
            '<button class="q-btn-stub" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
          emits: ["click"],
        },
        QIcon: {
          name: "QIcon",
          template:
            '<span class="OIcon-stub" :data-name="name" v-bind="$attrs" @click="$emit(\'click\', $event)"></span>',
          props: ["name", "size"],
          emits: ["click"],
        },
      },
    },
  });
}

describe("FieldExpansion", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component rendering", () => {
    it("mounts without errors", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the QExpansionItem stub", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".q-expansion-item-stub").exists()).toBe(true);
    });

    it("renders the field label header element", () => {
      const wrapper = createWrapper();
      const header = wrapper.find(
        `[data-test="logs-field-list-item-${defaultField.name}"]`
      );
      expect(header.exists()).toBe(true);
    });

    it("renders the expand button with correct data-test", () => {
      const wrapper = createWrapper();
      const expandBtn = wrapper.find(
        `[data-test="log-search-expand-${defaultField.name}-field-btn"]`
      );
      expect(expandBtn.exists()).toBe(true);
    });

    it("displays the field name text in header", () => {
      const wrapper = createWrapper();
      const headerDiv = wrapper.find(
        `[data-test="logs-field-list-item-${defaultField.name}"]`
      );
      expect(headerDiv.text()).toContain(defaultField.name);
    });

    it("renders expand icon when field has dataType and is not expanded", () => {
      const wrapper = createWrapper();
      // The chevron_right icon is shown when not expanded
      const icons = wrapper.findAll(".OIcon-stub");
      const expandIcon = icons.find(
        (i) => i.attributes("data-name") === "chevron_right"
      );
      expect(expandIcon).toBeDefined();
    });
  });

  describe("Props: isFieldSelected computed", () => {
    it("shows add-to-table icon when field is NOT in selectedFields", () => {
      const wrapper = createWrapper({ selectedFields: [] });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      expect(addIcon.exists()).toBe(true);
    });

    it("shows remove-from-table icon when field IS in selectedFields", () => {
      const wrapper = createWrapper({
        selectedFields: [defaultField.name],
      });
      const removeIcon = wrapper.find(
        `[data-test="log-search-index-list-remove-${defaultField.name}-field-btn"]`
      );
      expect(removeIcon.exists()).toBe(true);
    });

    it("hides add icon when field is selected", () => {
      const wrapper = createWrapper({
        selectedFields: [defaultField.name],
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      expect(addIcon.exists()).toBe(false);
    });

    it("hides remove icon when field is not selected", () => {
      const wrapper = createWrapper({ selectedFields: [] });
      const removeIcon = wrapper.find(
        `[data-test="log-search-index-list-remove-${defaultField.name}-field-btn"]`
      );
      expect(removeIcon.exists()).toBe(false);
    });
  });

  describe("Props: showQuickMode", () => {
    it("hides interesting field icon when showQuickMode is false", () => {
      const wrapper = createWrapper({ showQuickMode: false });
      const interestingIcon = wrapper.find(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      expect(interestingIcon.exists()).toBe(false);
    });

    it("shows interesting field icon in overlay when showQuickMode is true", () => {
      const wrapper = createWrapper({ showQuickMode: true });
      const interestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      expect(interestingIcons.length).toBeGreaterThan(0);
    });

    it("shows info icon when field isInterestingField is true", () => {
      const wrapper = createWrapper({
        showQuickMode: true,
        field: { ...defaultField, isInterestingField: true },
      });
      const icons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      const infoIcon = icons.find(
        (i) => i.attributes("data-name") === "info"
      );
      expect(infoIcon).toBeDefined();
    });

    it("shows info_outline icon when field isInterestingField is false", () => {
      const wrapper = createWrapper({
        showQuickMode: true,
        field: { ...defaultField, isInterestingField: false },
      });
      const icons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      const outlineIcon = icons.find(
        (i) => i.attributes("data-name") === "info_outline"
      );
      expect(outlineIcon).toBeDefined();
    });
  });

  describe("Props: field.isSchemaField", () => {
    it("shows the filter button when field is a schema field", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: true },
      });
      const filterBtn = wrapper.find(
        `[data-test="log-search-index-list-filter-${defaultField.name}-field-btn"]`
      );
      expect(filterBtn.exists()).toBe(true);
    });

    it("hides the filter button when field is not a schema field", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: false },
      });
      const filterBtn = wrapper.find(
        `[data-test="log-search-index-list-filter-${defaultField.name}-field-btn"]`
      );
      expect(filterBtn.exists()).toBe(false);
    });
  });

  describe("Emits: add-to-filter", () => {
    it("emits add-to-filter with correct value when filter button is clicked", async () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: true },
      });
      const filterBtn = wrapper.find(
        `[data-test="log-search-index-list-filter-${defaultField.name}-field-btn"]`
      );
      await filterBtn.trigger("click");
      expect(wrapper.emitted("add-to-filter")).toBeTruthy();
      expect(wrapper.emitted("add-to-filter")![0]).toEqual([
        `${defaultField.name}=''`,
      ]);
    });
  });

  describe("Emits: toggle-field", () => {
    it("emits toggle-field when add icon is clicked (field not selected)", async () => {
      const wrapper = createWrapper({ selectedFields: [] });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      await addIcon.trigger("click");
      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")![0]).toEqual([defaultField]);
    });

    it("emits toggle-field when remove icon is clicked (field selected)", async () => {
      const wrapper = createWrapper({
        selectedFields: [defaultField.name],
      });
      const removeIcon = wrapper.find(
        `[data-test="log-search-index-list-remove-${defaultField.name}-field-btn"]`
      );
      await removeIcon.trigger("click");
      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")![0]).toEqual([defaultField]);
    });
  });

  describe("Emits: toggle-interesting", () => {
    it("emits toggle-interesting with field and current interest status when icon is clicked", async () => {
      const fieldWithInterest = { ...defaultField, isInterestingField: false };
      const wrapper = createWrapper({
        showQuickMode: true,
        field: fieldWithInterest,
      });
      // In the overlay section, click the interesting icon
      const allInterestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      // The overlay icon is the last one (inside field_overlay div)
      const overlayIcon = allInterestingIcons[allInterestingIcons.length - 1];
      await overlayIcon.trigger("click");
      expect(wrapper.emitted("toggle-interesting")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting")![0]).toEqual([
        fieldWithInterest,
        false,
      ]);
    });
  });

  describe("Expand/Collapse behavior", () => {
    it("starts in collapsed state (isExpanded = false)", () => {
      const wrapper = createWrapper();
      // The expansion item stub gets modelValue from isExpanded ref
      // We verify the chevron_right icon is shown (not expanded)
      const icons = wrapper.findAll(".OIcon-stub");
      const chevronIcon = icons.find(
        (i) => i.attributes("data-name") === "chevron_right"
      );
      expect(chevronIcon).toBeDefined();
    });

    it("renders FieldValuesPanel inside card section", () => {
      const wrapper = createWrapper();
      const panel = wrapper.find(".field-values-panel-stub");
      expect(panel.exists()).toBe(true);
    });
  });

  describe("Props: field.dataType", () => {
    it("renders expand icon span when field has dataType", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, dataType: "Utf8" },
      });
      const expandIconSpan = wrapper.find(".field-type-container");
      expect(expandIconSpan.exists()).toBe(true);
    });

    it("does not render expand icon span when field has no dataType", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, dataType: undefined },
      });
      const expandIconSpan = wrapper.find(".field-type-container");
      expect(expandIconSpan.exists()).toBe(false);
    });
  });

  describe("Props: selectedStreamsCount and showMultiSelect", () => {
    it("passes showMultiSelect=true to FieldValuesPanel when streamsCount matches field.streams.length", () => {
      const wrapper = createWrapper({
        selectedStreamsCount: 2,
        field: { ...defaultField, streams: ["s1", "s2"] },
      });
      const panel = wrapper.findComponent({ name: "FieldValuesPanel" });
      expect(panel.props("showMultiSelect")).toBe(true);
    });

    it("passes showMultiSelect=false to FieldValuesPanel when streamsCount does not match", () => {
      const wrapper = createWrapper({
        selectedStreamsCount: 1,
        field: { ...defaultField, streams: ["s1", "s2"] },
      });
      const panel = wrapper.findComponent({ name: "FieldValuesPanel" });
      expect(panel.props("showMultiSelect")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("handles field with empty name gracefully", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, name: "" },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles null fieldValues gracefully", () => {
      const wrapper = createWrapper({ fieldValues: undefined });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles empty selectedFields array", () => {
      const wrapper = createWrapper({ selectedFields: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles selectedStreamsCount of 0", () => {
      const wrapper = createWrapper({ selectedStreamsCount: 0 });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
