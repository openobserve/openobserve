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

describe.skip("Streams", async () => {
  let wrapper: any;

  beforeEach(async () => {
    
    const updateStream = vi.spyOn(StreamService, "updateSettings");

    wrapper = mount(LogStream, {
      props: {
        modelValue: {
          name: "k8s_json",
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
              name: "kubernetes.container_hash",
              type: "Utf8",
            },
            {
              name: "log",
              type: "Utf8",
            },
            {
              name: "message",
              type: "Utf8",
            },
            {
              name: "test_this_field",
              type: "Utf8",
            },
          ],
          settings: {
            partition_time_level: "hourly",
            partition_keys: {},
            full_text_search_keys: ["level", "log"],
            index_fields: [],
            bloom_filter_fields: [],
            distinct_value_fields: [],
            data_retention: 3650,
            max_query_range: 0,
            store_original_data: false,
            approx_partition: false,
            index_updated_at: 1737970280285469,
            extended_retention_days: [],
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

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("should display title", () => {
    const pageTitle = wrapper.find('[data-test="schema-title-text"]');
    expect(pageTitle.text()).toBe("Stream Detail");
  });

  it("Should display stream title", () => {
    const streamTitle = wrapper.find('[data-test="schema-stream-title-text"]');
    expect(streamTitle.text()).toBe("Stream Name k8s_json");
  });

  it("Should have cancel button", () => {
    const cancelButton = wrapper.find('[data-test="schema-cancel-button"]');
    expect(cancelButton.exists()).toBeTruthy();
    expect(cancelButton.text()).toBe("Cancel");
  });

  it("Should have Update Settings button", () => {
    const updateSettingsButton = wrapper.find(
      '[data-test="schema-update-settings-button"]',
    );
    expect(updateSettingsButton.exists()).toBeTruthy();
    expect(updateSettingsButton.text()).toBe("Update Settings");
  });

  it("Should display stream fields mapping table", async () => {
    const table = await wrapper.find(
      '[data-test="schema-log-stream-field-mapping-table"]',
    );
    expect(table.exists()).toBeTruthy();
  });

  it("Should display stream fields mapping title", () => {
    const table = wrapper.find(
      '[data-test="schema-log-stream-mapping-title-text"]',
    );
    expect(table.text()).toBe(
      "Mapping Default FTS keys used (no custom keys set).Store Original Data",
    );
  });

  it("Should display stream fields mapping table headers", () => {
    const tableHeaders = wrapper
      .find('[data-test="schema-log-stream-field-mapping-table"]')
      .find("thead")
      .find("tr")
      .findAll("th");

    expect(tableHeaders[0].text()).toBe("");
    expect(tableHeaders[1].text()).toBe("Fieldarrow_upward");
  });

  it.skip("Should display stream fields mapping table data", () => {
    const tableData = wrapper
      .find('[data-test="schema-log-stream-field-mapping-table"]')
      .find("tbody")
      .findAll("tr")[0]
      .findAll("td");

    expect(tableData[0].text()).toBe("");
    expect(tableData[1].text()).toBe("_timestamp");
    expect(tableData[2].text()).toBe("Int64");
  });

  // TODO : Check if we can update this test case
  // - expect(logCheckbox.find(".q-checkbox__inner--truthy").exists()).toBeTruthy();
  // + expect(wrapper.vm.ftsKeys.includes('log')).toBeTruthy();

  describe("When user make changes and update settings", () => {
    const updateStream = vi.spyOn(StreamService, "updateSettings");

    

    let logPartition, timeStampCheckbox, updateSettingsButton: any;
    beforeEach(async () => {
    });
    it("Should make api call when user updates the form and click update settings ", async () => {
      // Find the q-toggle component wrapper
      const toggleWrapper = await wrapper.find(
        '[data-test="log-stream-store-original-data-toggle-btn"]',
      );

      // Verify initial state of the toggle
      const checkBox = await toggleWrapper.find('input[type="checkbox"]');
      expect(checkBox.element.checked).toBe(false);

      // Simulate a click on the toggle
      await checkBox.trigger("click");
      await wrapper.vm.$nextTick();
      await flushPromises();

      await checkBox.setValue(true);
      expect(checkBox.element.checked).toBe(true);

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);

      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");

      // Simulate form submission
      // const settingsForm = wrapper.find('[data-test="settings-form"]');
      // await settingsForm.trigger("submit");
      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();

      // Verify that the API call was made (mocked in your setup)
      expect(updateStream).toHaveBeenCalledTimes(1); // Uncomment if you have a mocked function
    });
    it("Should prevent multiple API calls on rapid form submissions", async () => {
      // Simulate form changes
      const toggleWrapper = wrapper.find(
        '[data-test="log-stream-store-original-data-toggle-btn"]',
      );
      const checkBox = toggleWrapper.find('input[type="checkbox"]');
      await checkBox.setValue(true);
      await checkBox.trigger("click");
      await wrapper.vm.$nextTick();

      await checkBox.setValue(true);
      expect(checkBox.element.checked).toBe(true);

      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );

      // Rapidly trigger multiple submissions
      await Promise.all([
        updateSettingsButton.trigger("submit"),
        updateSettingsButton.trigger("submit"),
        updateSettingsButton.trigger("submit"),
      ]);

      await flushPromises();

      // Verify that only one API call was made
      expect(updateStream).toHaveBeenCalledTimes(1);
    });
    it("Should not call update settings API if retention days is less than 1", async () => {
      // Simulate form changes
      const retentionDaysInput = await wrapper.find(
        '[data-test="stream-details-data-retention-input"]',
      );

      await retentionDaysInput.setValue(0); // Set retention days to less than 1
      await retentionDaysInput.trigger("input");
      await wrapper.vm.$nextTick();

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);

      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");

      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();

      // Verify that the API call was not made
      expect(updateStream).toHaveBeenCalledTimes(0);
    });

    it("Should handle API error when updating settings", async () => {
      // Mock the API to return an error
      await flushPromises();

      // Simulate form changes
      const toggleWrapper = wrapper.find(
        '[data-test="log-stream-store-original-data-toggle-btn"]',
      );
      const checkBox = toggleWrapper.find('input[type="checkbox"]');
      await checkBox.setValue(true);
      await checkBox.trigger("click");
      await wrapper.vm.$nextTick();

      await checkBox.setValue(true);
      expect(checkBox.element.checked).toBe(true);

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);

      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");

      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();

      // Verify that the API call was made and handled the error
      expect(updateStream).toHaveBeenCalledTimes(1);
      expect(
        updateStream.mock.settledResults[0].value.response.data.message,
      ).toBe("Internal Server Error"); // Assuming you set an errorMessage in your component
    });
    it("Should update index type to prefixPartition when selected and verify using update call", async () => {
      await flushPromises();
      // Find the index type select dropdown within the table row
      const indexTypeSelectWrapper = wrapper
        .find('[data-test="schema-log-stream-field-mapping-table"]')
        .findAll("tbody tr")
        .at(1) // Assuming you want to select the first row for this test
        .find('[data-test="schema-stream-index-select"]');
      const indexTypeSelector = indexTypeSelectWrapper.findComponent({
        name: "QSelect",
      });

      // Simulate selecting the "prefixPartition" option
      await indexTypeSelector.vm.$emit("update:modelValue", [
        "prefixPartition",
      ]);

      await wrapper.vm.$nextTick();

      // Verify that the selected value is "prefixPartition"
      // expect(indexTypeSelect.element.value).toBe("prefixPartition");

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");
      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();
      const parsedRequest = JSON.parse(
        updateStream.mock.settledResults[0].value.config.data,
      );

      parsedRequest.partition_keys.add.forEach((index: any) => {
        if (index.field == "kubernetes.container_hash") {
          expect(index.types).toEqual("prefix");
        }
      });
      // Verify that the API call was made
      expect(updateStream).toHaveBeenCalledTimes(1);
    });
    it("Should update index type to fullTextSearchKey when selected and verify using update call", async () => {
      await flushPromises();
      // Find the index type select dropdown within the table row
      const indexTypeSelectWrapper = wrapper
        .find('[data-test="schema-log-stream-field-mapping-table"]')
        .findAll("tbody tr")
        .at(1) // Assuming you want to select the first row for this test
        .find('[data-test="schema-stream-index-select"]');
      const indexTypeSelector = indexTypeSelectWrapper.findComponent({
        name: "QSelect",
      });

      // Simulate selecting the "prefixPartition" option
      await indexTypeSelector.vm.$emit("update:modelValue", [
        "fullTextSearchKey",
      ]);

      await wrapper.vm.$nextTick();

      // Verify that the selected value is "prefixPartition"
      // expect(indexTypeSelect.element.value).toBe("prefixPartition");

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");
      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();
      const parsedRequest = JSON.parse(
        updateStream.mock.settledResults[0].value.config.data,
      );
      expect(parsedRequest.full_text_search_keys.add[0]).toEqual(
        "kubernetes.container_hash",
      );
      // Verify that the API call was made
      expect(updateStream).toHaveBeenCalledTimes(1);
    });
    it("Should update index type to keyPartition when selected and verify using update call", async () => {
      await flushPromises();
      // Find the index type select dropdown within the table row
      const indexTypeSelectWrapper = wrapper
        .find('[data-test="schema-log-stream-field-mapping-table"]')
        .findAll("tbody tr")
        .at(2) // Assuming you want to select the first row for this test
        .find('[data-test="schema-stream-index-select"]');
      const indexTypeSelector = indexTypeSelectWrapper.findComponent({
        name: "QSelect",
      });

      // Simulate selecting the "prefixPartition" option
      await indexTypeSelector.vm.$emit("update:modelValue", ["keyPartition"]);

      await wrapper.vm.$nextTick();

      // Verify that the selected value is "prefixPartition"
      // expect(indexTypeSelect.element.value).toBe("prefixPartition");

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");
      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();
      const parsedRequest = JSON.parse(
        updateStream.mock.settledResults[0].value.config.data,
      );

      parsedRequest.partition_keys.add.forEach((index: any) => {
        if (index.field == "log") {
          expect(index.types).toEqual("value");
        }
      });
      // Verify that the API call was made
      expect(updateStream).toHaveBeenCalledTimes(1);
    });
    it("Should update index type to hashPartition_8 when selected and verify using update call", async () => {
      await flushPromises();
      // Find the index type select dropdown within the table row
      const indexTypeSelectWrapper = wrapper
        .find('[data-test="schema-log-stream-field-mapping-table"]')
        .findAll("tbody tr")
        .at(3) // Assuming you want to select the first row for this test
        .find('[data-test="schema-stream-index-select"]');
      const indexTypeSelector = indexTypeSelectWrapper.findComponent({
        name: "QSelect",
      });

      // Simulate selecting the "prefixPartition" option
      await indexTypeSelector.vm.$emit("update:modelValue", [
        "hashPartition_8",
      ]);

      await wrapper.vm.$nextTick();

      // Verify that the selected value is "prefixPartition"
      // expect(indexTypeSelect.element.value).toBe("prefixPartition");

      // Verify that formDirtyFlag has been updated
      expect(wrapper.vm.formDirtyFlag).toBe(true);
      // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      expect(updateSettingsButton.attributes("disabled")).toBe(undefined); // Ensure it's enabled
      await updateSettingsButton.trigger("submit");
      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();
      const parsedRequest = JSON.parse(
        updateStream.mock.settledResults[0].value.config.data,
      );

      parsedRequest.partition_keys.add.forEach((index: any) => {
        if (index.field == "message") {
          expect(index.types.hash).toEqual(8);
        }
      });
      // Verify that the API call was made
      expect(updateStream).toHaveBeenCalledTimes(1);
    });
    it("Should add fields to user defined schema", async () => {
      await flushPromises();
      // Find the index type select dropdown within the table row
      const indexTypeSelectWrapper = wrapper.find(
        '[data-test="schema-stream-delete-log-field-fts-key-checkbox"]',
      );
      const indexTypeSelector = await indexTypeSelectWrapper.find(
        'input[type="checkbox"]',
      );

      await indexTypeSelector.setValue(true);
      await indexTypeSelector.trigger("click");

      await wrapper.vm.$nextTick();


      const updateSchemaBtn = await wrapper.find(
        '[data-test="schema-add-field-button"]',
      );

      await updateSchemaBtn.trigger("click");

      // wrapper.vm.formDirtyFlag = true;

      await wrapper.vm.$nextTick(); // Find and trigger the update settings button
      const updateSettingsButton = wrapper.find(
        '[data-test="schema-update-settings-button"]',
      );
      await updateSettingsButton.trigger("submit");
      await flushPromises();
      await vi.advanceTimersByTime(500);
      await flushPromises();
      const parsedRequest = JSON.parse(
        updateStream.mock.settledResults[0].value.config.data,
      );

      parsedRequest.partition_keys.add.forEach((index: any) => {
        expect(index).toEqual("log");
      });
      // Verify that the API call was made
      expect(updateStream).toHaveBeenCalledTimes(1);
    });

    describe("disable options test cases", () => {
      it("disable Options: should disable options correctly based on row data", async () => {
        const wrapper = mount(LogStream, {
          props: {
            modelValue: {
              name: "k8s_json",
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
                  name: "kubernetes.container_hash",
                  type: "Utf8",
                },
                {
                  name: "log",
                  type: "Utf8",
                },
                {
                  name: "message",
                  type: "Utf8",
                },
                {
                  name: "test_this_field",
                  type: "Utf8",
                },
              ],
              settings: {
                partition_time_level: "hourly",
                partition_keys: {},
                full_text_search_keys: ["level", "log"],
                index_fields: [],
                bloom_filter_fields: [],
                distinct_value_fields: [],
                data_retention: 3650,
                max_query_range: 0,
                store_original_data: false,
                approx_partition: false,
                index_updated_at: 1737970280285469,
                extended_retention_days: [],
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

        const disableOptions = wrapper.vm.disableOptions;

        const row = {
          name: "log",
          index_type: ["fullTextSearchKey"],
        };

        const option = { value: "prefixPartition" };
        const result = disableOptions(row, option);
        expect(result).toBe(false);

        row.index_type = ["keyPartition"];
        const result2 = disableOptions(row, option);
        expect(result2).toBe(true);
      });
    });
    describe("filterFieldFn test cases", () => {
      const rows = [
        { name: "log" },
        { name: "message" },
        { name: "kubernetes.container_hash" },
        { name: "_timestamp" },
      ];

      const indexData = {
        value: {
          defined_schema_fields: ["log", "message"],
        },
      };

      it("should filter rows based on field name", () => {
        const filterFieldFn = wrapper.vm.filterFieldFn;

        const terms = "log";
        const result = filterFieldFn(rows, terms);
        expect(result).toEqual([{ name: "log" }]);
      });

      it("should filter rows based on field name and schemaFields type", () => {
        const filterFieldFn = wrapper.vm.filterFieldFn;

        const terms = "message";
        const result = filterFieldFn(rows, terms);
        expect(result).toEqual([{ name: "message" }]);
      });

      it("should return all rows if field is empty and type is schemaFields", () => {
        const filterFieldFn = wrapper.vm.filterFieldFn;

        const terms = "@schemaFields";
        const result = filterFieldFn(rows, terms);
        expect(result).toEqual([]);
      });

      it("should return all rows if field is empty", () => {
        const filterFieldFn = wrapper.vm.filterFieldFn;

        const terms = "";
        const result = filterFieldFn(rows, terms);
        expect(result).toEqual(rows);
      });

      it("should return empty array if no rows match the field", () => {
        const filterFieldFn = wrapper.vm.filterFieldFn;

        const terms = "nonexistent";
        const result = filterFieldFn(rows, terms);
        expect(result).toEqual([]);
      });

      it("should filter rows based on field name case insensitively", () => {
        const filterFieldFn = wrapper.vm.filterFieldFn;

        const terms = "LOG";
        const result = filterFieldFn(rows, terms);
        expect(result).toEqual([{ name: "log" }]);
      });
    });

    describe("Schema Field Management", () => {
      let wrapper: any;

      beforeEach(async () => {
        
        wrapper = mount(LogStream, {
          props: {
            modelValue: {
              name: "k8s_json",
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
                  name: "kubernetes.container_hash",
                  type: "Utf8",
                },
                {
                  name: "log",
                  type: "Utf8",
                },
                {
                  name: "message",
                  type: "Utf8",
                },
                {
                  name: "test_this_field",
                  type: "Utf8",
                },
              ],
              settings: {
                partition_time_level: "hourly",
                partition_keys: {},
                full_text_search_keys: ["level", "log"],
                index_fields: [],
                bloom_filter_fields: [],
                distinct_value_fields: [],
                data_retention: 3650,
                max_query_range: 0,
                store_original_data: false,
                approx_partition: false,
                index_updated_at: 1737970280285469,
                extended_retention_days: [],
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

      afterEach(() => {
        wrapper.unmount();
        vi.restoreAllMocks();
      });

      it("should add a new schema field", async () => {
        const addSchemaFieldButton = wrapper.find(
          '[data-test="schema-add-fields-title"]',
        );
        await addSchemaFieldButton.trigger("click");

        expect(wrapper.vm.newSchemaFields.length).toBe(1);
        expect(wrapper.vm.newSchemaFields[0]).toEqual({
          name: "",
          type: "",
          index_type: [],
        });
        expect(wrapper.vm.formDirtyFlag).toBe(true);
      });

      it("should remove a schema field", async () => {
        const addSchemaFieldButton = wrapper.find(
          '[data-test="schema-add-fields-title"]',
        );
        await addSchemaFieldButton.trigger("click");
        wrapper.vm.newSchemaFields = [
          { name: "field1", type: "Utf8", index_type: [] },
          { name: "field2", type: "Int64", index_type: [] },
        ];
        wrapper.vm.removeSchemaField(0);
        expect(wrapper.vm.newSchemaFields.length).toBe(1);
        expect(wrapper.vm.newSchemaFields[0]).toEqual({
          name: "field2",
          type: "Int64",
          index_type: [],
        });
      });

      it("should close dialog and reset newSchemaFields when last field is removed", async () => {
        wrapper.vm.newSchemaFields = [
          { name: "field1", type: "Utf8", index_type: [] },
        ];
        wrapper.vm.isDialogOpen = true;
        wrapper.vm.removeSchemaField(0);

        expect(wrapper.vm.newSchemaFields.length).toBe(0);
        expect(wrapper.vm.isDialogOpen).toBe(false);
        expect(wrapper.vm.newSchemaFields).toEqual([]);
      });
    });
  });
});
