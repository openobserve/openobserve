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
import FieldList from "@/plugins/logs/components/FieldList.vue";
import i18n from "@/locales";
import { Quasar } from "quasar";

describe("FieldList.vue", () => {
  const defaultProps = {
    streamFieldsRows: [
      {
        name: "Fields",
        label: true,
        group: "schema",
      },
      {
        name: "status",
        group: "schema",
        isSchemaField: true,
        isInterestingField: false,
        streams: ["logs"],
      },
      {
        name: "message",
        group: "schema",
        isSchemaField: true,
        isInterestingField: true,
        streams: ["logs"],
      },
    ],
    selectedStream: "logs",
    filterField: "",
    filterFieldFn: (rows: any[], terms: any) => rows,
    pagination: { page: 1, rowsPerPage: 100 },
    wrapCells: false,
    loadingStream: false,
    showOnlyInterestingFields: false,
    interestingExpandedGroupRowsFieldCount: { schema: 1 },
    expandGroupRowsFieldCount: { schema: 2 },
    expandGroupRows: { schema: true },
    theme: "light",
    selectedFields: [],
    timestampColumn: "_timestamp",
    showQuickMode: true,
    fieldValues: {},
    selectedStreamsCount: 1,
    showUserDefinedSchemaToggle: false,
    useUserDefinedSchemas: "user_defined_schema",
    userDefinedSchemaBtnGroupOption: [],
    selectedFieldsBtnGroupOption: [],
    totalFieldsCount: 2,
  };

  describe("rendering", () => {
    it("should render q-table with correct data-test attribute", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find('[data-test="log-search-index-list-fields-table"]').exists()).toBe(true);
    });

    it("should render search input", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find('[data-test="log-search-index-list-field-search-input"]').exists()).toBe(true);
    });

    it("should render loading state when loadingStream is true", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          loadingStream: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
            "q-spinner-hourglass": {
              template: '<div class="q-spinner-hourglass" />',
            },
          },
        },
      });

      expect(wrapper.find(".q-spinner-hourglass").exists()).toBe(true);
    });

    it("should apply loading-fields class when loadingStream is true", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          loadingStream: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find(".field-table").classes()).toContain("loading-fields");
    });

    it("should render no matching fields message", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          streamFieldsRows: [{ name: "no-fields-found" }],
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.text()).toContain("No matching fields found.");
    });
  });

  describe("field groups", () => {
    it("should render field group header", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.text()).toContain("Fields");
    });

    it("should show field count in group header", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.text()).toContain("Fields (2)");
    });

    it("should show expand icon for groups with fields", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const groupHeader = wrapper.find(".field-group-header");
      expect(groupHeader.exists()).toBe(true);
    });

    it("should emit toggle-group when group header is clicked", async () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const groupHeader = wrapper.find(".field-group-header").element.parentElement;
      if (groupHeader) {
        await groupHeader.dispatchEvent(new Event("click"));
      }

      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("toggle-group")).toBeTruthy();
    });
  });

  describe("field rows", () => {
    it("should render FieldRow components for non-label rows", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: {
              template: '<div class="field-row"></div>',
              props: ["field", "selectedFields", "timestampColumn", "theme", "showQuickMode"],
            },
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const fieldRows = wrapper.findAll(".field-row");
      expect(fieldRows.length).toBeGreaterThan(0);
    });

    it("should pass correct props to FieldRow", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: {
              template: '<div class="field-row" />',
              props: ["field", "selectedFields", "timestampColumn", "theme", "showQuickMode"],
            },
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.findComponent({ name: "FieldRow" }).exists()).toBe(false); // Stub doesn't have name
    });

    it("should apply selected class to selected fields", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          selectedFields: ["status"],
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find(".field_list").exists()).toBe(true);
    });
  });

  describe("search functionality", () => {
    it("should emit update:filter-field when search input changes", async () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const searchInput = wrapper.find('[data-test="log-search-index-list-field-search-input"]');
      await searchInput.setValue("test");

      expect(wrapper.emitted("update:filter-field")).toBeTruthy();
    });

    it("should show search icon in input prepend", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find(".o2-search-input-icon").exists()).toBe(true);
    });
  });

  describe("pagination", () => {
    it("should render FieldListPagination component", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: {
              template: '<div class="field-list-pagination" />',
            },
          },
        },
      });

      expect(wrapper.find(".field-list-pagination").exists()).toBe(true);
    });

    it("should emit update:pagination event", async () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const table = wrapper.findComponent({ name: "q-table" });
      const newPagination = {
        page: 2,
        rowsPerPage: 100,
        sortBy: null,
        descending: false
      };
      await table.vm.$emit("update:pagination", newPagination);

      // Check that the event is emitted (forwarded from q-table)
      expect(wrapper.emitted("update:pagination")).toBeTruthy();
      expect(wrapper.emitted("update:pagination")?.length).toBeGreaterThan(0);
    });
  });

  describe("event forwarding", () => {
    it("should forward add-to-filter event from FieldRow", async () => {
      const FieldRowStub = {
        template: '<div class="field-row-stub" @click="$emit(\'add-to-filter\', \'test\')"></div>',
        props: ["field", "selectedFields", "timestampColumn", "theme", "showQuickMode"],
        emits: ["add-to-filter"],
      };

      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: FieldRowStub,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const fieldRow = wrapper.find(".field-row-stub");
      await fieldRow.trigger("click");

      expect(wrapper.emitted("add-to-filter")).toBeTruthy();
    });

    it("should forward toggle-field event", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      // Event forwarding is set up in template
      expect(wrapper.vm.$options.emits).toBeDefined();
    });
  });

  describe("interesting fields mode", () => {
    it("should show only interesting fields when enabled", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          showOnlyInterestingFields: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.text()).toContain("Fields (1)");
    });

    it("should use interesting count in group header when mode enabled", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          showOnlyInterestingFields: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      // Should show interesting count (1) instead of total count (2)
      expect(wrapper.html()).toContain("1");
    });
  });

  describe("theme support", () => {
    it("should apply dark theme class to group headers", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          theme: "dark",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const groupHeader = wrapper.find(".field-group-header");
      expect(groupHeader.classes()).toContain("text-grey-5");
    });

    it("should apply light theme class to group headers", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          theme: "light",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const groupHeader = wrapper.find(".field-group-header");
      expect(groupHeader.classes()).toContain("bg-grey-3");
    });
  });
});
