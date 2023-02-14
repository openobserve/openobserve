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
          v-model="searchObj.meta.showQuery"
          :label="t('search.showQueryLabel')"
        />
        <q-toggle
          v-model="searchObj.meta.showFields"
          :label="t('search.showFieldLabel')"
        />
        <q-toggle
          v-model="searchObj.meta.showHistogram"
          :label="t('search.showHistogramLabel')"
        />
        <q-toggle
          v-model="searchObj.meta.sqlMode"
          :label="t('search.sqlModeLabel')"
        />
        <syntax-guide :sqlmode="searchObj.meta.sqlMode"></syntax-guide>
      </div>
      <div class="float-right col-auto">
        <div class="float-left">
          <date-time @date-change="updateDateTime" />
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
            >
              <div class="refresh-rate-dropdown-container">
                <div class="row">
                  <div class="col col-12 q-pa-sm" style="text-align: center">
                    <q-btn
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
              data-cy="search-bar-refresh-button"
              dense
              flat
              title="Run Query"
              icon="search"
              class="q-pa-none search-button"
              @click="searchData"
              :disable="
                searchObj.loading || searchObj.data.streamResults.length == 0
              "
            ></q-btn>
          </q-btn-group>
        </div>
      </div>
    </div>
    <div class="row" v-if="searchObj.meta.showQuery">
      <div class="col">
        <query-editor
          ref="queryEditorRef"
          class="monaco-editor"
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
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

import DateTime from "./DateTime.vue";
import useLogs from "../../composables/useLogs";
import QueryEditor from "./QueryEditor.vue";
import SyntaxGuide from "./SyntaxGuide.vue";

import { Parser } from "node-sql-parser";

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
    const btnRefreshInterval = ref(null);

    const { searchObj } = useLogs();
    const queryEditorRef = ref(null);

    const parser = new Parser();
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
          // alert(
          //   searchObj.data.parsedQuery.from[0].table !==
          //     searchObj.data.stream.selectedStream.value
          // );
          // alert(searchObj.data.parsedQuery.from[0].table !== streamName);
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
    };

    const udpateQuery = () => {
      // alert(searchObj.data.query);
      queryEditorRef.value.setValue(searchObj.data.query);
    };

    return {
      t,
      router,
      searchObj,
      queryEditorRef,
      btnRefreshInterval,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      udpateQuery,
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

        if (currentQuery.length > 1) {
          if (currentQuery[1].trim() != "") {
            currentQuery[1] += " and " + this.searchObj.data.stream.addToFilter;
          } else {
            currentQuery[1] = this.searchObj.data.stream.addToFilter;
          }
          this.searchObj.data.query = currentQuery.join("| ");
        } else {
          if (currentQuery != "") {
            currentQuery += " and " + this.searchObj.data.stream.addToFilter;
          } else {
            currentQuery = this.searchObj.data.stream.addToFilter;
          }
          this.searchObj.data.query = currentQuery;
        }
        this.searchObj.data.stream.addToFilter = "";

        this.queryEditorRef.setValue(this.searchObj.data.query);
      }
    },
  },
});
</script>

<style lang="scss">
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
    .q-btn-group {
      border-radius: 3px;

      .q-btn {
        min-height: auto;
      }
    }
  }
  .search-dropdown {
    padding-top: 2px;
    padding-bottom: 2px;
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
    .q-btn__content {
      background: $primary;
      border-radius: 0px 3px 3px 0px;

      .q-icon {
        font-size: 15px;
        color: #ffffff;
      }
    }
  }
}
</style>
