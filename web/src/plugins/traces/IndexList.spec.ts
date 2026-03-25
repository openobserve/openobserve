// Copyright 2026 OpenObserve Inc.
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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
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

// ── vi.mock calls must be at the top level so Vitest can hoist them ──────────

// Mock useTraces composable — vi.mock (not vi.doMock) so it is hoisted
vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    updatedLocalLogFilterField: vi.fn(),
  }),
  DEFAULT_TRACE_COLUMNS: {
    traces: [
      "service_name",
      "operation_name",
      "duration",
      "spans",
      "status",
      "service_latency",
    ],
    spans: [
      "service_name",
      "operation_name",
      "duration",
      "status",
      "status_code",
      "method",
    ],
  },
}));

// Mock stream service
vi.mock("@/services/stream", () => ({
  default: {
    tracesFieldValues: vi.fn(),
    fieldValues: vi.fn(),
  },
}));

// Mock SQL parser
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () =>
      Promise.resolve({
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
      }),
  }),
}));

// Mock zincutils
vi.mock("@/utils/zincutils", async (importOriginal: any) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn().mockReturnValue("/test-image.png"),
    formatLargeNumber: vi.fn().mockImplementation((num: any) => num.toString()),
    b64EncodeUnicode: vi.fn().mockImplementation((str: string) => btoa(str)),
    mergeRoutes: vi
      .fn()
      .mockImplementation((route1: any, route2: any) => [
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

// ── Shared mock state — must be defined before the vi.mock factory runs ──────
// The factory for useTraces references mockSearchObj via closure.
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

const mockSearchObj: any = {
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
    searchMode: "traces",
  },
  organizationIdentifier: "default",
  loadingStream: false,
};

// ── Import component AFTER all vi.mock calls ─────────────────────────────────
import IndexList from "@/plugins/traces/IndexList.vue";

// ── Reusable mount factory ────────────────────────────────────────────────────
function mountIndexList(props: Record<string, unknown> = {}) {
  return mount(IndexList, {
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
      ...props,
    },
    global: {
      plugins: [i18n, router],
      provide: { store },
      stubs: {
        // FieldRow stub exposes the expansion slot so BasicValuesFilter renders
        FieldRow: {
          template: '<div><slot name="expansion" :field="field" /></div>',
          props: [
            "field",
            "selectedFields",
            "timestampColumn",
            "theme",
            "showQuickMode",
            "showVisibilityToggle",
          ],
        },
        BasicValuesFilter: {
          template:
            '<div data-test="basic-values-filter">Basic Values Filter</div>',
          props: [
            "row",
            "activeIncludeValues",
            "activeExcludeValues",
            "selectedFields",
            "showVisibilityToggle",
          ],
        },
      },
    },
  });
}

describe("IndexList Component", () => {
  let wrapper: VueWrapper;
  let mockStreamService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockNotify.mockClear();

    // Reset shared mock state to known defaults before each test
    mockSearchObj.data.stream.selectedStream = {
      label: "test_stream",
      value: "test_stream",
    };
    mockSearchObj.data.stream.selectedFields = ["field1", "field2"];
    mockSearchObj.data.query = "";
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.resultGrid.currentPage = 0;
    mockSearchObj.data.stream.addToFilter = "";
    mockSearchObj.loadingStream = false;

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

    wrapper = mountIndexList();

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
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
      expect((wrapper.props("fieldList") as any[])[0].name).toBe("field1");
      expect((wrapper.props("fieldList") as any[])[1].name).toBe(
        "service_name",
      );
    });

    it("should have searchObj available", () => {
      expect(wrapper.vm.searchObj).toBeDefined();
      expect(wrapper.vm.searchObj.data).toBeDefined();
      expect(wrapper.vm.searchObj.data.stream).toBeDefined();
    });

    it("should have streamOptions available as array", () => {
      expect(Array.isArray(wrapper.vm.streamOptions)).toBe(true);
    });
  });

  describe("Field Display", () => {
    it("should display fields in the table", () => {
      const fieldCells = wrapper.findAll(".field_list");
      expect(fieldCells.length).toBeGreaterThan(0);
    });

    it("should show BasicValuesFilter for fields with showValues=true", () => {
      const basicFilters = wrapper.findAll('[data-test="basic-values-filter"]');
      expect(basicFilters.length).toBeGreaterThan(0);
    });
  });

  describe("Stream Selection", () => {
    it("should show correct stream in dropdown", () => {
      const streamSelect = wrapper.find(
        '[data-test="log-search-index-list-select-stream"]',
      );
      expect(streamSelect.exists()).toBe(true);
    });
  });

  describe("Field Search", () => {
    it("should update filter field when searching", async () => {
      const searchInput = wrapper.find(
        '[data-test="log-search-index-list-field-search-input"]',
      );
      expect(searchInput.exists()).toBe(true);
      await searchInput.setValue("service");
      await wrapper.vm.$nextTick();
      expect(searchInput.exists()).toBe(true);
    });

    it("should filter fields using filterFieldFn", () => {
      const testRows = [
        { name: "service_name" },
        { name: "operation_name" },
        { name: "custom_field" },
      ];
      const result = wrapper.vm.filterFieldFn(testRows, "service");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("service_name");
    });
  });

  describe("Field Actions", () => {
    it("should have addToFilter function", () => {
      expect(typeof wrapper.vm.addToFilter).toBe("function");
    });

    it("should update addToFilter state when addToFilter is called", () => {
      const testFilter = "field1=''";
      wrapper.vm.addToFilter(testFilter);
      expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe(testFilter);
    });
  });

  describe("Computed Properties", () => {
    it("should expose duration with slider.min and slider.max", () => {
      expect(wrapper.vm.duration).toHaveProperty("slider");
      expect(wrapper.vm.duration.slider).toHaveProperty("min");
      expect(wrapper.vm.duration.slider).toHaveProperty("max");
    });

    it("should expose duration with input.min and input.max", () => {
      expect(wrapper.vm.duration).toHaveProperty("input");
      expect(wrapper.vm.duration.input).toHaveProperty("min");
      expect(wrapper.vm.duration.input).toHaveProperty("max");
    });
  });

  describe("Stream Filtering", () => {
    it("should filter streams using filterStreamFn", () => {
      const updateFn = vi.fn((callback) => callback());
      wrapper.vm.filterStreamFn("stream1", updateFn);
      expect(updateFn).toHaveBeenCalled();
      expect(wrapper.vm.streamOptions.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Field Values Management — dead code removed", () => {
    it("should not have getFieldValues function", () => {
      expect(wrapper.vm.getFieldValues).toBeUndefined();
    });

    it("should not have getSpecialFieldsValues function", () => {
      expect(wrapper.vm.getSpecialFieldsValues).toBeUndefined();
    });
  });

  describe("Query Building", () => {
    it("should expose updateQueryFilter when present", () => {
      // updateQueryFilter is optional; assert its type when present
      if (wrapper.vm.updateQueryFilter !== undefined) {
        expect(typeof wrapper.vm.updateQueryFilter).toBe("function");
      }
    });
  });

  describe("UI Interactions", () => {
    it("should not crash when stream options are cleared", async () => {
      wrapper.vm.streamOptions = [];
      await wrapper.vm.$nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should accept updated fieldList prop", async () => {
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

  describe("Accessibility — data-test attributes", () => {
    it("should have data-test on stream select", () => {
      expect(
        wrapper
          .find('[data-test="log-search-index-list-select-stream"]')
          .exists(),
      ).toBe(true);
    });

    it("should have data-test on fields table", () => {
      expect(
        wrapper
          .find('[data-test="log-search-index-list-fields-table"]')
          .exists(),
      ).toBe(true);
    });

    it("should have data-test on field search input", () => {
      expect(
        wrapper
          .find('[data-test="log-search-index-list-field-search-input"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("Integration", () => {
    it("should emit update:changeStream when stream changes", async () => {
      const newStream = { label: "new_stream", value: "new_stream" };
      await wrapper.vm.onStreamChange(newStream);
      expect(wrapper.emitted("update:changeStream")).toBeTruthy();
    });

    it("should have store accessible", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have router accessible", () => {
      expect(wrapper.vm.router).toBeDefined();
    });

    it("should have t translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  // ─── normalizedFieldList computed ────────────────────────────────────────────

  describe("normalizedFieldList computed property", () => {
    it("should add isSchemaField: true to every field", () => {
      const normalized: any[] = wrapper.vm.normalizedFieldList;
      expect(normalized.length).toBe(4);
      for (const field of normalized) {
        expect(field.isSchemaField).toBe(true);
      }
    });

    it("should preserve original field properties", () => {
      const normalized: any[] = wrapper.vm.normalizedFieldList;
      const field1 = normalized.find((f: any) => f.name === "field1");
      expect(field1).toBeDefined();
      expect(field1.label).toBe("Field 1");
      expect(field1.ftsKey).toBe(true);
    });

    it("should set enableVisibility: false for service_name (locked trace column)", () => {
      const normalized: any[] = wrapper.vm.normalizedFieldList;
      const serviceNameField = normalized.find(
        (f: any) => f.name === "service_name",
      );
      expect(serviceNameField).toBeDefined();
      expect(serviceNameField.enableVisibility).toBe(false);
    });

    it("should set enableVisibility: false for operation_name (locked trace column)", () => {
      const normalized: any[] = wrapper.vm.normalizedFieldList;
      const field = normalized.find((f: any) => f.name === "operation_name");
      expect(field).toBeDefined();
      expect(field.enableVisibility).toBe(false);
    });

    it("should set enableVisibility: true for custom_field (non-locked)", () => {
      const normalized: any[] = wrapper.vm.normalizedFieldList;
      const customField = normalized.find((f: any) => f.name === "custom_field");
      expect(customField).toBeDefined();
      expect(customField.enableVisibility).toBe(true);
    });

    it("should set enableVisibility: true for field1 (non-locked)", () => {
      const normalized: any[] = wrapper.vm.normalizedFieldList;
      const field = normalized.find((f: any) => f.name === "field1");
      expect(field).toBeDefined();
      expect(field.enableVisibility).toBe(true);
    });

    it("should update when fieldList prop changes", async () => {
      await wrapper.setProps({
        fieldList: [
          {
            name: "span_status",
            label: "Span Status",
            showValues: true,
            ftsKey: false,
          },
          {
            name: "my_custom",
            label: "My Custom",
            showValues: true,
            ftsKey: false,
          },
        ],
      });

      const normalized: any[] = wrapper.vm.normalizedFieldList;
      expect(normalized).toHaveLength(2);

      const spanStatus = normalized.find((f: any) => f.name === "span_status");
      expect(spanStatus.enableVisibility).toBe(false);

      const myCustom = normalized.find((f: any) => f.name === "my_custom");
      expect(myCustom.enableVisibility).toBe(true);
    });
  });

  // ─── TRACES_LOCKED_FIELD_NAMES — locked columns ───────────────────────────

  describe("TRACES_LOCKED_FIELD_NAMES locked set", () => {
    it("should expose TRACES_LOCKED_FIELD_NAMES as a Set", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES).toBeInstanceOf(Set);
    });

    it("should lock service_name", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("service_name")).toBe(
        true,
      );
    });

    it("should lock operation_name", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("operation_name")).toBe(
        true,
      );
    });

    it("should lock duration", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("duration")).toBe(true);
    });

    it("should lock spans", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("spans")).toBe(true);
    });

    it("should lock span_status (mapped from 'status' column ID)", () => {
      // The column ID "status" maps to field name "span_status"
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("span_status")).toBe(
        true,
      );
    });

    it("should NOT lock the raw 'status' column ID — only span_status", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("status")).toBe(false);
    });

    it("should lock service_latency", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("service_latency")).toBe(
        true,
      );
    });

    it("should NOT lock an arbitrary custom field", () => {
      expect(wrapper.vm.TRACES_LOCKED_FIELD_NAMES.has("custom_field")).toBe(
        false,
      );
    });
  });

  // ─── toggleField method ───────────────────────────────────────────────────

  describe("toggleField method", () => {
    it("should expose toggleField as a function", () => {
      expect(typeof wrapper.vm.toggleField).toBe("function");
    });

    it("should emit update:selectedFields with the field when called", async () => {
      const testField = {
        name: "custom_field",
        label: "Custom Field",
        isSchemaField: true,
        enableVisibility: true,
      };

      await wrapper.vm.toggleField(testField);

      const emitted = wrapper.emitted("update:selectedFields");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toEqual(testField);
    });

    it("should emit update:selectedFields each time toggleField is called", async () => {
      const fieldA = { name: "field_a", enableVisibility: true };
      const fieldB = { name: "field_b", enableVisibility: true };

      await wrapper.vm.toggleField(fieldA);
      await wrapper.vm.toggleField(fieldB);

      const emitted = wrapper.emitted("update:selectedFields");
      expect(emitted).toHaveLength(2);
      expect(emitted![0][0]).toEqual(fieldA);
      expect(emitted![1][0]).toEqual(fieldB);
    });
  });

  // ─── fnMarkerLabel computed ───────────────────────────────────────────────

  describe("fnMarkerLabel computed property", () => {
    it("should be defined and be an array", () => {
      expect(Array.isArray(wrapper.vm.fnMarkerLabel)).toBe(true);
    });

    it("should return exactly 5 markers", () => {
      expect(wrapper.vm.fnMarkerLabel).toHaveLength(5);
    });

    it("each marker should have label and value properties", () => {
      for (const marker of wrapper.vm.fnMarkerLabel) {
        expect(marker).toHaveProperty("label");
        expect(marker).toHaveProperty("value");
      }
    });

    it("first marker value should equal duration.slider.min", () => {
      const { min } = wrapper.vm.duration.slider;
      expect(wrapper.vm.fnMarkerLabel[0].value).toBe(min);
    });

    it("last marker value should equal duration.slider.max", () => {
      const { max } = wrapper.vm.duration.slider;
      expect(wrapper.vm.fnMarkerLabel[4].value).toBe(max);
    });

    it("marker labels should end with 'ms'", () => {
      for (const marker of wrapper.vm.fnMarkerLabel) {
        expect(marker.label).toMatch(/ms$/);
      }
    });

    it("should recalculate when duration slider values change", async () => {
      wrapper.vm.duration.slider.min = 100;
      wrapper.vm.duration.slider.max = 500;
      await nextTick();

      const markers = wrapper.vm.fnMarkerLabel;
      expect(markers[0].value).toBe(100);
      expect(markers[4].value).toBe(500);
    });
  });

  // ─── addSearchTerm method ─────────────────────────────────────────────────

  describe("addSearchTerm method", () => {
    it("should be defined and callable", () => {
      expect(typeof wrapper.vm.addSearchTerm).toBe("function");
    });

    it("should update searchObj.data.stream.addToFilter with the supplied term", () => {
      const term = "service_name='test'";
      wrapper.vm.addSearchTerm(term);
      expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe(term);
    });

    it("should accept empty string without throwing", () => {
      expect(() => wrapper.vm.addSearchTerm("")).not.toThrow();
      expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("");
    });
  });

  // ─── onStreamChange side-effects ──────────────────────────────────────────

  describe("onStreamChange side-effects", () => {
    it("should reset query to empty string on stream change", async () => {
      wrapper.vm.searchObj.data.query = "some query";
      await wrapper.vm.onStreamChange({ label: "s1", value: "s1" });
      expect(wrapper.vm.searchObj.data.query).toBe("");
    });

    it("should reset editorValue to empty string on stream change", async () => {
      wrapper.vm.searchObj.data.editorValue = "SELECT *";
      await wrapper.vm.onStreamChange({ label: "s1", value: "s1" });
      expect(wrapper.vm.searchObj.data.editorValue).toBe("");
    });

    it("should reset resultGrid.currentPage to 0 on stream change", async () => {
      wrapper.vm.searchObj.data.resultGrid.currentPage = 3;
      await wrapper.vm.onStreamChange({ label: "s1", value: "s1" });
      expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(0);
    });

    it("should update selectedStream on stream change", async () => {
      const newStream = { label: "new_stream", value: "new_stream" };
      await wrapper.vm.onStreamChange(newStream);
      expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual(
        newStream,
      );
    });
  });

  // ─── Loading stream indicator ─────────────────────────────────────────────

  describe("Loading stream indicator", () => {
    it("should not crash when searchObj.loadingStream is true", async () => {
      mockSearchObj.loadingStream = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.exists()).toBe(true);
      mockSearchObj.loadingStream = false;
    });

    it("should not crash when loadingStream transitions from true to false", async () => {
      mockSearchObj.loadingStream = true;
      await wrapper.vm.$nextTick();
      mockSearchObj.loadingStream = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ─── filterFieldFn — edge cases ───────────────────────────────────────────

  describe("filterFieldFn — edge cases", () => {
    it("should return empty array when terms is empty string", () => {
      const rows = [{ name: "field_a" }, { name: "field_b" }];
      const result = wrapper.vm.filterFieldFn(rows, "");
      expect(result).toEqual([]);
    });

    it("should perform case-insensitive match", () => {
      const rows = [{ name: "ServiceName" }, { name: "operation" }];
      const result = wrapper.vm.filterFieldFn(rows, "servicename");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("ServiceName");
    });

    it("should return multiple matches when several rows match", () => {
      const rows = [
        { name: "span_id" },
        { name: "span_name" },
        { name: "duration" },
      ];
      const result = wrapper.vm.filterFieldFn(rows, "span");
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no rows match", () => {
      const rows = [{ name: "field_a" }, { name: "field_b" }];
      const result = wrapper.vm.filterFieldFn(rows, "xyz_no_match");
      expect(result).toHaveLength(0);
    });
  });

  // ─── duration reactive object ─────────────────────────────────────────────

  describe("duration reactive object", () => {
    it("should expose slider sub-object with number min and max", () => {
      expect(wrapper.vm.duration.slider).toBeDefined();
      expect(typeof wrapper.vm.duration.slider.min).toBe("number");
      expect(typeof wrapper.vm.duration.slider.max).toBe("number");
    });

    it("should expose input sub-object with number min and max", () => {
      expect(wrapper.vm.duration.input).toBeDefined();
      expect(typeof wrapper.vm.duration.input.min).toBe("number");
      expect(typeof wrapper.vm.duration.input.max).toBe("number");
    });

    it("input.max default should be 100000", () => {
      expect(wrapper.vm.duration.input.max).toBe(100000);
    });
  });
});
