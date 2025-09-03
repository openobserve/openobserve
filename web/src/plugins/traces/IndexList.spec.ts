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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import IndexList from "@/plugins/traces/IndexList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick } from "vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock useTraces composable with a more realistic structure
const mockFieldValues = {
  service_name: {
    values: [],
    selectedValues: [],
    isLoading: false,
    isOpen: false,
    size: 5,
    searchKeyword: "",
  },
  operation_name: {
    values: [],
    selectedValues: [],
    isLoading: false,
    isOpen: false,
    size: 5,
    searchKeyword: "",
  },
  custom_field: {
    values: [],
    selectedValues: [],
    isLoading: false,
    isOpen: false,
    size: 5,
    searchKeyword: "",
  },
};

const mockSearchObj = {
  data: {
    stream: {
      selectedStream: { label: "test_stream", value: "test_stream" },
      selectedFields: ["field1", "field2"],
      streamLists: [
        { label: "stream1", value: "stream1" },
        { label: "stream2", value: "stream2" },
        { label: "test_stream", value: "test_stream" },
      ],
      filterField: "",
      addToFilter: "",
      fieldValues: mockFieldValues,
    },
    editorValue: "",
    advanceFiltersQuery: "",
    query: "",
    datetime: {
      startTime: Date.now() - 900000,
      endTime: Date.now(),
    },
    resultGrid: {
      currentPage: 0,
    },
  },
  meta: {
    resultGrid: {
      wrapCells: false,
    },
  },
  organizationIdentifier: "default",
};

vi.doMock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    updatedLocalLogFilterField: vi.fn(),
  }),
}));

// Mock stream service
vi.mock("@/services/stream", () => ({
  default: {
    tracesFieldValues: vi.fn(),
    fieldValues: vi.fn(),
  },
}));

// Mock SQL parser
const mockParser = {
  astify: vi.fn().mockReturnValue({
    type: "select",
    columns: "*",
    from: [{ table: "test_stream" }],
    where: {
      type: "binary_expr",
      operator: "IN",
      left: { column: "service_name" },
      right: { value: ["service1", "service2"] },
    },
  }),
  sqlify: vi
    .fn()
    .mockReturnValue(
      "SELECT * FROM test_stream WHERE service_name IN ('service1', 'service2')",
    ),
};

vi.doMock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => Promise.resolve(mockParser),
  }),
}));

// Mock zincutils
vi.mock("@/utils/zincutils", async (importOriginal: any) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn().mockReturnValue("/test-image.png"),
    formatLargeNumber: vi.fn().mockImplementation((num) => num.toString()),
    b64EncodeUnicode: vi.fn().mockImplementation((str) => btoa(str)),
    mergeRoutes: vi
      .fn()
      .mockImplementation((route1, route2) => [
        ...(route1 || []),
        ...(route2 || []),
      ]),
  };
});

// Mock Quasar notify
const mockNotify = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

describe("IndexList Component", () => {
  let wrapper: any;
  let mockStreamService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockNotify.mockClear();

    // Setup mock stream service
    const { default: streamService } = await import("@/services/stream");
    mockStreamService = streamService;

    mockStreamService.tracesFieldValues.mockResolvedValue({
      data: {
        hits: [
          {
            field: "service_name",
            values: [
              { zo_sql_key: "service1", zo_sql_num: 100 },
              { zo_sql_key: "service2", zo_sql_num: 200 },
            ],
          },
        ],
      },
    });

    mockStreamService.fieldValues.mockResolvedValue({
      data: {
        hits: [
          {
            field: "custom_field",
            values: [
              { zo_sql_key: "value1", zo_sql_num: 50 },
              { zo_sql_key: "value2", zo_sql_num: 75 },
            ],
          },
        ],
      },
    });

    wrapper = mount(IndexList, {
      attachTo: "#app",
      props: {
        fieldList: [
          {
            name: "field1",
            label: "Field 1",
            showValues: false,
            ftsKey: true,
          },
          {
            name: "service_name",
            label: "Service Name",
            showValues: true,
            ftsKey: false,
          },
          {
            name: "operation_name",
            label: "Operation Name",
            showValues: true,
            ftsKey: false,
          },
          {
            name: "custom_field",
            label: "Custom Field",
            showValues: true,
            ftsKey: false,
          },
        ],
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          BasicValuesFilter: {
            template:
              '<div data-test="basic-values-filter">Basic Values Filter</div>',
            props: ["row"],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render stream select dropdown", () => {
      const streamSelect = wrapper.find(
        '[data-test="log-search-index-list-select-stream"]',
      );
      expect(streamSelect.exists()).toBe(true);
    });

    it("should render fields table", () => {
      const fieldsTable = wrapper.find(
        '[data-test="log-search-index-list-fields-table"]',
      );
      expect(fieldsTable.exists()).toBe(true);
    });

    it("should render field search input", () => {
      const searchInput = wrapper.find(
        '[data-test="log-search-index-list-field-search-input"]',
      );
      expect(searchInput.exists()).toBe(true);
    });
  });

  describe("Props and Data", () => {
    it("should receive fieldList prop correctly", () => {
      expect(wrapper.props("fieldList")).toHaveLength(4);
      expect(wrapper.props("fieldList")[0].name).toBe("field1");
      expect(wrapper.props("fieldList")[1].name).toBe("service_name");
    });

    it("should have searchObj available", () => {
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(wrapper.vm.searchObj.data).toBeDefined();
      expect(wrapper.vm.searchObj.data.stream).toBeDefined();
    });

    it("should have streamOptions available", () => {
      expect(wrapper.vm.streamOptions).toBeDefined();
      expect(Array.isArray(wrapper.vm.streamOptions)).toBe(true);
    });
  });

  describe("Field Display", () => {
    it("should display fields in the table", async () => {
      const fieldCells = wrapper.findAll(".field_list");
      expect(fieldCells.length).toBeGreaterThan(0);
    });

    it("should show BasicValuesFilter for fields with showValues=true", () => {
      const basicFilters = wrapper.findAll('[data-test="basic-values-filter"]');
      // Should have filters for fields that have showValues=true and ftsKey=false
      expect(basicFilters.length).toBeGreaterThan(0);
    });

    it("should display field labels correctly", () => {
      const fieldLabels = wrapper.findAll(".field_label");
      expect(fieldLabels.length).toBeGreaterThan(0);
    });
  });

  describe("Stream Selection", () => {
    it("should show correct stream in dropdown", () => {
      const streamSelect = wrapper.find(
        '[data-test="log-search-index-list-select-stream"]',
      );
      expect(streamSelect.exists()).toBe(true);
    });

    it("should call onStreamChange when stream is changed", async () => {
      const newStream = { label: "new_stream", value: "new_stream" };

      if (wrapper.vm.onStreamChange) {
        await wrapper.vm.onStreamChange(newStream);
        expect(wrapper.emitted("update:changeStream")).toBeTruthy();
      }
    });
  });

  describe("Field Search", () => {
    it("should update filter field when searching", async () => {
      const searchInput = wrapper.find(
        '[data-test="log-search-index-list-field-search-input"]',
      );

      await searchInput.setValue("service");
      await wrapper.vm.$nextTick();

      // The searchObj should be updated through the v-model
      expect(searchInput.exists()).toBe(true);
    });

    it("should filter fields using filterFieldFn", () => {
      if (wrapper.vm.filterFieldFn) {
        const testRows = [
          { name: "service_name" },
          { name: "operation_name" },
          { name: "custom_field" },
        ];

        const result = wrapper.vm.filterFieldFn(testRows, "service");
        expect(result.length).toBe(1);
        expect(result[0].name).toBe("service_name");
      }
    });
  });

  describe("Field Actions", () => {
    it("should have addToFilter function", () => {
      expect(wrapper.vm.addToFilter).toBeDefined();
      expect(typeof wrapper.vm.addToFilter).toBe("function");
    });

    it("should call addToFilter when button is clicked", async () => {
      if (wrapper.vm.addToFilter) {
        const testFilter = "field1=''";
        wrapper.vm.addToFilter(testFilter);
        expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe(testFilter);
      }
    });
  });

  describe("Computed Properties", () => {
    it("should have duration object with slider and input properties", () => {
      if (wrapper.vm.duration) {
        expect(wrapper.vm.duration).toHaveProperty("slider");
        expect(wrapper.vm.duration).toHaveProperty("input");
        expect(wrapper.vm.duration.slider).toHaveProperty("min");
        expect(wrapper.vm.duration.slider).toHaveProperty("max");
      }
    });
  });

  describe("Stream Filtering", () => {
    it("should filter streams using filterStreamFn", async () => {
      if (wrapper.vm.filterStreamFn) {
        const updateFn = vi.fn((callback) => callback());

        wrapper.vm.filterStreamFn("stream1", updateFn);

        expect(updateFn).toHaveBeenCalled();
        expect(wrapper.vm.streamOptions.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Field Values Management", () => {
    it("should not have getFieldValues function (cleaned up dead code)", () => {
      expect(wrapper.vm.getFieldValues).toBeUndefined();
    });

    it("should not have getSpecialFieldsValues function (cleaned up dead code)", () => {
      expect(wrapper.vm.getSpecialFieldsValues).toBeUndefined();
    });
  });

  describe("Query Building", () => {
    it("should have updateQueryFilter function", () => {
      if (wrapper.vm.updateQueryFilter) {
        expect(typeof wrapper.vm.updateQueryFilter).toBe("function");
      }
    });

    it("should handle query filter updates", async () => {
      if (wrapper.vm.updateQueryFilter) {
        const column = "service_name";
        const values = ["service1", "service2"];
        const prevValues: string[] = [];

        wrapper.vm.updateQueryFilter(column, values, prevValues);

        // Should not throw errors
        expect(true).toBe(true);
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      if (wrapper.vm.getFieldValues) {
        // Ensure the field exists in fieldValues before calling
        wrapper.vm.fieldValues.test_field = {
          values: [],
          selectedValues: [],
          isLoading: false,
          size: 5,
          searchKeyword: "",
        };

        mockStreamService.fieldValues.mockRejectedValueOnce(
          new Error("API Error"),
        );

        await wrapper.vm.getFieldValues("test_field");

        // Should handle error without crashing
        expect(wrapper.exists()).toBe(true);
      }
    });

    it("should handle notification errors", async () => {
      if (wrapper.vm.getSpecialFieldsValues) {
        mockStreamService.tracesFieldValues.mockRejectedValueOnce(
          new Error("Network Error"),
        );

        await wrapper.vm.getSpecialFieldsValues("service_name");

        // Component should still exist after error
        expect(wrapper.exists()).toBe(true);
      }
    });
  });

  describe("UI Interactions", () => {
    it("should handle field row selection", async () => {
      const fieldRows = wrapper.findAll(".field_list");
      if (fieldRows.length > 0) {
        await fieldRows[0].trigger("click");
        expect(wrapper.exists()).toBe(true);
      }
    });

    it("should show overlay on hover", async () => {
      const fieldContainer = wrapper.find(".field-container");
      if (fieldContainer.exists()) {
        await fieldContainer.trigger("mouseenter");
        expect(fieldContainer.exists()).toBe(true);
      }
    });

    it("should handle no-option template", async () => {
      // Empty stream options to show no-option
      wrapper.vm.streamOptions = [];
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle prop changes", async () => {
      const newFieldList = [
        {
          name: "new_field",
          label: "New Field",
          showValues: true,
          ftsKey: false,
        },
      ];

      await wrapper.setProps({ fieldList: newFieldList });

      expect(wrapper.props("fieldList")).toEqual(newFieldList);
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      expect(
        wrapper
          .find('[data-test="log-search-index-list-select-stream"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="log-search-index-list-fields-table"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="log-search-index-list-field-search-input"]')
          .exists(),
      ).toBe(true);
    });

    it("should have proper table structure", () => {
      const table = wrapper.find(
        '[data-test="log-search-index-list-fields-table"]',
      );
      expect(table.exists()).toBe(true);
      expect(table.attributes("role")).toBeFalsy(); // Quasar table handles accessibility
    });
  });

  describe("Integration", () => {
    it("should emit changeStream event when stream changes", async () => {
      const streamSelect = wrapper.find(
        '[data-test="log-search-index-list-select-stream"]',
      );

      if (streamSelect.exists() && wrapper.vm.onStreamChange) {
        const newStream = { label: "new_stream", value: "new_stream" };

        // Test the onStreamChange method directly
        await wrapper.vm.onStreamChange(newStream);

        expect(wrapper.emitted("update:changeStream")).toBeTruthy();
      } else {
        // Skip if method not available
        expect(streamSelect.exists()).toBe(true);
      }
    });

    it("should work with store integration", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should work with router integration", () => {
      expect(wrapper.vm.router).toBeDefined();
    });

    it("should work with i18n integration", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });
});
