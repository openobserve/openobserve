<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="search-bar-component" id="searchBarComponent">
    <!-- {{ searchObj.data }} -->
    <div class="row q-my-xs">
      <div class="float-right col">
        <q-toggle
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.showQuery"
          :label="t('search.showQueryLabel')"
        />
        <q-toggle
          data-test="logs-search-bar-show-fields-toggle-btn"
          v-model="searchObj.meta.showFields"
          :label="t('search.showFieldLabel')"
        />
        <q-toggle
          data-test="logs-search-bar-show-histogram-toggle-btn"
          v-bind:disable="searchObj.meta.sqlMode"
          v-model="searchObj.meta.showHistogram"
          :label="t('search.showHistogramLabel')"
        />
        <q-toggle
          data-test="logs-search-bar-sql-mode-toggle-btn"
          v-model="searchObj.meta.sqlMode"
          :label="t('search.sqlModeLabel')"
        />
        <syntax-guide
          data-test="logs-search-bar-sql-mode-toggle-btn"
          :sqlmode="searchObj.meta.sqlMode"
        ></syntax-guide>
      </div>
      <div class="float-right col-auto">
        <q-toggle
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.toggleFunction"
          :label="t('search.toggleFunctionLabel')"
          class="float-left q-mr-sm"
        />
        <q-btn
          v-if="searchObj.data.queryResults.hits"
          class="q-mr-sm float-left download-logs-btn"
          size="sm"
          :disable="!searchObj.data.queryResults.hits.length"
          icon="download"
          title="Export logs"
          @click="downloadLogs"
        ></q-btn>
        <div class="float-left">
          <date-time
            data-test="logs-search-bar-date-time-dropdown"
            @date-change="updateDateTime"
          />
        </div>
        <div class="search-time q-pl-sm float-left">
          <q-btn-group spread>
            <q-btn-dropdown
              v-model="btnRefreshInterval"
              data-cy="search-bar-button-dropdown"
              flat
              class="search-dropdown"
              no-caps
              :label="searchObj.meta.refreshIntervalLabel"
              data-test="logs-search-refresh-interval-dropdown-btn"
            >
              <div class="refresh-rate-dropdown-container">
                <div class="row">
                  <div class="col col-12 q-pa-sm" style="text-align: center">
                    <q-btn
                      data-test="logs-search-off-refresh-interval"
                      no-caps
                      :flat="searchObj.meta.refreshInterval !== '0'"
                      size="md"
                      :class="
                        'no-border full-width ' +
                        (searchObj.meta.refreshInterval === '0'
                          ? 'selected'
                          : '')
                      "
                      @click="refreshTimeChange({ label: 'Off', value: 0 })"
                    >
                      Off
                    </q-btn>
                  </div>
                </div>
                <q-separator />
                <div
                  v-for="(items, i) in refreshTimes"
                  :key="'row_' + i"
                  class="row"
                >
                  <div
                    v-for="(item, j) in items"
                    :key="'col_' + i + '_' + j"
                    class="col col-4 q-pa-sm"
                    style="text-align: center"
                  >
                    <q-btn
                      :data-test="`logs-search-bar-refresh-time-${item.value}`"
                      no-caps
                      :flat="searchObj.meta.refreshInterval !== item.label"
                      size="md"
                      :class="
                        'no-border ' +
                        (searchObj.meta.refreshInterval === item.label
                          ? 'selected'
                          : '')
                      "
                      @click="refreshTimeChange(item)"
                    >
                      {{ item.label }}
                    </q-btn>
                  </div>
                </div>
              </div>
            </q-btn-dropdown>
            <q-separator vertical inset />
            <q-btn
              data-test="logs-search-bar-refresh-btn"
              data-cy="search-bar-refresh-button"
              dense
              flat
              title="Run query"
              class="q-pa-none search-button"
              @click="searchData"
              :disable="
                searchObj.loading || searchObj.data.streamResults.length == 0
              "
              >Run query</q-btn
            >
          </q-btn-group>
        </div>
      </div>
    </div>
    <div class="row" v-show="searchObj.meta.showQuery">
      <div class="col" style="border-top: 1px solid #dbdbdb">
        <q-splitter
          v-model="searchObj.config.fnSplitterModel"
          :limits="searchObj.config.fnSplitterLimit"
          style="width: 100%"
        >
          <template #before>
            <b>Query Editor:</b>
            <query-editor
              ref="queryEditorRef"
              class="monaco-editor"
              v-model:query="searchObj.data.query"
              v-model:fields="searchObj.data.stream.selectedStreamFields"
              v-model:functions="searchObj.data.stream.functions"
              @update-query="updateQueryValue"
              @run-query="searchData"
            ></query-editor>
          </template>
          <template #after>
            <div v-show="searchObj.meta.toggleFunction">
              <b>VRL Function Editor:</b>
              <div ref="fnEditorRef" id="fnEditor"></div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

import DateTime from "@/components/DateTime.vue";
import useLogs from "@/composables/useLogs";
import QueryEditor from "./QueryEditor.vue";
import SyntaxGuide from "./SyntaxGuide.vue";
import jsTransformService from "@/services/jstransform";

import { Parser } from "node-sql-parser";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";

import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import search from "../../services/search";

const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    DateTime,
    QueryEditor,
    SyntaxGuide,
  },
  emits: ["searchdata"],
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
  },
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const btnRefreshInterval = ref(null);

    const { searchObj } = useLogs();
    const queryEditorRef = ref(null);

    const parser = new Parser();
    const formData: any = ref(defaultValue());

    const fnEditorRef: any = ref(null);
    let fnEditorobj: any = null;
    let streamName = "";

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = item.value;
      searchObj.meta.refreshIntervalLabel = item.label;
      btnRefreshInterval.value = false;
    };

    const updateQueryValue = (value: string) => {
      searchObj.data.editorValue = value;
      searchObj.data.query = value;
      if (searchObj.meta.sqlMode == true) {
        searchObj.data.parsedQuery = parser.astify(value);
        if (searchObj.data.parsedQuery.from.length > 0) {
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
      searchObj.data.datetime = value;

      if (config.isZincObserveCloud == "true" && value.userChangedValue) {
        let dateTimeVal;
        if (value.tab === "relative") {
          dateTimeVal = value.relative;
        } else {
          dateTimeVal = value.absolute;
        }

        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: dateTimeVal,
          //user_org: this.store.state.selectedOrganization.identifier,
          //user_id: this.store.state.userInfo.email,
          stream_name: searchObj.data.stream.selectedStream.value,
          page: "Search Logs",
        });
      }
    };

    const udpateQuery = () => {
      // alert(searchObj.data.query);
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(searchObj.data.query);
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

    const initFunctionEditor = () => {
      monaco.editor.defineTheme("myFnCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [
          {
            token: "comment",
            foreground: "ffa500",
            fontStyle: "italic underline",
          },
          { token: "comment.js", foreground: "008800", fontStyle: "bold" },
          { token: "comment.css", foreground: "0000ff" }, // will inherit fontStyle from `comment` above
        ],
        colors: {
          "editor.foreground": "#000000",
        },
      });
      fnEditorobj = monaco.editor.create(fnEditorRef.value, {
        value: ``,
        language: "ruby",
        minimap: {
          enabled: false,
        },
        theme: "myFnCustomTheme",
        showFoldingControls: "never",
        wordWrap: "on",
        lineNumbers: "on",
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: false,
        overviewRulerBorder: false,
        lineDecorationsWidth: 15,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: "none",
        glyphMargin: false,
        folding: false,
        scrollBeyondLastColumn: 0,
        scrollBeyondLastLine: true,
        scrollbar: { horizontal: "auto", vertical: "visible" },
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: "never",
          seedSearchStringFromSelection: "never",
        },
      });

      fnEditorobj.onDidBlurEditorText((e: any) => {
        searchObj.data.tempFunctionLoading = true;
        searchObj.data.tempFunctionContent = fnEditorobj.getValue();
        // saveTemporaryFunction(fnEditorobj.getValue());
      });

      fnEditorobj.layout();
    };

    onMounted(async () => {
      initFunctionEditor();

      window.addEventListener("click", () => {
        fnEditorobj.layout();
      });
    });

    const saveTemporaryFunction = (content: string) => {
      let callTransform: Promise<{ data: any }>;

      if (content == formData.value.function) {
        searchObj.data.tempFunctionLoading = false;
        return;
      }

      if (content.trim() == "") {
        searchObj.data.tempFunctionName = "";
        $q.notify({
          type: "positive",
          message:
            "Function has been removed and no more applicable to the query.",
        });
        searchObj.data.tempFunctionLoading = false;
        formData.value.function = "";
        return;
      }

      formData.value.params = "row";
      formData.value.function = content;
      formData.value.transType = 0;
      if (searchObj.data.tempFunctionName == "") {
        formData.value.name =
          store.state.selectedOrganization.identifier +
          "_" +
          store.state.userInfo.email.slice(
            0,
            store.state.userInfo.email.indexOf("@")
          ) +
          "_" +
          Math.floor(Date.now() / 1000);

        callTransform = jsTransformService.create(
          store.state.selectedOrganization.identifier,
          formData.value
        );
      } else {
        formData.value.name = searchObj.data.tempFunctionName;

        callTransform = jsTransformService.update(
          store.state.selectedOrganization.identifier,
          formData.value
        );
      }

      callTransform
        .then((res: { data: any }) => {
          searchObj.data.tempFunctionLoading = false;
          searchObj.data.tempFunctionName = formData.value.name;
          $q.notify({
            type: "positive",
            message: res.data.hasOwnProperty("message")
              ? res.data.message
              : "Function updated successfully.",
          });
        })
        .catch((err) => {
          searchObj.data.tempFunctionLoading = false;
          $q.notify({
            type: "negative",
            message:
              JSON.stringify(err.response.data["message"]) ||
              "Function creation failed",
            timeout: 5000,
          });
        });
    };

    const resetFunctionContent = () => {
      formData.value.function = "";
      fnEditorobj.setValue("");
      formData.value.name = "";
      searchObj.data.tempFunctionLoading = false;
      searchObj.data.tempFunctionName = "";
    };

    return {
      t,
      store,
      router,
      fnEditorRef,
      fnEditorobj,
      searchObj,
      queryEditorRef,
      btnRefreshInterval,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      udpateQuery,
      downloadLogs,
      initFunctionEditor,
      resetFunctionContent,
    };
  },
  computed: {
    addSearchTerm() {
      return this.searchObj.data.stream.addToFilter;
    },
    toggleFunction() {
      return this.searchObj.meta.toggleFunction;
    },
    // executeRunQuery() {
    //   return this.searchObj.data.tempFunctionLoading;
    // },
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
    toggleFunction(newVal) {
      if (newVal == false) {
        this.searchObj.config.fnSplitterModel = 100;
      } else {
        this.searchObj.config.fnSplitterModel = 60;
      }
    },
    // executeRunQuery(newVal) {
    //   if (newVal == false) {
    //     this.$emit("run-query");
    //   }
    // },
  },
});
</script>

<style lang="scss">
#fnEditor {
  width: 100%;
  min-height: 4rem;
  border-radius: 5px;
  border: 0px solid #dbdbdb;
}
.search-bar-component {
  border-bottom: 1px solid #e0e0e0;
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
    margin-right: 10px;
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
    height: 70px !important;
  }

  .search-button {
    width: 96px;
    line-height: 29px;
    font-weight: bold;
    text-transform: initial;
    font-size: 11px;
    color: white;

    .q-btn__content {
      background: $primary;
      border-radius: 0px 3px 3px 0px;

      .q-icon {
        font-size: 15px;
        color: #ffffff;
      }
    }
  }

  .download-logs-btn {
    height: 30px;
  }
}
</style>
