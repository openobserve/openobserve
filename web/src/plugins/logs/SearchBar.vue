<!-- Copyright 2023 Zinc Labs Inc.

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
  <div class="logs-search-bar-component" id="searchBarComponent">
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
        <q-btn-group class="q-ml-sm no-outline q-pa-none no-border">
          <q-btn-dropdown
            v-model="savedViewDropdownModel"
            auto-close
            size="12px"
            icon="save"
            icon-right="saved_search"
            :title="t('search.savedViewsLabel')"
            @click="fnSavedView"
            split
            class="no-outline saved-views-dropdown no-border"
          >
            <q-list>
              <q-item-label header class="q-pa-sm">{{
                t("search.savedViewDropdownLabel")
              }}</q-item-label>
              <q-separator inset></q-separator>

              <div v-if="searchObj.data.savedViews.length">
                <q-item
                  class="q-pa-sm saved-view-item"
                  clickable
                  v-for="(item, i) in searchObj.data.savedViews"
                  :key="'saved-view-' + i"
                >
                  <q-item-section @click.stop="applySavedView(item)">
                    <q-item-label>{{ item.view_name }}</q-item-label>
                  </q-item-section>
                  <q-item-section
                    side
                    @click.stop="handleDeleteSavedView(item)"
                  >
                    <q-icon name="delete" color="grey" size="xs" />
                  </q-item-section>
                </q-item>
              </div>
              <div v-else>
                <q-item>
                  <q-item-section>
                    <q-item-label>{{
                      t("search.savedViewsNotFound")
                    }}</q-item-label>
                  </q-item-section>
                </q-item>
              </div>
            </q-list>
          </q-btn-dropdown>
        </q-btn-group>
      </div>
      <div class="float-right col-auto q-mb-xs">
        <q-toggle
          data-test="logs-search-bar-wrap-table-content-toggle-btn"
          v-if="searchObj.meta.flagWrapContent"
          v-model="searchObj.meta.toggleSourceWrap"
          icon="wrap_text"
          :title="t('search.messageWrapContent')"
          class="float-left"
          size="32px"
        />
        <q-toggle
          data-test="logs-search-bar-show-query-toggle-btn"
          v-model="searchObj.meta.toggleFunction"
          icon="functions"
          title="Toggle Function Editor"
          class="float-left"
          size="32px"
        />
        <q-select
          v-model="functionModel"
          :options="functionOptions"
          option-label="name"
          option-value="function"
          :placeholder="t('search.functionPlaceholder')"
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
              <q-item-section class="text-xs">{{
                t("search.functionMessage")
              }}</q-item-section>
            </q-item>
          </template>
        </q-select>
        <q-btn
          :disable="
            !functionModel ||
            !searchObj.data.tempFunctionContent ||
            functionModel.function == searchObj.data.tempFunctionContent
          "
          :title="t('search.saveFunctionLabel')"
          icon="save"
          icon-right="functions"
          size="sm"
          class="q-px-xs q-mr-sm float-left download-logs-btn"
          @click="saveFunction"
        ></q-btn>
        <q-btn
          class="q-mr-sm download-logs-btn q-px-sm"
          size="sm"
          v-bind:disable="
            searchObj.data.queryResults &&
            searchObj.data.queryResults.hasOwnProperty('hits') &&
            !searchObj.data.queryResults.hits.length
          "
          icon="download"
          :title="t('search.exportLogs')"
          @click="downloadLogs"
        ></q-btn>
        <div class="float-left">
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
            @on:date-change="updateDateTime"
            @on:timezone-change="updateTimezone"
          />
        </div>
        <div class="search-time q-pl-sm float-left q-mr-sm">
          <div class="flex">
            <auto-refresh-interval
              class="q-mr-sm q-px-none logs-auto-refresh-interval"
              v-model="searchObj.meta.refreshInterval"
              @update:model-value="onRefreshIntervalUpdate"
            />
            <!-- <q-separator vertical inset /> -->
            <q-btn
              data-test="logs-search-bar-refresh-btn"
              data-cy="search-bar-refresh-button"
              dense
              flat
              :title="t('search.runQuery')"
              class="q-pa-none search-button"
              @click="handleRunQuery"
              :disable="
                searchObj.loading ||
                (searchObj.data.hasOwnProperty('streamResults') &&
                  searchObj.data.streamResults.length == 0)
              "
              >{{ t("search.runQuery") }}</q-btn
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
            <query-editor
              editor-id="logsQueryEditor"
              ref="queryEditorRef"
              class="monaco-editor"
              v-model:query="searchObj.data.query"
              :keywords="autoCompleteKeywords"
              :suggestions="autoCompleteSuggestions"
              @update:query="updateQueryValue"
              @run-query="handleRunQuery"
              :class="
                searchObj.data.editorValue == '' &&
                searchObj.meta.queryEditorPlaceholderFlag
                  ? 'empty-query'
                  : ''
              "
            ></query-editor>
          </template>
          <template #after>
            <div
              data-test="logs-vrl-function-editor"
              v-show="searchObj.meta.toggleFunction"
              style="height: 100%"
            >
              <div
                ref="fnEditorRef"
                id="fnEditor"
                style="height: 100%"
                :class="
                  searchObj.data.tempFunctionContent == '' &&
                  searchObj.meta.functionEditorPlaceholderFlag
                    ? 'empty-function'
                    : ''
                "
              ></div>
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
          <q-btn
            :label="t('confirmDialog.cancel')"
            color="primary"
            @click="cancelConfirmDialog"
          />
          <q-btn
            :label="t('confirmDialog.ok')"
            color="positive"
            @click="confirmDialogOK"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog v-model="store.state.savedViewDialog">
      <q-card style="width: 700px; max-width: 80vw">
        <q-card-section>
          <div class="text-h6">{{ t("search.savedViewsLabel") }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-label>Update</q-label>
          <q-toggle
            v-bind:disable="searchObj.data.savedViews.length == 0"
            name="saved_view_action"
            v-model="isSavedViewAction"
            true-value="create"
            false-value="update"
            label=""
            @change="savedViewName = ''"
          />
          <q-label>Create</q-label>
          <div v-if="isSavedViewAction == 'create'">
            <q-input
              data-test="add-alert-name-input"
              v-model="savedViewName"
              :label="t('search.savedViewName')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[
                (val) => !!val.trim() || 'This field is required',
                (val) =>
                  /^[A-Za-z0-9 ]+$/.test(val) || 'Input must be alphanumeric',
              ]"
              tabindex="0"
            />
          </div>
          <div v-else>
            <q-select
              v-model="savedViewSelectedName"
              :options="searchObj.data.savedViews"
              option-label="view_name"
              option-value="view_id"
              :label="t('search.savedViewName')"
              :popup-content-style="{ textTransform: 'capitalize' }"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop"
              stack-label
              outlined
              filled
              dense
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
        </q-card-section>

        <q-card-actions align="right" class="bg-white text-teal">
          <q-btn
            unelevated
            no-caps
            class="q-mr-sm text-bold"
            :label="t('confirmDialog.cancel')"
            color="secondary"
            v-close-popup
          />
          <q-btn
            v-if="!saveViewLoader"
            unelevated
            no-caps
            :label="t('confirmDialog.ok')"
            color="primary"
            class="text-bold"
            @click="handleSavedView"
          />
          <q-btn
            v-if="saveViewLoader"
            unelevated
            no-caps
            :label="t('confirmDialog.loading')"
            color="primary"
            class="text-bold"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <ConfirmDialog
      title="Delete Saved View"
      message="Are you sure you want to delete saved view?"
      @update:ok="confirmDeleteSavedViews"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onMounted, nextTick, watch, toRaw } from "vue";
import { useI18n } from "vue-i18n";
import { onBeforeRouteUpdate, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

import DateTime from "@/components/DateTime.vue";
import useLogs from "@/composables/useLogs";
import QueryEditor from "@/components/QueryEditor.vue";
import SyntaxGuide from "./SyntaxGuide.vue";
import jsTransformService from "@/services/jstransform";

import { Parser } from "node-sql-parser/build/mysql";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";

import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import search from "../../services/search";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import stream from "@/services/stream";
import { getConsumableDateTime } from "@/utils/commons";
import useSqlSuggestions from "@/composables/useSuggestions";
import { mergeDeep } from "@/utils/zincutils";
import savedviewsService from "@/services/saved_views";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

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
    ConfirmDialog,
  },
  emits: ["searchdata", "onChangeInterval", "onChangeTimezone"],
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
    handleDeleteSavedView(item: any) {
      this.savedViewDropdownModel = false;
      this.deleteViewID = item.view_id;
      this.confirmDelete = true;
    },
    confirmDeleteSavedViews() {
      this.deleteSavedViews();
    },
  },
  props: {
    fieldValues: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();

    const {
      searchObj,
      refreshData,
      handleRunQuery,
      updatedLocalLogFilterField,
      getSavedViews,
      getQueryData,
      getStreams,
    } = useLogs();
    const queryEditorRef = ref(null);

    const formData: any = ref(defaultValue());
    const functionOptions = ref(searchObj.data.transforms);

    const functionModel: string = ref(null);
    const fnEditorRef: any = ref(null);
    const confirmDialogVisible: boolean = ref(false);
    let confirmCallback;
    let fnEditorobj: any = null;
    let streamName = "";

    const parser = new Parser();
    const dateTimeRef = ref(null);
    const saveViewLoader = ref(false);
    const isSavedViewApplied = ref(false);

    const {
      autoCompleteData,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      getSuggestions,
      updateFieldKeywords,
      updateFunctionKeywords,
    } = useSqlSuggestions();

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = item.value;
    };

    const isSavedViewAction = ref("create");
    const savedViewName = ref("");
    const savedViewSelectedName = ref("");
    const confirmDelete = ref(false);
    const deleteViewID = ref("");
    const savedViewDropdownModel = ref(false);

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      (fields) => {
        if (fields.length) updateFieldKeywords(fields);
      },
      { immediate: true, deep: true }
    );

    watch(
      () => searchObj.data.stream.functions,
      (funs) => {
        if (funs.length) updateFunctionKeywords(funs);
      },
      { immediate: true, deep: true }
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
      searchObj.data.editorValue = value;

      updateAutoComplete(value);
      try {
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
      } catch (e) {
        console.log("Logs: Error while updating query value");
      }
    };

    const updateDateTime = async (value: object) => {
      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: value.relativeTimePeriod
          ? value.relativeTimePeriod
          : searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
      };

      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();

      if (searchObj.loading == false) {
        searchObj.loading = true;
        searchObj.runQuery = true;
      }

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

      if (value.valueType === "relative") emit("searchdata");
    };

    const updateTimezone = () => {
      emit("onChangeTimezone");
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
        theme: store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
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
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        mouseWheelScrollSensitivity: 0,
        fastScrollSensitivity: 0,
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

      fnEditorobj.onDidFocusEditorWidget(() => {
        searchObj.meta.functionEditorPlaceholderFlag = false;
      });

      fnEditorobj.onDidBlurEditorWidget(() => {
        searchObj.meta.functionEditorPlaceholderFlag = true;
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
            (v) => v.name?.toLowerCase().indexOf(needle) > -1
          );
        }
      });
    };

    const onRefreshIntervalUpdate = () => {
      emit("onChangeInterval");
    };

    const fnSavedView = () => {
      if (!searchObj.data.stream.selectedStream.value) {
        $q.notify({
          type: "negative",
          message: "No stream available to save view.",
        });
        return;
      }
      store.dispatch("setSavedViewDialog", true);
      isSavedViewAction.value = "create";
      savedViewName.value = "";
      saveViewLoader.value = false;
      savedViewSelectedName.value = "";
      savedViewDropdownModel.value = false;
    };

    const applySavedView = (item) => {
      savedviewsService
        .getViewDetail(
          store.state.selectedOrganization.identifier,
          item.view_id
        )
        .then(async (res) => {
          if (res.status == 200) {
            isSavedViewApplied.value = true;
            // const extractedObj = JSON.parse(b64DecodeUnicode(res.data.data));
            const extractedObj = res.data.data;
            // alert(JSON.stringify(searchObj.data.stream.selectedStream))
            // if (
            //   extractedObj.data.stream.selectedStream.value !=
            //   searchObj.data.stream.selectedStream.value
            // ) {
            extractedObj.data.stream.streamLists =
              searchObj.data.stream.streamLists;
            extractedObj.data.transforms = searchObj.data.transforms;
            extractedObj.data.stream.functions =
              searchObj.data.stream.functions;
            extractedObj.data.histogram = {
              xData: [],
              yData: [],
              chartParams: {},
            };
            extractedObj.data.savedViews = searchObj.data.savedViews;
            extractedObj.data.queryResults = [];
            extractedObj.meta.scrollInfo = {};
            searchObj.value = mergeDeep(searchObj, extractedObj);
            await nextTick();
            if (extractedObj.data.tempFunctionContent != "") {
              populateFunctionImplementation({
                name: "",
                function: searchObj.data.tempFunctionContent,
              });
              searchObj.data.tempFunctionContent =
                extractedObj.data.tempFunctionContent;
              searchObj.meta.functionEditorPlaceholderFlag = false;
            }
            dateTimeRef.value.setSavedDate(searchObj.data.datetime);
            if (searchObj.meta.refreshInterval != "0") {
              onRefreshIntervalUpdate();
            }

            if (searchObj.data?.timezone) {
              store.dispatch("setTimezone", searchObj.data.timezone);
            }
            await updatedLocalLogFilterField();
            await getStreams("logs", true);

            $q.notify({
              message: `${item.view_name} view applied successfully.`,
              color: "positive",
              position: "bottom",
              timeout: 1000,
            });
            setTimeout(async () => {
              searchObj.loading = true;
              await getQueryData();
              isSavedViewApplied.value = false;
            }, 1000);

            // } else {
            //   searchObj.value = mergeDeep(searchObj, extractedObj);
            //   await nextTick();
            //   updatedLocalLogFilterField();
            //   handleRunQuery();
            // }
          } else {
            $q.notify({
              message: `Error while applying saved view. ${res.data.error_detail}`,
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
          }
        })
        .catch((err) => {
          $q.notify({
            message: `Error while applying saved view.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
          console.log(err);
        });
      // const extractedObj = JSON.parse(b64DecodeUnicode(item.data));
      // searchObj.value = mergeDeep(searchObj, extractedObj);
      // await nextTick();
      // updatedLocalLogFilterField();
      // handleRunQuery();
    };

    const handleSavedView = () => {
      if (isSavedViewAction.value == "create") {
        if (
          savedViewName.value == "" ||
          !/^[A-Za-z0-9 ]+$/.test(savedViewName.value)
        ) {
          $q.notify({
            message: `Please provide valid view name.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
        } else {
          saveViewLoader.value = true;
          createSavedViews(savedViewName.value);
        }
      } else {
        if (savedViewSelectedName.value.view_id) {
          saveViewLoader.value = true;
          updateSavedViews(
            savedViewSelectedName.value.view_id,
            savedViewSelectedName.value.view_name
          );
        } else {
          $q.notify({
            message: `Please select saved view to update.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
        }
      }
    };

    const deleteSavedViews = async () => {
      try {
        savedviewsService
          .delete(
            store.state.selectedOrganization.identifier,
            deleteViewID.value
          )
          .then((res) => {
            console.log(res);
            if (res.status == 200) {
              $q.notify({
                message: `View deleted successfully.`,
                color: "positive",
                position: "bottom",
                timeout: 1000,
              });
              getSavedViews();
            } else {
              $q.notify({
                message: `Error while deleting saved view. ${res.data.error_detail}`,
                color: "negative",
                position: "bottom",
                timeout: 1000,
              });
            }
          })
          .catch((err) => {
            $q.notify({
              message: `Error while deleting saved view.`,
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
            console.log(err);
          });
      } catch (e: any) {
        console.log("Error while getting saved views", e);
      }
    };

    const getSearchObj = () => {
      try {
        delete searchObj.meta.scrollInfo;
        delete searchObj?.value;
        let savedSearchObj = toRaw(searchObj);
        savedSearchObj = JSON.parse(JSON.stringify(savedSearchObj));

        delete savedSearchObj.data.queryResults;
        delete savedSearchObj.data.histogram;
        delete savedSearchObj.data.sortedQueryResults;
        delete savedSearchObj.data.stream.streamLists;
        delete savedSearchObj.data.stream.functions;
        delete savedSearchObj.data.streamResults;
        delete savedSearchObj.data.savedViews;
        delete savedSearchObj.data.transforms;

        savedSearchObj.data.timezone = store.state.timezone;
        delete savedSearchObj.value;

        return savedSearchObj;
        // return b64EncodeUnicode(JSON.stringify(savedSearchObj));
      } catch (e) {
        console.log("Error while encoding search obj", e);
      }
    };

    const createSavedViews = (viewName: string) => {
      try {
        if (viewName.trim() == "") {
          $q.notify({
            message: `Please provide valid view name.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
          saveViewLoader.value = false;
          return;
        }

        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        savedviewsService
          .post(store.state.selectedOrganization.identifier, viewObj)
          .then((res) => {
            if (res.status == 200) {
              store.dispatch("setSavedViewDialog", false);
              if (searchObj.data.hasOwnProperty("savedViews") == false) {
                searchObj.data.savedViews = [];
              }
              searchObj.data.savedViews.push({
                org_id: res.data.org_id,
                payload: viewObj.data,
                view_id: res.data.view_id,
                view_name: viewName,
              });
              $q.notify({
                message: `View created successfully.`,
                color: "positive",
                position: "bottom",
                timeout: 1000,
              });
              getSavedViews();
              isSavedViewAction.value = "create";
              savedViewName.value = "";
              saveViewLoader.value = false;
            } else {
              saveViewLoader.value = false;
              $q.notify({
                message: `Error while creating saved view. ${res.data.error_detail}`,
                color: "negative",
                position: "bottom",
                timeout: 1000,
              });
            }
          })
          .catch((err) => {
            saveViewLoader.value = false;
            $q.notify({
              message: `Error while creating saved view.`,
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
            console.log(err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        savedViewName.value = "";
        saveViewLoader.value = false;
        $q.notify({
          message: `Error while saving view: ${e}`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log("Error while saving view", e);
      }
    };

    const updateSavedViews = (viewID: string, viewName: string) => {
      try {
        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        savedviewsService
          .put(store.state.selectedOrganization.identifier, viewID, viewObj)
          .then((res) => {
            if (res.status == 200) {
              store.dispatch("setSavedViewDialog", false);
              //update the payload and view_name in savedViews object based on id
              searchObj.data.savedViews.forEach(
                (item: { view_id: string }, index: string | number) => {
                  if (item.view_id == viewID) {
                    searchObj.data.savedViews[index].payload = viewObj.data;
                    searchObj.data.savedViews[index].view_name = viewName;
                  }
                }
              );

              $q.notify({
                message: `View updated successfully.`,
                color: "positive",
                position: "bottom",
                timeout: 1000,
              });
              isSavedViewAction.value = "create";
              savedViewSelectedName.value = "";
              saveViewLoader.value = false;
            } else {
              saveViewLoader.value = false;
              $q.notify({
                message: `Error while updating saved view. ${res.data.error_detail}`,
                color: "negative",
                position: "bottom",
                timeout: 1000,
              });
            }
          })
          .catch((err) => {
            saveViewLoader.value = false;
            $q.notify({
              message: `Error while updating saved view.`,
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
            console.log(err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        savedViewSelectedName.value = "";
        saveViewLoader.value = false;
        $q.notify({
          message: `Error while saving view: ${e}`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log("Error while saving view", e);
      }
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
      refreshData,
      handleRunQuery,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      onRefreshIntervalUpdate,
      updateTimezone,
      dateTimeRef,
      fnSavedView,
      applySavedView,
      isSavedViewAction,
      savedViewName,
      savedViewSelectedName,
      handleSavedView,
      deleteSavedViews,
      deleteViewID,
      confirmDelete,
      saveViewLoader,
      savedViewDropdownModel,
      isSavedViewApplied,
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
    resetFunction() {
      return this.searchObj.data.tempFunctionName;
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
            if (
              this.searchObj.meta.sqlMode == true &&
              currentQuery.toString().toLowerCase().indexOf("where") == -1
            ) {
              currentQuery += " where " + filter;
            } else {
              currentQuery += " and " + filter;
            }
          } else {
            if (this.searchObj.meta.sqlMode == true) {
              currentQuery = "where " + filter;
            } else {
              currentQuery = filter;
            }
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
        this.searchObj.config.fnSplitterModel = 99.5;
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
    resetFunction(newVal) {
      if (newVal == "" && this.isSavedViewApplied == false) {
        this.resetFunctionContent();
      }
    },
  },
});
</script>

<style lang="scss">
#logsQueryEditor,
#fnEditor {
  height: 100% !important;
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
  height: 100%; /* or any other height you want to set */
}

.empty-query .monaco-editor-background {
  background-image: url("../../assets/images/common/query-editor.png");
  background-repeat: no-repeat;
  background-size: 115px;
}

.empty-function .monaco-editor-background {
  background-image: url("../../assets/images/common/vrl-function.png");
  background-repeat: no-repeat;
  background-size: 170px;
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
    min-width: 96px;
    line-height: 29px;
    font-weight: bold;
    text-transform: initial;
    font-size: 11px;
    color: white;

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
}

.query-editor-container {
  height: calc(100% - 37px) !important;
}

.logs-auto-refresh-interval {
  .q-btn {
    min-height: 30px;
    max-height: 30px;
    padding: 0 4px;
  }
}

.saved-views-dropdown {
  border-radius: 4px;
  button {
    padding: 4px 5px;
  }
}

.savedview-dropdown {
  width: 215px;
  display: inline-block;
  border: 1px solid #dbdbdb;

  .q-field__input {
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
  }
  .q-field__native,
  .q-field__control {
    min-height: 29px !important;
    height: 29px;
    padding: 0px 0px 0px 4px;
  }

  .q-field__marginal {
    height: 30px;
  }
}

.saved-view-item {
  padding: 4px 5px !important;
}
</style>
