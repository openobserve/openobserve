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
    <div class="row flex justify-end align-center">
      <div class="col-auto q-my-xs">
        <q-btn
          class="q-mr-sm download-logs-btn q-px-sm"
          size="sm"
          :disabled="
            queryData.queryResults.hasOwnProperty('hits') &&
            !queryData.queryResults.hits.length
          "
          icon="download"
          title="Export logs"
          @click="downloadLogs"
        ></q-btn>
        <div
          class="float-left"
          v-show="queryData.streamType !== 'enrichment_tables'"
        >
          <date-time
            data-test="logs-search-bar-date-time-dropdown"
            @date-change="updateDateTime"
          />
        </div>
        <div class="search-time q-pl-sm float-left q-mr-sm">
          <q-btn
            data-test="logs-search-bar-refresh-btn"
            data-cy="search-bar-refresh-button"
            dense
            flat
            title="Run query"
            class="q-pa-none search-button"
            @click="searchData"
            >Run query</q-btn
          >
        </div>
      </div>
    </div>
    <div class="row query-editor-container">
      <div class="col" style="border-top: 1px solid #dbdbdb; height: 100px">
        <b>Query Editor:</b>
        <query-editor
          id="logsQueryEditor"
          ref="queryEditorRef"
          class="monaco-editor"
          :show-auto-complete="false"
          v-model:query="searchObj.data.query"
          v-model:fields="searchObj.data.stream.selectedStreamFields"
          v-model:functions="searchObj.data.stream.functions"
          @update-query="updateQueryValue"
          @run-query="searchData"
        ></query-editor>
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
import QueryEditor from "@/components/QueryEditor.vue";
import jsTransformService from "@/services/jstransform";

import { Parser } from "node-sql-parser";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";

import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import search from "../../services/search";
import { emit } from "process";

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
  props: {
    queryData: {
      type: Object,
      default: () => {
        return {};
      },
    },
  },
  components: {
    DateTime,
    QueryEditor,
  },
  emits: ["searchdata", "update-query"],
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const store = useStore();
    const btnRefreshInterval = ref(null);

    const { searchObj } = useLogs();
    const queryEditorRef = ref(null);

    const functionOptions = ref(searchObj.data.transforms);

    const functionModel: string = ref(null);
    const fnEditorRef: any = ref(null);
    const confirmDialogVisible: boolean = ref(false);
    let confirmCallback;
    let fnEditorobj: any = null;

    const updateQueryValue = (value: string) => {
      emit("update-query", value);
    };

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
        queryEditorRef.value.setValue(props.queryData.query);
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
      const data = jsonToCsv(props.queryData.queryResults.hits);
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

    const resetEditorLayout = () => {
      setTimeout(() => {
        queryEditorRef.value.resetEditorLayout();
        fnEditorobj.layout();
      }, 100);
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
      confirmDialogVisible,
      confirmCallback,
      refreshTimes: searchObj.config.refreshTimes,
      updateQueryValue,
      updateDateTime,
      udpateQuery,
      downloadLogs,
      resetEditorLayout,
      functionModel,
      functionOptions,
    };
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
</style>
