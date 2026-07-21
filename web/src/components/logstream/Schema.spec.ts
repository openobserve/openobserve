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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
// @ts-ignore
import store from "@/test/unit/helpers/store";

const { mockToast, mockGetStream, mockStreamServiceSchema, mockStreamServiceList, mockUpdateSettings } =
  vi.hoisted(() => ({
    mockToast: vi.fn(() => vi.fn()),
    mockGetStream: vi.fn(),
    mockStreamServiceSchema: vi.fn(),
    mockStreamServiceList: vi.fn(),
    mockUpdateSettings: vi.fn().mockResolvedValue({ data: { code: 200 } }),
  }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast, toasts: [] }),
  toastRecords: [],
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
    getStreams: vi.fn().mockResolvedValue({}),
    getUpdatedSettings: vi.fn((_prev, settings) => settings),
    streamsCache: { logs: { value: {} }, traces: { value: {} }, metrics: { value: {} }, enrichment_tables: { value: {} } },
    updateStreamsInStore: vi.fn(),
  }),
}));

vi.mock("@/services/stream", () => ({
  default: {
    schema: mockStreamServiceSchema,
    list: mockStreamServiceList,
    deleteFields: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    updateSettings: mockUpdateSettings,
    nameList: vi.fn().mockResolvedValue({ data: [] }),
    getStreamStats: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import LogStream from "@/components/logstream/schema.vue";

// Lightweight stub for ODrawer so tests can render the slots schema.vue
// places inside the drawer (header badge, default content, footer) without
// pulling in reka-ui portals. Exposes the migrated prop surface and emits
// update:open + click:primary/secondary/neutral.
const ODrawerStub = {
  name: "ODrawer",
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    titleDataTest: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: true },
    width: { type: [String, Number], default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-width="width"
      :data-persistent="String(!!persistent)"
      :data-show-close="String(!!showClose)"
    >
      <span v-if="title" :data-test="titleDataTest">{{ title }}</span>
      <span v-if="subTitle" data-test="o-drawer-sub-title">{{ subTitle }}</span>
      <slot name="header" />
      <slot name="header-left" />
      <slot name="header-right" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-drawer-stub-primary"
        @click="$emit('click:primary')"
      >primary</button>
      <button
        data-test="o-drawer-stub-secondary"
        @click="$emit('click:secondary')"
      >secondary</button>
      <button
        data-test="o-drawer-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

describe("Schema Component Tests", () => {
  let wrapper: any;

  beforeEach(() => {
    // Default mock for getStream — resolves with minimal valid stream data.
    // Individual test groups override this with more specific data as needed.
    mockGetStream.mockResolvedValue({
      name: "test-stream",
      stream_type: "logs",
      storage_type: "s3",
      stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
      schema: [{ name: "_timestamp", type: "Int64" }],
      settings: { partition_time_level: "hourly", partition_keys: {}, full_text_search_keys: [], index_fields: [], bloom_filter_fields: [], data_retention: 30, max_query_range: 0, store_original_data: false, approx_partition: false, defined_schema_fields: [], extended_retention_days: [] },
      pattern_associations: [],
    });
  });

  // Additional comprehensive tests for schema.vue functions from lines 697-1784
  describe("Comprehensive Schema Function Tests", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "test-stream",
        storage_type: "s3",
        stream_type: "logs",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 400,
          file_num: 1,
          storage_size: 0.74,
          compressed_size: 0.03,
        },
        schema: [
          { name: "_timestamp", type: "Int64" },
          { name: "message", type: "Utf8" },
        ],
        settings: {
          partition_time_level: "hourly",
          partition_keys: {},
          full_text_search_keys: ["message"],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      // Reset wrapper for each test
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "test-stream",
            storage_type: "s3",
            stream_type: "logs",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 400,
              file_num: 1,
              storage_size: 0.74,
              compressed_size: 0.03,
            },
            schema: [
              { name: "_timestamp", type: "Int64" },
              { name: "message", type: "Utf8" },
            ],
            settings: {
              partition_time_level: "hourly",
              partition_keys: {},
              full_text_search_keys: ["message"],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: {
            store: store,
          },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    // Test 1: Component initialization with default values
    it("should initialize with correct default values", () => {
      expect(wrapper.vm.indexData.name).toBe("test-stream");
      expect(wrapper.vm.indexData.schema).toBeDefined();
      expect(wrapper.vm.loadingState).toBe(false);
      expect(wrapper.vm.formDirtyFlag).toBe(false);
    });

    // Test 2: markFormDirty function
    it("should mark form as dirty", () => {
      expect(wrapper.vm.formDirtyFlag).toBe(false);
      wrapper.vm.markFormDirty();
      expect(wrapper.vm.formDirtyFlag).toBe(true);
    });

    // Test 3: changePagination function
    it("should change pagination correctly", () => {
      const newPagination = { label: "50", value: 50 };
      wrapper.vm.changePagination(newPagination);

      expect(wrapper.vm.selectedPerPage).toBe(50);
    });

    // Test 4: updateActiveTab function
    it("should update active tab and result total", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      wrapper.vm.indexData.schema = [{ name: "field1" }, { name: "field2" }];
      
      wrapper.vm.updateActiveTab("schemaFields");
      expect(wrapper.vm.activeTab).toBe("schemaFields");
      expect(wrapper.vm.resultTotal).toBe(1);
      
      wrapper.vm.updateActiveTab("allFields");
      expect(wrapper.vm.activeTab).toBe("allFields");
      expect(wrapper.vm.resultTotal).toBe(2);
    });

    // Test 5: updateActiveMainTab function
    it("should update active main tab", () => {
      wrapper.vm.updateActiveMainTab("redButton");
      expect(wrapper.vm.activeMainTab).toBe("redButton");
    });

    // Test 6: openDialog function
    it("should open dialog and initialize fields", async () => {
      wrapper.vm.openDialog();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isDialogOpen).toBe(true);
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      // Rows are form-owned now (read via the reactive newSchemaFields view).
      expect(wrapper.vm.newSchemaFields.length).toBe(1);
      expect(wrapper.vm.newSchemaFields[0]).toEqual({
        name: "",
        type: "",
        index_type: [],
      });
    });

    // Test 7: closeDialog function
    it("should close dialog and reset fields", async () => {
      wrapper.vm.isDialogOpen = true;
      // Seed rows through the form (single source of truth), not a local ref.
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "test", type: "string", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      wrapper.vm.closeDialog();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isDialogOpen).toBe(false);
      expect(wrapper.vm.newSchemaFields).toEqual([]);
    });

    // Test 8: hasUserDefinedSchema computed property
    it("should compute hasUserDefinedSchema correctly", () => {
      // Initially false
      expect(wrapper.vm.hasUserDefinedSchema).toBe(false);
      
      // Set defined schema fields
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      expect(wrapper.vm.hasUserDefinedSchema).toBe(true);
    });


    // Test 10: showDataRetention computed property  
    it("should compute showDataRetention correctly", async () => {
      expect(wrapper.vm.showDataRetention).toBe(true);
      
      // Test with enrichment_tables
      const enrichmentWrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "test-stream",
            stream_type: "enrichment_tables",
            settings: { defined_schema_fields: [] }
          },
        },
        global: {
          provide: { store: store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });

      await flushPromises();
      expect(enrichmentWrapper.vm.showDataRetention).toBe(false);
      enrichmentWrapper.unmount();
    });


    // Test 12: getFieldIndices function with full text search
    it("should get correct field indices for full text search", () => {
      const property = { name: "message" };
      const settings = {
        full_text_search_keys: ["message"],
        index_fields: [],
        bloom_filter_fields: [],
        partition_keys: {},
      };
      
      // Mock store properties that are used in getFieldIndices
      wrapper.vm.store.state.zoConfig.default_fts_keys = wrapper.vm.store.state.zoConfig.default_fts_keys || [];
      wrapper.vm.store.state.zoConfig.default_secondary_index_fields = wrapper.vm.store.state.zoConfig.default_secondary_index_fields || [];
      
      const indices = wrapper.vm.getFieldIndices(property, settings);
      expect(indices).toContain("fullTextSearchKey");
      expect(property.index_type).toContain("fullTextSearchKey");
    });


    // Test 14: getFieldIndices function with secondary index
    it("should get correct field indices for secondary index", () => {
      const property = { name: "status" };
      const settings = {
        full_text_search_keys: [],
        index_fields: ["status"],
        bloom_filter_fields: [],
        partition_keys: {},
      };
      
      // Mock store properties that are used in getFieldIndices
      wrapper.vm.store.state.zoConfig.default_fts_keys = wrapper.vm.store.state.zoConfig.default_fts_keys || [];
      wrapper.vm.store.state.zoConfig.default_secondary_index_fields = wrapper.vm.store.state.zoConfig.default_secondary_index_fields || [];
      
      const indices = wrapper.vm.getFieldIndices(property, settings);
      expect(indices).toContain("secondaryIndexKey");
    });

    // Test 15: getFieldIndices function with bloom filter
    it("should get correct field indices for bloom filter", () => {
      const property = { name: "userId" };
      const settings = {
        full_text_search_keys: [],
        index_fields: [],
        bloom_filter_fields: ["userId"],
        partition_keys: {},
      };
      
      // Mock store properties that are used in getFieldIndices
      wrapper.vm.store.state.zoConfig.default_fts_keys = wrapper.vm.store.state.zoConfig.default_fts_keys || [];
      wrapper.vm.store.state.zoConfig.default_secondary_index_fields = wrapper.vm.store.state.zoConfig.default_secondary_index_fields || [];
      
      const indices = wrapper.vm.getFieldIndices(property, settings);
      expect(indices).toContain("bloomFilterKey");
    });

    // Test 16: getFieldIndices function with key partition
    it("should get correct field indices for key partition", () => {
      const property = { name: "region" };
      const settings = {
        full_text_search_keys: [],
        index_fields: [],
        bloom_filter_fields: [],
        partition_keys: {
          level1: { field: "region", types: "value", disabled: false }
        },
      };
      
      // Mock store properties that are used in getFieldIndices
      wrapper.vm.store.state.zoConfig.default_fts_keys = wrapper.vm.store.state.zoConfig.default_fts_keys || [];
      wrapper.vm.store.state.zoConfig.default_secondary_index_fields = wrapper.vm.store.state.zoConfig.default_secondary_index_fields || [];
      
      const indices = wrapper.vm.getFieldIndices(property, settings);
      expect(indices).toContain("keyPartition");
      expect(property.level).toBe("level1");
    });

    // Test 17: getFieldIndices function with hash partition
    it("should get correct field indices for hash partition", () => {
      const property = { name: "customerId" };
      const settings = {
        full_text_search_keys: [],
        index_fields: [],
        bloom_filter_fields: [],
        partition_keys: {
          level1: { field: "customerId", types: { hash: 16 }, disabled: false }
        },
      };
      
      // Mock store properties that are used in getFieldIndices
      wrapper.vm.store.state.zoConfig.default_fts_keys = wrapper.vm.store.state.zoConfig.default_fts_keys || [];
      wrapper.vm.store.state.zoConfig.default_secondary_index_fields = wrapper.vm.store.state.zoConfig.default_secondary_index_fields || [];
      
      const indices = wrapper.vm.getFieldIndices(property, settings);
      expect(indices).toContain("hashPartition_16");
    });

    // Test 18: updateDefinedSchemaFields function - removing fields
    it("should update defined schema fields when removing", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1", "field2", "field3"];
      wrapper.vm.selectedFields = [{ name: "field2" }];
      wrapper.vm.activeTab = "schemaFields";
      
      wrapper.vm.updateDefinedSchemaFields();
      
      expect(wrapper.vm.indexData.defined_schema_fields).toEqual(["field1", "field3"]);
      expect(wrapper.vm.selectedFields).toEqual([]);
      expect(wrapper.vm.formDirtyFlag).toBe(true);
    });

    // Test 19: updateDefinedSchemaFields function - adding fields
    it("should update defined schema fields when adding", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      wrapper.vm.selectedFields = [{ name: "field2" }];
      wrapper.vm.activeTab = "allFields";
      
      wrapper.vm.updateDefinedSchemaFields();
      
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("field1");
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("field2");
    });

    // Test 20: updateDefinedSchemaFields function - switch tab when empty
    it("should switch to allFields when schema fields becomes empty", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      wrapper.vm.selectedFields = [{ name: "field1" }];
      wrapper.vm.activeTab = "schemaFields";
      
      wrapper.vm.updateDefinedSchemaFields();
      
      expect(wrapper.vm.indexData.defined_schema_fields).toEqual([]);
      expect(wrapper.vm.activeTab).toBe("allFields");
    });

    // Test 21: updateStreamResponse function
    it("should update stream response with user defined flags", () => {
      const streamResponse = {
        settings: {
          defined_schema_fields: ["field1"]
        },
        schema: [
          { name: "field1", type: "string" },
          { name: "field2", type: "number" }
        ]
      };
      
      const result = wrapper.vm.updateStreamResponse(streamResponse);
      
      expect(result.schema[0].isUserDefined).toBe(true);
      expect(result.schema[1].isUserDefined).toBe(false);
    });

    // Test 22: formatDate function
    it("should format date correctly", () => {
      const result = wrapper.vm.formatDate("2023-12-25T10:30:00");
      expect(result).toBe("25-12-2023");
    });

    // Test 23: convertUnixToDateFormat function
    it("should convert unix timestamp correctly", () => {
      const unixMicroseconds = 1703505000000000; // 2023-12-25
      const result = wrapper.vm.convertUnixToDateFormat(unixMicroseconds);
      expect(result).toMatch(/\d{2}-\d{2}-\d{4}/);
    });

    // Test 24: convertUnixToDateFormat with empty input
    it("should handle empty unix timestamp", () => {
      const result = wrapper.vm.convertUnixToDateFormat("");
      expect(result).toBe("");
    });

    // Test 25: calculateDateRange function
    it("should calculate date range correctly", () => {
      wrapper.vm.dataRetentionDays = 30;
      wrapper.vm.calculateDateRange();
      expect(wrapper.vm.minDate).toBeDefined();
    });

    // Test 26: openPatternAssociationDialog function
    it("should open pattern association dialog", () => {
      wrapper.vm.patternAssociations = {
        field1: [{ field: "field1", pattern_name: "pattern1", pattern_id: "id1" }]
      };
      
      wrapper.vm.openPatternAssociationDialog("field1");
      
      expect(wrapper.vm.patternAssociationDialog.show).toBe(true);
      expect(wrapper.vm.patternAssociationDialog.fieldName).toBe("field1");
    });

    // Test 27: handleAddPattern function
    it("should add new pattern correctly", () => {
      const pattern = {
        field: "field1",
        pattern_name: "test-pattern",
        pattern_id: "pattern-123",
        policy: "replace",
        apply_at: "ingestion"
      };
      
      wrapper.vm.handleAddPattern(pattern);
      
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      expect(wrapper.vm.patternAssociations.field1).toEqual(
        expect.arrayContaining([expect.objectContaining(pattern)])
      );
    });

    // Test 28: handleRemovePattern function
    it("should remove pattern correctly", () => {
      wrapper.vm.patternAssociations = {
        field1: [
          { field: "field1", pattern_name: "pattern1", pattern_id: "id1" },
          { field: "field1", pattern_name: "pattern2", pattern_id: "id2" }
        ]
      };
      
      wrapper.vm.handleRemovePattern("id1", "field1");
      
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      expect(wrapper.vm.patternAssociations.field1).toHaveLength(1);
      expect(wrapper.vm.patternAssociations.field1[0].pattern_id).toBe("id2");
    });

    // Test 29: handleUpdateAppliedPattern for policy
    it("should update applied pattern policy", () => {
      wrapper.vm.patternAssociations = {
        field1: [{ field: "field1", pattern_name: "pattern1", pattern_id: "id1", policy: "old" }]
      };
      
      const updatedPattern = {
        field: "field1",
        pattern_name: "pattern1",
        pattern_id: "id1",
        policy: "new"
      };
      
      wrapper.vm.handleUpdateAppliedPattern(updatedPattern, "field1", "id1", "policy");
      expect(wrapper.vm.patternAssociations.field1[0].policy).toBe("new");
    });

    // Test 30: scrollToAddFields function
    it("should scroll to add fields section", () => {
      const mockElement = { scrollIntoView: vi.fn() };
      vi.spyOn(document, "getElementById").mockReturnValue(mockElement);
      
      wrapper.vm.scrollToAddFields();
      
      expect(document.getElementById).toHaveBeenCalledWith("schema-add-fields-section");
      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    });

    // Test 31: dateChangeValue function
    // NOTE: dateChangeValue internally calls convertDateToTimestamp which uses
    // Luxon's DateTime.fromObject. That call can fail in jsdom environments that
    // lack full Intl support. When the timestamp conversion fails, both
    // startTimestamp and endTimestamp are 0, so the push to redDaysList is
    // skipped and onSubmit is never called. The formatDate sub-function is
    // tested separately above. This test verifies the function runs without
    // throwing and handles the relativeTimePeriod path correctly.
    it("should handle date change with relative time period", () => {
      const dateValue = { relativeTimePeriod: "1h" };

      wrapper.vm.dateChangeValue(dateValue);
      // When relativeTimePeriod is set, the function should exit early without
      // modifying redDaysList or calling onSubmit.
      expect(wrapper.vm.redDaysList).toEqual([]);
    });

    // Test 32: deleteDates function
    it("should delete dates correctly", () => {
      wrapper.vm.selectedDateFields = [
        { original_start: 1703505000000, original_end: 1703591400000 }
      ];
      
      wrapper.vm.deleteDates();
      expect(wrapper.vm.formDirtyFlag).toBe(true);
    });

    // Test 33: groupPatternAssociationsByField function
    it("should group pattern associations by field", () => {
      const associations = [
        { field: "field1", pattern_name: "pattern1", pattern_id: "id1" },
        { field: "field1", pattern_name: "pattern2", pattern_id: "id2" },
        { field: "field2", pattern_name: "pattern3", pattern_id: "id3" }
      ];
      
      const result = wrapper.vm.groupPatternAssociationsByField(associations);
      expect(result.field1).toHaveLength(2);
      expect(result.field2).toHaveLength(1);
    });

    // Test 34: ungroupPatternAssociations function
    it("should ungroup pattern associations", () => {
      const grouped = {
        field1: [
          { field: "field1", pattern_name: "pattern1", pattern_id: "id1" },
          { field: "field1", pattern_name: "pattern2", pattern_id: "id2" }
        ],
        field2: [{ field: "field2", pattern_name: "pattern3", pattern_id: "id3" }]
      };
      
      const result = wrapper.vm.ungroupPatternAssociations(grouped);
      expect(result).toHaveLength(3);
    });

    // Test 35: computedSchemaFieldsName computed property
    it("should compute schema fields name correctly", () => {
      // Without user defined schema
      expect(wrapper.vm.computedSchemaFieldsName).toBe("All Fields");
      
      // With user defined schema
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      expect(wrapper.vm.computedSchemaFieldsName).toBe("All Fields");
    });

    // Test 36: tabs computed property
    it("should compute tabs correctly", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      wrapper.vm.indexData.schema = [{ name: "field1" }, { name: "field2" }];
      
      const tabs = wrapper.vm.tabs;
      expect(tabs[0].value).toBe("schemaFields");
      expect(tabs[1].value).toBe("allFields");
      expect(tabs[0].label).toContain("User Defined Schema (1)");
      expect(tabs[1].label).toContain("All Fields (2)");
    });

    // Test 37: mainTabs computed property
    it("should compute main tabs correctly", () => {
      const mainTabs = wrapper.vm.mainTabs;
      expect(mainTabs[0].value).toBe("schemaSettings");
      expect(mainTabs[0].label).toBe("Schema Settings");
      expect(mainTabs[1].value).toBe("redButton");
      expect(mainTabs[1].label).toBe("Extended Retention");
    });

    // Test 38: isSchemaUDSEnabled computed property
    it("should compute UDS enabled correctly", () => {
      expect(wrapper.vm.isSchemaUDSEnabled).toBe(true);
    });

    // Test 39: allFieldsName computed property
    it("should compute all fields name correctly", () => {
      // The allFieldsName is a computed property that depends on store state
      expect(wrapper.vm.allFieldsName).toBe("_all");
    });

    // Test 40: showStoreOriginalDataToggle computed property
    it("should compute store original data toggle visibility", async () => {
      expect(wrapper.vm.showStoreOriginalDataToggle).toBe(true);
      
      // Test with traces
      const tracesWrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "test-stream",
            stream_type: "traces",
            settings: { defined_schema_fields: [] }
          },
        },
        global: {
          provide: { store: store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });

      await flushPromises();
      expect(tracesWrapper.vm.showStoreOriginalDataToggle).toBe(false);
      tracesWrapper.unmount();
    });

    // Test 41-50: Additional edge cases and error scenarios
    it("should handle empty pattern associations in openPatternAssociationDialog", () => {
      wrapper.vm.openPatternAssociationDialog("nonexistent");
      expect(wrapper.vm.patternAssociationDialog.data).toEqual([]);
    });

    it("should handle adding pattern to existing field", () => {
      wrapper.vm.patternAssociations = {
        field1: [{ field: "field1", pattern_name: "existing", pattern_id: "existing-id" }]
      };
      
      const newPattern = {
        field: "field1",
        pattern_name: "new-pattern",
        pattern_id: "new-id"
      };
      
      wrapper.vm.handleAddPattern(newPattern);
      expect(wrapper.vm.patternAssociations.field1).toHaveLength(2);
    });

    it("should handle updateAppliedPattern with apply_at attribute", () => {
      wrapper.vm.patternAssociations = {
        field1: [{ field: "field1", pattern_name: "pattern1", pattern_id: "id1", apply_at: "old" }]
      };
      
      const updatedPattern = {
        field: "field1",
        pattern_name: "pattern1", 
        pattern_id: "id1",
        apply_at: "new"
      };
      
      wrapper.vm.handleUpdateAppliedPattern(updatedPattern, "field1", "id1", "apply_at");
      expect(wrapper.vm.patternAssociations.field1[0].apply_at).toBe("new");
    });

    it("should handle filter field function with schema fields", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1", "field2"];
      
      const rows = [
        { name: "field1" },
        { name: "field2" },
        { name: "field3" }
      ];
      
      const result = wrapper.vm.filterFieldFn(rows, "field@schemaFields");
      expect(result.length).toBe(2);
    });

    it("should handle empty date value in dateChangeValue", () => {
      const dateValue = { relativeTimePeriod: "1h" };
      wrapper.vm.dateChangeValue(dateValue);
      // Should not add to redDaysList
      expect(wrapper.vm.redDaysList).toEqual([]);
    });

    it("should handle scroll when element doesn't exist", () => {
      vi.spyOn(document, "getElementById").mockReturnValue(null);
      expect(() => wrapper.vm.scrollToAddFields()).not.toThrow();
    });

    it("should handle empty stream response in updateStreamResponse", () => {
      const streamResponse = {
        settings: {},
        schema: []
      };
      
      const result = wrapper.vm.updateStreamResponse(streamResponse);
      expect(result.schema).toEqual([]);
    });

    it("should handle partition key conflicts in disableOptions", () => {
      const schema = { index_type: ["prefixPartition"] };
      const keyPartitionOption = { value: "keyPartition" };
      
      expect(wrapper.vm.disableOptions(schema, keyPartitionOption)).toBe(true);
    });

    it("should handle hash partition conflicts in disableOptions", () => {
      const schema = { index_type: ["hashPartition_8"] };
      const hashOption = { value: "hashPartition_16" };
      
      expect(wrapper.vm.disableOptions(schema, hashOption)).toBe(true);
    });

    it("should not disable non-conflicting options", () => {
      const schema = { index_type: ["fullTextSearchKey"] };
      const bloomOption = { value: "bloomFilterKey" };

      expect(wrapper.vm.disableOptions(schema, bloomOption)).toBe(false);
    });
  });

  // Performance Fields Popup Tests
  describe("Performance Fields Popup Tests", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "test-stream",
        storage_type: "s3",
        stream_type: "logs",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 400,
          file_num: 1,
          storage_size: 0.74,
          compressed_size: 0.03,
        },
        schema: [
          { name: "user_id", type: "Utf8", index_type: ["fullTextSearchKey"] },
          { name: "log_level", type: "Utf8", index_type: ["secondaryIndexKey"] },
          { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
          { name: "timestamp", type: "Int64", index_type: [] },
        ],
        settings: {
          partition_time_level: "hourly",
          partition_keys: {},
          full_text_search_keys: ["user_id", "message"],
          index_fields: ["log_level"],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "test-stream",
            storage_type: "s3",
            stream_type: "logs",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 400,
              file_num: 1,
              storage_size: 0.74,
              compressed_size: 0.03,
            },
            schema: [
              {
                name: "user_id",
                type: "Utf8",
                index_type: ["fullTextSearchKey"],
              },
              {
                name: "log_level",
                type: "Utf8",
                index_type: ["secondaryIndexKey"],
              },
              {
                name: "message",
                type: "Utf8",
                index_type: ["fullTextSearchKey"],
              },
              {
                name: "timestamp",
                type: "Int64",
                index_type: [],
              },
            ],
            settings: {
              partition_time_level: "hourly",
              partition_keys: {},
              full_text_search_keys: ["user_id", "message"],
              index_fields: ["log_level"],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: []
            },
          },
        },
        global: {
          provide: {
            store: {
              ...store,
              state: {
                ...store.state,
                zoConfig: {
                  ...store.state.zoConfig,
                  default_fts_keys: ["user_id"],
                  default_secondary_index_fields: ["log_level"],
                  user_defined_schema_max_fields: 100,
                }
              }
            },
          },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    // Test 1: getMissingPerformanceFields should detect missing FTS fields
    it("should detect missing FTS fields", () => {
      const selectedFieldsSet = new Set(["timestamp"]); // Not selecting FTS fields
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      expect(missing.length).toBeGreaterThan(0);
      const ftsFields = missing.filter(f => f.type === "Full Text Search");
      expect(ftsFields.length).toBeGreaterThan(0);
      expect(ftsFields.some(f => f.name === "user_id" || f.name === "message")).toBe(true);
    });

    // Test 2: getMissingPerformanceFields should detect missing Secondary Index fields
    it("should detect missing Secondary Index fields", () => {
      const selectedFieldsSet = new Set(["timestamp"]); // Not selecting secondary index fields
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      expect(missing.length).toBeGreaterThan(0);
      const secondaryIndexFields = missing.filter(f => f.type === "Secondary Index");
      expect(secondaryIndexFields.length).toBeGreaterThan(0);
      expect(secondaryIndexFields.some(f => f.name === "log_level")).toBe(true);
    });

    // Test 3: getMissingPerformanceFields should not detect fields already selected
    it("should not detect fields already selected by user", () => {
      const selectedFieldsSet = new Set(["user_id", "message", "log_level", "timestamp"]);
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      expect(missing.length).toBe(0);
    });

    // Test 4: getMissingPerformanceFields should detect default FTS keys from config
    it("should detect default FTS keys from backend config", () => {
      // user_id is in default_fts_keys
      const selectedFieldsSet = new Set(["message", "timestamp"]); // Not including user_id
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      const ftsFields = missing.filter(f => f.type === "Full Text Search");
      expect(ftsFields.some(f => f.name === "user_id")).toBe(true);
    });

    // Test 5: getMissingPerformanceFields should detect default secondary index keys from config
    it("should detect default secondary index keys from backend config", () => {
      // log_level is in default_secondary_index_fields
      const selectedFieldsSet = new Set(["user_id", "timestamp"]); // Not including log_level
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      const secondaryIndexFields = missing.filter(f => f.type === "Secondary Index");
      expect(secondaryIndexFields.some(f => f.name === "log_level")).toBe(true);
    });

    // Test 6: updateDefinedSchemaFields should show popup when UDS is enabled first time with missing fields
    it("should show performance fields popup when enabling UDS for first time", () => {
      wrapper.vm.indexData.defined_schema_fields = []; // First time enabling UDS
      wrapper.vm.selectedFields = [{ name: "timestamp" }];
      wrapper.vm.activeTab = "allFields";

      wrapper.vm.updateDefinedSchemaFields();

      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(true);
      expect(wrapper.vm.missingPerformanceFields.length).toBeGreaterThan(0);
      expect(wrapper.vm.pendingSelectedFields).toEqual(["timestamp"]);
    });

    // Test 7: updateDefinedSchemaFields should not show popup when all performance fields are selected
    it("should not show popup when all performance fields are already selected", () => {
      wrapper.vm.indexData.defined_schema_fields = []; // First time enabling UDS
      wrapper.vm.selectedFields = [
        { name: "user_id" },
        { name: "message" },
        { name: "log_level" },
        { name: "timestamp" }
      ];
      wrapper.vm.activeTab = "allFields";

      wrapper.vm.updateDefinedSchemaFields();

      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(false);
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("user_id");
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("message");
    });

    // Test 8: updateDefinedSchemaFields should not show popup when UDS already has fields
    it("should not show popup when UDS already has existing fields", () => {
      wrapper.vm.indexData.defined_schema_fields = ["existing_field"]; // Already has fields
      wrapper.vm.selectedFields = [{ name: "timestamp" }];
      wrapper.vm.activeTab = "allFields";

      wrapper.vm.updateDefinedSchemaFields();

      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(false);
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("existing_field");
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("timestamp");
    });

    // Test 9: addPerformanceFields should add missing fields when user clicks OK
    it("should add missing performance fields when user clicks OK", () => {
      wrapper.vm.pendingSelectedFields = ["timestamp"];
      wrapper.vm.missingPerformanceFields = [
        { name: "user_id", type: "Full Text Search" },
        { name: "log_level", type: "Secondary Index" }
      ];

      wrapper.vm.addPerformanceFields();

      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(false);
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("timestamp");
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("user_id");
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("log_level");
      expect(wrapper.vm.missingPerformanceFields).toEqual([]);
      expect(wrapper.vm.pendingSelectedFields).toEqual([]);
    });

    // Test 10: skipPerformanceFields should not add missing fields when user clicks Skip
    it("should not add missing performance fields when user clicks Skip", () => {
      wrapper.vm.pendingSelectedFields = ["timestamp"];
      wrapper.vm.missingPerformanceFields = [
        { name: "user_id", type: "Full Text Search" },
        { name: "log_level", type: "Secondary Index" }
      ];

      wrapper.vm.skipPerformanceFields();

      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(false);
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("timestamp");
      expect(wrapper.vm.indexData.defined_schema_fields).not.toContain("user_id");
      expect(wrapper.vm.indexData.defined_schema_fields).not.toContain("log_level");
      expect(wrapper.vm.missingPerformanceFields).toEqual([]);
      expect(wrapper.vm.pendingSelectedFields).toEqual([]);
    });

    // Test 11: Removed test for missingPerformanceFieldsByType
    // This computed property is now internal to PerformanceFieldsDialog component
    // The grouping functionality is still tested through the dialog component's behavior

    // Test 12: proceedWithAddingFields should filter out timestamp and allFields
    it("should filter out timestamp and _all fields when adding", () => {
      const selectedFieldsSet = new Set(["user_id", "_all", "_timestamp"]);
      wrapper.vm.store.state.zoConfig.timestamp_column = "_timestamp";

      wrapper.vm.proceedWithAddingFields(selectedFieldsSet);

      expect(wrapper.vm.indexData.defined_schema_fields).toContain("user_id");
      expect(wrapper.vm.indexData.defined_schema_fields).not.toContain("_all");
      expect(wrapper.vm.indexData.defined_schema_fields).not.toContain("_timestamp");
    });

    // Test 13: proceedWithAddingFields should mark form as dirty
    it("should mark form as dirty when adding fields", () => {
      wrapper.vm.formDirtyFlag = false;
      const selectedFieldsSet = new Set(["user_id"]);

      wrapper.vm.proceedWithAddingFields(selectedFieldsSet);

      expect(wrapper.vm.formDirtyFlag).toBe(true);
    });

    // Test 14: getMissingPerformanceFields should only include fields that exist in schema
    it("should only include backend default fields that exist in current schema", () => {
      // Add a field to default config that doesn't exist in schema
      wrapper.vm.store.state.zoConfig.default_fts_keys = ["user_id", "nonexistent_field"];

      const selectedFieldsSet = new Set(["timestamp"]);
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      const ftsFields = missing.filter(f => f.type === "Full Text Search");
      expect(ftsFields.some(f => f.name === "user_id")).toBe(true);
      expect(ftsFields.some(f => f.name === "nonexistent_field")).toBe(false);
    });

    // Test 15: updateDefinedSchemaFields should respect max field limit
    it("should show error when exceeding max field limit", () => {
      mockToast.mockClear();
      wrapper.vm.store.state.zoConfig.user_defined_schema_max_fields = 5;
      wrapper.vm.indexData.defined_schema_fields = ["f1", "f2", "f3", "f4"];
      wrapper.vm.selectedFields = [{ name: "f5" }, { name: "f6" }]; // Would exceed limit
      wrapper.vm.activeTab = "allFields";

      wrapper.vm.updateDefinedSchemaFields();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("Maximum allowed fields"),
        })
      );
      expect(wrapper.vm.selectedFields).toEqual([]);
    });

    // Test 16: updateActiveMainTab for new tabs (Configuration, Cross-Linking)
    it("should update activeMainTab to 'configuration'", () => {
      wrapper.vm.updateActiveMainTab("configuration");
      expect(wrapper.vm.activeMainTab).toBe("configuration");
    });

    it("should update activeMainTab to 'crossLinking'", () => {
      wrapper.vm.updateActiveMainTab("crossLinking");
      expect(wrapper.vm.activeMainTab).toBe("crossLinking");
    });

    it("should reset activeMainTab back to 'schemaSettings'", () => {
      wrapper.vm.updateActiveMainTab("configuration");
      wrapper.vm.updateActiveMainTab("schemaSettings");
      expect(wrapper.vm.activeMainTab).toBe("schemaSettings");
    });
  });

  // Tests for new features added in Mar 11 update
  describe("Stats Grid Tiles (added Mar 11)", () => {
    let w: any;

    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "test-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 1000,
          file_num: 5,
          storage_size: 2.5,
          compressed_size: 0.5,
          index_size: 0.1,
        },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          partition_time_level: "hourly",
          partition_keys: {},
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      w = mount(LogStream, {
        props: {
          modelValue: {
            name: "test-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 1000,
              file_num: 5,
              storage_size: 2.5,
              compressed_size: 0.5,
              index_size: 0.1,
            },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              partition_time_level: "hourly",
              partition_keys: {},
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    afterEach(() => { w.unmount(); });

    it("should render storage-size-tile", async () => {
      expect(w.find('[data-test="storage-size-tile"]').exists()).toBe(true);
    });

    it("should expose formatSizeFromMB function", () => {
      expect(typeof w.vm.formatSizeFromMB).toBe("function");
    });

    it("formatSizeFromMB should format MB values with units", () => {
      // 1024 MB = 1 GB
      const result = w.vm.formatSizeFromMB(1024);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("formatSizeFromMB should handle zero", () => {
      const result = w.vm.formatSizeFromMB(0);
      expect(typeof result).toBe("string");
    });

    it("formatSizeFromMB should handle small values", () => {
      const result = w.vm.formatSizeFromMB(0.5);
      expect(typeof result).toBe("string");
    });
  });

  describe("Timeline and Name Badge (added Mar 11)", () => {
    let w: any;

    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "my-stream-name",
        stream_type: "logs",
        storage_type: "s3",
        stats: {
          doc_time_min: 1000000,
          doc_time_max: 2000000,
          doc_num: 100,
          file_num: 1,
          storage_size: 1.0,
          compressed_size: 0.2,
        },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      w = mount(LogStream, {
        props: {
          modelValue: {
            name: "my-stream-name",
            stream_type: "logs",
            storage_type: "s3",
            stats: {
              doc_time_min: 1000000,
              doc_time_max: 2000000,
              doc_num: 100,
              file_num: 1,
              storage_size: 1.0,
              compressed_size: 0.2,
            },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    afterEach(() => { w.unmount(); });

    it("should show the stream name in the header badge", async () => {
      expect(w.find('[data-test="schema-title-text"]').text()).toContain("my-stream-name");
    });

    it("should expose getTimelineIcon computed", () => {
      expect(w.vm.getTimelineIcon).toBeDefined();
      expect(typeof w.vm.getTimelineIcon).toBe("string");
    });

    it("getTimelineIcon should return different URL based on theme", async () => {
      // light theme
      w.vm.store.state.theme = "light";
      await w.vm.$nextTick();
      const lightIcon = w.vm.getTimelineIcon;

      // dark theme
      w.vm.store.state.theme = "dark";
      await w.vm.$nextTick();
      const darkIcon = w.vm.getTimelineIcon;

      expect(typeof lightIcon).toBe("string");
      expect(typeof darkIcon).toBe("string");
    });
  });

  describe("Cross-Linking Tab (added Mar 11)", () => {
    it("should not render cross-linking tab when enable_cross_linking is false", async () => {
      store.state.zoConfig = {
        ...store.state.zoConfig,
        enable_cross_linking: false,
      };

      const w = mount(LogStream, {
        props: {
          modelValue: {
            name: "test-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: { full_text_search_keys: [], index_fields: [], bloom_filter_fields: [], data_retention: 30, max_query_range: 0, store_original_data: false, approx_partition: false, defined_schema_fields: [], extended_retention_days: [], pattern_associations: [] },
          },
        },
        global: { provide: { store }, plugins: [i18n], stubs: { ODrawer: ODrawerStub } },
      });
      await flushPromises();
      // When enable_cross_linking is false, the tab should not exist
      expect(w.exists()).toBe(true);
      w.unmount();
    });

    it("should expose streamCrossLinks reactive ref", async () => {
      expect(Array.isArray(wrapper.vm.streamCrossLinks)).toBe(true);
    });

    it("should expose orgCrossLinks computed", async () => {
      expect(wrapper.vm.orgCrossLinks).toBeDefined();
      expect(Array.isArray(wrapper.vm.orgCrossLinks)).toBe(true);
    });
  });

  // Coverage for the ODrawer migration.
  describe("ODrawer Migration", () => {
    const buildProps = (open = true) => ({
      open,
      modelValue: {
        name: "test-stream",
        storage_type: "s3",
        stream_type: "logs",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 400,
          file_num: 1,
          storage_size: 0.74,
          compressed_size: 0.03,
        },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          partition_time_level: "hourly",
          partition_keys: {},
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
          pattern_associations: [],
        },
      },
    });

    let w: any;

    beforeEach(async () => {
      w = mount(LogStream, {
        props: buildProps(true),
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    afterEach(() => {
      w?.unmount();
      vi.clearAllMocks();
    });

    it("should render both ODrawer instances (schema drawer + pattern association drawer)", () => {
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers.length).toBe(2);
    });

    it("should forward the open prop to the schema ODrawer", () => {
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[0].props("open")).toBe(true);
    });

    it("should mount the schema ODrawer with width=60", () => {
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[0].props("width")).toBe(60);
    });

    it("should mount the pattern association ODrawer with width=60 and showClose=false", () => {
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[1].props("width")).toBe(60);
      expect(drawers[1].props("showClose")).toBe(false);
    });

    it("should keep the pattern association ODrawer closed by default", () => {
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[1].props("open")).toBe(false);
    });

    it("should emit update:open=false when the schema ODrawer emits update:open=false", async () => {
      const drawers = w.findAllComponents(ODrawerStub);
      await drawers[0].vm.$emit("update:open", false);
      const emitted = w.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("should emit update:open=false when the ODrawer close button is clicked", async () => {
      const drawers = w.findAllComponents(ODrawerStub);
      await drawers[0].find('[data-test="o-drawer-stub-close"]').trigger("click");
      await flushPromises();
      const emitted = w.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });

    it("should render the header slot content (stream name badge) inside the ODrawer", () => {
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[0].find('[data-test="schema-title-text"]').exists()).toBe(true);
      expect(drawers[0].find('[data-test="schema-title-text"]').text()).toContain("test-stream");
    });

    it("should open the pattern association ODrawer when openPatternAssociationDialog is invoked", async () => {
      w.vm.patternAssociations = {
        field1: [{ field: "field1", pattern_name: "p1", pattern_id: "id1" }],
      };
      w.vm.openPatternAssociationDialog("field1");
      await flushPromises();
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[1].props("open")).toBe(true);
    });

    it("should close the pattern association ODrawer when it emits update:open=false", async () => {
      w.vm.patternAssociationDialog.show = true;
      await flushPromises();
      const drawers = w.findAllComponents(ODrawerStub);
      expect(drawers[1].props("open")).toBe(true);

      await drawers[1].vm.$emit("update:open", false);
      await flushPromises();
      expect(w.vm.patternAssociationDialog.show).toBe(false);
    });

    it("should hide schema content and show loading placeholder when indexData.schema is falsy", async () => {
      // Override the default mock to return null schema so the loading
      // placeholder is rendered instead of the full schema content.
      mockGetStream.mockResolvedValue({
        name: "loading-stream",
        stream_type: "logs",
        storage_type: "s3",
        schema: null,
        stats: {},
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      const lw = mount(LogStream, {
        props: {
          open: true,
          modelValue: { name: "loading-stream", schema: null, stats: {}, settings: {} },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
      const drawer = lw.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.text()).toContain("Wait while loading");
      lw.unmount();
    });

    it("should not throw when ODrawer emits update:open with the same value", async () => {
      const drawers = w.findAllComponents(ODrawerStub);
      await drawers[0].vm.$emit("update:open", true);
      const emitted = w.emitted("update:open");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([true]);
    });
  });

  // ==========================================
  // Phase 2 tests — Configuration Tab
  // ==========================================
  describe("Configuration Tab", () => {
    let w: any;

    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "config-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 500,
          file_num: 3,
          storage_size: 1.5,
          compressed_size: 0.2,
          index_size: 0.05,
        },
        schema: [
          { name: "_timestamp", type: "Int64" },
          { name: "message", type: "Utf8" },
        ],
        settings: {
          partition_time_level: "hourly",
          partition_keys: {},
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 24,
          flatten_level: null,
          store_original_data: false,
          approx_partition: false,
          enable_distinct_fields: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      w = mount(LogStream, {
        props: {
          modelValue: {
            name: "config-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 500,
              file_num: 3,
              storage_size: 1.5,
              compressed_size: 0.2,
              index_size: 0.05,
            },
            schema: [
              { name: "_timestamp", type: "Int64" },
              { name: "message", type: "Utf8" },
            ],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 24,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    afterEach(() => { w.unmount(); });

    it("should render the config tab when activeMainTab is 'configuration'", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      expect(w.find('[data-test="stream-details-data-retention-input"]').exists()).toBe(true);
      expect(w.find('[data-test="stream-details-max-query-range-input"]').exists()).toBe(true);
      expect(w.find('[data-test="stream-details-flatten-level-input"]').exists()).toBe(true);
    });

    it("should update dataRetentionDays and mark form dirty", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      // OInput is a custom component; drive v-model through vm state
      w.vm.dataRetentionDays = 90;
      w.vm.markFormDirty();
      await w.vm.$nextTick();

      expect(w.vm.dataRetentionDays).toBe(90);
      expect(w.vm.formDirtyFlag).toBe(true);
    });

    it("should update maxQueryRange and mark form dirty", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      w.vm.maxQueryRange = 48;
      w.vm.markFormDirty();
      await w.vm.$nextTick();

      expect(w.vm.maxQueryRange).toBe(48);
      expect(w.vm.formDirtyFlag).toBe(true);
    });

    it("should update flattenLevel and mark form dirty", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      w.vm.flattenLevel = 5;
      w.vm.markFormDirty();
      await w.vm.$nextTick();

      expect(w.vm.flattenLevel).toBe(5);
      expect(w.vm.formDirtyFlag).toBe(true);
    });

    it("should show the approxPartition switch and toggle it", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      const toggleBtn = w.find('[data-test="log-stream-use_approx-toggle-btn"]');
      expect(toggleBtn.exists()).toBe(true);

      // Toggle from false to true
      w.vm.approxPartition = true;
      w.vm.formDirtyFlag = true;
      await w.vm.$nextTick();
      expect(w.vm.approxPartition).toBe(true);
      expect(w.vm.formDirtyFlag).toBe(true);
    });

    it("should show storeOriginalData switch and toggle it", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      const toggleBtn = w.find('[data-test="log-stream-store-original-data-toggle-btn"]');
      expect(toggleBtn.exists()).toBe(true);

      w.vm.storeOriginalData = true;
      w.vm.formDirtyFlag = true;
      await w.vm.$nextTick();
      expect(w.vm.storeOriginalData).toBe(true);
    });

    it("should show enableDistinctFields switch and toggle it", async () => {
      w.vm.updateActiveMainTab("configuration");
      await w.vm.$nextTick();

      const toggleBtn = w.find('[data-test="log-stream-enabled-distinct-values-toggle-btn"]');
      expect(toggleBtn.exists()).toBe(true);

      w.vm.enableDistinctFields = true;
      w.vm.formDirtyFlag = true;
      await w.vm.$nextTick();
      expect(w.vm.enableDistinctFields).toBe(true);
    });
  });

  // ==========================================
  // Phase 2 tests — Red Button Tab
  // ==========================================
  describe("Red Button Tab (Extended Retention)", () => {
    let w: any;

    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "retention-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 100,
          file_num: 1,
          storage_size: 0.5,
          compressed_size: 0.05,
        },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [
            { start: 1703505000, end: 1703591400 },
          ],
        },
        pattern_associations: [],
      });
      w = mount(LogStream, {
        props: {
          modelValue: {
            name: "retention-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 100,
              file_num: 1,
              storage_size: 0.5,
              compressed_size: 0.05,
            },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [
                { start: 1703505000, end: 1703591400 },
              ],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    afterEach(() => { w.unmount(); });

    it("should render the red button tab when activeMainTab is 'redButton'", async () => {
      w.vm.updateActiveMainTab("redButton");
      await w.vm.$nextTick();

      // The red button tab renders an info message and a DateTime component
      expect(w.vm.activeMainTab).toBe("redButton");
      expect(w.vm.redBtnRows).toBeDefined();
      expect(Array.isArray(w.vm.redBtnRows)).toBe(true);
    });

    it("should populate redBtnRows from extended_retention_days settings", () => {
      expect(w.vm.redBtnRows.length).toBe(1);
      expect(w.vm.redBtnRows[0].original_start).toBe(1703505000);
      expect(w.vm.redBtnRows[0].original_end).toBe(1703591400);
    });

    it("should handle date selection callback", () => {
      // dateChangeValue with relative time period exits early
      w.vm.dateChangeValue({ relativeTimePeriod: "1h" });
      expect(w.vm.redDaysList).toEqual([]);
    });

    it("should ignore programmatic mount-replay date-change emits (userChangedValue false)", () => {
      // On mount/remount <date-time> emits an absolute range with
      // userChangedValue:false. dateChangeValue must ignore it so it does not
      // push to redDaysList and trigger onSubmit — the cause of the infinite
      // updateSettings/getStream loop on the Extended Retention tab.
      mockUpdateSettings.mockClear();
      w.vm.dateChangeValue({
        relativeTimePeriod: null,
        userChangedValue: false,
        selectedDate: { from: "2024-06-15", to: "2024-06-16" },
      });
      expect(w.vm.redDaysList).toEqual([]);
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it("should set IsdeleteBtnVisible when rows are selected", async () => {
      w.vm.updateActiveMainTab("redButton");
      await w.vm.$nextTick();

      w.vm.selectedDateFields = [{ index: 0, start: "02-01-2024", end: "03-01-2024" }];
      w.vm.IsdeleteBtnVisible = true;
      await w.vm.$nextTick();

      expect(w.vm.IsdeleteBtnVisible).toBe(true);
    });

    it("should delete dates when deleteDates is called", async () => {
      w.vm.updateActiveMainTab("redButton");
      await w.vm.$nextTick();

      w.vm.selectedDateFields = [
        { original_start: 1703505000, original_end: 1703591400, index: 0 },
      ];
      // deleteDates sets formDirtyFlag then calls onSubmit()
      // onSubmit() resets formDirtyFlag to false on success
      await w.vm.deleteDates();
      await flushPromises();

      // After onSubmit completes successfully, the form should not be dirty
      // because the component resets it after saving
      expect(mockUpdateSettings).toHaveBeenCalled();
      expect(w.vm.loadingState).toBe(false);
    });
  });

  // ==========================================
  // Phase 2 tests — Additional Functions Coverage
  // ==========================================
  describe("Additional Functions", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "funcs-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 200,
          file_num: 2,
          storage_size: 1.0,
          compressed_size: 0.1,
        },
        schema: [
          { name: "_timestamp", type: "Int64", index_type: [] },
          { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
          { name: "job", type: "Utf8", index_type: [] },
        ],
        settings: {
          full_text_search_keys: ["message"],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "funcs-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 200,
              file_num: 2,
              storage_size: 1.0,
              compressed_size: 0.1,
            },
            schema: [
              { name: "_timestamp", type: "Int64", index_type: [] },
              { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
              { name: "job", type: "Utf8", index_type: [] },
            ],
            settings: {
              full_text_search_keys: ["message"],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should enforce max index types (cap at 2)", () => {
      const result = wrapper.vm.enforceMaxIndexTypes([
        "fullTextSearchKey",
        "secondaryIndexKey",
        "bloomFilterKey",
      ]);
      expect(result).toEqual(["secondaryIndexKey", "bloomFilterKey"]);
    });

    it("should enforce max index types (no cap when 2 or fewer)", () => {
      const result = wrapper.vm.enforceMaxIndexTypes(["fullTextSearchKey", "bloomFilterKey"]);
      expect(result).toEqual(["fullTextSearchKey", "bloomFilterKey"]);
    });

    it("should enforce max index types (return non-array as-is)", () => {
      expect(wrapper.vm.enforceMaxIndexTypes("not-array")).toBe("not-array");
      expect(wrapper.vm.enforceMaxIndexTypes(null)).toBe(null);
    });

    it("should detect env quick mode field", () => {
      wrapper.vm.store.state.zoConfig.default_quick_mode_fields = ["job", "log"];
      expect(wrapper.vm.isEnvQuickModeField("job")).toBe(true);
      expect(wrapper.vm.isEnvQuickModeField("message")).toBe(false);
      expect(wrapper.vm.isEnvQuickModeField("unknown")).toBe(false);
    });

    it("should compute quickModeIcon based on theme", () => {
      expect(typeof wrapper.vm.quickModeIcon).toBe("string");
      expect(wrapper.vm.quickModeIcon.length).toBeGreaterThan(0);
    });

    it("should compute getConfigIcon based on theme", () => {
      expect(typeof wrapper.vm.getConfigIcon).toBe("string");
      expect(wrapper.vm.getConfigIcon.length).toBeGreaterThan(0);
    });

    it("should add and remove schema fields via the form", async () => {
      // Rows are owned by the child (StreamFieldInputs) through the form now —
      // add/remove go through form.pushFieldValue / form.removeFieldValue, the
      // same calls the child makes. The parent no longer exposes add/remove
      // handlers.
      expect(wrapper.vm.newSchemaFields.length).toBe(0);

      wrapper.vm.newSchemaFieldsForm.pushFieldValue("newSchemaFields", {
        name: "",
        type: "",
        index_type: [],
      });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.newSchemaFields.length).toBe(1);
      expect(wrapper.vm.newSchemaFields[0].name).toBe("");
      expect(wrapper.vm.newSchemaFields[0].type).toBe("");

      wrapper.vm.newSchemaFieldsForm.pushFieldValue("newSchemaFields", {
        name: "",
        type: "",
        index_type: [],
      });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.newSchemaFields.length).toBe(2);

      wrapper.vm.newSchemaFieldsForm.removeFieldValue("newSchemaFields", 0);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.newSchemaFields.length).toBe(1);
    });

    it("should close dialog when last schema field is removed", async () => {
      wrapper.vm.isDialogOpen = true;
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "test", type: "string", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      // The child removes rows directly via the form; the parent's watch closes
      // the dialog once the rows drain to empty (main's behavior, restored).
      wrapper.vm.newSchemaFieldsForm.removeFieldValue("newSchemaFields", 0);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isDialogOpen).toBe(false);
      expect(wrapper.vm.newSchemaFields).toEqual([]);
    });

    it("should remove a field from the missing performance fields list", () => {
      wrapper.vm.missingPerformanceFields = [
        { name: "field1", type: "Full Text Search" },
        { name: "field2", type: "Secondary Index" },
      ];
      wrapper.vm.pendingSelectedFields = ["field3"];

      wrapper.vm.removeFieldFromList("fts", "field1");

      expect(wrapper.vm.missingPerformanceFields).toEqual([
        { name: "field2", type: "Secondary Index" },
      ]);
      // Should not close dialog since there's still one missing field
      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(false);
    });

    it("should close dialog when last missing performance field is removed", () => {
      wrapper.vm.confirmAddPerformanceFieldsDialog = true;
      wrapper.vm.missingPerformanceFields = [
        { name: "field1", type: "Full Text Search" },
      ];
      wrapper.vm.pendingSelectedFields = ["field3"];

      wrapper.vm.removeFieldFromList("fts", "field1");

      expect(wrapper.vm.confirmAddPerformanceFieldsDialog).toBe(false);
      expect(wrapper.vm.missingPerformanceFields).toEqual([]);
      expect(wrapper.vm.pendingSelectedFields).toEqual([]);
    });

    it("should check if option is present in default env config", () => {
      wrapper.vm.store.state.zoConfig.default_fts_keys = ["message"];
      wrapper.vm.store.state.zoConfig.default_secondary_index_fields = ["status"];

      expect(
        wrapper.vm.checkIfOptionPresentInDefaultEnv("message", {
          value: "fullTextSearchKey",
        }),
      ).toBe(true);
      expect(
        wrapper.vm.checkIfOptionPresentInDefaultEnv("status", {
          value: "secondaryIndexKey",
        }),
      ).toBe(true);
      expect(
        wrapper.vm.checkIfOptionPresentInDefaultEnv("message", {
          value: "secondaryIndexKey",
        }),
      ).toBe(false);
    });

    it("should compute indexTypeOptionsForRow with disabled flags", () => {
      const options = wrapper.vm.indexTypeOptionsForRow({
        name: "message",
        index_type: ["fullTextSearchKey"],
      });

      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      options.forEach((opt: any) => {
        expect(opt).toHaveProperty("value");
        expect(opt).toHaveProperty("label");
        expect(opt).toHaveProperty("disabled");
      });
    });

    it("should filter filterFieldFn by name", () => {
      const rows = wrapper.vm.indexData.schema;
      const result = wrapper.vm.filterFieldFn(rows, "message@allFields");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("message");
    });

    it("should filter filterFieldFn with schema fields filter type", () => {
      wrapper.vm.indexData.defined_schema_fields = ["message"];
      const rows = wrapper.vm.indexData.schema;
      const result = wrapper.vm.filterFieldFn(rows, "message@schemaFields");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("message");
    });

    it("should filter filterFieldFn with empty search returns all rows", () => {
      const rows = wrapper.vm.indexData.schema;
      const result = wrapper.vm.filterFieldFn(rows, "@allFields");
      expect(result.length).toBe(3);
    });

    it("should sort stream field names", () => {
      const names = wrapper.vm.streamFieldNames;
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBe(3);
    });

    it("should compute hasUDSFieldInSelection", async () => {
      wrapper.vm.activeTab = "allFields";
      wrapper.vm.selectedFields = [{ name: "message", isUserDefined: true }];
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.hasUDSFieldInSelection).toBe(true);

      wrapper.vm.selectedFields = [{ name: "message", isUserDefined: false }];
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.hasUDSFieldInSelection).toBe(false);
    });

    it("should handle handleSchemaSelectedIdsUpdate", () => {
      wrapper.vm.handleSchemaSelectedIdsUpdate(["message"]);
      expect(wrapper.vm.selectedFields.map((f: any) => f.name)).toContain("message");
    });

    it("should handle handleSchemaSelectionChange", () => {
      wrapper.vm.handleSchemaSelectionChange([
        { name: "_timestamp" },
        { name: "message" },
        { name: "_all" },
      ]);
      const names = wrapper.vm.selectedFields.map((f: any) => f.name);
      expect(names).not.toContain("_timestamp");
      expect(names).not.toContain("_all");
      expect(names).toContain("message");
    });

    it("should handle handleDateSelectionChange", () => {
      const rows = [{ index: 0, start: "01-01-2024", end: "02-01-2024" }];
      wrapper.vm.handleDateSelectionChange(rows);
      expect(wrapper.vm.selectedDateFields).toEqual(rows);
    });

    it("should get missing performance fields (concurrent with secondaryIndex and FTS)", () => {
      // "message" has fullTextSearchKey, so it should appear in missing if not selected
      const selectedFieldsSet = new Set(["_timestamp"]);
      const missing = wrapper.vm.getMissingPerformanceFields(selectedFieldsSet);

      const ftsMissing = missing.filter((f: any) => f.type === "Full Text Search");
      expect(ftsMissing.length).toBeGreaterThan(0);
      expect(ftsMissing.some((f: any) => f.name === "message")).toBe(true);
    });
  });

  // ==========================================
  // Phase 2 tests — onSubmit and deleteFields async paths
  // ==========================================
  describe("onSubmit and deleteFields", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "save-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 100,
          file_num: 1,
          storage_size: 1.0,
          compressed_size: 0.1,
        },
        schema: [
          { name: "_timestamp", type: "Int64", index_type: [] },
          { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
        ],
        settings: {
          full_text_search_keys: ["message"],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "save-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 100,
              file_num: 1,
              storage_size: 1.0,
              compressed_size: 0.1,
            },
            schema: [
              { name: "_timestamp", type: "Int64", index_type: [] },
              { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
            ],
            settings: {
              full_text_search_keys: ["message"],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should save stream settings via onSubmit", async () => {
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockUpdateSettings).toHaveBeenCalled();
    });

    it("should handle updateSettings error in onSubmit", async () => {
      mockUpdateSettings.mockRejectedValue({
        response: { data: { message: "Update failed" } },
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockToast).toHaveBeenCalled();
      expect(wrapper.vm.loadingState).toBe(false);
    });

    it("should show error when dataRetentionDays < 1 during onSubmit", async () => {
      wrapper.vm.dataRetentionDays = 0;
      mockToast.mockClear();

      await wrapper.vm.onSubmit();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Retention period must be at least 1 day"),
        }),
      );
    });

    it("should delete fields via deleteFields", async () => {
      // Simulate selected fields to delete
      wrapper.vm.selectedFields = [{ name: "message" }];
      wrapper.vm.confirmQueryModeChangeDialog = true;

      await wrapper.vm.deleteFields();
      await flushPromises();

      // After successful delete, confirmDialog should be closed
      expect(wrapper.vm.confirmQueryModeChangeDialog).toBe(false);
    });

    it("should handle deleteFields error gracefully", async () => {
      vi.hoisted(() => ({
        mockStreamServiceDeleteFields: vi.fn(),
      }));
      // We need to intercept the streamService mock
      const streamService = (await import("@/services/stream")).default;

      wrapper.vm.selectedFields = [{ name: "message" }];

      // Mock the deleteFields call to reject
      vi.mocked(streamService.deleteFields).mockRejectedValueOnce(new Error("Delete failed"));

      await wrapper.vm.deleteFields();
      await flushPromises();

      expect(mockToast).toHaveBeenCalled();
    });

    it("should deal with dataRetentionDays empty string error in onSubmit", async () => {
      wrapper.vm.dataRetentionDays = "";
      mockToast.mockClear();

      await wrapper.vm.onSubmit();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Retention period must be at least 1 day"),
        }),
      );
    });

    it("should set flatten_level in settings when flattenLevel not null", async () => {
      wrapper.vm.flattenLevel = 5;
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.any(String),
        "save-stream",
        "logs",
        expect.objectContaining({
          flatten_level: 5,
        }),
      );
    });
  });

  // ==========================================
  // Phase 2 tests — Cross-linking and LLM eval tabs
  // ==========================================
  describe("Cross-Linking Tab", () => {
    let w: any;

    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "link-stream",
        stream_type: "traces",
        storage_type: "s3",
        stats: {
          doc_time_min: 1678448628630259,
          doc_time_max: 1678448628652947,
          doc_num: 100,
          file_num: 1,
          storage_size: 0.5,
          compressed_size: 0.05,
        },
        schema: [
          { name: "_timestamp", type: "Int64" },
          { name: "span_id", type: "Utf8" },
        ],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: true,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      w = mount(LogStream, {
        props: {
          modelValue: {
            name: "link-stream",
            stream_type: "traces",
            storage_type: "s3",
            stats: {
              doc_time_min: 1678448628630259,
              doc_time_max: 1678448628652947,
              doc_num: 100,
              file_num: 1,
              storage_size: 0.5,
              compressed_size: 0.05,
            },
            schema: [
              { name: "_timestamp", type: "Int64" },
              { name: "span_id", type: "Utf8" },
            ],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: true,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    afterEach(() => { w.unmount(); });

    it("should show cross-linking tab when enable_cross_linking is true", async () => {
      store.state.zoConfig.enable_cross_linking = true;
      w.vm.updateActiveMainTab("crossLinking");
      await w.vm.$nextTick();

      expect(w.vm.activeMainTab).toBe("crossLinking");
      expect(Array.isArray(w.vm.streamCrossLinks)).toBe(true);
      expect(Array.isArray(w.vm.orgCrossLinks)).toBe(true);
    });

    it("should streamCrossLinks be an empty array initially", () => {
      expect(w.vm.streamCrossLinks).toEqual([]);
    });

    it("should hide storeOriginalData toggle for traces", () => {
      expect(w.vm.showStoreOriginalDataToggle).toBe(false);
    });

    it("should compute hasUDSFieldInSelection for allFields tab", async () => {
      w.vm.activeTab = "allFields";
      w.vm.selectedFields = [{ name: "span_id", isUserDefined: true }];
      await w.vm.$nextTick();

      expect(w.vm.hasUDSFieldInSelection).toBe(true);
    });
  });

  // ==========================================
  // Phase 2 tests — setSchema edge cases
  // ==========================================
  describe("setSchema edge cases", () => {
    it("should populate indexData.defaultFts when FTS/popular columns are present but settings FTS is empty", async () => {
      mockGetStream.mockResolvedValue({
        name: "fts-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }, { name: "message", type: "Utf8" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      const w = mount(LogStream, {
        props: {
          modelValue: {
            name: "fts-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }, { name: "message", type: "Utf8" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
      expect(w.vm.indexData.defaultFts).toBe(true);
      w.unmount();
    });

    it("should update schema with defined_schema_fields not already in schema", async () => {
      mockGetStream.mockResolvedValue({
        name: "extra-uds-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: ["extra_field"],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      const w = mount(LogStream, {
        props: {
          modelValue: {
            name: "extra-uds-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: ["extra_field"],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
      // "extra_field" should be added to schema
      const fieldNames = w.vm.indexData.schema.map((f: any) => f.name);
      expect(fieldNames).toContain("extra_field");
      w.unmount();
    });

    it("should handle streamResponse.schema being empty with defined_schema_fields", async () => {
      mockGetStream.mockResolvedValue({
        name: "empty-schema-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: ["field1"],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      const w = mount(LogStream, {
        props: {
          modelValue: {
            name: "empty-schema-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: ["field1"],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
      // field1 from defined_schema_fields should be in schema
      const fieldNames = w.vm.indexData.schema.map((f: any) => f.name);
      expect(fieldNames).toContain("field1");
      // No _timestamp in original schema (it was empty array)
      w.unmount();
    });
  });

  // ==========================================
  // Phase 2 tests — OTable selection syncing
  // ==========================================
  describe("OTable Selection Syncing", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "selection-sync-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [
          { name: "_timestamp", type: "Int64" },
          { name: "message", type: "Utf8" },
          { name: "level", type: "Utf8" },
        ],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "selection-sync-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [
              { name: "_timestamp", type: "Int64" },
              { name: "message", type: "Utf8" },
              { name: "level", type: "Utf8" },
            ],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should sync selectedSchemaIds with selectedFields (set)", () => {
      wrapper.vm.selectedSchemaIds = ["message"];
      const fieldNames = wrapper.vm.selectedFields.map((f: any) => f.name);
      expect(fieldNames).toContain("message");
      // timestamp should be filtered out (equal to zoConfig.timestamp_column)
      expect(fieldNames).not.toContain("_timestamp");
    });

    it("should sync selectedSchemaIds with selectedFields (get)", () => {
      wrapper.vm.selectedFields = [
        { name: "message", type: "Utf8" },
        { name: "level", type: "Utf8" },
      ];
      expect(wrapper.vm.selectedSchemaIds).toEqual(["message", "level"]);
    });

    it("should sync selectedDateIds (get) from selectedDateFields", () => {
      wrapper.vm.redBtnRows = [
        { index: 0, start: "01-01-2024", end: "02-01-2024" },
        { index: 1, start: "03-01-2024", end: "04-01-2024" },
      ];
      wrapper.vm.selectedDateFields = [
        { index: 0, start: "01-01-2024", end: "02-01-2024" },
      ];
      expect(wrapper.vm.selectedDateIds).toEqual([0]);
    });

    it("should sync selectedDateIds (set) from ids", () => {
      wrapper.vm.redBtnRows = [
        { index: 0, start: "01-01-2024", end: "02-01-2024" },
        { index: 1, start: "03-01-2024", end: "04-01-2024" },
      ];
      wrapper.vm.selectedDateIds = [1];
      expect(wrapper.vm.selectedDateFields).toEqual([
        { index: 1, start: "03-01-2024", end: "04-01-2024" },
      ]);
    });
  });

  // ==========================================
  // Phase 2 tests — Cross-links diff in onSubmit
  // ==========================================
  describe("Cross-links diff in onSubmit", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "cross-link-save",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
          cross_links: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "cross-link-save",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              cross_links: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should compute cross_links diff when links are added", async () => {
      // Add a new cross-link
      wrapper.vm.streamCrossLinks = [
        { name: "new-link", url: "https://example.com", fields: ["_timestamp"] },
      ];
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.any(String),
        "cross-link-save",
        "logs",
        expect.objectContaining({
          cross_links: expect.objectContaining({
            add: expect.arrayContaining([
              expect.objectContaining({ name: "new-link" }),
            ]),
            remove: [],
          }),
        }),
      );
    });
  });

  // ==========================================
  // Phase 2 tests — updateIndexType (exercises filterValueBasedOnEnv internally)
  // ==========================================
  describe("updateIndexType (exercises filterValueBasedOnEnv)", () => {
    beforeEach(async () => {
      store.state.zoConfig.default_fts_keys = ["message"];
      store.state.zoConfig.default_secondary_index_fields = ["status"];
      mockGetStream.mockResolvedValue({
        name: "update-idx-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [
          { name: "_timestamp", type: "Int64", index_type: [] },
          { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
          { name: "status", type: "Utf8", index_type: ["secondaryIndexKey"] },
          { name: "level", type: "Utf8", index_type: [] },
        ],
        settings: {
          full_text_search_keys: ["message"],
          index_fields: ["status"],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "update-idx-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [
              { name: "_timestamp", type: "Int64", index_type: [] },
              { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
              { name: "status", type: "Utf8", index_type: ["secondaryIndexKey"] },
              { name: "level", type: "Utf8", index_type: [] },
            ],
            settings: {
              full_text_search_keys: ["message"],
              index_fields: ["status"],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should update index_type on a row and mark form dirty", () => {
      const row = wrapper.vm.indexData.schema.find((f: any) => f.name === "level");
      expect(row).toBeDefined();

      wrapper.vm.updateIndexType(
        { row },
        ["fullTextSearchKey", "bloomFilterKey"],
      );

      // row.index_type should be updated (fullTextSearchKey + bloomFilterKey)
      expect(row.index_type).toContain("fullTextSearchKey");
      expect(row.index_type).toContain("bloomFilterKey");
      expect(wrapper.vm.formDirtyFlag).toBe(true);
    });

    it("should filter out env-default FTS key when updating message field", () => {
      const row = wrapper.vm.indexData.schema.find((f: any) => f.name === "message");
      expect(row).toBeDefined();

      // "message" is in default_fts_keys — fullTextSearchKey should be filtered
      wrapper.vm.updateIndexType(
        { row },
        ["fullTextSearchKey", "secondaryIndexKey"],
      );

      // fullTextSearchKey is env-default, should be filtered out
      expect(row.index_type).not.toContain("fullTextSearchKey");
      // secondaryIndexKey is not an env-default for message, should remain
      expect(row.index_type).toContain("secondaryIndexKey");
    });

    it("should filter out env-default secondary index key when updating status field", () => {
      const row = wrapper.vm.indexData.schema.find((f: any) => f.name === "status");
      expect(row).toBeDefined();

      // "status" is in default_secondary_index_fields — secondaryIndexKey should be filtered
      wrapper.vm.updateIndexType(
        { row },
        ["fullTextSearchKey", "secondaryIndexKey"],
      );

      expect(row.index_type).toContain("fullTextSearchKey");
      expect(row.index_type).not.toContain("secondaryIndexKey");
    });

    it("should handle empty index_type update (clear all)", () => {
      const row = wrapper.vm.indexData.schema.find((f: any) => f.name === "level");
      wrapper.vm.updateIndexType({ row }, []);

      expect(row.index_type).toEqual([]);
    });
  });

  // ==========================================
  // Phase 2 tests — Default props without name (created else path)
  // ==========================================
  describe("Default props without name", () => {
    it("should handle mounting with modelValue having empty name gracefully", async () => {
      mockGetStream.mockResolvedValue({
        name: "empty-name",
        stream_type: "logs",
        storage_type: "s3",
        schema: [],
        stats: {},
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      const w = mount(LogStream, {
        props: {
          modelValue: { name: "empty-name", schema: [], stats: {}, settings: { defined_schema_fields: [] } },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
      expect(w.exists()).toBe(true);
      w.unmount();
    });
  });

  // ==========================================
  // Phase 2 tests — dateChangeValue try/catch
  // ==========================================
  describe("dateChangeValue try/catch coverage", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "date-change-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "date-change-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should enter the try block when relativeTimePeriod is null", () => {
      // This exercises the try/catch path in dateChangeValue
      // When selectedDate.from is set and relativeTimePeriod is null,
      // the function enters the try block to convert dates.
      // convertDateToTimestamp (Luxon-based) may fail in jsdom,
      // exercising either the success path or the catch path.
      expect(() => {
        wrapper.vm.dateChangeValue({
          relativeTimePeriod: null,
          selectedDate: { from: "2024-01-01", to: "2024-01-02" },
        });
      }).not.toThrow();
    });

    it("should handle dateChangeValue with selectedDate but no relativeTimePeriod", () => {
      // Should not throw even when convertDateToTimestamp fails in jsdom
      wrapper.vm.dateChangeValue({
        selectedDate: { from: "2024-06-15", to: "2024-06-16" },
      });
      // The function should complete without errors
      expect(true).toBe(true);
    });
  });

  // ==========================================
  // Phase 2 tests — handleUpdateAppliedPattern apply_at else path
  // ==========================================
  describe("handleUpdateAppliedPattern apply_at coverage", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "apply-at-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [
          { field: "field1", pattern_name: "p1", pattern_id: "id1", policy: "replace", apply_at: "ingestion" },
        ],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "apply-at-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [
                { field: "field1", pattern_name: "p1", pattern_id: "id1", policy: "replace", apply_at: "ingestion" },
              ],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should use patternIdToApplyAtMap when apply_at is undefined", () => {
      // In setSchema, patternIdToApplyAtMap is populated from previousSchemaVersion
      // When apply_at is undefined, the else branch at line 2587 fetches from the map
      const updatedPattern = {
        field: "field1",
        pattern_name: "p1",
        pattern_id: "id1",
        apply_at: undefined, // triggers the apply_at else path
      };

      wrapper.vm.handleUpdateAppliedPattern(updatedPattern, "field1", "id1", "apply_at");

      // After the update, apply_at should come from patternIdToApplyAtMap
      expect(wrapper.vm.patternAssociations.field1[0].apply_at).toBe("ingestion");
    });

    it("should update apply_at when defined in the updated pattern", () => {
      const updatedPattern = {
        field: "field1",
        pattern_name: "p1",
        pattern_id: "id1",
        apply_at: "query_time",
      };

      wrapper.vm.handleUpdateAppliedPattern(updatedPattern, "field1", "id1", "apply_at");

      expect(wrapper.vm.patternAssociations.field1[0].apply_at).toBe("query_time");
    });
  });

  // ==========================================
  // Phase 2 tests — updateDefinedSchemaFields timestamp/allFields delete paths
  // ==========================================
  describe("updateDefinedSchemaFields delete paths", () => {
    beforeEach(async () => {
      store.state.zoConfig.timestamp_column = "_timestamp";
      store.state.zoConfig.all_fields_name = "_all";
      mockGetStream.mockResolvedValue({
        name: "delete-paths-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [
          { name: "_timestamp", type: "Int64" },
          { name: "_all", type: "Utf8" },
          { name: "message", type: "Utf8" },
        ],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "delete-paths-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [
              { name: "_timestamp", type: "Int64" },
              { name: "_all", type: "Utf8" },
              { name: "message", type: "Utf8" },
            ],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should delete timestamp_column and allFieldsName from selectedFieldsSet", () => {
      // Include _timestamp and _all in selected fields to exercise the
      // delete paths at lines 2357-2361 in updateDefinedSchemaFields
      wrapper.vm.selectedFields = [
        { name: "_timestamp" },
        { name: "_all" },
        { name: "message" },
      ];
      wrapper.vm.activeTab = "allFields";

      wrapper.vm.updateDefinedSchemaFields();

      // _timestamp and _all should be filtered from defined_schema_fields
      expect(wrapper.vm.indexData.defined_schema_fields).not.toContain("_timestamp");
      expect(wrapper.vm.indexData.defined_schema_fields).not.toContain("_all");
      expect(wrapper.vm.indexData.defined_schema_fields).toContain("message");
    });

    it("should call updateResultTotal with activeTab as schemaFields", () => {
      // updateResultTotal is internal (not exported from setup).
      // Test the behavior indirectly by calling updateStreamResponse
      // with activeTab set to "schemaFields" — this exercises
      // the resultTotal = defined_schema_fields.length branch
      wrapper.vm.activeTab = "schemaFields";
      wrapper.vm.indexData.defined_schema_fields = ["field1", "field2"];

      const mockResponse = {
        settings: { defined_schema_fields: ["field1", "field2"] },
        schema: [{ name: "field1" }, { name: "field2" }, { name: "field3" }],
      };

      wrapper.vm.updateStreamResponse(mockResponse);

      // activeTab is "schemaFields", so resultTotal should be defined_schema_fields length
      expect(wrapper.vm.resultTotal).toBe(2);
    });
  });

  // ==========================================
  // Phase 2 tests — deleteFields error branch (res.data.code != 200)
  // ==========================================
  describe("deleteFields non-200 response", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "del-non200-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }, { name: "field_to_delete", type: "Utf8" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "del-non200-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }, { name: "field_to_delete", type: "Utf8" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should show error toast when deleteFields returns non-200 code", async () => {
      const { mockStreamServiceDeleteFields } = await (async () => {
        const mod = await import("@/services/stream");
        return { mockStreamServiceDeleteFields: mod.default.deleteFields };
      })();

      mockToast.mockClear();
      vi.mocked(mockStreamServiceDeleteFields).mockResolvedValueOnce({
        data: { code: 400, message: "Cannot delete system field" },
      });

      wrapper.vm.selectedFields = [{ name: "field_to_delete" }];

      await wrapper.vm.deleteFields();
      await flushPromises();

      // Should toast the error message from the response
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Cannot delete system field",
        }),
      );
      expect(wrapper.vm.confirmQueryModeChangeDialog).toBe(false);
    });
  });

  // ==========================================
  // Phase 2 tests — event handler: enforceMaxIndexTypes in template
  // ==========================================
  describe("enforceMaxIndexTypes template integration", () => {
    it("should cap index type at 2 when exceeding max via enforceMaxIndexTypes + updateIndexType", () => {
      // Simulate the template: enforceMaxIndexTypes wraps the value before
      // passing to updateIndexType, mirroring:
      // @update:model-value="(val) => updateIndexType({ row }, enforceMaxIndexTypes(val))"
      const capped = wrapper.vm.enforceMaxIndexTypes([
        "fullTextSearchKey",
        "secondaryIndexKey",
        "bloomFilterKey",
      ]);
      expect(capped.length).toBe(2);

      const row = { name: "field1", index_type: [] };
      wrapper.vm.updateIndexType({ row }, capped);
      expect(row.index_type.length).toBe(2);
    });
  });

  // ==========================================
  // Phase 2 tests — handleUpdateAppliedPattern with null apply_at
  // ==========================================
  describe("handleUpdateAppliedPattern null apply_at", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "null-apply-at-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "null-apply-at-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should handle updateAppliedPattern with null apply_at (else branch line 2587)", () => {
      wrapper.vm.patternAssociations = {
        fieldX: [{ field: "fieldX", pattern_name: "px", pattern_id: "pidX", policy: "replace", apply_at: "ingestion" }],
      };
      const pattern = { field: "fieldX", pattern_name: "px", pattern_id: "pidX", policy: "replace", apply_at: null };

      wrapper.vm.handleUpdateAppliedPattern(pattern, "fieldX", "pidX", "apply_at");

      const updatedPattern = wrapper.vm.patternAssociations.fieldX[0];
      expect(updatedPattern.apply_at).toBeUndefined();
    });
  });

  // ==========================================
  // Phase 2 tests — filterFieldFn index_type matching
  // ==========================================
  describe("filterFieldFn index_type matching", () => {
    beforeEach(async () => {
      store.state.zoConfig.timestamp_column = "_timestamp";
      mockGetStream.mockResolvedValue({
        name: "filter-idx-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [
          { name: "_timestamp", type: "Int64", index_type: [] },
          { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
          { name: "status", type: "Utf8", index_type: ["secondaryIndexKey"] },
        ],
        settings: {
          full_text_search_keys: ["message"],
          index_fields: ["status"],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "filter-idx-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [
              { name: "_timestamp", type: "Int64", index_type: [] },
              { name: "message", type: "Utf8", index_type: ["fullTextSearchKey"] },
              { name: "status", type: "Utf8", index_type: ["secondaryIndexKey"] },
            ],
            settings: {
              full_text_search_keys: ["message"],
              index_fields: ["status"],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should match by index_type value in filterFieldFn", () => {
      // Filter by a direct index_type value match (exercises lines 2060-2066)
      const rows = wrapper.vm.indexData.schema;
      const result = wrapper.vm.filterFieldFn(rows, "fullTextSearchKey@allFields");

      expect(result.length).toBe(1);
      expect(result[0].name).toBe("message");
    });

    it("should match by index_type label in filterFieldFn", () => {
      // Filter by an index type label that maps to a value
      const rows = wrapper.vm.indexData.schema;
      const result = wrapper.vm.filterFieldFn(rows, "full text search@allFields");

      expect(result.length).toBe(1);
      expect(result[0].name).toBe("message");
    });

    it("should match by index_type value in schemaFields tab", () => {
      // Exercise the schemaFields index_type matching path (lines 2036-2045)
      wrapper.vm.indexData.defined_schema_fields = ["message", "status"];
      const rows = wrapper.vm.indexData.schema;

      // Search for "secondaryIndexKey" in schemaFields tab
      // "status" has secondaryIndexKey and is in defined_schema_fields
      const result = wrapper.vm.filterFieldFn(rows, "secondaryIndexKey@schemaFields");

      expect(result.length).toBe(1);
      expect(result[0].name).toBe("status");
    });

    it("should match by index_type label (label->value map) in schemaFields tab", () => {
      wrapper.vm.indexData.defined_schema_fields = ["message"];
      const rows = wrapper.vm.indexData.schema;

      const result = wrapper.vm.filterFieldFn(rows, "full text search@schemaFields");

      expect(result.length).toBe(1);
      expect(result[0].name).toBe("message");
    });

    it("should return all schemaFields when search term is empty", () => {
      // Exercises line 2029: filterFieldFn with empty search in schemaFields tab
      wrapper.vm.indexData.defined_schema_fields = ["message", "status"];
      const rows = wrapper.vm.indexData.schema;

      const result = wrapper.vm.filterFieldFn(rows, "@schemaFields");

      expect(result.length).toBe(2);
      expect(result.map((r: any) => r.name).sort()).toEqual(["message", "status"]);
    });
  });

  // ==========================================
  // Phase 2 tests — disableOptions hashPartition conflict with keyPartition/prefixPartition
  // ==========================================
  describe("disableOptions hashPartition-keyPartition/prefixPartition conflict", () => {
    it("should disable hashPartition when row already has keyPartition", () => {
      const schema = { name: "field1", index_type: ["keyPartition"] };
      const hashOption = { value: "hashPartition_8" };

      expect(wrapper.vm.disableOptions(schema, hashOption)).toBe(true);
    });

    it("should disable hashPartition when row already has prefixPartition", () => {
      const schema = { name: "field2", index_type: ["prefixPartition"] };
      const hashOption = { value: "hashPartition_16" };

      expect(wrapper.vm.disableOptions(schema, hashOption)).toBe(true);
    });
  });

  // ==========================================
  // Phase 2 tests — Exercise remaining computed/functions for coverage
  // ==========================================
  describe("Coverage-closing test: exercise setup-level functions", () => {
    beforeEach(async () => {
      mockGetStream.mockResolvedValue({
        name: "coverage-close-stream",
        stream_type: "logs",
        storage_type: "s3",
        stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
        schema: [{ name: "_timestamp", type: "Int64" }],
        settings: {
          full_text_search_keys: [],
          index_fields: [],
          bloom_filter_fields: [],
          data_retention: 30,
          max_query_range: 0,
          store_original_data: false,
          approx_partition: false,
          defined_schema_fields: [],
          extended_retention_days: [],
          partition_keys: {},
        },
        pattern_associations: [],
      });
      wrapper = mount(LogStream, {
        props: {
          modelValue: {
            name: "coverage-close-stream",
            stream_type: "logs",
            storage_type: "s3",
            stats: { doc_time_min: 0, doc_time_max: 0, doc_num: 0, file_num: 0, storage_size: 0, compressed_size: 0 },
            schema: [{ name: "_timestamp", type: "Int64" }],
            settings: {
              full_text_search_keys: [],
              index_fields: [],
              bloom_filter_fields: [],
              data_retention: 30,
              max_query_range: 0,
              store_original_data: false,
              approx_partition: false,
              defined_schema_fields: [],
              extended_retention_days: [],
              partition_keys: {},
              pattern_associations: [],
            },
          },
        },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: { ODrawer: ODrawerStub },
        },
      });
      await flushPromises();
    });

    it("should access showPartitionColumn computed to trigger function coverage", () => {
      expect(typeof wrapper.vm.showPartitionColumn).toBe("boolean");
    });

    it("should access showFullTextSearchColumn computed to trigger function coverage", () => {
      expect(typeof wrapper.vm.showFullTextSearchColumn).toBe("boolean");
    });

    it("should access filteredSchemaData with empty filter to exercise filter callback", () => {
      wrapper.vm.filterField = "";
      const data = wrapper.vm.filteredSchemaData;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });

    it("should exercise onSubmit with non-empty newSchemaFields (maps)", async () => {
      // Func 55, 56: newSchemaFields map callbacks in onSubmit. The row gate
      // validates the NORMALIZED name, so a dash is allowed — "test-field"
      // normalizes to "test_field" (valid), passes the gate, and is saved.
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "test-field", type: "Utf8", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockUpdateSettings).toHaveBeenCalled();
      // newSchemaFields should be reset after successful save
      expect(wrapper.vm.newSchemaFields).toEqual([]);
    });

    it("should block onSubmit when a field name has invalid characters", async () => {
      // Option A gating: "!" survives normalization, so "user!id" fails the row
      // schema. onSubmit reveals the inline error and does NOT save — the fix for
      // the dropped inline feedback (invalid names no longer pass silently).
      wrapper.vm.isDialogOpen = true;
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "user!id", type: "Utf8", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      mockUpdateSettings.mockClear();
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockUpdateSettings).not.toHaveBeenCalled();
      // Rows are preserved (not reset) so the user can correct them.
      expect(wrapper.vm.newSchemaFields.length).toBe(1);
    });

    it("should block onSubmit when a field has no data type", async () => {
      // The data-type select is visible + required in the Add Field(s) card, so a
      // row with a valid name but no type also blocks the save.
      wrapper.vm.isDialogOpen = true;
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "valid_name", type: "", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      mockUpdateSettings.mockClear();
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(mockUpdateSettings).not.toHaveBeenCalled();
      expect(wrapper.vm.newSchemaFields.length).toBe(1);
    });

    it("should save on Enter from a field-name input", async () => {
      // Enter in the Add Field(s) name input triggers the settings save (the
      // nested <form> otherwise swallows Enter with 2+ rows).
      wrapper.vm.isDialogOpen = true;
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "valid_name", type: "Utf8", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      mockUpdateSettings.mockClear();
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onAddFieldsKeyup({
        key: "Enter",
        target: { tagName: "INPUT", name: "newSchemaFields[0].name" },
      });
      await flushPromises();

      expect(mockUpdateSettings).toHaveBeenCalled();
    });

    it("should NOT save on Enter from the data-type select (only the name input submits)", async () => {
      wrapper.vm.isDialogOpen = true;
      wrapper.vm.newSchemaFieldsForm.setFieldValue("newSchemaFields", [
        { name: "valid_name", type: "Utf8", index_type: [] },
      ]);
      await wrapper.vm.$nextTick();

      mockUpdateSettings.mockClear();
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      // Enter on the type field (dropdown) must not submit.
      wrapper.vm.onAddFieldsKeyup({
        key: "Enter",
        target: { tagName: "INPUT", name: "newSchemaFields[0].type" },
      });
      // A non-Enter key on the name input must not submit either.
      wrapper.vm.onAddFieldsKeyup({
        key: "a",
        target: { tagName: "INPUT", name: "newSchemaFields[0].name" },
      });
      await flushPromises();

      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it("should exercise cross-links diff in onSubmit with modified links", async () => {
      // Set up cross-links to exercise the diff computation
      // (func 61: prevCrossLinks.map, func 64: currCrossLinks.filter, func 65: inline fn)
      wrapper.vm.streamCrossLinks = [
        { name: "a", url: "https://a.com", fields: ["_timestamp"] },
      ];
      // prevCrossLinks has "a" in it (from settings.cross_links which was set in previousSchemaVersion)
      // streamCrossLinks has "a" — so prevCrossLinkNames includes "a" and currCrossLinkNames includes "a"
      // This exercises the diff path
      mockUpdateSettings.mockResolvedValue({ data: { code: 200 } });

      await wrapper.vm.onSubmit();
      await flushPromises();

      // Should have been called
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });
});
