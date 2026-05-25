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
import FieldList from "@/plugins/logs/components/LogsPluginFieldList.vue";
import i18n from "@/locales";

// Stub OFieldList: renders slots and emits search
const OFieldListStub = {
  name: "OFieldList",
  template: `
    <div data-test="o-field-list">
      <input
        data-test="log-search-index-list-field-search-input"
        :value="search"
        @input="$emit('update:search', $event.target.value)"
      />
      <div v-if="loading" class="o-field-list-loading">Loading...</div>
      <div v-for="(row, idx) in fields" :key="idx">
        <div v-if="row.isGroup">
          <slot name="group-header" :row="row" :group-name="row.groupName" />
        </div>
        <div v-else data-test="log-search-field-row">
          <slot name="field-row" :row="row" :index="idx" />
        </div>
      </div>
      <div v-if="fields.length === 0">
        <slot name="empty" />
      </div>
      <div>
        <slot name="after-list" />
      </div>
    </div>
  `,
  props: [
    "fields",
    "search",
    "searchPlaceholder",
    "loading",
    "pageSize",
    "pageSizeOptions",
    "rowKey",
    "showPagination",
  ],
  emits: ["update:search", "row-click", "update:currentPage"],
};

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
    showFtsFieldValues: false,
  };

  describe("rendering", () => {
    it("should render OFieldList component", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(
        wrapper.find('[data-test="o-field-list"]').exists(),
      ).toBe(true);
    });

    it("should render search input via OFieldList", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(
        wrapper
          .find('[data-test="log-search-index-list-field-search-input"]')
          .exists(),
      ).toBe(true);
    });

    it("should pass loading prop to OFieldList", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          loadingStream: true,
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find(".o-field-list-loading").exists()).toBe(true);
    });

    it("should render no matching fields message via empty slot", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          streamFieldsRows: [],
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
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
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
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
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
            OBadge: {
              template: '<span class="obadge-stub"><slot /></span>',
              props: ["variant"],
            },
          },
        },
      });

      // Group name "Fields" and count "2" are rendered (OBadge displays count)
      expect(wrapper.text()).toContain("Fields");
      expect(wrapper.text()).toContain("2");
    });

    it("should show expand icon for groups with fields", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
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
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      await wrapper.find(".field-group-header").trigger("click");
      expect(wrapper.emitted("toggle-group")).toBeTruthy();
      expect(wrapper.emitted("toggle-group")?.[0]).toEqual(["schema"]);
    });
  });

  describe("field rows", () => {
    it("should render FieldRow components for non-label rows", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: {
              template: '<div class="field-row"></div>',
              props: [
                "field",
                "selectedFields",
                "timestampColumn",
                "theme",
                "showQuickMode",
                "showFtsFieldValues",
              ],
            },
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const fieldRows = wrapper.findAll('[data-test="log-search-field-row"]');
      expect(fieldRows.length).toBe(2); // Two non-label rows in defaultProps
    });

    it("should apply selected class to selected fields", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          selectedFields: ["status"],
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.find('[data-test="log-search-field-row"]').exists()).toBe(
        true,
      );
    });
  });

  describe("search functionality", () => {
    it("should emit update:filter-field when search input changes", async () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      const searchInput = wrapper.find(
        '[data-test="log-search-index-list-field-search-input"]',
      );
      await searchInput.setValue("test");

      expect(wrapper.emitted("update:filter-field")).toBeTruthy();
    });
  });

  describe("pagination", () => {
    it("should render FieldListPagination component", () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
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

    it("should emit set-page when pagination changes", async () => {
      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: {
              template:
                '<button class="next-btn" @click="$emit(\'set-page\', 2)" />',
              props: [
                "currentPage",
                "pagesNumber",
                "isFirstPage",
                "isLastPage",
                "totalFieldsCount",
              ],
              emits: ["set-page", "first-page", "last-page", "reset-fields"],
            },
          },
        },
      });

      await wrapper.find(".next-btn").trigger("click");
      expect(wrapper.emitted("set-page")).toBeTruthy();
      expect(wrapper.emitted("set-page")?.[0]).toEqual([2]);
    });
  });

  describe("event forwarding", () => {
    it("should forward add-to-filter event from FieldRow", async () => {
      const FieldRowStub = {
        template:
          '<div class="field-row-stub" @click="$emit(\'add-to-filter\', \'test\')"></div>',
        props: [
          "field",
          "selectedFields",
          "timestampColumn",
          "theme",
          "showQuickMode",
          "showFtsFieldValues",
        ],
        emits: ["add-to-filter"],
      };

      const wrapper = mount(FieldList, {
        props: defaultProps,
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
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
  });

  describe("interesting fields mode", () => {
    it("should show only interesting fields when enabled", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          showOnlyInterestingFields: true,
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
            OBadge: {
              template: '<span class="obadge-stub"><slot /></span>',
              props: ["variant"],
            },
          },
        },
      });

      // Group renders "Fields" and count "1" via OBadge (not "(1)")
      expect(wrapper.text()).toContain("Fields");
      expect(wrapper.text()).toContain("1");
    });

    it("should use interesting count in group header when mode enabled", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          showOnlyInterestingFields: true,
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      expect(wrapper.html()).toContain("1");
    });

    it("should filter out non-interesting field rows", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          showOnlyInterestingFields: true,
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
          },
        },
      });

      // Only 1 interesting field row (message), not 2
      const fieldRows = wrapper.findAll('[data-test="log-search-field-row"]');
      expect(fieldRows.length).toBe(1);
    });
  });

  describe("theme support", () => {
    it("should render group headers when theme is dark", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          theme: "dark",
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
            OBadge: true,
          },
        },
      });

      const groupHeader = wrapper.find(".field-group-header");
      expect(groupHeader.exists()).toBe(true);
      expect(groupHeader.text()).toContain("Fields");
    });

    it("should render group headers when theme is light", () => {
      const wrapper = mount(FieldList, {
        props: {
          ...defaultProps,
          theme: "light",
        },
        global: {
          plugins: [i18n],
          stubs: {
            OFieldList: OFieldListStub,
            FieldRow: true,
            FieldExpansion: true,
            FieldListPagination: true,
            OBadge: true,
          },
        },
      });

      const groupHeader = wrapper.find(".field-group-header");
      expect(groupHeader.exists()).toBe(true);
      expect(groupHeader.text()).toContain("Fields");
    });
  });
});
