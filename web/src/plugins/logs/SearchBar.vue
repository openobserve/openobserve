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
  <div class="logs-search-bar-component" id="searchBarComponent">
    <!-- {{ searchObj.data }} -->
    <div class="row">
      <div class="float-right col q-mb-xs">
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
      <div class="float-right col-auto q-mb-xs">
        <q-toggle
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.toggleFunction"
          icon="functions"
          title="Toggle Function Editor"
          class="float-left q-mr-sm"
          size="32px"
        />
        <q-select
          v-model="functionModel"
          :options="functionOptions"
          option-label="name"
          option-value="function"
          placeholder="Select or create a function"
          data-cy="index-dropdown"
          input-debounce="10"
          use-input
          hide-selected
          behavior="default"
          fill-input
          dense
          :loading="false"
          @filter="filterFn"
          @new-value="createNewValue"
          @blur="updateSelectedValue"
          @update:model-value="populateFunctionImplementation"
          class="float-left function-dropdown q-mr-sm"
        >
          <template v-slot:append>
            <q-icon
              v-if="functionModel !== null"
              class="cursor-pointer"
              name="clear"
              size="xs"
              @click.stop.prevent="functionModel = null"
            />
          </template>
          <template #no-option>
            <q-item>
              <q-item-section class="text-xs"
                >Press Tab/Enter button to apply new function
                name.</q-item-section
              >
            </q-item>
          </template>
        </q-select>
        <q-btn
          :disable="
            !functionModel ||
            !searchObj.data.tempFunctionContent ||
            functionModel.function == searchObj.data.tempFunctionContent
          "
          title="Save Function"
          icon="save"
          icon-right="functions"
          size="sm"
          class="q-px-xs q-mr-sm float-left download-logs-btn"
          @click="saveFunction"
        ></q-btn>
        <q-btn
          class="q-mr-sm download-logs-btn q-px-sm"
          size="sm"
          :disabled="
            searchObj.data.queryResults.hasOwnProperty('hits') &&
            !searchObj.data.queryResults.hits.length
          "
          icon="download"
          title="Export logs"
          @click="downloadLogs"
        ></q-btn>
        <div class="float-left">
          <date-time
            :default-date="searchObj.data.datetime"
            data-test="logs-search-bar-date-time-dropdown"
            @date-change="updateDateTime"
          />
        </div>
        <div class="search-time q-pl-sm float-left q-mr-sm">
          <div class="flex">
            <auto-refresh-interval
              class="q-mr-sm q-px-none logs-auto-refresh-interval"
              style="padding-left: 0 !important"
              v-model="searchObj.meta.refreshInterval"
            />
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
          </div>
        </div>
      </div>
    </div>
    <div class="row query-editor-container" v-show="searchObj.meta.showQuery">
      <div class="col" style="border-top: 1px solid #dbdbdb; height: 100%">
        <q-splitter
          class="logs-search-splitter"
          no-scroll
          v-model="searchObj.config.fnSplitterModel"
          :limits="searchObj.config.fnSplitterLimit"
          style="width: 100%; height: 100%"
        >
          <template #before>
            <b>Query Editor:</b>
            <query-editor
              id="logsQueryEditor"
              ref="queryEditorRef"
              class="monaco-editor"
              v-model:query="searchObj.data.query"
              v-model:fields="searchObj.data.stream.selectedStreamFields"
              v-model:functions="searchObj.data.stream.functions"
              :keywords="autoCompleteKeywords"
              :suggestions="autoCompleteSuggestions"
              @update:query="updateQueryValue"
              @run-query="searchData"
            ></query-editor>
          </template>
          <template #after>
            <div v-show="searchObj.meta.toggleFunction" style="height: 100%">
              <b>VRL Function Editor:</b>
              <div ref="fnEditorRef" id="fnEditor" style="height: 100%"></div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>

    <q-dialog ref="confirmDialog" v-model="confirmDialogVisible">
      <q-card>
        <q-card-section>
          {{ confirmMessage }}
        </q-card-section>

        <q-card-actions align="right">
          <q-btn label="Cancel" color="primary" @click="cancelConfirmDialog" />
          <q-btn label="OK" color="positive" @click="confirmDialogOK" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { onBeforeRouteUpdate, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

import DateTime from "@/components/DateTime.vue";
import useLogs from "@/composables/useLogs";
import QueryEditor from "@/components/QueryEditor.vue";
import SyntaxGuide from "./SyntaxGuide.vue";
import jsTransformService from "@/services/jstransform";

import { Parser } from "node-sql-parser";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";

import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import search from "../../services/search";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import stream from "@/services/stream";
import { getConsumableDateTime } from "@/utils/commons";
import { a } from "aws-amplify";

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
    AutoRefreshInterval,
  },
  emits: ["searchdata"],
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
    changeFunctionName(value) {
      // alert(value)
      console.log(value);
    },
    createNewValue(inputValue, doneFn) {
      // Do something with the new value
      console.log(`New value created: ${inputValue}`);

      // Call the doneFn with the new value
      doneFn(inputValue);
    },
    updateSelectedValue() {
      // Update the selected value with the newly created value
      if (
        this.functionModel &&
        !this.functionOptions.includes(this.functionModel)
      ) {
        this.functionOptions.push(this.functionModel);
      }
    },
  },
  props: {
    fieldValues: {
      type: Array,
      default: () => [],
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();

    const { searchObj } = useLogs();
    const queryEditorRef = ref(null);

    const parser = new Parser();
    const formData: any = ref(defaultValue());
    const functionOptions = ref(searchObj.data.transforms);

    const functionModel: string = ref(null);
    const fnEditorRef: any = ref(null);
    const confirmDialogVisible: boolean = ref(false);
    let confirmCallback;
    let fnEditorobj: any = null;
    let streamName = "";

    const defaultKeywords = [
      {
        label: "and",
        kind: "Keyword",
        insertText: "and ",
      },
      {
        label: "or",
        kind: "Keyword",
        insertText: "or ",
      },
      {
        label: "like",
        kind: "Keyword",
        insertText: "like '%${1:params}%' ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "in",
        kind: "Keyword",
        insertText: "in ('${1:params}') ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "not in",
        kind: "Keyword",
        insertText: "not in ('${1:params}') ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "between",
        kind: "Keyword",
        insertText: "between '${1:params}' and '${1:params}' ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "not between",
        kind: "Keyword",
        insertText: "not between '${1:params}' and '${1:params}' ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "is null",
        kind: "Keyword",
        insertText: "is null ",
      },
      {
        label: "is not null",
        kind: "Keyword",
        insertText: "is not null ",
      },
      {
        label: ">",
        kind: "Operator",
        insertText: "> ",
      },
      {
        label: "<",
        kind: "Operator",
        insertText: "< ",
      },
      {
        label: ">=",
        kind: "Operator",
        insertText: ">= ",
      },
      {
        label: "<=",
        kind: "Operator",
        insertText: "<= ",
      },
      {
        label: "<>",
        kind: "Operator",
        insertText: "<> ",
      },
      {
        label: "=",
        kind: "Operator",
        insertText: "= ",
      },
      {
        label: "!=",
        kind: "Operator",
        insertText: "!= ",
      },
      {
        label: "()",
        kind: "Keyword",
        insertText: "(${1:condition}) ",
        insertTextRules: "InsertAsSnippet",
      },
    ];

    const defaultSuggestions = [
      {
        label: (_keyword) => `match_all('${_keyword}')`,
        kind: "Text",
        insertText: (_keyword) => `match_all('${_keyword}')`,
      },
      {
        label: (_keyword) => `match_all_ignore_case('${_keyword}')`,
        kind: "Text",
        insertText: (_keyword) => `match_all_ignore_case('${_keyword}')`,
      },
    ];

    const autoCompleteKeywords = ref([]);
    const autoCompleteSuggestions = ref([...defaultSuggestions]);

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = item.value;
    };

    const updateQueryValue = (value: string) => {
      searchObj.data.editorValue = value;
      updateSqlSuggestions(value);
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

    const updateSqlSuggestions = async (value) => {
      autoCompleteKeywords.value = [];
      const cursorIndex = queryEditorRef.value.getCursorIndex();
      const sqlWhereClause = analyzeSqlWhereClause(value, cursorIndex);
      if (
        sqlWhereClause.meta.label &&
        props.fieldValues[sqlWhereClause.meta.label]
      ) {
        let values = Array.from(
          props.fieldValues[sqlWhereClause.meta.label] || new Set()
        ).map((item) => {
          return {
            label: item,
            insertText: `'${item}'`,
            kind: "Keyword",
          };
        });

        autoCompleteKeywords.value = [
          ...values,
          {
            label: "...Loading more values",
            kind: "Text",
            insertText: "",
            sortText: "zzzzzzz",
          },
        ];

        await nextTick();

        queryEditorRef.value.triggerAutoComplete(value);

        const timestamps = getConsumableDateTime(searchObj.data.datetime);

        const startISOTimestamp: any =
          new Date(timestamps.start_time.toISOString()).getTime() * 1000;
        const endISOTimestamp: any =
          new Date(timestamps.end_time.toISOString()).getTime() * 1000;
        stream
          .fieldValues({
            org_identifier: store.state.selectedOrganization.identifier,
            stream_name: searchObj.data.stream.selectedStream.value,
            fields: [sqlWhereClause.meta.label],
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            size: 20,
            query_context: "U0VMRUNUICogRlJPTSAiY2xvdWR3YXRjaCI=",
          })
          .then((response) => {
            queryEditorRef.value.disableSuggestionPopup();
            autoCompleteKeywords.value.pop();
            response.data.hits.forEach((field) => {
              if (field["field"] === sqlWhereClause.meta.label) {
                field.values.forEach((item) => {
                  if (item.zo_sql_key)
                    autoCompleteKeywords.value.push({
                      label: item.zo_sql_key,
                      insertText: `'${item.zo_sql_key}'`,
                      kind: "Keyword",
                    });
                });
              }
            });
          })
          .finally(async () => {
            await nextTick();
            queryEditorRef.value.triggerAutoComplete(value);
          });
        queryEditorRef.value.disableSuggestionPopup();
        if (!autoCompleteKeywords.value.length) return;
        await nextTick();
        queryEditorRef.value.triggerAutoComplete(value);
      } else {
        searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
          if (field.name == store.state.zoConfig.timestamp_column) {
            return;
          }
          let itemObj = {
            label: field.name,
            kind: "Text",
            insertText: field.name,
            insertTextRules: "InsertAsSnippet",
          };
          autoCompleteKeywords.value.push(itemObj);
        });

        searchObj.data.stream.functions.forEach((field: any) => {
          let itemObj = {
            label: field.name,
            kind: "Text",
            insertText: field.name + field.args,
            insertTextRules: "InsertAsSnippet",
          };
          autoCompleteKeywords.value.push(itemObj);
        });
        autoCompleteKeywords.value.push(...defaultKeywords);
      }
    };

    function analyzeSqlWhereClause(whereClause, cursorIndex) {
      const labelMeta = {
        hasLabels: false,
        isFocused: false,
        isEmpty: true,
        focusOn: "", // label or value
        meta: {
          label: "",
          value: "",
        },
      };

      const columnValueRegex = /(\w+)\s*=\s*$|\w+\s+IN\s+\($/i;

      let match;
      while ((match = columnValueRegex.exec(whereClause)) !== null) {
        const column = match[1];

        if (cursorIndex <= match.index + match[0].length - 1) {
          labelMeta.focusOn = "value";
          labelMeta.isFocused = true;
          labelMeta.meta.label = column;

          break; // Exit the loop after processing the match
        }
      }
      return labelMeta;
    }

    const updateDateTime = (value: object) => {
      searchObj.data.datetime = value;

      if (config.isCloud == "true" && value.userChangedValue) {
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
          "editor.background": "#fafafa",
          "editorCursor.foreground": "#000000",
          "editor.lineHighlightBackground": "#FFFFFF",
          "editorLineNumber.foreground": "#000000",
          "editor.border": "#000000",
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
        lineDecorationsWidth: 3,
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

      fnEditorobj.onDidChangeModelContent((e: any) => {
        searchObj.data.tempFunctionContent = fnEditorobj.getValue();
      });

      fnEditorobj.onDidBlurEditorText((e: any) => {
        searchObj.data.tempFunctionContent = fnEditorobj.getValue();
        // saveFunction(fnEditorobj.getValue());
      });

      fnEditorobj.layout();
    };

    onMounted(async () => {
      initFunctionEditor();

      window.addEventListener("click", () => {
        fnEditorobj.layout();
        // queryEditorRef.value.resetEditorLayout();
      });
    });

    const saveFunction = () => {
      let callTransform: Promise<{ data: any }>;
      const content = fnEditorobj.getValue();

      let fnName = functionModel.value;
      if (typeof functionModel.value == "object") {
        fnName = functionModel.value.name;
      }

      if (content.trim() == "") {
        $q.notify({
          type: "warning",
          message:
            "The function field must contain a value and cannot be left empty.",
        });
        return;
      }

      const pattern = /^[a-zA-Z][a-zA-Z0-9_]*$/;
      if (!pattern.test(fnName)) {
        $q.notify({
          type: "negative",
          message: "Function name is not valid.",
        });
        return;
      }

      formData.value.params = "row";
      formData.value.function = content;
      formData.value.transType = 0;
      formData.value.name = fnName;

      const result = functionOptions.value.find((obj) => obj.name === fnName);
      if (!result) {
        callTransform = jsTransformService.create(
          store.state.selectedOrganization.identifier,
          formData.value
        );

        callTransform
          .then((res: { data: any }) => {
            searchObj.data.tempFunctionLoading = false;

            $q.notify({
              type: "positive",
              message: res.data.message,
            });

            functionModel.value = {
              name: formData.value.name,
              function: formData.value.function,
            };
            functionOptions.value.push({
              name: formData.value.name,
              function: formData.value.function,
              transType: 0,
              params: "row",
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
      } else {
        showConfirmDialog(() => {
          callTransform = jsTransformService.update(
            store.state.selectedOrganization.identifier,
            formData.value
          );

          callTransform
            .then((res: { data: any }) => {
              searchObj.data.tempFunctionLoading = false;

              $q.notify({
                type: "positive",
                message: "Function updated successfully.",
              });

              const transformIndex = searchObj.data.transforms.findIndex(
                (obj) => obj.name === formData.value.name
              );
              if (transformIndex !== -1) {
                searchObj.data.transforms[transformIndex].name =
                  formData.value.name;
                searchObj.data.transforms[transformIndex].function =
                  formData.value.function;
              }

              functionOptions.value = searchObj.data.transforms;
            })
            .catch((err) => {
              searchObj.data.tempFunctionLoading = false;
              $q.notify({
                type: "negative",
                message:
                  JSON.stringify(err.response.data["message"]) ||
                  "Function updation failed",
                timeout: 5000,
              });
            });
        });
      }
    };

    const resetFunctionContent = () => {
      formData.value.function = "";
      fnEditorobj.setValue("");
      formData.value.name = "";
      functionModel.value = "";
      searchObj.data.tempFunctionLoading = false;
      searchObj.data.tempFunctionName = "";
      searchObj.data.tempFunctionContent = "";
    };

    const resetEditorLayout = () => {
      setTimeout(() => {
        queryEditorRef.value.resetEditorLayout();
        fnEditorobj.layout();
      }, 100);
    };

    const populateFunctionImplementation = (fnValue) => {
      fnEditorobj.setValue(fnValue.function);
      searchObj.data.tempFunctionName = fnValue.name;
      searchObj.data.tempFunctionContent = fnValue.function;
    };

    const showConfirmDialog = (callback) => {
      confirmDialogVisible.value = true;
      confirmCallback = callback;
    };

    const cancelConfirmDialog = () => {
      confirmDialogVisible.value = false;
      confirmCallback = null;
    };

    const confirmDialogOK = () => {
      if (confirmCallback) {
        confirmCallback();
      }
      confirmDialogVisible.value = false;
      confirmCallback = null;
    };

    const filterFn = (val, update) => {
      update(() => {
        if (val === "") {
          functionOptions.value = searchObj.data.transforms;
        } else {
          const needle = val.toLowerCase();
          functionOptions.value = searchObj.data.transforms.filter(
            (v) => v.name.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    return {
      t,
      store,
      router,
      fnEditorRef,
      fnEditorobj,
      searchObj,
      queryEditorRef,
      confirmDialogVisible,
      confirmCallback,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      showConfirmDialog,
      cancelConfirmDialog,
      confirmDialogOK,
      udpateQuery,
      downloadLogs,
      saveFunction,
      initFunctionEditor,
      resetFunctionContent,
      resetEditorLayout,
      populateFunctionImplementation,
      functionModel,
      functionOptions,
      filterFn,
      autoCompleteKeywords,
      autoCompleteSuggestions,
    };
  },
  computed: {
    addSearchTerm() {
      return this.searchObj.data.stream.addToFilter;
    },
    toggleFunction() {
      return this.searchObj.meta.toggleFunction;
    },
    selectFunction() {
      return this.functionModel;
    },
    confirmMessage() {
      return "Are you sure you want to update the function?";
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
    toggleFunction(newVal) {
      if (newVal == false) {
        this.searchObj.config.fnSplitterModel = 100;
        this.resetFunctionContent();
      } else {
        this.searchObj.config.fnSplitterModel = 60;
      }
      this.resetEditorLayout();
    },
    selectFunction(newVal) {
      if (newVal != "") {
        this.searchObj.config.fnSplitterModel = 60;
        this.searchObj.meta.toggleFunction = true;
      }
    },
  },
});
</script>

<style lang="scss">
#logsQueryEditor,
#fnEditor {
  height: calc(100% - 20px) !important;
}
#fnEditor {
  width: 100%;
  border-radius: 5px;
  border: 0px solid #dbdbdb;
  overflow: hidden;
}

.q-field--standard .q-field__control:before,
.q-field--standard .q-field__control:focus:before,
.q-field--standard .q-field__control:hover:before {
  border: 0px !important;
  border-color: none;
  transition: none;
}

.logs-search-bar-component > .row:nth-child(2) {
  height: calc(100% - 38px); /* or any other height you want to set */
}

.logs-search-bar-component {
  padding-bottom: 1px;
  height: 100%;
  overflow: visible;

  .function-dropdown {
    width: 205px;
    padding-bottom: 0px;
    border: 1px solid #dbdbdb;
    border-radius: 5px;
    cursor: pointer;

    .q-field__input {
      cursor: pointer;
      color: #36383a;
      font-weight: 600;
      font-size: 12px;
    }
    .q-field__native,
    .q-field__control {
      min-height: 29px;
      height: 29px;
      padding: 0px 0px 0px 4px;
    }

    .q-field__marginal {
      height: 30px;
    }
  }

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

.query-editor-container {
  height: calc(100% - 40px) !important;
}

.logs-auto-refresh-interval {
  .q-btn {
    min-height: 30px;
    max-height: 30px;
    padding: 0 4px;
  }
}
</style>
