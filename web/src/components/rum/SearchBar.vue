<!-- Copyright 2026 OpenObserve Inc.

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
    <div class="row q-my-xs">
      <div class="float-right col">
        <syntax-guide
          data-test="logs-search-bar-sql-mode-toggle-btn"
          :sqlmode="searchObj.meta.sqlMode"
          class="syntax-guide-in-toolbar element-box-shadow"
        ></syntax-guide>
      </div>
      <div class="float-right col-auto">
        <OButton
          v-if="searchObj.data.queryResults.hits"
          class="q-mr-sm float-left download-logs-btn"
          variant="ghost"
          size="icon-sm"
          icon-left="download"
          :disabled="!searchObj.data.queryResults.hits.length"
          :title="t('search.exportLogs')"
          @click="downloadLogs"
        />
        <div class="float-left">
          <date-time
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="logs-search-bar-date-time-dropdown"
            @on:date-change="updateDateTime"
          />
        </div>
        <div class="search-time q-pl-sm float-left">
          <OButton
            data-test="logs-search-bar-refresh-btn"
            data-cy="search-bar-refresh-button"
            variant="primary"
            size="sm-action"
            :disabled="
              searchObj.loading ||
              searchObj.data.streamResults?.list?.length == 0
            "
            @click="searchData"
          >
            {{ t("search.runQuery") }}
          </OButton>
        </div>
      </div>
    </div>
    <div class="row" v-if="searchObj.meta.showQuery">
      <div class="col">
        <query-editor
          ref="queryEditorRef"
          editor-id="rum-searchbar-query-editor"
          class="monaco-editor"
          v-model:query="searchObj.data.editorValue"
          :keywords="effectiveKeywords"
          v-model:functions="searchObj.data.stream.functions"
          @update:query="updateQueryValue"
          @run-query="searchData"
        ></query-editor>
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
  onBeforeMount,
  defineAsyncComponent,
  onBeforeUnmount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";

import DateTime from "@/components/DateTime.vue";
import useTraces from "@/composables/useTraces";
import {
  applyFilterTerm,
  removeFieldCondition,
} from "@/utils/traces/filterUtils";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import OButton from '@/lib/core/Button/OButton.vue';


import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import useSqlSuggestions from "@/composables/useSuggestions";

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    DateTime,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    SyntaxGuide,
    OButton,
  },
  emits: ["searchdata", "date-change"],
  props: {
    fieldValues: {
      type: Object,
      default: () => {},
    },
  },
  methods: {
    searchData() {
      if (this.searchObj?.loading == false) {
        this.$emit("searchdata");
      }
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const $q = useQuasar();

    const { searchObj } = useTraces();
    const queryEditorRef = ref(null);

    let parser: any;
    let streamName = "";

    const {
      autoCompleteData,
      autoCompleteKeywords,
      effectiveKeywords,
      getSuggestions,
      updateFieldKeywords,
      updateStreamKeywords,
    } = useSqlSuggestions();

    onBeforeMount(async () => {
      await importSqlParser();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    onBeforeUnmount(() => {
      parser = null;
    });

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      (fields) => {
        if (fields.length) updateFieldKeywords(fields);
      },
      { immediate: true, deep: true },
    );

    // Feed all available RUM streams into FROM autocomplete.
    watch(
      () => searchObj.data.streamResults?.list,
      (list) => {
        updateStreamKeywords((list ?? []).map((s: any) => ({ name: s.name })));
      },
      { immediate: true },
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

    const updateQueryValue = (value: string) => {
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
            searchObj.data.streamResults.list.forEach((stream) => {
              if (stream.name == searchObj.data.parsedQuery.from[0].table) {
                streamFound = true;
                let itemObj = {
                  label: stream.name,
                  value: stream.name,
                };
                searchObj.data.stream.selectedStream = itemObj;
                stream.schema.forEach((field) => {
                  searchObj.data.stream.selectedStreamFields.push({
                    name: field.name,
                  });
                });
              }
            });

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

    const updateDateTime = (value: object) => {
      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: value.relativeTimePeriod
          ? value.relativeTimePeriod
          : searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
      };

      emit("date-change", searchObj.data.datetime);

      if (config.isCloud == "true" && value.userChangedValue) {
        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: value,
          stream_name: searchObj.data.stream.selectedStream.value,
          page: "Search Logs",
        });
      }

      if (value.valueType === "relative") emit("searchdata");
    };

    const updateQuery = () => {
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
      const filename = "logs-data.csv";
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

    return {
      t,
      searchObj,
      queryEditorRef,
      updateQueryValue,
      updateDateTime,
      updateQuery,
      downloadLogs,
      setEditorValue,
      autoCompleteKeywords,
      effectiveKeywords,
    };
  },
  watch: {
    addSearchTerm() {
      if (this.searchObj.data.stream.addToFilter != "") {
        const newValue = applyFilterTerm(
          this.searchObj.data.stream.addToFilter,
          this.searchObj.data.editorValue,
        );
        this.searchObj.data.query = newValue;
        this.searchObj.data.stream.addToFilter = "";
        if (this.queryEditorRef?.setValue)
          this.queryEditorRef.setValue(newValue);
      }
    },
    removeFieldTerm(fieldName: string) {
      if (!fieldName) return;
      const newValue = removeFieldCondition(
        this.searchObj.data.editorValue,
        fieldName,
      );
      this.searchObj.data.query = newValue;
      this.searchObj.data.stream.removeFilterField = "";
      if (this.queryEditorRef?.setValue) this.queryEditorRef.setValue(newValue);
    },
  },
});
</script>

<style lang="scss" scoped>
.search-bar-component {
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 1px;

  .q-toggle__inner {
    font-size: 1.875rem;
  }

  .q-toggle__label {
    font-size: 0.75rem;
  }

  .casesensitive-btn {
    padding: 0.5rem;
    margin-left: -0.375rem;
    background-color: #d5d5d5;
    border-radius: 0 0.1875rem 0.1875rem 0;
  }
  .search-field .q-field {
    &__control {
      border-radius: 0.1875rem 0 0 0.1875rem !important;
    }
    &__native {
      font-weight: 600;
    }
  }
  .search-time {
    // width: 120px;
    margin-right: 0.625rem;
    .q-btn-group {
      border-radius: 0.1875rem;

      .q-btn {
        min-height: auto;
      }
    }
  }
  .search-dropdown {
    padding: 0;
    .block {
      color: $dark-page;
      font-weight: 600;
      font-size: 0.75rem;
    }
    .q-btn-dropdown__arrow-container {
      color: $light-text2;
    }
  }
  .refresh-rate-dropdown-container {
    width: 13.75rem;
    * .q-btn {
      font-size: 0.75rem !important;
      padding-left: 0.5rem;
      padding-right: 0.5rem;
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
      height: calc(100vh - 9.125rem);
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
        border-radius: 0.1875rem;
      }
    }
  }
  .fields_autocomplete {
    max-height: 15.625rem;
  }
  .monaco-editor {
    width: 100% !important;
    height: 4.375rem !important;
  }

  .search-button {
    width: 6rem;
    line-height: 1.8125rem;
    font-weight: bold;
    text-transform: initial;
    font-size: 0.6875rem;
    color: white;

    .q-btn__content {
      background: $secondary;
      border-radius: 0.1875rem 0.1875rem 0.1875rem 0.1875rem;

      .OIcon {
        font-size: 0.9375rem;
        color: #ffffff;
      }
    }
  }

  .download-logs-btn {
    height: 1.875rem;
  }
}
</style>
