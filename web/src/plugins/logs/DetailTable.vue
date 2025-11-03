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
  <q-card
    class="column full-height no-wrap searchdetaildialog"
    data-test="dialog-box"
    :style="{ borderTop: `4px solid ${statusColor}` }"
  >
    <q-card-section class="q-px-md q-pb-sm">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="text-body1 text-bold" data-test="log-detail-title-text">
            {{ t("search.rowDetail") }}
          </div>
        </div>
        <div class="col-auto">
          <q-btn
            v-close-popup="true"
            round
            flat
            icon="cancel"
            data-test="close-dialog"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <div class="row justify-between q-pt-sm">
      <div class="col-10">
        <q-tabs v-model="tab" shrink align="left">
          <q-tab
            data-test="log-detail-json-tab"
            name="json"
            :label="t('common.json')"
          />
          <q-tab
            data-test="log-detail-table-tab"
            name="table"
            :label="t('common.table')"
          />
          <!-- o2 ai context add button in the detail table -->
          <O2AIContextAddBtn 
            class="tw-px-2 tw-py-2" 
            @sendToAiChat="sendToAiChat(JSON.stringify(rowData))"
             />
        </q-tabs>
      </div>
      <div
        v-show="tab === 'table'"
        class="col-2 flex justify-end align-center q-pr-md"
      >
        <q-toggle
          data-test="log-detail-wrap-values-toggle-btn"
          v-model="shouldWrapValues"
          :label="t('common.wrap')"
          class="o2-toggle-button-xs"
          size="xs"
          flat
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-xs-dark'
              : 'o2-toggle-button-xs-light'
          "
          @update:model-value="toggleWrapLogDetails"
        />
      </div>
    </div>

    <q-separator />

    <q-tab-panels
      data-test="log-detail-tab-container"
      class="tab-panels-container"
      v-model="tab"
      animated
    >
      <q-tab-panel name="json" class="q-pa-none">
        <q-card-section
          data-test="log-detail-json-content"
          class="q-pa-none q-mb-lg q-pt-sm"
        >
          <json-preview
            :value="rowData"
            show-copy-button
            mode="sidebar"
            :highlight-query="highlightQuery"
            @copy="copyContentToClipboard"
            @add-field-to-table="addFieldToTable"
            @add-search-term="toggleIncludeSearchTerm"
            @view-trace="viewTrace"
            @send-to-ai-chat="sendToAiChat"
            @closeTable="closeTable"
          />
        </q-card-section>
      </q-tab-panel>
      <q-tab-panel name="table" class="q-pa-none">
        <q-card-section
          class="tw-p-[0.675rem] q-mb-lg"
          data-test="log-detail-table-content"
        >
          <div v-if="rowData.length == 0" class="q-pt-md tw-max-w-[350px]">
            No data available.
          </div>
          <q-table
            v-else
            ref="qTable"
            data-test="log-detail-table"
            :rows="tableRows"
            :columns="tableColumns"
            :row-key="(row) => 'field_' + row.field"
            :rows-per-page-options="[0]"
            class="q-table o2-quasar-table o2-row-md o2-schema-table tw-w-full tw-border tw-border-solid tw-border-[var(--o2-border-color)]"
            dense
          >
            <template v-slot:body-cell-field="props">
              <q-td
                :data-test="`log-detail-${props.row.field}-key`"
                class="text-left"
                :class="store.state.theme == 'dark' ? 'tw-text-[#f67a7aff]' : 'tw-text-[#B71C1C]'"
              >
                {{ props.row.field }}
              </q-td>
            </template>

            <template v-slot:body-cell-value="props">
              <q-td
                class="text-left"
                :class="!shouldWrapValues ? 'ellipsis' : ''"
              >
                <div class="tw-flex tw-items-start tw-gap-2">
                  <q-btn-dropdown
                    :data-test="`log-details-include-exclude-field-btn-${props.row.field}`"
                    size="6px"
                    outlined
                    filled
                    dense
                    class="pointer"
                    name="'img:' + getImageURL('images/common/add_icon.svg')"
                  >
                    <q-list data-test="field-list-modal" class="logs-table-list">
                      <q-item
                        clickable
                        v-close-popup="true"
                        v-if="
                          searchObj.data.stream.selectedStreamFields.some(
                            (item: any) =>
                              item.name === props.row.field ? item.isSchemaField : '',
                          )
                        "
                      >
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-include-field-btn"
                            @click="
                              toggleIncludeSearchTerm(props.row.field, props.row.value, 'include')
                            "
                            ><q-btn
                              title="Add to search query"
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            >
                              <q-icon color="currentColor">
                                <EqualIcon></EqualIcon>
                              </q-icon> </q-btn
                            >{{ t("common.includeSearchTerm") }}</q-item-label
                          >
                        </q-item-section>
                      </q-item>

                      <q-item
                        clickable
                        v-close-popup="true"
                        v-if="
                          searchObj.data.stream.selectedStreamFields.some(
                            (item: any) =>
                              item.name === props.row.field ? item.isSchemaField : '',
                          )
                        "
                      >
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-exclude-field-btn"
                            @click="
                              toggleExcludeSearchTerm(props.row.field, props.row.value, 'exclude')
                            "
                            ><q-btn
                              title="Add to search query"
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            >
                              <q-icon color="currentColor">
                                <NotEqualIcon></NotEqualIcon>
                              </q-icon> </q-btn
                            >{{ t("common.excludeSearchTerm") }}</q-item-label
                          >
                        </q-item-section>
                      </q-item>

                      <q-item
                        v-if="
                          !searchObj.data.stream.selectedFields.includes(
                            props.row.field.toString(),
                          )
                        "
                        clickable
                        v-close-popup="true"
                      >
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-include-field-btn"
                            @click="addFieldToTable(props.row.field.toString())"
                            ><q-btn
                              title="Add to table"
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            >
                              <q-icon
                                color="currentColor"
                                name="visibility" /></q-btn
                            >{{ t("common.addFieldToTable") }}</q-item-label
                          >
                        </q-item-section>
                      </q-item>
                      <q-item v-else clickable v-close-popup="true">
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-include-field-btn"
                            @click="addFieldToTable(props.row.field.toString())"
                            ><q-btn
                              title="Remove from table "
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            >
                              <q-icon
                                color="currentColor"
                                name="visibility_off" /></q-btn
                            >{{
                              t("common.removeFieldFromTable")
                            }}</q-item-label
                          >
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </q-btn-dropdown>
                  <pre
                    :data-test="`log-detail-${props.row.field}-value`"
                    class="table-pre tw-flex-1"
                    :class="
                      !shouldWrapValues
                        ? 'tw-whitespace-nowrap'
                        : 'tw-whitespace-pre-wrap'
                    "
                  ><LogsHighLighting :data="props.row.value" :show-braces="false" :query-string="highlightQuery" /></pre>
                </div>
              </q-td>
            </template>
          </q-table>
        </q-card-section>
      </q-tab-panel>
    </q-tab-panels>

    <q-separator />
    <q-card-section class="q-pa-md q-pb-md">
      <div class="row items-center no-wrap justify-between">
        <div class="col-2">
          <q-btn
            data-test="log-detail-previous-detail-btn"
            class="text-bold"
            text-color="light-text"
            no-caps
            :disabled="currentIndex <= 0"
            outline
            @click="$emit('showPrevDetail', false, true)"
            icon="navigate_before"
            :label="t('common.previous')"
          />
        </div>
        <div
          v-show="
            streamType !== 'enrichment_tables' &&
            searchObj.data.stream.selectedStream.length <= 1 &&
            hasAggregationQuery == false
          "
          class="col-8 row justify-center align-center q-gutter-sm"
        >
          <div class="tw-leading-10 tw-font-bold">
            {{ t("common.noOfRecords") }}
          </div>
          <div class="tw-min-w-[70px]">
            <q-select
              v-model="selectedRelativeValue"
              :options="recordSizeOptions"
              dense
              class="select-noof-records"
            ></q-select>
          </div>
          <div class="">
            <q-btn
              data-test="logs-detail-table-search-around-btn"
              class="text-bold"
              text-color="light-text"
              no-caps
              outline
              :label="t('common.searchAround')"
              @click="searchTimeBoxed(rowData, Number(selectedRelativeValue))"
              padding="sm md"
            />
          </div>
        </div>
        <div class="col-2 items-end">
          <q-btn
            data-test="log-detail-next-detail-btn"
            class="text-bold"
            text-color="light-text"
            no-caps
            :disabled="currentIndex >= totalLength - 1"
            outline
            @click="$emit('showNextDetail', true, false)"
            icon-right="navigate_next"
            :label="t('common.next')"
          />
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getImageURL } from "../../utils/zincutils";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { copyToClipboard, useQuasar } from "quasar";
import JsonPreview from "./JsonPreview.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import { extractStatusFromLog } from "@/utils/logs/statusParser";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { searchState } from "@/composables/useLogs/searchState";

const defaultValue: any = () => {
  return {
    data: {},
  };
};

export default defineComponent({
  name: "SearchDetail",
  components: { EqualIcon, NotEqualIcon, JsonPreview, O2AIContextAddBtn, LogsHighLighting },
  emits: [
    "showPrevDetail",
    "showNextDetail",
    "add:searchterm",
    "remove:searchterm",
    "search:timeboxed",
    "add:table",
    "view-trace",
    "sendToAiChat",
    "closeTable"
  ],
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    currentIndex: {
      type: Number,
      required: true,
    },
    totalLength: {
      type: Number,
      required: true,
    },
    streamType: {
      type: String,
      default: "logs",
    },
    highlightQuery: {
      type: String,
      default: "",
    },
  },
  methods: {
    toggleIncludeSearchTerm(
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) {
      this.$emit("add:searchterm", field, field_value, action);
    },
    toggleExcludeSearchTerm(
      field: string | number,
      field_value: string | number | boolean,
      action: string,
    ) {
      this.$emit("add:searchterm", field, field_value, action);
    },
    searchTimeBoxed(rowData: any, size: number) { 
      this.$emit("search:timeboxed", {
        key: rowData[this.store.state.zoConfig.timestamp_column],
        size: size,
        body: rowData,
      });
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const rowData: any = ref({});
    const router = useRouter();
    const store = useStore();
    const tab = ref("json");
    const selectedRelativeValue = ref("10");
    const recordSizeOptions: any = ref([10, 20, 50, 100, 200, 500, 1000]);
    const shouldWrapValues: any = ref(true);
    const { searchObj } = searchState();
    const {fnParsedSQL, hasAggregation} = logsUtils();

    const $q = useQuasar();

    // Table columns for q-table
    const tableColumns = [
      {
        name: "field",
        label: t("search.sourceName"),
        field: "field",
        align: "left" as const,
        headerClasses: "!tw-text-left",
      },
      {
        name: "value",
        label: t("search.sourceValue"),
        field: "value",
        align: "left" as const,
        headerClasses: "!tw-text-left",
      },
    ];

    // Transform rowData object into array of rows for q-table
    const tableRows = computed(() => {
      return Object.entries(rowData.value).map(([field, value]) => ({
        field,
        value,
      }));
    });

    // Pagination settings for q-table (show all rows)
    const tablePagination = ref({ rowsPerPage: 0 });
    let multiStreamFields: any = ref([]);
    let hasAggregationQuery: any = computed(() => {
      let parsedSQL = fnParsedSQL();
      return hasAggregation(parsedSQL?.columns);
    });

    // Compute status color for the top border
    const statusColor = computed(() => {
      return extractStatusFromLog(rowData.value).color;
    });

    onBeforeMount(() => {
      if (window.localStorage.getItem("wrap-log-details") === null) {
        window.localStorage.setItem("wrap-log-details", "true");
      }
      shouldWrapValues.value =
        window.localStorage.getItem("wrap-log-details") === "true";

      searchObj.data.stream.selectedStreamFields.forEach((item: any) => {
        if (
          item.streams.length == searchObj.data.stream.selectedStream.length
        ) {
          multiStreamFields.value.push(item.name);
        }
      });
    });

    const toggleWrapLogDetails = () => {
      window.localStorage.setItem(
        "wrap-log-details",
        shouldWrapValues.value ? "true" : "false",
      );
    };

    const flattenJSONObject = (obj: any, param: string) => {
      let newObj: any = {};
      for (let key in obj) {
        if (typeof obj[key] === "object") {
          // let childJSON = JSON.stringify(obj[key]);
          // let unflatten = flattenJSONObject(obj[key], key + ".");
          newObj = {
            ...newObj,
            ...flattenJSONObject(obj[key], param + key + "."),
          };
        } else {
          newObj[param + key] = obj[key];
        }
      }
      return newObj;
    };

    const copyContentToClipboard = (log: any) => {
      copyToClipboard(JSON.stringify(log)).then(() =>
        $q.notify({
          type: "positive",
          message: "Content Copied Successfully!",
          timeout: 1000,
        }),
      );
    };

    const addFieldToTable = (value: string) => {
      emit("add:table", value);
    };

    const viewTrace = () => {
      emit("view-trace");
    };

    const sendToAiChat = (value: any) => {
      emit("sendToAiChat", value);
      emit("closeTable");
    };
    const closeTable = () => {
      emit("closeTable");
    }
    return {
      t,
      store,
      router,
      rowData,
      tab,
      flattenJSONObject,
      selectedRelativeValue,
      recordSizeOptions,
      getImageURL,
      shouldWrapValues,
      toggleWrapLogDetails,
      copyContentToClipboard,
      addFieldToTable,
      searchObj,
      multiStreamFields,
      viewTrace,
      hasAggregationQuery,
      sendToAiChat,
      closeTable,
      statusColor,
      tableColumns,
      tableRows,
      tablePagination,
    };
  },
  async created() {
    const newObj = await this.flattenJSONObject(this.modelValue, "");
    this.rowData = newObj;
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/logs/detail-table.scss";
</style>
