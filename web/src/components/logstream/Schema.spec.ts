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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import LogStream from "@/components/logstream/schema.vue";
import i18n from "@/locales";
// @ts-ignore
import store from "@/test/unit/helpers/store";
import StreamService from "@/services/stream";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("Schema Component Tests", async () => {
  let wrapper: any;

  // Additional comprehensive tests for schema.vue functions from lines 697-1784
  describe("Comprehensive Schema Function Tests", () => {
    beforeEach(async () => {
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
              {
                name: "_timestamp",
                type: "Int64",
              },
              {
                name: "message",
                type: "Utf8",
              },
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
              pattern_associations: []
            },
          },
        },
        global: {
          provide: {
            store: store,
          },
          plugins: [i18n],
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
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
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
    it("should open dialog and initialize fields", () => {
      wrapper.vm.openDialog();
      
      expect(wrapper.vm.isDialogOpen).toBe(true);
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      expect(wrapper.vm.newSchemaFields.length).toBe(1);
      expect(wrapper.vm.newSchemaFields[0]).toEqual({
        name: "",
        type: "",
        index_type: [],
      });
    });

    // Test 7: closeDialog function
    it("should close dialog and reset fields", () => {
      wrapper.vm.isDialogOpen = true;
      wrapper.vm.newSchemaFields = [{ name: "test", type: "string", index_type: [] }];
      
      wrapper.vm.closeDialog();
      
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

    // Test 23: convertUnixToQuasarFormat function
    it("should convert unix timestamp correctly", () => {
      const unixMicroseconds = 1703505000000000; // 2023-12-25
      const result = wrapper.vm.convertUnixToQuasarFormat(unixMicroseconds);
      expect(result).toMatch(/\d{2}-\d{2}-\d{4}/);
    });

    // Test 24: convertUnixToQuasarFormat with empty input
    it("should handle empty unix timestamp", () => {
      const result = wrapper.vm.convertUnixToQuasarFormat("");
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
    it("should handle date change correctly", () => {
      const dateValue = {
        selectedDate: {
          from: new Date("2023-12-25"),
          to: new Date("2023-12-26")
        },
        relativeTimePeriod: null
      };
      
      wrapper.vm.dateChangeValue(dateValue);
      expect(wrapper.vm.redDaysList.length).toBeGreaterThan(0);
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
      expect(wrapper.vm.computedSchemaFieldsName).toBe("Other Fields");
    });

    // Test 36: tabs computed property
    it("should compute tabs correctly", () => {
      wrapper.vm.indexData.defined_schema_fields = ["field1"];
      wrapper.vm.indexData.schema = [{ name: "field1" }, { name: "field2" }];
      
      const tabs = wrapper.vm.tabs;
      expect(tabs[0].value).toBe("schemaFields");
      expect(tabs[1].value).toBe("allFields");
      expect(tabs[0].label).toContain("User Defined Schema (1)");
      expect(tabs[1].label).toContain("Other Fields (2)");
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
      const notifySpy = vi.spyOn(wrapper.vm.q, "notify");
      wrapper.vm.store.state.zoConfig.user_defined_schema_max_fields = 5;
      wrapper.vm.indexData.defined_schema_fields = ["f1", "f2", "f3", "f4"];
      wrapper.vm.selectedFields = [{ name: "f5" }, { name: "f6" }]; // Would exceed limit
      wrapper.vm.activeTab = "allFields";

      wrapper.vm.updateDefinedSchemaFields();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: expect.stringContaining("Maximum allowed fields")
        })
      );
      expect(wrapper.vm.selectedFields).toEqual([]);
    });
  });
});
