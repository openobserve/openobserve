<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="column logs-index-menu tw:p-[0.375rem]! tw:h-[calc(100%-0.7rem)]"
    :class="store.state.theme == 'dark' ? 'theme-dark' : 'theme-light'"
  >
    <div style="max-width: 100%; overflow: hidden">
      <q-select
        ref="streamSelect"
        data-test="log-search-index-list-select-stream"
        v-model="searchObj.data.stream.selectedStream"
        :options="streamOptions"
        data-cy="index-dropdown"
        :placeholder="placeHolderText"
        input-debounce="0"
        behavior="menu"
        borderless
        dense
        use-input
        multiple
        emit-value
        map-options
        @filter="filterStreamFn"
        @update:model-value="handleMultiStreamSelection"
      >
        <q-tooltip
          v-if="searchObj.data.stream.selectedStream.length > 0"
          :delay="500"
          anchor="bottom left"
          self="top left"
          max-width="280px"
          style="font-size: 13px"
        >
          {{ searchObj.data.stream.selectedStream.join(", ") }}
        </q-tooltip>
        <template #no-option>
          <q-item>
            <q-item-section> {{ t("search.noResult") }}</q-item-section>
          </q-item>
        </template>
        <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
          <q-item style="cursor: pointer">
            <q-item-section @click="handleSingleStreamSelect(opt)">
              <q-item-label v-html="opt.label" />
            </q-item-section>
            <q-item-section side>
              <q-toggle
                :data-test="`log-search-index-list-stream-toggle-${opt.label}`"
                :model-value="selected"
                class="indexlist-stream-toggle"
                size="20"
                @update:model-value="toggleOption(opt.value)"
              />
            </q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>
    <div
      v-if="
        (!searchObj.data.stream.selectedStreamFields ||
          searchObj.data.stream.selectedStreamFields.length == 0) &&
        searchObj.loading == false
      "
      class="index-table q-mt-xs"
    >
      <div
        data-test="logs-search-no-field-found-text"
        class="text-center col-10 q-mx-none q-pt-md"
      >
        <q-icon name="info" color="primary" size="xs" />
        {{ t("search.noFieldFoundInStream") }}
      </div>
    </div>
    <div v-else class="index-table q-mt-xs">
      <FieldList
        ref="fieldListRef"
        :stream-fields-rows="streamFieldsRows"
        :selected-stream="searchObj.data.stream.selectedStream[0]"
        :filter-field="searchObj.data.stream.filterField"
        :filter-field-fn="filterFieldFn"
        :pagination="pagination"
        @update:pagination="pagination = $event"
        @update:filter-field="searchObj.data.stream.filterField = $event"
        :wrap-cells="searchObj.meta.resultGrid.wrapCells"
        :loading-stream="searchObj.loadingStream"
        :show-only-interesting-fields="showOnlyInterestingFields"
        :interesting-expanded-group-rows-field-count="
          searchObj.data.stream.interestingExpandedGroupRowsFieldCount
        "
        :expand-group-rows-field-count="
          searchObj.data.stream.expandGroupRowsFieldCount
        "
        :expand-group-rows="searchObj.data.stream.expandGroupRows"
        :theme="store.state.theme"
        :selected-fields="searchObj.data.stream.selectedFields"
        :timestamp-column="store.state.zoConfig.timestamp_column"
        :show-quick-mode="searchObj.meta.quickMode"
        :field-values="fieldValues"
        :selected-streams-count="searchObj.data.stream.selectedStream.length"
        :show-user-defined-schema-toggle="showUserDefinedSchemaToggle"
        :use-user-defined-schemas="searchObj.meta.useUserDefinedSchemas"
        :user-defined-schema-btn-group-option="userDefinedSchemaBtnGroupOption"
        :selected-fields-btn-group-option="selectedFieldsBtnGroupOption"
        :total-fields-count="
          searchObj.data.stream.selectedStream.length > 1
            ? searchObj.data.stream.selectedStreamFields.length -
              (searchObj.data.stream.selectedStream.length + 1)
            : searchObj.data.stream.selectedStreamFields.length
        "
        @add-to-filter="addToFilter"
        @toggle-field="clickFieldFn"
        @toggle-interesting="addToInterestingFieldList"
        @add-search-term="addSearchTerm"
        @before-show="openFilterCreator"
        @before-hide="cancelFilterCreator"
        @toggle-group="toggleFieldGroup"
        @toggle-schema="toggleSchema"
        @toggle-interesting-fields="toggleInterestingFields"
        @set-page="setPage"
        @reset-fields="resetSelectedFileds"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  type Ref,
  watch,
  computed,
  onBeforeMount,
  onBeforeUnmount,
  nextTick,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useLogs from "../../composables/useLogs";
import {
  b64EncodeUnicode,
  getImageURL,
  convertTimeFromMicroToMilli,
  formatLargeNumber,
  useLocalInterestingFields,
  generateTraceContext,
  isStreamingEnabled,
  addSpacesToOperators,
} from "../../utils/zincutils";
import streamService from "../../services/stream";
import {
  outlinedAdd,
  outlinedVisibility,
  outlinedVisibilityOff,
} from "@quasar/extras/material-icons-outlined";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import searchService from "@/services/search";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { useSearchBar } from "@/composables/useLogs/useSearchBar";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import { searchState } from "@/composables/useLogs/searchState";
import { useStreamFields } from "@/composables/useLogs/useStreamFields";

interface Filter {
  fieldName: string;
  selectedValues: string[];
  selectedOperator: string;
}
export default defineComponent({
  name: "ComponentSearchIndexSelect",
  components: {
    EqualIcon,
    NotEqualIcon,
    FieldList: defineAsyncComponent(
      () => import("@/plugins/logs/components/FieldList.vue"),
    ),
  },
  emits: ["setInterestingFieldInSQLQuery"],
  methods: {
    handleMultiStreamSelection() {
      // Clear the filter input when streams change
      //we will first check if qselect is there or not and then call the method
      //we will use the quasar next tick to ensure that the dom is updated before we call the method
      //we will also us the quasar's updateInputValue method to clear the input value
      this.$nextTick(() => {
        const indexListSelectField = this.$refs.streamSelect;
        if (
          indexListSelectField &&
          indexListSelectField.inputValue &&
          indexListSelectField.updateInputValue
        ) {
          indexListSelectField.updateInputValue("");
        }
      });
      this.onStreamChange("");
      this.resetPagination();
    },
    handleSingleStreamSelect(opt: any) {
      if (this.searchObj.data.stream.selectedStream.indexOf(opt.value) == -1) {
        this.searchObj.data.stream.selectedFields = [];
      }
      this.searchObj.data.stream.selectedStream = [opt.value];
      // Clear the filter input and close the menu when single stream is selected
      //we will first check if qselect is there or not and then call the method
      //we will use the quasar next tick to ensure that the dom is updated before we call the method
      //we will also us the quasar's updateInputValue method to clear the input value
      this.$nextTick(() => {
        const indexListSelectField = this.$refs.streamSelect;
        if (indexListSelectField) {
          // Clear the search input
          if (indexListSelectField.updateInputValue) {
            indexListSelectField.updateInputValue("");
          }
          // // Close the dropdown menu
          // if (indexListSelectField.hidePopup) {
          //   indexListSelectField.hidePopup();
          // }
        }
      });
      this.onStreamChange("");
      this.resetPagination();
    },
  },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const {
      reorderSelectedFields,
      getFilterExpressionByFieldType,
      extractValueQuery,
    } = useLogs();

    const { filterHitsColumns, extractFields } = useStreamFields();

    const { searchObj, streamSchemaFieldsIndexMapping } = searchState();

    const { onStreamChange, handleQueryData } = useSearchBar();
    const { validateFilterForMultiStream } = useSearchStream();

    const { fnParsedSQL, fnUnparsedSQL, updatedLocalLogFilterField } =
      logsUtils();

    const {
      fetchQueryDataWithWebSocket,
      sendSearchMessageBasedOnRequestId,
      cancelSearchQueryBasedOnRequestId,
    } = useSearchWebSocket();

    const { fetchQueryDataWithHttpStream } = useHttpStreaming();

    const traceIdMapper = ref<{ [key: string]: string[] }>({});

    const showOnlyInterestingFields = ref(false);

    const userDefinedSchemaBtnGroupOption = ref([
      {
        label: "",
        value: "user_defined_schema",
        slot: "user_defined_slot",
      },
      {
        label: "",
        value: "all_fields",
        slot: "all_fields_slot",
      },
    ]);

    const selectedFieldsBtnGroupOption = [
      {
        label: "",
        value: false,
        slot: "all_fields_slot",
      },
      {
        label: "",
        value: true,
        slot: "interesting_fields_slot",
      },
    ];

    const streamOptions: any = ref([]);
    const fieldValues: Ref<{
      [key: string | number]: {
        isLoading: boolean;
        values: { key: string; count: number }[];
        errMsg?: string;
      };
    }> = ref({});

    const openedFilterFields = ref<string[]>([]);

    // New state to store field values with stream context
    const streamFieldValues: Ref<{
      [key: string]: {
        [stream: string]: {
          values: { key: string; count: number }[];
        };
      };
    }> = ref({});

    const pagination = ref({
      page: 1,
      rowsPerPage: 25,
    });

    const streamTypes = [
      { label: t("search.logs"), value: "logs" },
      { label: t("search.enrichmentTables"), value: "enrichment_tables" },
    ];

    const showUserDefinedSchemaToggle = computed(() => {
      return (
        store.state.zoConfig.user_defined_schemas_enabled &&
        searchObj.meta.hasUserDefinedSchemas
      );
    });

    const streamList = computed(() => {
      return searchObj.data.stream.streamLists;
    });

    const checkSelectedFields = computed(() => {
      return (
        searchObj.data.stream.selectedFields &&
        searchObj.data.stream.selectedFields.length > 0
      );
    });

    watch(
      () => streamList.value,
      () => {
        if (streamOptions.value.length === 0) {
          streamOptions.value = streamList.value;
        }
      },
      {
        deep: true,
      },
    );

    const resetFields = async () => {
      searchObj.loadingStream = true;

      // Wait for next tick to ensure loading state is rendered
      await nextTick();

      streamSchemaFieldsIndexMapping.value = {};
      await extractFields();

      // Wait for next tick before removing loading state
      await nextTick();
      searchObj.loadingStream = false;
    };

    const fieldListRef = ref<HTMLElement | null>(null);

    const scrollToTop = () => {
      if (fieldListRef.value) {
        // Find the scrollable container within the q-table
        const scrollContainer = fieldListRef?.value?.querySelector(
          ".q-table__middle.scroll",
        );
        if (scrollContainer) {
          scrollContainer.scrollTop = 0;
        }
      }
    };

    const resetPagination = () => {
      pagination.value.page = 1;

      // Reset scroll position when changing tabs
      nextTick(() => {
        scrollToTop();
      });
    };

    watch(
      () => searchObj.meta.quickMode,
      (isActive) => {
        if (isActive) {
          // check if its present in the array dont add it again
          if (
            !userDefinedSchemaBtnGroupOption.value.some(
              (option) => option.value === "interesting_fields",
            )
          ) {
            userDefinedSchemaBtnGroupOption.value.push({
              label: "",
              value: "interesting_fields",
              slot: "interesting_fields_slot",
            });
          }
          setDefaultFieldTab();
        } else {
          userDefinedSchemaBtnGroupOption.value =
            userDefinedSchemaBtnGroupOption.value.filter(
              (option) => option.value !== "interesting_fields",
            );

          if (searchObj.meta.useUserDefinedSchemas === "interesting_fields") {
            // As we are changing the tab reset the pagination
            if (pagination.value) resetPagination();
            searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
          }

          if (showOnlyInterestingFields.value)
            if (pagination.value) resetPagination();

          showOnlyInterestingFields.value = false;
        }
      },
      {
        immediate: true,
      },
    );

    // Removed resetFields() call on quick mode toggle to prevent flicker
    // watch(
    //   () => searchObj.meta.quickMode,
    //   () => {
    //     resetFields();
    //   },
    // );

    watch(
      () => [
        showUserDefinedSchemaToggle.value,
        searchObj.meta.useUserDefinedSchemas,
      ],
      (isActive) => {
        showOnlyInterestingFields.value =
          searchObj.meta.useUserDefinedSchemas === "interesting_fields";
      },
      {
        immediate: true,
      },
    );

    /**
     * Added this watcher to set default field tab when user defined schema toggle is changed
     * As when user selects stream defineSchema flag is set and there is no any event to identify that
     * so we are using this watcher to set default field tab as per the stream settings
     */
    watch(showUserDefinedSchemaToggle, () => {
      setDefaultFieldTab();
    });

    const filterStreamFn = (val: string, update: any) => {
      update(() => {
        streamOptions.value = streamList.value;
        const needle = val.toLowerCase();
        streamOptions.value = streamOptions.value.filter(
          (v: any) => v.label.toLowerCase().indexOf(needle) > -1,
        );
      });
    };

    const selectedStream = ref("");

    // if interesting field is enabled, then set default tab as interesting fields
    // otherwise set default tab as user defined schema
    // store.state.zoConfig.interesting_field_enabled was set as interesting fields was getting set by default with _timestamp field
    function setDefaultFieldTab() {
      if (store.state.zoConfig.log_page_default_field_list === "uds") {
        // reset pagination only if tab has changed
        if (searchObj.meta.useUserDefinedSchemas !== "user_defined_schema")
          resetPagination();
        searchObj.meta.useUserDefinedSchemas = "user_defined_schema";
        showOnlyInterestingFields.value = false;
      } else {
        // reset pagination only if tab has changed
        if (searchObj.meta.useUserDefinedSchemas !== "interesting_fields")
          resetPagination();
        searchObj.meta.useUserDefinedSchemas = "interesting_fields";
        showOnlyInterestingFields.value = true;
      }
    }

    const filterFieldFn = (rows: any, terms: any) => {
      var filtered = [];
      var includedFields: any = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (
            rows[i]["name"].toLowerCase().includes(terms) &&
            includedFields.indexOf(rows[i]["name"]) == -1
          ) {
            filtered.push(rows[i]);
            includedFields.push(rows[i]["name"]);
          }
        }
      }
      if (!filtered.length) {
        return [{ name: "no-fields-found", label: "No matching fields found" }];
      }
      return filtered;
    };

    const addToFilter = (field: any) => {
      searchObj.data.stream.addToFilter = field;
    };

    function clickFieldFn(row: { name: never }) {
      let selectedFields = reorderSelectedFields();

      if (selectedFields.includes(row.name)) {
        selectedFields = selectedFields.filter((v: any) => v !== row.name);
      } else {
        selectedFields.push(row.name);
      }

      searchObj.data.stream.selectedFields = selectedFields.filter(
        (_field) =>
          _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );

      searchObj.organizationIdentifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
      filterHitsColumns();
    }

    function resetSelectedFileds() {
      searchObj.data.stream.selectedFields = [];
      updatedLocalLogFilterField();
    }

    // Get page numbers to display (3 at a time)
    function getPageNumbers(currentPage: number, totalPages: number) {
      const pages: number[] = [];

      if (totalPages <= 3) {
        // If 3 or fewer pages, show all
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show 3 pages centered around current page
        let startPage = Math.max(1, currentPage - 1);
        let endPage = Math.min(totalPages, startPage + 2);

        // Adjust if we're near the end
        if (endPage === totalPages) {
          startPage = Math.max(1, endPage - 2);
        }

        for (let i = startPage; i <= endPage; i++) {
          pages.push(i);
        }
      }

      return pages;
    }

    /**
     * Single Stream
     * - Consider filter in sql and non sql mode, create sql query and fetch values
     *
     * Multiple Stream
     * - Dont consider filter in both mode, create sql query for each stream and fetch values
     *
     * @param event
     * @param param1
     */

    const openFilterCreator = async (
      event: any,
      { name, ftsKey, isSchemaField, streams }: any,
    ) => {
      if (ftsKey) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      try {
        //maintaing  the opened fields
        openedFilterFields.value.push(name);
        let timestamps: any =
          searchObj.data.datetime.type === "relative"
            ? getConsumableRelativeTime(
                searchObj.data.datetime.relativeTimePeriod,
              )
            : cloneDeep(searchObj.data.datetime);

        if (searchObj.data.stream.streamType === "enrichment_tables") {
          const stream = searchObj.data.streamResults.list.find((stream: any) =>
            searchObj.data.stream.selectedStream.includes(stream.name),
          );
          if (stream.stats) {
            timestamps = {
              startTime:
                new Date(
                  convertTimeFromMicroToMilli(
                    stream.stats.doc_time_min - 300000000,
                  ),
                ).getTime() * 1000,
              endTime:
                new Date(
                  convertTimeFromMicroToMilli(
                    stream.stats.doc_time_max + 300000000,
                  ),
                ).getTime() * 1000,
            };
          }
        }

        const startISOTimestamp: number = timestamps?.startTime || 0;
        const endISOTimestamp: number = timestamps?.endTime || 0;

        fieldValues.value[name] = {
          isLoading: true,
          values: [],
          errMsg: "",
        };
        let query_context = "";
        let query = searchObj.data.query;
        let whereClause = "";
        let queries: any = {};
        searchObj.data.filterErrMsg = "";
        searchObj.data.missingStreamMessage = "";
        searchObj.data.stream.missingStreamMultiStreamFilter = [];
        if (searchObj.meta.sqlMode == true && query.trim().length) {
          const parsedSQL: any = fnParsedSQL(query);
          //hack add time stamp column to parsedSQL if not already added
          query_context = fnUnparsedSQL(parsedSQL).replace(/`/g, '"') || "";

          if (searchObj.data.stream.selectedStream.length > 1) {
            queries = extractValueQuery();
          }
        } else {
          let parseQuery = query.split("|");
          let queryFunctions = "";
          let whereClause = "";
          if (parseQuery.length > 1) {
            queryFunctions = "," + parseQuery[0].trim();
            whereClause = parseQuery[1].trim();
          } else {
            whereClause = parseQuery[0].trim();
          }

          query_context = `SELECT *${queryFunctions} FROM "[INDEX_NAME]" [WHERE_CLAUSE]`;

          if (whereClause.trim() != "") {
            whereClause = addSpacesToOperators(whereClause);

            const parsedSQL = whereClause.split(" ");
            searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
              parsedSQL.forEach((node: any, index: any) => {
                if (node == field.name) {
                  node = node.replaceAll('"', "");
                  parsedSQL[index] = '"' + node + '"';
                }
              });
            });

            whereClause = parsedSQL.join(" ");

            // query_context = query_context.replace(
            //   "[WHERE_CLAUSE]",
            //   " WHERE " + whereClause,
            // );
            query_context = query_context
              .split("[WHERE_CLAUSE]")
              .join(" WHERE " + whereClause);
          } else {
            query_context = query_context.replace("[WHERE_CLAUSE]", "");
          }
          // query_context = b64EncodeUnicode(query_context) || "";
        }

        let query_fn = "";
        if (
          searchObj.data.tempFunctionContent != "" &&
          searchObj.data.transformType === "function"
        ) {
          query_fn = b64EncodeUnicode(searchObj.data.tempFunctionContent) || "";
        }

        let action_id = "";
        if (
          searchObj.data.transformType === "action" &&
          searchObj.data.selectedTransform?.id
        ) {
          action_id = searchObj.data.selectedTransform.id;
        }

        fieldValues.value[name] = {
          isLoading: true,
          values: [],
          errMsg: "",
        };
        if (whereClause.trim() != "") {
          // validateFilterForMultiStream function called to get missingStreamMultiStreamFilter
          const validationFlag = validateFilterForMultiStream();
          if (!validationFlag) {
            fieldValues.value[name]["isLoading"] = false;
            fieldValues.value[name]["errMsg"] =
              "Filter is not valid for selected streams.";
            return;
          }
          if (searchObj.data.stream.missingStreamMultiStreamFilter.length > 0) {
            streams = searchObj.data.stream.selectedStream.filter(
              (streams: any) =>
                !searchObj.data.stream.missingStreamMultiStreamFilter.includes(
                  streams,
                ),
            );
          }
        }

        let countTotal = streams.length;
        for (const selectedStream of streams) {
          if (streams.length > 1) {
            query_context = "select * from [INDEX_NAME]";
          }
          if (
            searchObj.data.stream.selectedStream.length > 1 &&
            searchObj.meta.sqlMode &&
            queries[selectedStream]
          ) {
            query_context = queries[selectedStream];
          }

          if (query_context !== "") {
            query_context = query_context == undefined ? "" : query_context;

            // Implement streaming based field values, check getQueryData in useLogs for streaming enabled
            fetchValuesWithWebsocket({
              fields: [name],
              size: store.state.zoConfig?.query_values_default_num || 10,
              no_count: false,
              regions: searchObj.meta.regions,
              clusters: searchObj.meta.clusters,
              vrl_fn: query_fn,
              start_time: startISOTimestamp,
              end_time: endISOTimestamp,
              timeout: 30000,
              stream_name: selectedStream,
              stream_type: searchObj.data.stream.streamType,
              use_cache: (window as any).use_cache ?? true,
              sql:
                b64EncodeUnicode(
                  query_context.replace("[INDEX_NAME]", selectedStream),
                ) || "",
            });
          }
        }

        openedFilterFields.value = openedFilterFields.value.filter(
          (field: string) => field !== name,
        );
      } catch (err) {
        fieldValues.value[name]["isLoading"] = false;
        openedFilterFields.value = openedFilterFields.value.filter(
          (field: string) => field !== name,
        );
        console.log(err);
        $q.notify({
          type: "negative",
          message: "Error while fetching field values",
        });
      }
    };

    const addSearchTerm = (
      field: string,
      field_value: string | number | boolean,
      action: string,
    ) => {
      const expression = getFilterExpressionByFieldType(
        field,
        field_value,
        action,
      );

      if (expression) {
        searchObj.data.stream.addToFilter = expression;
      } else {
        $q.notify({
          type: "negative",
          message: "Failed to generate filter expression",
        });
      }
    };

    let fieldIndex: any = -1;
    const addToInterestingFieldList = (
      field: any,
      isInterestingField: boolean,
    ) => {
      if (!Object.keys(streamSchemaFieldsIndexMapping.value).length) {
        return;
      }

      const defaultInterestingFields = new Set(
        store.state?.zoConfig?.default_quick_mode_fields || [],
      );

      if (isInterestingField) {
        const index = searchObj.data.stream.interestingFieldList.indexOf(
          field.name,
        );

        if (index > -1) {
          // only splice array when item is found
          searchObj.data.stream.interestingFieldList.splice(index, 1); // 2nd parameter means remove one item only

          searchObj.data.stream.selectedInterestingStreamFields =
            searchObj.data.stream.selectedInterestingStreamFields.filter(
              (item: any) => item.name !== field.name,
            );

          if (field.group) {
            if (
              searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                field.group
              ] > 0
            ) {
              searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                field.group
              ] =
                searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
                  field.group
                ] - 1;
            }
          }

          field.isInterestingField = !isInterestingField;
          fieldIndex = streamSchemaFieldsIndexMapping.value[field.name];
          if (fieldIndex > -1) {
            searchObj.data.stream.selectedStreamFields[
              fieldIndex
            ].isInterestingField = !isInterestingField;
            fieldIndex = -1;
          }
          // searchObj.data.stream.selectedStreamFields[3].isInterestingField = !isInterestingField;
          const localInterestingFields: any = useLocalInterestingFields();
          let localStreamFields: any = {};
          if (localInterestingFields.value != null) {
            localStreamFields = localInterestingFields.value;
          }

          if (field.streams.length > 0) {
            let localFieldIndex = -1;
            for (const selectedStream of field.streams) {
              localFieldIndex = localStreamFields?.[
                searchObj.organizationIdentifier + "_" + selectedStream
              ]?.indexOf(field.name);
              if (localFieldIndex > -1) {
                localStreamFields[
                  searchObj.organizationIdentifier + "_" + selectedStream
                ].splice(localFieldIndex, 1);
              }

              // If the field is in the default interesting fields, add it to the deselect list
              const deselectField =
                localStreamFields?.[
                  "deselect" +
                    "_" +
                    searchObj.organizationIdentifier +
                    "_" +
                    selectedStream
                ] || [];
              if (
                defaultInterestingFields.has(field.name) &&
                !deselectField.includes(field.name)
              ) {
                localStreamFields[
                  "deselect" +
                    "_" +
                    searchObj.organizationIdentifier +
                    "_" +
                    selectedStream
                ] = [...deselectField, field.name];
              }
            }
          }

          // If no interesting fields are selected, show all fields
          if (!searchObj.data.stream.interestingFieldList.length)
            showOnlyInterestingFields.value = false;

          useLocalInterestingFields(localStreamFields);
        }
      } else {
        const index = searchObj.data.stream.interestingFieldList.indexOf(
          field.name,
        );
        if (index == -1 && field.name != "*") {
          searchObj.data.stream.interestingFieldList.push(field.name);

          const localInterestingFields: any = useLocalInterestingFields();
          field.isInterestingField = !isInterestingField;
          fieldIndex = streamSchemaFieldsIndexMapping.value[field.name];
          if (fieldIndex > -1) {
            searchObj.data.stream.selectedStreamFields[
              fieldIndex
            ].isInterestingField = !isInterestingField;
            fieldIndex = -1;
          }

          let localStreamFields: any = {};
          if (localInterestingFields.value != null) {
            localStreamFields = localInterestingFields.value;
          }
          if (field.streams.length > 0) {
            for (const selectedStream of field.streams) {
              if (selectedStream != undefined) {
                if (
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ] == undefined
                ) {
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ] = [];
                }

                // If the field is not in the local stream fields and is not the timestamp column, add it to the local stream fields
                // As timestamp column is default interesting field, we don't need to add it to the local stream fields
                if (
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ]?.indexOf(field.name) == -1 &&
                  field.name !== store.state.zoConfig?.timestamp_column &&
                  !defaultInterestingFields.has(field.name)
                ) {
                  localStreamFields[
                    searchObj.organizationIdentifier + "_" + selectedStream
                  ].push(field.name);
                }

                // If the field is in the deselect list, remove it from the local stream fields
                const isFieldDeselected = new Set(
                  localStreamFields?.[
                    "deselect" +
                      "_" +
                      searchObj.organizationIdentifier +
                      "_" +
                      selectedStream
                  ] || [],
                ).has(field.name);

                if (
                  defaultInterestingFields.has(field.name) &&
                  isFieldDeselected
                ) {
                  localStreamFields[
                    "deselect" +
                      "_" +
                      searchObj.organizationIdentifier +
                      "_" +
                      selectedStream
                  ] = localStreamFields[
                    "deselect" +
                      "_" +
                      searchObj.organizationIdentifier +
                      "_" +
                      selectedStream
                  ].filter((item: any) => item !== field.name);
                }
              }
            }
          }
          useLocalInterestingFields(localStreamFields);
          addInterestingFieldToSelectedStreamFields(field);
        }
      }

      emit("setInterestingFieldInSQLQuery", field, isInterestingField);
    };

    const addInterestingFieldToSelectedStreamFields = (field: any) => {
      const defaultFields = [
        store.state.zoConfig?.timestamp_column,
        store.state.zoConfig?.all_fields_name,
      ];

      let expandKeys = Object.keys(searchObj.data.stream.expandGroupRows);

      let index = 0;
      for (const key of expandKeys) {
        if (Object.keys(expandKeys).length > 1) index += 1;

        if (key === field.group) break;
        index =
          index +
          searchObj.data.stream.interestingExpandedGroupRowsFieldCount[key];
      }

      // Add the field to the beginning of the array, add all after timestamp column if timestamp column is present
      if (field.name === store.state.zoConfig?.timestamp_column) {
        searchObj.data.stream.selectedInterestingStreamFields.splice(
          index,
          0,
          field,
        );
      } else {
        searchObj.data.stream.selectedInterestingStreamFields.splice(
          index +
            searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
              field.group
            ],
          0,
          field,
        );
      }

      searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
        field.group
      ] =
        searchObj.data.stream.interestingExpandedGroupRowsFieldCount[
          field.group
        ] + 1;
    };

    const toggleSchema = async (newValue: string) => {
      // Update the schema type with the new value from the toggle
      searchObj.meta.useUserDefinedSchemas = newValue;

      // Reset pagination to page 1 before resetting fields
      resetPagination();

      const isInterestingFields =
        searchObj.meta.useUserDefinedSchemas === "interesting_fields";

      if (isInterestingFields) {
        showOnlyInterestingFields.value = true;
      } else {
        showOnlyInterestingFields.value = false;
      }

      await resetFields();
    };

    const toggleInterestingFields = (newValue: boolean) => {
      // Update the interesting fields toggle with the new value
      showOnlyInterestingFields.value = newValue;

      // Reset pagination to page 1 before resetting fields
      resetPagination();
      resetFields();
    };

    const toggleFieldGroup = (group: string) => {
      searchObj.data.stream.expandGroupRows[group] =
        !searchObj.data.stream.expandGroupRows[group];
    };

    const hasUserDefinedSchemas = () => {
      return searchObj.data.stream.selectedStream.some((stream: any) => {
        store.state.zoConfig.user_defined_schemas_enabled &&
          searchObj.meta.useUserDefinedSchemas == "user_defined_schema" &&
          stream.settings.hasOwnProperty("defined_schema_fields") &&
          (stream.settings?.defined_schema_fields?.slice() || []) > 0;
      });
    };

    const sortedStreamFields = () => {
      return searchObj.data.stream.selectedStreamFields.sort(
        (a: any, b: any) => a.group - b.group,
      );
    };

    const placeHolderText = computed(() => {
      return searchObj.data.stream?.selectedStream?.length === 0
        ? t("search.selectStream")
        : "";
    });

    // ----- WebSocket Implementation -----

    const fetchValuesWithWebsocket = (payload: any) => {
      const wsPayload = {
        queryReq: payload,
        type: "values",
        isPagination: false,
        traceId: generateTraceContext().traceId,
        org_id: searchObj.organizationIdentifier,
        meta: payload,
      };
      initializeWebSocketConnection(wsPayload);

      addTraceId(payload.fields[0], wsPayload.traceId);
    };

    const initializeWebSocketConnection = (payload: any) => {
      // if (isStreamingEnabled(store.state)) {
      fetchQueryDataWithHttpStream(payload, {
        data: handleSearchResponse,
        error: handleSearchError,
        complete: handleSearchClose,
        reset: handleSearchReset,
      });
      return;
      // }
    };

    const sendSearchMessage = (queryReq: any) => {
      const payload = {
        type: "values",
        content: {
          trace_id: queryReq.traceId,
          payload: queryReq.queryReq,
          stream_type: searchObj.data.stream.streamType,
          search_type: "ui",
          use_cache: (window as any).use_cache ?? true,
          org_id: searchObj.organizationIdentifier,
        },
      };

      if (
        Object.hasOwn(queryReq.queryReq, "regions") &&
        Object.hasOwn(queryReq.queryReq, "clusters")
      ) {
        payload.content.payload["regions"] = queryReq.queryReq.regions;
        payload.content.payload["clusters"] = queryReq.queryReq.clusters;
      }

      sendSearchMessageBasedOnRequestId(payload);
    };

    const handleSearchClose = (payload: any, response: any) => {
      // Disable the loading indicator
      if (fieldValues.value[payload.queryReq.fields[0]]) {
        fieldValues.value[payload.queryReq.fields[0]].isLoading = false;
      }

      //TODO Omkar: Remove the duplicate error codes, are present same in useSearchWebSocket.ts
      const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

      if (errorCodes.includes(response.code)) {
        handleSearchError(payload, {
          content: {
            message:
              "WebSocket connection terminated unexpectedly. Please check your network and try again",
            trace_id: payload.traceId,
            code: response.code,
            error_detail: "",
          },
          type: "error",
        });
      }

      removeTraceId(payload.queryReq.fields[0], payload.traceId);
    };

    const handleSearchError = (request: any, err: any) => {
      if (fieldValues.value[request.queryReq?.fields[0]]) {
        fieldValues.value[request.queryReq.fields[0]].isLoading = false;
        fieldValues.value[request.queryReq.fields[0]].errMsg =
          "Failed to fetch field values";
      }

      removeTraceId(request.queryReq.fields[0], request.traceId);
    };

    const handleSearchResponse = (payload: any, response: any) => {
      const fieldName = payload?.queryReq?.fields[0];
      const streamName = payload?.queryReq?.stream_name;

      try {
        // We don't need to handle search_response_metadata
        if (response.type === "cancel_response") {
          removeTraceId(payload.queryReq.fields[0], response.content.trace_id);
          return;
        }

        if (response.type !== "search_response_hits") {
          return;
        }

        // Initialize if not exists
        if (!fieldValues.value[fieldName]) {
          fieldValues.value[fieldName] = {
            values: [],
            isLoading: false,
            errMsg: "",
          };
        }

        // Initialize stream-specific values if not exists
        if (!streamFieldValues.value[fieldName]) {
          streamFieldValues.value[fieldName] = {};
        }

        streamFieldValues.value[fieldName][streamName] = {
          values: [],
        };

        // Process the results
        if (response.content.results.hits.length) {
          // Store stream-specific values
          const streamValues: { key: string; count: number }[] = [];

          response.content.results.hits.forEach((item: any) => {
            item.values.forEach((subItem: any) => {
              streamValues.push({
                key: subItem.zo_sql_key,
                count: parseInt(subItem.zo_sql_num),
              });
            });
          });

          // Update stream-specific values
          streamFieldValues.value[fieldName][streamName].values = streamValues;

          // Aggregate values across all streams
          const aggregatedValues: { [key: string]: number } = {};

          // Collect all values from all streams
          Object.keys(streamFieldValues.value[fieldName]).forEach((stream) => {
            streamFieldValues.value[fieldName][stream].values.forEach(
              (value) => {
                if (aggregatedValues[value.key]) {
                  aggregatedValues[value.key] += value.count;
                } else {
                  aggregatedValues[value.key] = value.count;
                }
              },
            );
          });

          // Convert aggregated values to array and sort
          const aggregatedArray = Object.keys(aggregatedValues).map((key) => ({
            key,
            count: aggregatedValues[key],
          }));

          // Sort by count in descending order
          aggregatedArray.sort((a, b) => b.count - a.count);

          // Take top N
          fieldValues.value[fieldName].values = aggregatedArray.slice(
            0,
            store.state.zoConfig?.query_values_default_num || 10,
          );
        }

        // Mark as not loading
        fieldValues.value[fieldName].isLoading = false;
      } catch (error) {
        console.error("Failed to fetch field values:", error);
        fieldValues.value[fieldName].errMsg = "Failed to fetch field values";
        fieldValues.value[fieldName].isLoading = false;
      }
    };

    const handleSearchReset = (data: any) => {
      const fieldName = data.payload.queryReq.fields[0];

      // Reset the main fieldValues state
      fieldValues.value[fieldName] = {
        values: [],
        isLoading: true,
        errMsg: "",
      };

      // Reset the streamFieldValues state for this field
      if (streamFieldValues.value[fieldName]) {
        streamFieldValues.value[fieldName] = {};
      }

      fetchValuesWithWebsocket(data.payload.queryReq);
    };

    const addTraceId = (field: string, traceId: string) => {
      if (!traceIdMapper.value[field]) {
        traceIdMapper.value[field] = [];
      }

      traceIdMapper.value[field].push(traceId);
    };

    const removeTraceId = (field: string, traceId: string) => {
      if (traceIdMapper.value[field]) {
        traceIdMapper.value[field] = traceIdMapper.value[field].filter(
          (id) => id !== traceId,
        );
      }
    };

    const cancelFilterCreator = (row: any) => {
      //if it is websocker based then cancel the trace id
      //else cancel the further value api calls using the openedFilterFields
      cancelValueApi(row.name);
    };

    const cancelTraceId = (field: string) => {
      const traceIds = traceIdMapper.value[field];
      if (traceIds) {
        traceIds.forEach((traceId) => {
          cancelSearchQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
      }
    };

    const cancelValueApi = (value: string) => {
      //remove the field from the openedFilterFields
      openedFilterFields.value = openedFilterFields.value.filter(
        (field: string) => field !== value,
      );
    };

    const getValuesPartition = async (
      start: number,
      end: number,
      name: string,
      queryToBeSent: string,
    ) => {
      try {
        const queryReq = {
          sql: queryToBeSent,
          start_time: start,
          end_time: end,
          // streaming_output: true,
        };
        const res = await searchService.partition({
          org_identifier: store.state.selectedOrganization.identifier,
          query: queryReq,
          page_type: searchObj.data.stream.streamType,
          traceparent: generateTraceContext().traceId,
          enable_align_histogram: true,
        });

        return res;
      } catch (err) {
        console.error("Failed to fetch field values:", err);
        fieldValues.value[name].errMsg = "Failed to fetch field values";
      }
    };

    const setPage = (page) => {
      pagination.value = { ...pagination.value, page };
    };

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      filterFieldFn,
      addToFilter,
      clickFieldFn,
      getImageURL,
      filterStreamFn,
      openFilterCreator,
      addSearchTerm,
      fieldValues,
      streamTypes,
      outlinedAdd,
      outlinedVisibilityOff,
      outlinedVisibility,
      handleQueryData,
      onStreamChange,
      addToInterestingFieldList,
      extractFields,
      userDefinedSchemaBtnGroupOption,
      selectedFieldsBtnGroupOption,
      pagination,
      toggleSchema,
      toggleInterestingFields,
      fieldListRef,
      toggleFieldGroup,
      streamFieldsRows: computed(() => {
        let expandKeys = Object.keys(
          searchObj.data.stream.expandGroupRows,
        ).reverse();

        const expandGroupRowsFieldCount = showOnlyInterestingFields.value
          ? searchObj.data.stream.interestingExpandedGroupRowsFieldCount
          : searchObj.data.stream.expandGroupRowsFieldCount;

        let startIndex = 0;
        // Iterate over the keys in reverse order
        let selectedStreamFields = cloneDeep(
          showOnlyInterestingFields.value
            ? searchObj.data.stream.selectedInterestingStreamFields
            : searchObj.data.stream.selectedStreamFields,
        );
        let count = 0;
        for (let key of expandKeys) {
          if (
            searchObj.data.stream.expandGroupRows[key] == false &&
            selectedStreamFields != undefined &&
            selectedStreamFields?.length > 0
          ) {
            startIndex =
              selectedStreamFields.length - expandGroupRowsFieldCount[key];
            if (startIndex > 0) {
              // console.log("startIndex", startIndex);
              // console.log("count", count);
              // console.log("selectedStreamFields", selectedStreamFields.length);
              // console.log(searchObj.data.stream.expandGroupRowsFieldCount[key]);
              // console.log("========");
              selectedStreamFields.splice(
                startIndex - count,
                expandGroupRowsFieldCount[key],
              );
            }
          } else {
            count += expandGroupRowsFieldCount[key];
          }
          count++;
        }
        return selectedStreamFields;
      }),
      formatLargeNumber,
      sortedStreamFields,
      placeHolderText,
      cancelTraceId,
      cancelFilterCreator,
      selectedStream,
      getFilterExpressionByFieldType,
      addTraceId,
      removeTraceId,
      traceIdMapper,
      checkSelectedFields,
      resetSelectedFileds,
      getPageNumbers,
      handleSearchResponse,
      handleSearchReset,
      showOnlyInterestingFields,
      showUserDefinedSchemaToggle,
      // Additional functions exposed for testing
      resetFields,
      sendSearchMessage,
      handleSearchClose,
      handleSearchError,
      fetchValuesWithWebsocket,
      initializeWebSocketConnection,
      cancelValueApi,
      getValuesPartition,
      streamList,
      hasUserDefinedSchemas,
      setPage,
      resetPagination,
    };
  },
});
</script>

<style scoped lang="scss">
.indexlist-search-input {
  height: 36px;
  .q-field__control {
    height: 36px;
    display: flex;
    align-items: center;
    font-size: 13px;
    padding: 0px 6px !important;
    font-weight: 500;
  }
  .q-field__prepend {
    height: 36px !important;
    padding-bottom: 4px !important;
  }
  .q-field__append {
    padding-top: 8px !important;
  }

  .q-icon {
    height: 16px;
    width: 16px;
    margin-right: 10px;
  }
}
</style>

<style lang="scss">
.indexlist-stream-toggle {
  .q-toggle__inner {
    padding: 0.325em !important;
    font-size: 20px !important;
  }

  .q-toggle__thumb:before {
    background: transparent !important;
  }
}
</style>
