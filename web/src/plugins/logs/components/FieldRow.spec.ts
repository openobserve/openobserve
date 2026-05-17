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
import FieldRow from "./FieldRow.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      zoConfig: {
        show_fts_field_values: false,
      },
    },
  }),
}));

vi.mock("@quasar/extras/material-icons-outlined", () => ({
  "add": "add",
  "visibility": "visibility",
  "visibility-off": "visibility_off",
}));

const quasarStubs = {
  QBtn: {
    name: "QBtn",
    template:
      '<button class="q-btn-stub" :data-test="$attrs[\'data-test\']" @click.stop="$emit(\'click\', $event)"><slot /></button>',
    props: ["icon", "size", "round"],
    emits: ["click"],
  },
  QIcon: {
    name: "QIcon",
    template:
      '<span class="OIcon-stub" :data-test="$attrs[\'data-test\']" :data-name="name" @click.stop="$emit(\'click\', $event)"></span>',
    props: ["name", "size", "title"],
    emits: ["click"],
  },
};

const defaultField = {
  name: "log_level",
  isSchemaField: true,
  isInterestingField: false,
  ftsKey: false,
  showValues: true,
  dataType: "Utf8",
};

const defaultProps = {
  field: defaultField,
  selectedFields: [],
  timestampColumn: "_timestamp",
  theme: "light",
  showQuickMode: false,
};

// Default slot for the expansion (when field would use expansion)
const expansionSlot = {
  expansion: `<template #expansion="{ field }"><div class="expansion-slot-stub" :data-field-name="field.name">expansion</div></template>`,
};

function createWrapper(props = {}, slots = {}) {
  return mount(FieldRow, {
    props: { ...defaultProps, ...props },
    slots,
    global: {
      stubs: quasarStubs,
    },
  });
}

describe("FieldRow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering: simple field (ftsKey or no expansion)", () => {
    it("mounts without errors", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders simple field container when ftsKey is true", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
      });
      const container = wrapper.find(".field-container");
      expect(container.exists()).toBe(true);
    });

    it("renders simple field container when isSchemaField is false", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: false },
      });
      const container = wrapper.find(".field-container");
      expect(container.exists()).toBe(true);
    });

    it("renders simple field container when showValues is false", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, showValues: false },
      });
      const container = wrapper.find(".field-container");
      expect(container.exists()).toBe(true);
    });

    it("renders simple field container when all three conditions are false (ftsKey=false, isSchemaField=true, showValues=false)", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: false, isSchemaField: true, showValues: false },
      });
      const container = wrapper.find(".field-container");
      expect(container.exists()).toBe(true);
    });

    it("displays field name in the label", () => {
      const wrapper = createWrapper({ field: { ...defaultField, ftsKey: true } });
      const label = wrapper.find(
        `[data-test="logs-field-list-item-${defaultField.name}"]`
      );
      expect(label.exists()).toBe(true);
      expect(label.text()).toContain(defaultField.name);
    });

    it("sets title on the field container", () => {
      const wrapper = createWrapper({ field: { ...defaultField, ftsKey: true } });
      const container = wrapper.find(".field-container");
      expect(container.attributes("title")).toBe(defaultField.name);
    });
  });

  describe("Rendering: expansion slot", () => {
    it("renders expansion slot content when field is schema field with showValues and no ftsKey", () => {
      const wrapper = createWrapper(
        {
          field: {
            ...defaultField,
            ftsKey: false,
            isSchemaField: true,
            showValues: true,
          },
        },
        {
          expansion: `<template #expansion="{ field }"><div class="expansion-slot-content">slot</div></template>`,
        }
      );
      const expansionContent = wrapper.find(".expansion-slot-content");
      expect(expansionContent.exists()).toBe(true);
    });

    it("does not render simple field container when expansion slot is used", () => {
      const wrapper = createWrapper(
        {
          field: {
            ...defaultField,
            ftsKey: false,
            isSchemaField: true,
            showValues: true,
          },
        },
        {
          expansion: `<template #expansion="{ field }"><div class="expansion-slot-content">slot</div></template>`,
        }
      );
      const container = wrapper.find(".field-container");
      expect(container.exists()).toBe(false);
    });
  });

  describe("Props: isFieldSelected computed", () => {
    it("shows add-to-table icon when field is NOT in selectedFields", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        selectedFields: [],
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      expect(addIcon.exists()).toBe(true);
    });

    it("shows remove-from-table icon when field IS in selectedFields", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        selectedFields: [defaultField.name],
      });
      const removeIcon = wrapper.find(
        `[data-test="log-search-index-list-remove-${defaultField.name}-field-btn"]`
      );
      expect(removeIcon.exists()).toBe(true);
    });

    it("hides add icon when field is in selectedFields", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        selectedFields: [defaultField.name],
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      expect(addIcon.exists()).toBe(false);
    });

    it("hides remove icon when field is NOT in selectedFields", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        selectedFields: [],
      });
      const removeIcon = wrapper.find(
        `[data-test="log-search-index-list-remove-${defaultField.name}-field-btn"]`
      );
      expect(removeIcon.exists()).toBe(false);
    });
  });

  describe("Props: timestampColumn", () => {
    it("hides field_overlay for the timestamp column", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, name: "_timestamp", ftsKey: false },
        timestampColumn: "_timestamp",
      });
      const overlay = wrapper.find(".field_overlay");
      expect(overlay.exists()).toBe(false);
    });

    it("shows field_overlay for non-timestamp fields", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        timestampColumn: "_timestamp",
      });
      const overlay = wrapper.find(".field_overlay");
      expect(overlay.exists()).toBe(true);
    });

    it("hides interesting icon for timestamp column when showQuickMode is true", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, name: "_timestamp", ftsKey: false },
        timestampColumn: "_timestamp",
        showQuickMode: true,
      });
      const interestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-_timestamp-field-btn"]`
      );
      expect(interestingIcons.length).toBe(0);
    });

    it("hides add icon for timestamp column", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, name: "_timestamp", ftsKey: true },
        timestampColumn: "_timestamp",
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-_timestamp-field-btn"]`
      );
      expect(addIcon.exists()).toBe(false);
    });

    it("shows add icon for non-timestamp field", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        selectedFields: [],
        timestampColumn: "_timestamp",
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      expect(addIcon.exists()).toBe(true);
    });
  });

  describe("Props: showQuickMode", () => {
    it("hides interesting field icon in label when showQuickMode is false", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        showQuickMode: false,
      });
      const interestingIcon = wrapper.find(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      expect(interestingIcon.exists()).toBe(false);
    });

    it("shows interesting field icon in label when showQuickMode is true", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        showQuickMode: true,
      });
      const interestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      expect(interestingIcons.length).toBeGreaterThan(0);
    });

    it("shows info icon when isInterestingField is true and showQuickMode is true", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true, isInterestingField: true },
        showQuickMode: true,
      });
      const infoIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      const infoIcon = infoIcons.find(
        (i) => i.attributes("data-name") === "info"
      );
      expect(infoIcon).toBeDefined();
    });

    it("shows info_outline icon when isInterestingField is false and showQuickMode is true", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true, isInterestingField: false },
        showQuickMode: true,
      });
      const infoIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      const outlineIcon = infoIcons.find(
        (i) => i.attributes("data-name") === "info_outline"
      );
      expect(outlineIcon).toBeDefined();
    });
  });

  describe("Props: field.isSchemaField and filter button", () => {
    it("renders filter button when field is schema field and not timestamp", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: true, ftsKey: true },
        timestampColumn: "_timestamp",
      });
      const filterBtn = wrapper.find(
        `[data-test="log-search-index-list-filter-${defaultField.name}-field-btn"]`
      );
      expect(filterBtn.exists()).toBe(true);
    });

    it("does not render filter button when field is not a schema field", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: false, ftsKey: true },
      });
      const filterBtn = wrapper.find(
        `[data-test="log-search-index-list-filter-${defaultField.name}-field-btn"]`
      );
      expect(filterBtn.exists()).toBe(false);
    });

    it("does not render filter button when field name is the timestamp column", () => {
      const wrapper = createWrapper({
        field: {
          ...defaultField,
          name: "_timestamp",
          isSchemaField: true,
          ftsKey: true,
        },
        timestampColumn: "_timestamp",
      });
      const filterBtn = wrapper.find(
        `[data-test="log-search-index-list-filter-_timestamp-field-btn"]`
      );
      expect(filterBtn.exists()).toBe(false);
    });
  });

  describe("Emits: add-to-filter", () => {
    it("emits add-to-filter with correct value when filter button is clicked", async () => {
      const wrapper = createWrapper({
        field: { ...defaultField, isSchemaField: true, ftsKey: true },
        timestampColumn: "_timestamp",
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
    it("emits toggle-field with field when add icon is clicked", async () => {
      const fieldWithFts = { ...defaultField, ftsKey: true };
      const wrapper = createWrapper({
        field: fieldWithFts,
        selectedFields: [],
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      await addIcon.trigger("click");
      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")![0]).toEqual([fieldWithFts]);
    });

    it("emits toggle-field with field when remove icon is clicked", async () => {
      const fieldWithFts = { ...defaultField, ftsKey: true };
      const wrapper = createWrapper({
        field: fieldWithFts,
        selectedFields: [defaultField.name],
      });
      const removeIcon = wrapper.find(
        `[data-test="log-search-index-list-remove-${defaultField.name}-field-btn"]`
      );
      await removeIcon.trigger("click");
      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")![0]).toEqual([fieldWithFts]);
    });
  });

  describe("Emits: toggle-interesting", () => {
    it("emits toggle-interesting with field and current interest status when overlay icon is clicked", async () => {
      const fieldWithInterest = {
        ...defaultField,
        ftsKey: true,
        isInterestingField: false,
      };
      const wrapper = createWrapper({
        field: fieldWithInterest,
        showQuickMode: true,
      });
      const allInterestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      // In the overlay the icon is at the last position
      const overlayIcon = allInterestingIcons[allInterestingIcons.length - 1];
      await overlayIcon.trigger("click");
      expect(wrapper.emitted("toggle-interesting")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting")![0]).toEqual([
        fieldWithInterest,
        false,
      ]);
    });

    it("emits toggle-interesting with isInteresting=true when field is currently interesting", async () => {
      const interestingField = {
        ...defaultField,
        ftsKey: true,
        isInterestingField: true,
      };
      const wrapper = createWrapper({
        field: interestingField,
        showQuickMode: true,
      });
      const allInterestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      );
      const overlayIcon = allInterestingIcons[allInterestingIcons.length - 1];
      await overlayIcon.trigger("click");
      expect(wrapper.emitted("toggle-interesting")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting")![0]).toEqual([
        interestingField,
        true,
      ]);
    });
  });

  describe("Theme prop", () => {
    it("applies correct class for dark theme on interesting icon in label", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        showQuickMode: true,
        theme: "dark",
      });
      const labelInterestingIcon = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      )[0];
      // In dark theme the class should be '' (empty, not 'light-dimmed')
      expect(labelInterestingIcon.classes()).not.toContain("light-dimmed");
    });

    it("applies light-dimmed class for light theme on interesting icon in label", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        showQuickMode: true,
        theme: "light",
      });
      const labelInterestingIcon = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-${defaultField.name}-field-btn"]`
      )[0];
      expect(labelInterestingIcon.classes()).toContain("light-dimmed");
    });
  });

  describe("Edge cases", () => {
    it("handles field with empty name", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, name: "", ftsKey: true },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles empty selectedFields array", () => {
      const wrapper = createWrapper({ selectedFields: [] });
      expect(wrapper.exists()).toBe(true);
    });

    it("handles field where selectedFields includes a different field", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
        selectedFields: ["other_field"],
      });
      const addIcon = wrapper.find(
        `[data-test="log-search-index-list-add-${defaultField.name}-field-btn"]`
      );
      expect(addIcon.exists()).toBe(true);
    });

    it("handles ftsKey field that is also the timestamp column with showQuickMode on", () => {
      const wrapper = createWrapper({
        field: {
          ...defaultField,
          name: "_timestamp",
          ftsKey: true,
        },
        timestampColumn: "_timestamp",
        showQuickMode: true,
      });
      // No interesting icons should be shown for timestamp column
      const interestingIcons = wrapper.findAll(
        `[data-test="log-search-index-list-interesting-_timestamp-field-btn"]`
      );
      expect(interestingIcons.length).toBe(0);
    });

    it("renders field_label with correct data-test attribute", () => {
      const wrapper = createWrapper({
        field: { ...defaultField, ftsKey: true },
      });
      const label = wrapper.find(
        `[data-test="logs-field-list-item-${defaultField.name}"]`
      );
      expect(label.exists()).toBe(true);
    });
  });
});
