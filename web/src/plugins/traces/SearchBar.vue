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
  <div class="search-bar-component" id="searchBarComponent">
    <div class="row tw:m-0! tw:p-[0.375rem]">
      <div class="float-right col flex items-center">
        <!-- Tab Toggle Buttons -->
        <div v-if="store.state.zoConfig.service_graph_enabled" class="button-group logs-visualize-toggle element-box-shadow tw:mr-[0.375rem]">
          <div class="row">
            <div>
              <q-btn
                data-test="traces-search-toggle"
                :class="activeTab === 'search' ? 'selected' : ''"
                @click="$emit('update:activeTab', 'search')"
                no-caps
                size="sm"
                icon="search"
                class="button button-left tw:flex tw:justify-center tw:items-center no-border no-outline tw:rounded-r-none! q-px-sm tw:h-[2rem]"
              >
                <q-tooltip>
                  {{ t("common.search") }}
                </q-tooltip>
              </q-btn>
            </div>
            <div>
              <q-btn
                data-test="traces-service-maps-toggle"
                :class="activeTab === 'service-maps' ? 'selected' : ''"
                @click="$emit('update:activeTab', 'service-maps')"
                no-caps
                size="sm"
                icon="hub"
                class="button button-right tw:flex tw:justify-center tw:items-center no-border no-outline tw:rounded-l-none! q-px-sm tw:h-[2rem]"
              >
                <q-tooltip>
                  Service Maps
                </q-tooltip>
              </q-btn>
            </div>
          </div>
        </div>

        <!-- Show search controls only when on Search tab -->
        <template v-if="activeTab === 'search'">
          <div
            class="q-pr-xs tw:mr-[0.375rem] tw:flex tw:items-center tw:justify-center tw:border-solid tw:border tw:border-[var(--o2-border-color)] tw:rounded-[0.375rem]"
          >
            <q-toggle
              data-test="traces-search-bar-show-metrics-toggle-btn"
              v-model="searchObj.meta.showHistogram"
              class="o2-toggle-button-xs tw:flex tw:items-center tw:justify-center"
              size="xs"
              flat
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-xs-dark'
                  : 'o2-toggle-button-xs-light'
              "
            >
            </q-toggle>
            <img
              :src="metricsIcon"
              alt="Metrics"
              style="width: 20px; height: 20px"
            />
            <q-tooltip>
              {{ t("traces.RedMetrics") }}
            </q-tooltip>
          </div>
          <q-btn
            data-test="traces-search-bar-reset-filters-btn"
            no-caps
            size="13px"
            icon="restart_alt"
            class="tw:flex tw:justify-center tw:items-center tw:w-[2rem] tw:min-h-[2rem]! tw:h-[2rem]! tw:mr-[0.375rem] tw:rounded-[0.375rem] el-border q-mr-sm"
            @click="resetFilters"
          >
            <q-tooltip>
              {{ t("search.resetFilters") }}
            </q-tooltip>
          </q-btn>
          <syntax-guide
            data-test="logs-search-bar-sql-mode-toggle-btn"
            :sqlmode="searchObj.meta.sqlMode"
          />
        </template>
      </div>
      <div v-if="activeTab === 'search'" class="float-right col-auto">
        <div class="float-left tw:mr-[0.375rem]">
          <date-time
            ref="dateTimeRef"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="logs-search-bar-date-time-dropdown"
            :queryRangeRestrictionInHour="
              searchObj.data.datetime.queryRangeRestrictionInHour
            "
            :queryRangeRestrictionMsg="
              searchObj.data.datetime.queryRangeRestrictionMsg
            "
            class="tw:h-[2rem]"
            @on:date-change="updateDateTime"
            @on:timezone-change="updateTimezone"
          />
        </div>
        <div class="search-time tw:mr-[0.375rem] float-left">
          <q-btn
            data-test="logs-search-bar-refresh-btn"
            data-cy="search-bar-refresh-button"
            dense
            flat
            :title="t('search.runQuery')"
            class="q-pa-none o2-run-query-button o2-color-primary tw:h-[30px] element-box-shadow tw:leading-8!"
            @click="searchData"
            :loading="isLoading"
            :disable="isLoading"
            >{{ t("search.runQuery") }}</q-btn
          >
        </div>
        <q-btn
          class="tw:mr-[0.375rem] float-left download-logs-btn q-pa-sm tw:min-h-[2rem] el-border q-mr-sm"
          size="sm"
          :disable="!searchObj.data.queryResults?.hits?.length"
          icon="download"
          title="Export Traces"
          @click="downloadLogs"
        />
        <share-button
          data-test="logs-search-bar-share-link-btn"
          :url="tracesShareURL"
          button-class="tw:mr-0 download-logs-btn q-px-sm tw:min-h-[2rem] el-border"
          button-size="sm"
        />
      </div>
    </div>
    <div v-if="activeTab === 'search' && searchObj.meta.showQuery" class="row">
      <div
        class="col tw:border tw:solid tw:border-[var(--o2-border-color)] tw:mx-[0.375rem] tw:mb-[0.375rem] tw:rounded-[0.375rem] tw:overflow-hidden"
      >
        <code-query-editor
          ref="queryEditorRef"
          editor-id="traces-query-editor"
          class="monaco-editor tw:px-[0.325rem] tw:py-[0.125rem]"
          v-model:query="searchObj.data.editorValue"
          :keywords="autoCompleteKeywords"
          :class="
            searchObj.data.editorValue == '' &&
            searchObj.meta.queryEditorPlaceholderFlag
              ? 'empty-query'
              : ''
          "
          language="sql"
          @update:query="updateQueryValue"
          @run-query="searchData"
          @focus="searchObj.meta.queryEditorPlaceholderFlag = false"
          @blur="searchObj.meta.queryEditorPlaceholderFlag = true"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  nextTick,
  defineAsyncComponent,
  onBeforeUnmount,
  onActivated,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useStore } from "vuex";

import DateTime from "@/components/DateTime.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import useTraces from "@/composables/useTraces";
import SyntaxGuide from "./SyntaxGuide.vue";

import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import useSqlSuggestions from "@/composables/useSuggestions";
import useStreams from "@/composables/useStreams";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    DateTime,
    ShareButton,
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    SyntaxGuide,
  },
  emits: ["searchdata", "update:activeTab"],
  props: {
    fieldValues: {
      type: Object,
      default: () => {},
    },
    // Using loading key directly from traces composable was not working
    // so have added as prop
    // Run query btn was not getting disabled while loading
    isLoading: {
      type: Boolean,
      default: false,
    },
    activeTab: {
      type: String,
      default: "search",
    },
  },
  methods: {
    searchData() {
      if (this.searchObj?.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const btnRefreshInterval = ref(null);

    const { searchObj, tracesShareURL } = useTraces();
    const queryEditorRef = ref(null);

    let parser: any;
    let streamName = "";
    const dateTimeRef = ref(null);

    const { getStream } = useStreams();

    const {
      autoCompleteData,
      autoCompleteKeywords,
      getSuggestions,
      updateFieldKeywords,
    } = useSqlSuggestions();

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    onBeforeUnmount(async () => {
      await importSqlParser();
    });

    onActivated(async () => {
      await nextTick();
      if (searchObj.data.datetime.type === "relative") {
        dateTimeRef.value.setRelativeTime(
          searchObj.data.datetime.relativeTimePeriod,
        );

        dateTimeRef.value.refresh();
      } else {
        dateTimeRef.value.setAbsoluteTime(
          searchObj.data.datetime.startTime,
          searchObj.data.datetime.endTime,
        );
      }
    });

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = item.value;
      searchObj.meta.refreshIntervalLabel = item.label;
      btnRefreshInterval.value = false;
    };

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      (fields) => {
        if (fields.length) updateFieldKeywords(fields);
      },
      { immediate: true, deep: true },
    );

    const updateAutoComplete = (value) => {
      autoCompleteData.value.query = value;
      autoCompleteData.value.cursorIndex =
        queryEditorRef.value.getCursorIndex();
      autoCompleteData.value.fieldValues = props.fieldValues;
      autoCompleteData.value.popup.open =
        queryEditorRef.value.triggerAutoComplete;
      getSuggestions();
    };

    const updateQueryValue = async (value: string) => {
      updateAutoComplete(value);
      if (searchObj.meta.sqlMode == true) {
        searchObj.data.parsedQuery = parser.astify(value);
        if (searchObj.data.parsedQuery?.from?.length > 0) {
          if (
            searchObj.data.parsedQuery.from[0].table !==
              searchObj.data.stream.selectedStream.value &&
            searchObj.data.parsedQuery.from[0].table !== streamName
          ) {
            let streamFound = false;
            streamName = searchObj.data.parsedQuery.from[0].table;
            await getStream(streamName, "traces", true).then(
              (streamResponse) => {
                streamFound = true;
                let itemObj = {
                  label: streamResponse.name,
                  value: streamResponse.name,
                };
                searchObj.data.stream.selectedStream = itemObj;
                streamResponse.schema.forEach((field) => {
                  searchObj.data.stream.selectedStreamFields.push({
                    name: field.name,
                  });
                });
              },
            );

            if (streamFound == false) {
              searchObj.data.stream.selectedStream = { label: "", value: "" };
              searchObj.data.stream.selectedStreamFields = [];
              $q.notify({
                message: "Stream not found",
                color: "negative",
                position: "top",
                timeout: 2000,
              });
            }
          }
        }
      }
    };

    const updateDateTime = async (value: object) => {
      if (router.currentRoute.value.name !== "traces") return;
      if (
        value.valueType == "absolute" &&
        searchObj.data.stream.selectedStream.length > 0 &&
        searchObj.data.datetime.queryRangeRestrictionInHour > 0 &&
        value.hasOwnProperty("selectedDate") &&
        value.hasOwnProperty("selectedTime") &&
        value.selectedDate.hasOwnProperty("from") &&
        value.selectedTime.hasOwnProperty("startTime")
      ) {
        // Convert hours to microseconds
        let newStartTime =
          parseInt(value.endTime) -
          searchObj.data.datetime.queryRangeRestrictionInHour *
            60 *
            60 *
            1000000;

        if (parseInt(newStartTime) > parseInt(value.startTime)) {
          value.startTime = newStartTime;

          value.selectedDate.from = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "yyyy/MM/DD",
          );
          value.selectedTime.startTime = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "HH:mm",
          );

          dateTimeRef.value.setAbsoluteTime(value.startTime, value.endTime);
          dateTimeRef.value.setDateType("absolute");
        }
      }

      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: value.relativeTimePeriod
          ? value.relativeTimePeriod
          : searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
        queryRangeRestrictionMsg:
          searchObj.data.datetime?.queryRangeRestrictionMsg || "",
        queryRangeRestrictionInHour:
          searchObj.data.datetime?.queryRangeRestrictionInHour || 0,
      };

      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();

      if (config.isCloud == "true" && value.userChangedValue) {
        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: value,
          //user_org: this.store.state.selectedOrganization.identifier,
          //user_id: this.store.state.userInfo.email,
          stream_name: searchObj.data.stream.selectedStream.value,
          page: "Search Logs",
        });
      }
    };

    const updateQuery = () => {
      // alert(searchObj.data.query);
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(searchObj.data.query);
    };

    // This method is used in parent component using ref
    const setEditorValue = (value: String) => {
      if (queryEditorRef.value?.setValue) queryEditorRef.value.setValue(value);
    };

    const jsonToCsv = (jsonData) => {
      const replacer = (key, value) => (value === null ? "" : value);
      const header = Object.keys(jsonData[0]);
      let csv = header.join(",") + "\r\n";

      for (let i = 0; i < jsonData.length; i++) {
        const row = header
          .map((fieldName) => JSON.stringify(jsonData[i][fieldName], replacer))
          .join(",");
        csv += row + "\r\n";
      }

      return csv;
    };

    const downloadLogs = () => {
      const filename = "traces-data.csv";
      const data = jsonToCsv(searchObj.data.queryResults.hits);
      const file = new File([data], filename, {
        type: "text/csv",
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    const updateTimezone = () => {
      emit("onChangeTimezone");
    };

    const resetFilters = () => {
      searchObj.data.editorValue = "";
      searchObj.data.advanceFiltersQuery = "";
      Object.values(searchObj.data.stream.fieldValues).forEach((field) => {
        field.selectedValues = [];
        field.searchKeyword = "";
      });
    };

    /**
     * Update the date time in the date time component
     * @param value - object containing start time and end time
     * @param value.startTime - start time in microseconds
     * @param value.endTime - end time in microseconds
     */
    const updateNewDateTime = (value: object) => {
      if (!value.startTime || !value.endTime) return;
      dateTimeRef.value?.setAbsoluteTime(value.startTime, value.endTime);
      dateTimeRef.value?.setDateType("absolute");
    };

    const metricsIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/bar_chart_histogram_light.svg")
        : getImageURL("images/common/bar_chart_histogram.svg");
    });

    return {
      t,
      router,
      store,
      searchObj,
      queryEditorRef,
      btnRefreshInterval,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      updateQuery,
      downloadLogs,
      setEditorValue,
      autoCompleteKeywords,
      updateTimezone,
      dateTimeRef,
      resetFilters,
      updateNewDateTime,
      metricsIcon,
      tracesShareURL,
    };
  },
  computed: {
    addSearchTerm() {
      return this.searchObj.data.stream.addToFilter;
    },
  },
  watch: {
    addSearchTerm() {
      if (this.searchObj.data.stream.addToFilter != "") {
        let currentQuery = this.searchObj.data.editorValue.split("|");
        let filter = this.searchObj.data.stream.addToFilter;

        const isFilterValueNull = filter.split(/=|!=/)[1] === "'null'";

        if (isFilterValueNull) {
          filter = filter
            .replace(/=|!=/, (match) => {
              return match === "=" ? " is " : " is not ";
            })
            .replace(/'null'/, "null");
        }

        if (currentQuery.length > 1) {
          if (currentQuery[1].trim() != "") {
            currentQuery[1] += " and " + filter;
          } else {
            currentQuery[1] = filter;
          }
          this.searchObj.data.query = currentQuery.join("| ");
        } else {
          if (currentQuery != "") {
            currentQuery += " and " + filter;
          } else {
            currentQuery = filter;
          }
          this.searchObj.data.query = currentQuery;
        }
        this.searchObj.data.stream.addToFilter = "";
        if (this.queryEditorRef?.setValue)
          this.queryEditorRef.setValue(this.searchObj.data.query);
      }
    },
    filters() {},
  },
});
</script>

<style lang="scss" scoped>
.search-bar-component {
  padding-bottom: 1px;

  .q-toggle__inner {
    font-size: 30px;
  }

  .q-toggle__label {
    font-size: 12px;
  }

  .casesensitive-btn {
    padding: 8px;
    margin-left: -6px;
    background-color: #d5d5d5;
    border-radius: 0px 3px 3px 0px;
  }
  .search-field .q-field {
    &__control {
      border-radius: 3px 0px 0px 3px !important;
    }
    &__native {
      font-weight: 600;
    }
  }
  .search-time {
    // width: 120px;
    .q-btn-group {
      border-radius: 3px;

      .q-btn {
        min-height: auto;
      }
    }
  }
  .search-dropdown {
    padding: 0px;
    .block {
      color: $dark-page;
      font-weight: 600;
      font-size: 12px;
    }
    .q-btn-dropdown__arrow-container {
      color: $light-text2;
    }
  }
  .refresh-rate-dropdown-container {
    width: 220px;
    * .q-btn {
      font-size: 12px !important;
      padding-left: 8px;
      padding-right: 8px;
    }
  }

  .flex-start {
    justify-content: flex-start;
    align-items: flex-start;
    display: flex;
  }

  .resultsOverChart {
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    color: $dark-page;
    font-weight: 700;
  }

  .ddlWrapper {
    position: relative;
    z-index: 10;

    .listWrapper {
      box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
      transition: height 0.25s ease;
      height: calc(100vh - 146px);
      background-color: white;
      position: absolute;
      top: 2.75rem;
      width: 100%;
      left: 0;

      &:empty {
        height: 0;
      }

      &,
      .q-list {
        border-radius: 3px;
      }
    }
  }
  .fields_autocomplete {
    max-height: 250px;
  }
  .monaco-editor {
    width: 100% !important;
    height: 40px !important;
  }

  .search-button {
    min-width: 96px;
    line-height: 29px;
    font-weight: bold;
    text-transform: initial;
    font-size: 11px;
    color: white;
    padding: 0px 5px;

    .q-btn__content {
      background: $secondary;
      border-radius: 3px 3px 3px 3px;
      padding: 0px 5px;

      .q-icon {
        font-size: 15px;
        color: #ffffff;
      }
    }
  }

  .download-logs-btn {
    height: 30px;
  }

  .reset-filters {
    width: 30px;
    height: 30px;

    .q-icon {
      margin-right: 0;
    }
  }
}
</style>
