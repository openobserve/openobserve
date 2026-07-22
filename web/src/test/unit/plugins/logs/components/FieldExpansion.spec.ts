// Copyright 2026 OpenObserve Inc.
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
import FieldExpansion from "@/components/common/FieldExpansion.vue";
import i18n from "@/locales";

// Stub FieldValuesPanel so we can inspect passed props
const FieldValuesPanelStub = {
  name: "FieldValuesPanel",
  template: '<div class="field-values-panel-stub" />',
  props: [
    "fieldName",
    "fieldValues",
    "showMultiSelect",
    "defaultValuesCount",
    "theme",
    "activeIncludeValues",
    "activeExcludeValues",
  ],
  emits: [
    "add-search-term",
    "add-multiple-search-terms",
    "remove-field-filter",
    "load-more-values",
    "search-field-values",
  ],
};

// Stub OCollapsible: renders trigger + content when open
const OCollapsibleStub = {
  name: "OCollapsible",
  template: `
    <div class="o-collapsible-stub">
      <div class="collapsible-trigger" @click="$emit('update:modelValue', !modelValue)">
        <slot name="trigger" />
      </div>
      <div v-if="modelValue" class="collapsible-content">
        <slot />
      </div>
    </div>
  `,
  props: ["modelValue"],
  emits: ["update:modelValue"],
};

describe("FieldExpansion.vue", () => {
  const defaultProps = {
    field: {
      name: "status",
      isSchemaField: true,
      isInterestingField: false,
      streams: ["logs"],
    },
    fieldValues: {
      isLoading: false,
      values: [
        { key: "200", count: 1500 },
        { key: "404", count: 250 },
        { key: "500", count: 50 },
      ],
    },
    selectedFields: [],
    selectedStreamsCount: 1,
    theme: "light",
    showQuickMode: true,
  };

  function createWrapper(overrides: Record<string, unknown> = {}) {
    return mount(FieldExpansion, {
      props: { ...defaultProps, ...overrides },
      global: {
        plugins: [i18n],
        stubs: {
          OCollapsible: OCollapsibleStub,
          FieldValuesPanel: FieldValuesPanelStub,
          OButton: {
            template:
              '<button class="o-btn-stub" @click="$emit(\'click\', $event)"><slot /></button>',
            props: ["variant", "size", "disabled"],
            emits: ["click"],
          },
          OIcon: {
            template: '<span class="o-icon-stub" :data-icon-name="name" />',
            props: ["name", "size", "title"],
          },
        },
      },
    });
  }

  describe("rendering", () => {
    it("renders field name", () => {
      const wrapper = createWrapper();
      expect(wrapper.text()).toContain("status");
    });

    it("renders expand button with data-test", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="log-search-expand-status-field-btn"]').exists(),
      ).toBe(true);
    });

    it("renders FieldValuesPanel with mapped field values", () => {
      const wrapper = createWrapper({ expanded: true });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.exists()).toBe(true);
      expect(fvp.props("fieldValues")).toEqual({
        isLoading: false,
        values: [
          { key: "200", count: 1500 },
          { key: "404", count: 250 },
          { key: "500", count: 50 },
        ],
      });
    });

    it("passes fieldValues with truthy values to FieldValuesPanel", () => {
      const wrapper = createWrapper({
        expanded: true,
        fieldValues: {
          isLoading: false,
          values: [
            { key: "200", count: 1500 },
            { key: "404", count: 250 },
            { key: "500", count: 50 },
          ],
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("fieldValues").values).toHaveLength(3);
    });
  });

  describe("loading state", () => {
    it("passes isLoading to FieldValuesPanel", () => {
      const wrapper = createWrapper({
        expanded: true,
        fieldValues: {
          isLoading: true,
          values: [],
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("fieldValues").isLoading).toBe(true);
    });

    it("still passes values when loading", () => {
      const wrapper = createWrapper({
        expanded: true,
        fieldValues: {
          isLoading: true,
          values: [{ key: "test", count: 100 }],
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("fieldValues").isLoading).toBe(true);
      expect(fvp.props("fieldValues").values).toHaveLength(1);
    });
  });

  describe("empty state", () => {
    it("passes empty values and errMsg to FieldValuesPanel", () => {
      const wrapper = createWrapper({
        expanded: true,
        fieldValues: {
          isLoading: false,
          values: [],
          errMsg: "Failed to fetch values",
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("fieldValues").values).toEqual([]);
      expect(fvp.props("fieldValues").errMsg).toBe("Failed to fetch values");
    });

    it("passes undefined errMsg when not provided", () => {
      const wrapper = createWrapper({
        expanded: true,
        fieldValues: {
          isLoading: false,
          values: [],
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("fieldValues").errMsg).toBeUndefined();
    });
  });

  describe("field selection", () => {
    it("shows add icon when field is not selected", () => {
      const wrapper = createWrapper({ selectedFields: [] });

      const addIcon = wrapper.find(
        '[data-test="log-search-index-list-add-status-field-btn"]',
      );
      expect(addIcon.exists()).toBe(true);

      const removeIcon = wrapper.find(
        '[data-test="log-search-index-list-remove-status-field-btn"]',
      );
      expect(removeIcon.exists()).toBe(false);
    });

    it("shows remove icon when field is selected", () => {
      const wrapper = createWrapper({ selectedFields: ["status"] });

      const addIcon = wrapper.find(
        '[data-test="log-search-index-list-add-status-field-btn"]',
      );
      expect(addIcon.exists()).toBe(false);

      const removeIcon = wrapper.find(
        '[data-test="log-search-index-list-remove-status-field-btn"]',
      );
      expect(removeIcon.exists()).toBe(true);
    });

    it("emits toggle-field when add icon is clicked", async () => {
      const wrapper = createWrapper({ selectedFields: [] });

      const addIcon = wrapper.find(
        '[data-test="log-search-index-list-add-status-field-btn"]',
      );
      await addIcon.trigger("click");

      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")?.[0]).toEqual([
        defaultProps.field,
      ]);
    });

    it("emits toggle-field when remove icon is clicked", async () => {
      const wrapper = createWrapper({ selectedFields: ["status"] });

      const removeIcon = wrapper.find(
        '[data-test="log-search-index-list-remove-status-field-btn"]',
      );
      await removeIcon.trigger("click");

      expect(wrapper.emitted("toggle-field")).toBeTruthy();
    });
  });

  describe("interesting fields", () => {
    it("shows info icon for interesting fields", () => {
      const wrapper = createWrapper({
        field: {
          ...defaultProps.field,
          isInterestingField: true,
        },
      });

      const icon = wrapper.find(
        '[data-test="log-search-index-list-interesting-status-field-btn"]',
      );
      expect(icon.exists()).toBe(true);
    });

    it("shows info-outline for non-interesting fields", () => {
      const wrapper = createWrapper({
        field: {
          ...defaultProps.field,
          isInterestingField: false,
        },
      });

      const icon = wrapper.find(
        '[data-test="log-search-index-list-interesting-status-field-btn"]',
      );
      expect(icon.exists()).toBe(true);
    });

    it("emits toggle-interesting when interesting icon is clicked", async () => {
      const wrapper = createWrapper({
        field: {
          ...defaultProps.field,
          isInterestingField: false,
        },
      });

      const icon = wrapper.find(
        '[data-test="log-search-index-list-interesting-status-field-btn"]',
      );
      await icon.trigger("click");

      expect(wrapper.emitted("toggle-interesting")).toBeTruthy();
    });
  });

  describe("events", () => {
    it("emits add-to-filter when filter button is clicked", async () => {
      const wrapper = createWrapper();

      const filterBtn = wrapper.find(
        '[data-test="log-search-index-list-filter-status-field-btn"]',
      );
      expect(filterBtn.exists()).toBe(true);
      await filterBtn.trigger("click");

      expect(wrapper.emitted("add-to-filter")).toBeTruthy();
      expect(wrapper.emitted("add-to-filter")?.[0]).toEqual(["status=''"]);
    });

    it("emits before-show when collapsible expands", async () => {
      const wrapper = createWrapper({ expanded: false });

      const trigger = wrapper.find(".collapsible-trigger");
      await trigger.trigger("click");

      expect(wrapper.emitted("before-show")).toBeTruthy();
      expect(wrapper.emitted("before-show")?.[0]).toEqual([
        null,
        defaultProps.field,
      ]);
    });

    it("stays collapsed when expanded prop is false", () => {
      const wrapper = createWrapper({ expanded: false });
      expect(wrapper.find(".collapsible-content").exists()).toBe(false);
    });

    it("shows content when expanded prop is true", () => {
      const wrapper = createWrapper({ expanded: true });
      expect(wrapper.find(".collapsible-content").exists()).toBe(true);
    });
  });

  describe("quick mode", () => {
    it("shows interesting field icon when showQuickMode is true", () => {
      const wrapper = createWrapper({ showQuickMode: true });

      const icon = wrapper.find(
        '[data-test="log-search-index-list-interesting-status-field-btn"]',
      );
      expect(icon.exists()).toBe(true);
    });

    it("hides interesting field icon when showQuickMode is false", () => {
      const wrapper = createWrapper({ showQuickMode: false });

      const icon = wrapper.find(
        '[data-test="log-search-index-list-interesting-status-field-btn"]',
      );
      expect(icon.exists()).toBe(false);
    });
  });

  describe("theme support", () => {
    it("renders with dark theme prop", () => {
      const wrapper = createWrapper({ theme: "dark" });
      expect(wrapper.exists()).toBe(true);
    });

    it("renders with light theme prop", () => {
      const wrapper = createWrapper({ theme: "light" });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("showMultiSelect", () => {
    it("passes showMultiSelect=true when selectedStreamsCount matches field streams length", () => {
      const wrapper = createWrapper({
        expanded: true,
        selectedStreamsCount: 1,
        field: {
          ...defaultProps.field,
          streams: ["logs"],
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("showMultiSelect")).toBe(true);
    });

    it("passes showMultiSelect=false when stream counts do not match", () => {
      const wrapper = createWrapper({
        expanded: true,
        selectedStreamsCount: 2,
        field: {
          ...defaultProps.field,
          streams: ["logs"],
        },
      });
      const fvp = wrapper.findComponent(FieldValuesPanelStub);
      expect(fvp.props("showMultiSelect")).toBe(false);
    });
  });
});
