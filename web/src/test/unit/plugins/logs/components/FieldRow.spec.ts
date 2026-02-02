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
import FieldRow from "@/plugins/logs/components/FieldRow.vue";
import { Quasar } from "quasar";

describe("FieldRow.vue", () => {
  const defaultProps = {
    field: {
      name: "status",
      isSchemaField: true,
      isInterestingField: false,
      showValues: false,
    },
    selectedFields: [],
    timestampColumn: "_timestamp",
    theme: "light",
    showQuickMode: false,
  };

  describe("rendering", () => {
    it("should render field name", () => {
      const wrapper = mount(FieldRow, {
        props: defaultProps,
        global: {
          plugins: [Quasar],
        },
      });

      expect(wrapper.text()).toContain("status");
    });

    it("should render with correct data-test attribute", () => {
      const wrapper = mount(FieldRow, {
        props: defaultProps,
        global: {
          plugins: [Quasar],
        },
      });

      expect(wrapper.find('[data-test="logs-field-list-item-status"]').exists()).toBe(true);
    });

    it("should show simple field for FTS keys", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            ftsKey: true,
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      expect(wrapper.find(".field-container").exists()).toBe(true);
    });

    it("should show simple field for non-schema fields", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            isSchemaField: false,
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      expect(wrapper.find(".field-container").exists()).toBe(true);
    });

    it("should show expansion slot for fields with values", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            isSchemaField: true,
            showValues: true,
          },
        },
        global: {
          plugins: [Quasar],
        },
        slots: {
          expansion: '<div class="expansion-content">Expansion</div>',
        },
      });

      expect(wrapper.find(".expansion-content").exists()).toBe(true);
      expect(wrapper.find(".field-container").exists()).toBe(false);
    });
  });

  describe("add to filter button", () => {
    it("should render add to filter button for schema fields", () => {
      const wrapper = mount(FieldRow, {
        props: defaultProps,
        global: {
          plugins: [Quasar],
        },
      });

      const addBtn = wrapper.find('[data-test="log-search-index-list-filter-status-field-btn"]');
      expect(addBtn.exists()).toBe(true);
    });

    it("should not render add to filter button for timestamp column", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            name: "_timestamp",
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      const addBtn = wrapper.find('[data-test="log-search-index-list-filter-_timestamp-field-btn"]');
      expect(addBtn.exists()).toBe(false);
    });

    it("should emit add-to-filter event when clicked", async () => {
      const wrapper = mount(FieldRow, {
        props: defaultProps,
        global: {
          plugins: [Quasar],
        },
      });

      const addBtn = wrapper.find('[data-test="log-search-index-list-filter-status-field-btn"]');
      await addBtn.trigger("click");

      expect(wrapper.emitted("add-to-filter")).toBeTruthy();
      expect(wrapper.emitted("add-to-filter")?.[0]).toEqual(["status=''"]);
    });
  });

  describe("toggle field visibility", () => {
    it("should show add icon when field is not selected", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          selectedFields: [],
        },
        global: {
          plugins: [Quasar],
        },
      });

      const addIcon = wrapper.find('[data-test="log-search-index-list-add-status-field-btn"]');
      expect(addIcon.exists()).toBe(true);

      const removeIcon = wrapper.find('[data-test="log-search-index-list-remove-status-field-btn"]');
      expect(removeIcon.exists()).toBe(false);
    });

    it("should show remove icon when field is selected", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          selectedFields: ["status"],
        },
        global: {
          plugins: [Quasar],
        },
      });

      const addIcon = wrapper.find('[data-test="log-search-index-list-add-status-field-btn"]');
      expect(addIcon.exists()).toBe(false);

      const removeIcon = wrapper.find('[data-test="log-search-index-list-remove-status-field-btn"]');
      expect(removeIcon.exists()).toBe(true);
    });

    it("should emit toggle-field when add icon clicked", async () => {
      const wrapper = mount(FieldRow, {
        props: defaultProps,
        global: {
          plugins: [Quasar],
        },
      });

      const addIcon = wrapper.find('[data-test="log-search-index-list-add-status-field-btn"]');
      await addIcon.trigger("click");

      expect(wrapper.emitted("toggle-field")).toBeTruthy();
      expect(wrapper.emitted("toggle-field")?.[0]).toEqual([defaultProps.field]);
    });

    it("should emit toggle-field when remove icon clicked", async () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          selectedFields: ["status"],
        },
        global: {
          plugins: [Quasar],
        },
      });

      const removeIcon = wrapper.find('[data-test="log-search-index-list-remove-status-field-btn"]');
      await removeIcon.trigger("click");

      expect(wrapper.emitted("toggle-field")).toBeTruthy();
    });
  });

  describe("interesting fields", () => {
    it("should not show interesting icon when quick mode is disabled", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          showQuickMode: false,
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icons = wrapper.findAll('[data-test="log-search-index-list-interesting-status-field-btn"]');
      expect(icons.length).toBe(0);
    });

    it("should show interesting icon when quick mode is enabled", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          showQuickMode: true,
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icons = wrapper.findAll('[data-test="log-search-index-list-interesting-status-field-btn"]');
      expect(icons.length).toBeGreaterThan(0);
    });

    it("should show filled icon for interesting fields", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          showQuickMode: true,
          field: {
            ...defaultProps.field,
            isInterestingField: true,
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icon = wrapper.find('.field_label [data-test="log-search-index-list-interesting-status-field-btn"]');
      expect(icon.exists()).toBe(true);
    });

    it("should show outlined icon for non-interesting fields", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          showQuickMode: true,
          field: {
            ...defaultProps.field,
            isInterestingField: false,
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icon = wrapper.find(".field_label [data-test=\"log-search-index-list-interesting-status-field-btn\"]");
      expect(icon.exists()).toBe(true);
    });

    it("should emit toggle-interesting when clicked", async () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          showQuickMode: true,
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icon = wrapper.find(".field_overlay [data-test=\"log-search-index-list-interesting-status-field-btn\"]");
      await icon.trigger("click");

      expect(wrapper.emitted("toggle-interesting")).toBeTruthy();
      expect(wrapper.emitted("toggle-interesting")?.[0]).toEqual([defaultProps.field, false]);
    });

    it("should not show interesting icon for timestamp column", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          showQuickMode: true,
          field: {
            ...defaultProps.field,
            name: "_timestamp",
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icons = wrapper.findAll('[data-test="log-search-index-list-interesting-_timestamp-field-btn"]');
      expect(icons.length).toBe(0);
    });
  });

  describe("theme support", () => {
    it("should apply light theme classes", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          theme: "light",
          showQuickMode: true,
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icon = wrapper.find(".field_label [data-test=\"log-search-index-list-interesting-status-field-btn\"]");
      expect(icon.classes()).toContain("light-dimmed");
    });

    it("should not apply light-dimmed class for dark theme", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          theme: "dark",
          showQuickMode: true,
        },
        global: {
          plugins: [Quasar],
        },
      });

      const icon = wrapper.find(".field_label [data-test=\"log-search-index-list-interesting-status-field-btn\"]");
      expect(icon.classes()).not.toContain("light-dimmed");
    });
  });

  describe("field overlay", () => {
    it("should render field overlay for non-timestamp fields", () => {
      const wrapper = mount(FieldRow, {
        props: defaultProps,
        global: {
          plugins: [Quasar],
        },
      });

      expect(wrapper.find(".field_overlay").exists()).toBe(true);
    });

    it("should not render field overlay for timestamp column", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            name: "_timestamp",
          },
        },
        global: {
          plugins: [Quasar],
        },
      });

      expect(wrapper.find(".field_overlay").exists()).toBe(false);
    });
  });

  describe("expansion slot", () => {
    it("should pass field to expansion slot", () => {
      const wrapper = mount(FieldRow, {
        props: {
          ...defaultProps,
          field: {
            ...defaultProps.field,
            isSchemaField: true,
            showValues: true,
          },
        },
        global: {
          plugins: [Quasar],
        },
        slots: {
          expansion: '<div class="expansion-slot">{{ field.name }}</div>',
        },
      });

      expect(wrapper.find(".expansion-slot").exists()).toBe(true);
    });
  });
});
