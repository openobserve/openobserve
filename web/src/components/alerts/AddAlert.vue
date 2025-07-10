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
  <div class="full-width q-mx-lg "  >
    <div class="row items-center no-wrap q-mx-md q-my-sm">
      <div class="flex items-center">
        <div
          data-test="add-alert-back-btn"
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="router.back()"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div v-if="beingUpdated" class="text-h6" data-test="add-alert-title">
          {{ t("alerts.updateTitle") }}
        </div>
        <div v-else class="text-h6" data-test="add-alert-title">
          {{ t("alerts.addTitle") }}
        </div>
      </div>
    </div>

    <q-separator />
    <div
      ref="addAlertFormRef"
      class="q-px-lg q-my-md"
      style="
        max-height: calc(100vh - 195px);
        overflow: auto;
        scroll-behavior: smooth;
      "
    >
      <div class="row flex tw-gap-5 items-start" style="width: 100%">
        <div class="col" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
          <q-form class="add-alert-form" ref="addAlertForm" @submit="onSubmit">
            <!-- alerts setup  section -->
            <div
              class="flex q-mt-lg justify-start items-center q-pb-sm q-col-gutter-md flex-wrap "
            >
            <div class="  q-px-lg tw-w-full row alert-setup-container" style="width: calc(100vw - 600px);">
              <AlertsContainer 
                name="query"
                v-model:is-expanded="expandState.alertSetup"
                label="Alert Setup"
                subLabel="Set the stage for your alert."
                icon="edit"
                class="tw-mt-1 tw-w-full col-12"
            />
             <div v-show="expandState.alertSetup" class="tw-w-full ">

              <div
                class="alert-name-input o2-input flex justify-between items-center q-px-lg tw-gap-10"
                style="padding-top: 12px;"
                data-test="add-alert-name-input-container"
              >
                <q-input
                  data-test="add-alert-name-input row"
                  v-model="formData.name"
                  :label="t('alerts.name') + ' *'"
                  color="input-border"
                    class="showLabelOnTop col"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                  stack-label
                  outlined
                  filled
                  dense
                  v-bind:readonly="beingUpdated"
                  v-bind:disable="beingUpdated"
                  :rules="[
                    (val: any) =>
                      !!val
                        ? isValidResourceName(val) ||
                          `Characters like :, ?, /, #, and spaces are not allowed.`
                        : t('common.nameRequired'),
                  ]"
                  tabindex="0"
                />
                <div class="col">
                  <SelectFolderDropDown
                    :disableDropdown="beingUpdated"
                    :type="'alerts'"
                    @folder-selected="updateActiveFolderId"
                    :activeFolderId="activeFolderId"
                    :style="'height: 30px'"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                />
                </div>
               
              </div>
             </div>

             <div
                class="flex q-px-lg tw-w-full items-center justify-between row tw-gap-10"
                style="padding-top: 0px"
                v-show="expandState.alertSetup"
                data-test="add-alert-stream-type-select-container"
              >
                <div
                  data-test="add-alert-stream-type-select"
                  class="alert-stream-type o2-input tw-w-full col "
                  style="padding-top: 0"

                >
                  <q-select
                    data-test="add-alert-stream-type-select-dropdown"
                    v-model="formData.stream_type"
                    :options="streamTypes"
                    :label="t('alerts.streamType') + ' *'"
                    :popup-content-style="{ textTransform: 'lowercase' }"
                    color="input-border"
                    class="q-py-sm showLabelOnTop no-case col"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    stack-label
                    outlined
                    filled
                    dense
                    v-bind:readonly="beingUpdated"
                    v-bind:disable="beingUpdated"
                    @update:model-value="updateStreams()"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                  />
                </div>
                <div
                  data-test="add-alert-stream-select"
                  class="o2-input col"
                  style="padding-top: 0"
                >
                  <q-select
                    data-test="add-alert-stream-name-select-dropdown"
                    v-model="formData.stream_name"
                    :options="filteredStreams"
                    :label="t('alerts.stream_name') + ' *'"
                    :loading="isFetchingStreams"
                    color="input-border"
                    class="q-py-sm showLabelOnTop no-case col"
                    :class="store.state.theme === 'dark' ? 'input-box-bg-dark' : 'input-box-bg-light'"
                    filled
                    stack-label
                    dense
                    use-input
                    hide-selected
                    fill-input
                    :input-debounce="400"
                    v-bind:readonly="beingUpdated"
                    v-bind:disable="beingUpdated"
                    @filter="filterStreams"
                    @update:model-value="
                      updateStreamFields(formData.stream_name)
                    "
                    behavior="menu"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                  />
                </div>
              </div>
              <div  v-if="expandState.alertSetup" class="q-gutter-sm q-px-lg q-py-sm">
              <q-radio
                data-test="add-alert-scheduled-alert-radio"
                v-bind:readonly="beingUpdated"
                v-bind:disable="beingUpdated"
                v-model="formData.is_real_time"
                :checked="formData.is_real_time"
                val="false"
                :label="t('alerts.scheduled')"
                class="q-ml-none"
              />
              <q-radio
                data-test="add-alert-realtime-alert-radio"
                v-bind:readonly="beingUpdated"
                v-bind:disable="beingUpdated"
                v-model="formData.is_real_time"
                :checked="!formData.is_real_time"
                val="true"
                :label="t('alerts.realTime')"
                class="q-ml-none"
              />
            </div>
            </div>
           

            </div>
            

            <div
              v-if="formData.is_real_time === 'true'"
              class="q-pr-sm q-pa-none q-ma-none"
              data-test="add-alert-query-input-title"
            >
              <real-time-alert
                ref="realTimeAlertRef"
                :columns="filteredColumns"
                :conditions="formData.query_condition?.conditions || {}"
                @input:update="onInputUpdate"
                :expandState = expandState
                @update:expandState="updateExpandState"
                :trigger="formData.trigger_condition"
                :destinations="formData.destinations"
                :formattedDestinations="getFormattedDestinations"
                @refresh:destinations="refreshDestinations"
                @update:destinations="updateDestinations"
                @update:group="updateGroup"
                @remove:group="removeConditionGroup"

              />
            </div>
            <div v-else class="q-pa-none q-ma-none q-pr-sm  ">
              <scheduled-alert
                ref="scheduledAlertRef"
                :columns="filteredColumns"
                :conditions="formData.query_condition?.conditions || {}"
                :expandState = expandState
                :alertData="formData"
                :sqlQueryErrorMsg="sqlQueryErrorMsg"
                :vrlFunctionError="vrlFunctionError"
                :showTimezoneWarning="showTimezoneWarning"
                :selectedStream="formData.stream_name"
                :selected-stream-type="formData.stream_type"
                :destinations="formData.destinations"
                :formattedDestinations="getFormattedDestinations"
                v-model:trigger="formData.trigger_condition"
                v-model:sql="formData.query_condition.sql"
                v-model:promql="formData.query_condition.promql"
                v-model:query_type="formData.query_condition.type"
                v-model:aggregation="formData.query_condition.aggregation"
                v-model:silence="formData.trigger_condition.silence"
                v-model:promql_condition="
                  formData.query_condition.promql_condition
                "
                v-model:multi_time_range="
                  formData.query_condition.multi_time_range
                "
                v-model:vrl_function="formData.query_condition.vrl_function"
                v-model:isAggregationEnabled="isAggregationEnabled"
                v-model:showVrlFunction="showVrlFunction"
                @update:group="updateGroup"
                @remove:group="removeConditionGroup"
                @input:update="onInputUpdate"
                @validate-sql="validateSqlQuery"
                @update:showVrlFunction="updateFunctionVisibility"
                @update:multi_time_range="updateMultiTimeRange"
                @update:expandState="updateExpandState"
                @update:silence="updateSilence"
                @refresh:destinations="refreshDestinations"
                @update:destinations="updateDestinations"
                class="q-mt-sm"
              />
            </div>
  
              <!-- this section needs to be moved to the scheduled and relatime alert components -->

            <!-- additional setup starts here -->
            <div
              class="flex q-mt-md justify-start items-center q-pb-sm q-col-gutter-md flex-wrap "
            >
            <div class="  q-px-lg tw-w-full row alert-setup-container" >

              <AlertsContainer 
                name="advanced"
                v-model:is-expanded="expandState.advancedSetup"
                label="Advanced Setup"
                :icon="'add'"
                subLabel="Go deeper with custom options"
                class="tw-mt-1 tw-w-full col-12"
            />
            <div class="tw-w-full row q-px-lg" >
              <div v-if="expandState.advancedSetup" class="q-mt-md tw-w-full">
              <variables-input
                class="o2-input"
                :variables="formData.context_attributes"
                @add:variable="addVariable"
                @remove:variable="removeVariable"
              />
            </div>

            <div v-if="expandState.advancedSetup" class=" tw-w-full">
              <div data-test="add-alert-description-input tw-w-full " :class="store.state.theme === 'dark' ? '' : 'light-mode'">
                <div class="flex items-center q-mb-sm ">
                  <span class="text-bold custom-input-label">Description</span>
                </div>
                <q-input
                  v-model="formData.description"
                  color="input-border"
                  bg-color="input-bg"
                  class="showLabelOnTop q-mb-sm q-text-area-input"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="0"
                  style="width: 100%; resize: none;"
                  type="textarea"
                  placeholder="Type something"
                  rows="5"
                  
                />
              </div>
              <div data-test="add-alert-row-input tw-w-full">
                <div class="flex items-center q-mb-sm">
                  <span class="text-bold custom-input-label">Row Template</span>
                  <q-btn
                    data-test="add-alert-row-input-info-btn"
                    style="color: #A0A0A0;"
                    no-caps
                    padding="xs"
                    class="q-ml-xs"
                    size="sm"
                    flat
                    icon="info_outline"
                  >
                <q-tooltip>
               Row Template is used to format the alert message.
              </q-tooltip>
          </q-btn>
          </div>
                <q-input
                  data-test="add-alert-row-input-textarea"
                  v-model="formData.row_template"
                  color="input-border"
                  bg-color="input-bg"
                  class="row-template-input"
                  :class="store.state.theme === 'dark' ? 'dark-mode-row-template' : 'light-mode-row-template'"
                  stack-label
                  outlined
                  filled
                  dense
                  tabindex="0"
                  style="width: 100%; resize: none;"
                  type="textarea"
                  placeholder="e.g - Alert was triggered at {timestamp} "
                  rows="5"
                >
                
              </q-input>
              </div>
            </div>
            </div>

            </div>
            </div>
            




          </q-form>

        </div>
        <div
          style="width: 440px; height: 300px; position: sticky; top: 0 "
          class=" col-2"
        >
          <preview-alert
            style="border: 1px solid #ececec; height: 300px; width: 440px;"
            ref="previewAlertRef"
            :formData="formData"
            :query="previewQuery"
            :selectedTab="scheduledAlertRef?.tab || 'custom'"
            :isAggregationEnabled="isAggregationEnabled"
          />

        </div>
        
      </div>

    </div>
    <div class="flex justify-end items-center q-px-lg tw-w-full " :class="store.state.theme === 'dark' ? 'bottom-sticky-dark' : 'bottom-sticky-light'" style="position: sticky;  bottom: 0 !important; top: 0; height: 70px !important;">
      <q-btn
        data-test="add-alert-cancel-btn"
        v-close-popup="true"
        class=" text-bold"
        :label="t('alerts.cancel')"
        text-color="light-text"
        padding="sm md"
        no-caps
        @click="$emit('cancel:hideform')"
      />
      <q-btn
        data-test="add-alert-submit-btn"
        :label="t('alerts.save')"
        class=" text-bold no-border q-ml-md"
        color="secondary"
        padding="sm xl"
        type="submit"
        @click="onSubmit"
        no-caps
      />
    </div>

  </div>

  


</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  watch,
  type Ref,
  computed,
  nextTick,
  defineAsyncComponent,
  onBeforeMount,
} from "vue";

import alertsService from "../../services/alerts";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar, debounce } from "quasar";
import segment from "../../services/segment_analytics";
import {
  getUUID,
  getTimezoneOffset,
  b64EncodeUnicode,
  b64DecodeUnicode,
  isValidResourceName,
  getTimezonesByOffset,
} from "@/utils/zincutils";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import useFunctions from "@/composables/useFunctions";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import { convertDateToTimestamp } from "@/utils/date";

import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import cronParser from "cron-parser";
import AlertsContainer from "./AlertsContainer.vue";

const defaultValue: any = () => {
  return {
    name: "",
    stream_type: "",
    stream_name: "",
    is_real_time: "false",
    query_condition: {
      conditions: 
      {
        "or": [
            {
                "column": "",
                "operator": ">",
                "value": "",
                "ignore_case": false
            }
        ]
        },
      sql: "",
      promql: "",
      type: "custom",
      aggregation: {
        group_by: [""],
        function: "avg",
        having: {
          column: "",
          operator: ">=",
          value: 1,
        },
      },
      promql_condition: null,
      vrl_function: null,
      multi_time_range: [],
    },
    trigger_condition: {
      period: 10,
      operator: ">=",
      frequency: 1,
      cron: "",
      threshold: 3,
      silence: 10,
      frequency_type: "minutes",
      timezone: "UTC",
    },
    destinations: [],
    context_attributes: [],
    enabled: true,
    description: "",
    lastTriggeredAt: 0,
    createdAt: "",
    updatedAt: "",
    owner: "",
    lastEditedBy: "",
    folder_id : "",
  };
};
let callAlert: Promise<{ data: any }>;
export default defineComponent({
  name: "ComponentAddUpdateAlert",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:list", "cancel:hideform", "refresh:destinations"],
  components: {
    ScheduledAlert: defineAsyncComponent(() => import("./ScheduledAlert.vue")),
    RealTimeAlert: defineAsyncComponent(() => import("./RealTimeAlert.vue")),
    VariablesInput: defineAsyncComponent(() => import("./VariablesInput.vue")),
    PreviewAlert: defineAsyncComponent(() => import("./PreviewAlert.vue")),
    SelectFolderDropDown,
    AlertsContainer,
  },
  setup(props, { emit }) {
    const store: any = useStore();
    let beingUpdated: boolean = false;
    const addAlertForm: any = ref(null);
    const disableColor: any = ref("");
    const formData: any = ref(defaultValue());
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const { t } = useI18n();
    const q = useQuasar();
    const editorRef: any = ref(null);
    const filteredColumns: any = ref([]);
    const filteredStreams: Ref<string[]> = ref([]);
    let editorobj: any = null;
    var sqlAST: any = ref(null);
    const selectedRelativeValue = ref("1");
    const selectedRelativePeriod = ref("Minutes");
    const relativePeriods: any = ref(["Minutes"]);
    var triggerCols: any = ref([]);
    const selectedDestinations = ref("slack");
    const originalStreamFields: any = ref([]);
    const isAggregationEnabled = ref(false);
    const realTimeAlertRef: any = ref(null);
    const expandState = ref({
      alertSetup: true,
      queryMode: true,
      advancedSetup: true,
      realTimeMode: true,
      thresholds: true,
      multiWindowSelection: true,
    });
    var triggerOperators: any = ref([

      "=",
      "!=",
      ">=",
      "<=",
      ">",
      "<",
      "Contains",
      "NotContains",
    ]);
    const showVrlFunction = ref(false);
    const isFetchingStreams = ref(false);
    const streamTypes = ["logs", "metrics", "traces"];
    const editorUpdate = (e: any) => {
      formData.value.sql = e.target.value;
    };
    const { getAllFunctions } = useFunctions();

    const { getStreams, getStream } = useStreams();

    const { buildQueryPayload } = useQuery();

    const previewQuery = ref("");

    const sqlQueryErrorMsg = ref("");

    const validateSqlQueryPromise = ref<Promise<unknown>>();

    const addAlertFormRef = ref(null);

    const router = useRouter();
    const scheduledAlertRef: any = ref(null);

    const plotChart: any = ref(null);

    const previewAlertRef: any = ref(null);

    let parser: any = null;

    const vrlFunctionError = ref("");

    const showTimezoneWarning = ref(false);
    
    const activeFolderId = ref(router.currentRoute.value.query.folder || "default");

    const updateActiveFolderId = (folderId: any) => {
      activeFolderId.value = folderId.value;
    };

    onBeforeMount(async () => {
      await importSqlParser();
      await getAllFunctions();
    });

    const importSqlParser = async () => {
      const useSqlParser: any = await import("@/composables/useParser");
      const { sqlParser }: any = useSqlParser.default();
      parser = await sqlParser();
    };

    const streamFieldsMap = computed(() => {
      const map: any = {};
      originalStreamFields.value.forEach((field: any) => {
        map[field.value] = field;
      });
      return map;
    });

    const showPreview = computed(() => {
      return formData.value.stream_type && formData.value.stream_name;
    });

    const updateConditions = (e: any) => {
      try {
        const ast = parser.astify(e.target.value);
        if (ast) sqlAST.value = ast;
        else return;

        // If sqlAST.value.columns is not type of array then return
        if (!sqlAST.value) return;
        if (!Array.isArray(sqlAST.value?.columns)) return;

        sqlAST.value.columns.forEach(function (item: any) {
          let val;
          if (item["as"] === undefined || item["as"] === null) {
            val = item["expr"]["column"];
          } else {
            val = item["as"];
          }
          if (!triggerCols.value.includes(val)) {
            triggerCols.value.push(val);
          }
        });
      } catch (e) {
        console.log("Alerts: Error while parsing SQL query");
      }
    };
    const editorData = ref("");
    const prefixCode = ref("");
    const suffixCode = ref("");
    const alertType = ref(router.currentRoute.value.query.alert_type || "all");

    onMounted(async () => {});

    const updateEditorContent = async (stream_name: string) => {
      triggerCols.value = [];
      if (!stream_name) return;

      if (editorData.value) {
        editorData.value = editorData.value
          .replace(prefixCode.value, "")
          .trim();
        editorData.value = editorData.value
          .replace(suffixCode.value, "")
          .trim();
      }

      if (!props.isUpdated) {
        prefixCode.value = `select * from`;
        suffixCode.value = "'" + formData.value.stream_name + "'";
        const someCode = `${prefixCode.value} ${editorData.value} ${suffixCode.value}`;
      }

      const selected_stream: any = await getStream(
        stream_name,
        formData.value.stream_type,
        true,
      );
      selected_stream.schema.forEach(function (item: any) {
        triggerCols.value.push(item.name);
      });
    };

    const updateStreamFields = async (stream_name: any) => {
      let streamCols: any = [];
      const streams: any = await getStream(
        stream_name,
        formData.value.stream_type,
        true,
      );

      if (streams && Array.isArray(streams.schema)) {
        streamCols = streams.schema.map((column: any) => ({
          label: column.name,
          value: column.name,
          type: column.type,
        }));
      }

      originalStreamFields.value = [...streamCols];
      filteredColumns.value = [...streamCols];

      onInputUpdate("stream_name", stream_name);
    };
    watch(
      () => props.destinations.length, // Watch for length changes
      (newLength, oldLength) => {
        formData.value.destinations = formData.value.destinations.filter(
          (destination: any) => {
            return props.destinations.some((dest: any) => {
              return dest.name === destination;
            });
          },
        );
      },
    );

    watch(
      triggerCols.value,
      () => {
        filteredColumns.value = [...triggerCols.value];
      },
      { immediate: true },
    );
    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter(
          (column: any) => column.toLowerCase().indexOf(value) > -1,
        );
      });
      return filteredOptions;
    };
    const updateStreams = (resetStream = true) => {
      if (resetStream) formData.value.stream_name = "";
      if (streams.value[formData.value.stream_type]) {
        schemaList.value = streams.value[formData.value.stream_type];
        indexOptions.value = streams.value[formData.value.stream_type].map(
          (data: any) => {
            return data.name;
          },
        );
        return;
      }

      if (!formData.value.stream_type) return Promise.resolve();

      isFetchingStreams.value = true;
      return getStreams(formData.value.stream_type, false)
        .then((res: any) => {
          streams.value[formData.value.stream_type] = res.list;
          schemaList.value = res.list;
          indexOptions.value = res.list.map((data: any) => {
            return data.name;
          });

          if (formData.value.stream_name)
            updateStreamFields(formData.value.stream_name);
          return Promise.resolve();
        })
        .catch(() => Promise.reject())
        .finally(() => (isFetchingStreams.value = false));
    };

    const filterStreams = (val: string, update: any) => {
      filteredStreams.value = filterColumns(indexOptions.value, val, update);
    };


    const addVariable = () => {
      formData.value.context_attributes.push({
        name: "",
        value: "",
        id: getUUID(),
      });
    };

    const removeVariable = (variable: any) => {
      formData.value.context_attributes =
        formData.value.context_attributes.filter(
          (_variable: any) => _variable.id !== variable.id,
        );
    };

    const getSelectedTab = computed(() => {
      return scheduledAlertRef.value?.tab || null;
    });

    const previewAlert = async () => {
      if (getSelectedTab.value === "custom"){
        previewQuery.value = generateSqlQuery();

      }
      else if (getSelectedTab.value === "sql")
        previewQuery.value = formData.value.query_condition.sql.trim();
      else if (getSelectedTab.value === "promql")
        previewQuery.value = formData.value.query_condition.promql.trim();

      if (formData.value.is_real_time === "true") {
        previewQuery.value = generateSqlQuery();
      }

      await nextTick();
      if (getSelectedTab.value !== "sql") {
        previewAlertRef.value?.refreshData();
      }
    };

    const getFormattedCondition = (
      column: string,
      operator: string,
      value: number | string,
    ) => {
      let condition = "";
      switch (operator) {
        case "=":
        case "<>":
        case "<":
        case ">":
        case "<=":
        case ">=":
          condition = column + ` ${operator} ${value}`;
          break;
          //this is done because when we get from BE the response includes the operator in lowercase
          //so we need to handle it separately
        case "contains":
          condition = column + ` LIKE '%${value}%'`;
          break;
        //this is done because when we get from BE the response includes the operator in lowercase and converted NotContains to not_contains
        //so we need to handle it separately
        case "not_contains":
          condition = column + ` NOT LIKE '%${value}%'`;
          break;
          //this is done because in the FE we are not converting the operator to lowercase
          //so we need to handle it separately
        case 'Contains':
          condition = column + ` LIKE '%${value}%'`;
          break;
          //this is done because in the FE we are not converting the operator to lowercase
        case 'NotContains':
          condition = column + ` NOT LIKE '%${value}%'`;
          break;
        default:
          condition = column + ` ${operator} ${value}`;
          break;
      }

      return condition;
    };

    //this method is used to generate the where clause
    //for new format of conditions we need to iterate over the items and get the conditions
    //and then we need to format the conditions
    // then we need to return the where clause

    function generateWhereClause(group: any, streamFieldsMap: any) {
      //this method is used to format the value
      //if the value is a number or a string and the operator is contains or not contains then we need to return the value as it is
      //else we need to return the value as a string and add single quotes to it
      function formatValue(column: any, operator: any, value: any) {
        return streamFieldsMap[column]?.type === "Int64" ||
          operator === "contains" ||
          operator === "not_contains" ||
          operator === "Contains" ||
          operator === "NotContains"
          ? value
          : `'${value}'`;
      }

      //this method is used to format the condition
      //if the column and operator and value are present then we need to return the condition
      //else we need to return an empty string
      function formatCondition(column: any, operator: any, value: any) {
        return `${column} ${operator} ${value}`;
      }

      //this method is used to parse the group
      //if the group is not present or the items are not present then we need to return an empty string
      //else we need to iterate over the items and get the conditions
      //and then we need to return the where clause
      function parseGroup(groupNode: any) {
        if (!groupNode || !Array.isArray(groupNode.items)) return "";

        const parts = groupNode.items.map((item: any) => {
          // Nested group
          if (item.items && Array.isArray(item.items)) {
            return `(${parseGroup(item)})`;
          }

          // Single condition
          if (item.column && item.operator && item.value !== undefined) {
            const formattedValue = formatValue(item.column, item.operator, item.value);
              return getFormattedCondition(item.column, item.operator, formattedValue);
          }

          return "";
        }).filter(Boolean);

        return parts.join(` ${groupNode.label.toUpperCase()} `);
      }

      //this method is used to generate the where clause

      const clause = parseGroup(group);
      return clause.trim().length ? "WHERE " + clause : "";
  }


    const generateSqlQuery = () => {
      // SELECT histgoram(_timestamp, '1 minute') AS zo_sql_key, COUNT(*) as zo_sql_val FROM _rundata WHERE geo_info_country='india' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC

      // SELECT histgoram(_timestamp, '1 minute') AS zo_sql_key, avg(action_error_count) as zo_sql_val, geo_info_city FROM _rundata WHERE geo_info_country='india' GROUP BY zo_sql_key,geo_info_city ORDER BY zo_sql_key ASC;
      let query = `SELECT histogram(${
        store.state.zoConfig.timestamp_column || "_timestamp"
      }) AS zo_sql_key,`;
      //this method is used to generate the where clause
      //previously it was just iterating over the conditions and getting the where clause
      //now we are using the new format of conditions and getting the where clause using generateWhereClause method
      let whereClause = generateWhereClause(formData.value.query_condition.conditions, streamFieldsMap);

      if (!isAggregationEnabled.value) {
        query +=
          ` COUNT(*) as zo_sql_val FROM \"${formData.value.stream_name}\" ` +
          whereClause +
          " GROUP BY zo_sql_key ORDER BY zo_sql_key ASC";
      } else {
        const aggFn = formData.value.query_condition.aggregation.function;
        const column = formData.value.query_condition.aggregation.having.column;

        const isAggValid = aggFn?.trim()?.length && column?.trim()?.length;

        let groupByAlias = "";
        let groupByCols: string[] = [];
        formData.value.query_condition.aggregation.group_by.forEach(
          (column: any) => {
            if (column.trim().length) groupByCols.push(column);
          },
        );

        let concatGroupBy = "";
        if (groupByCols.length) {
          groupByAlias = ", x_axis_2";
          concatGroupBy = `, concat(${groupByCols.join(
            ",' : ',",
          )}) as x_axis_2`;
        }

        const percentileFunctions: any = {
          p50: 0.5,
          p75: 0.75,
          p90: 0.9,
          p95: 0.95,
          p99: 0.99,
        };

        if (isAggValid) {
          if (percentileFunctions[aggFn]) {
            query +=
              ` approx_percentile_cont(${column}, ${percentileFunctions[aggFn]}) as zo_sql_val ${concatGroupBy} FROM \"${formData.value.stream_name}\" ` +
              whereClause +
              ` GROUP BY zo_sql_key ${groupByAlias} ORDER BY zo_sql_key ASC`;
          } else {
            query +=
              ` ${aggFn}(${column}) as zo_sql_val ${concatGroupBy} FROM \"${formData.value.stream_name}\" ` +
              whereClause +
              ` GROUP BY zo_sql_key ${groupByAlias} ORDER BY zo_sql_key ASC`;
          }
        } else {
          query +=
            ` COUNT(*) as zo_sql_val ${concatGroupBy} FROM \"${formData.value.stream_name}\" ` +
            whereClause +
            ` GROUP BY zo_sql_key ${groupByAlias} ORDER BY zo_sql_key ASC`;
        }
      }

      return query;
    };

    const debouncedPreviewAlert = debounce(previewAlert, 500);

    const onInputUpdate = async (name: string, value: any) => {
      if (showPreview.value) {
        debouncedPreviewAlert();
      }
    };
    const getParser = (sqlQuery: string) => {
      try {
        // As default is a reserved keyword in sql-parser, we are replacing it with default1
        const regex = /\bdefault\b/g;
        const columns = parser.astify(
          sqlQuery.replace(regex, "default1"),
        ).columns;
        for (const column of columns) {
          if (column.expr.column === "*") {
            sqlQueryErrorMsg.value = "Selecting all columns is not allowed";
            return false;
          }
        }
        return true;
      } catch (error) {
        // In catch block we are returning true, as we just wanted to validate if user have added * in the query to select all columns
        // select field from default // here default is not wrapped in "" so node sql parser will throw error as default is a reserved keyword. But our Backend supports this query without quotes
        // Query will be validated in the backend
        console.log(error);
        return true;
      }
    };

    const getAlertPayload = () => {
      const payload = cloneDeep(formData.value);

      // Deleting uuid from payload as it was added for reference of frontend
      if (payload.uuid) delete payload.uuid;

      payload.is_real_time = payload.is_real_time === "true";

      payload.context_attributes = {};

      payload.query_condition.type = payload.is_real_time
        ? "custom"
        : formData.value.query_condition.type;

      formData.value.context_attributes.forEach((attr: any) => {
        if (attr.key?.trim() && attr.value?.trim())
          payload.context_attributes[attr.key] = attr.value;
      });

      payload.trigger_condition.threshold = parseInt(
        formData.value.trigger_condition.threshold,
      );

      payload.trigger_condition.period = parseInt(
        formData.value.trigger_condition.period,
      );

      payload.trigger_condition.frequency = parseInt(
        formData.value.trigger_condition.frequency,
      );

      payload.trigger_condition.silence = parseInt(
        formData.value.trigger_condition.silence,
      );

      payload.description = formData.value.description.trim();

      if (!isAggregationEnabled.value || getSelectedTab.value !== "custom") {
        payload.query_condition.aggregation = null;
      }

      if (getSelectedTab.value === "sql" || getSelectedTab.value === "promql")
        payload.query_condition.conditions = [];

      if (getSelectedTab.value === "sql" || getSelectedTab.value === "custom") {
        payload.query_condition.promql_condition = null;
      }

      if (getSelectedTab.value === "promql") {
        payload.query_condition.sql = "";
      }

      if (formData.value.query_condition.vrl_function) {
        payload.query_condition.vrl_function = b64EncodeUnicode(
          formData.value.query_condition.vrl_function.trim(),
        );
      }

      if (beingUpdated) {
        payload.updatedAt = new Date().toISOString();
        payload.lastEditedBy = store.state.userInfo.email;
      } else {
        payload.createdAt = new Date().toISOString();
        payload.owner = store.state.userInfo.email;
        payload.lastTriggeredAt = new Date().getTime();
        payload.lastEditedBy = store.state.userInfo.email;
        formData.value.updatedAt = new Date().toISOString();
      }

      return payload;
    };

    const validateInputs = (input: any, notify: boolean = true) => {
      if (isNaN(Number(input.trigger_condition.silence))) {
        notify &&
          q.notify({
            type: "negative",
            message: "Silence Notification should not be empty",
            timeout: 1500,
          });
        return false;
      }

      if (input.is_real_time) return true;

      if (
        Number(input.trigger_condition.period) < 1 ||
        isNaN(Number(input.trigger_condition.period))
      ) {
        notify &&
          q.notify({
            type: "negative",
            message: "Period should be greater than 0",
            timeout: 1500,
          });
        return false;
      }

      if (input.query_condition.aggregation) {
        if (
          isNaN(input.trigger_condition.threshold) ||
          !input.query_condition.aggregation.having.value.toString().trim()
            .length ||
          !input.query_condition.aggregation.having.column ||
          !input.query_condition.aggregation.having.operator
        ) {
          notify &&
            q.notify({
              type: "negative",
              message: "Threshold should not be empty",
              timeout: 1500,
            });
          return false;
        }

        return true;
      }

      if (
        isNaN(input.trigger_condition.threshold) ||
        input.trigger_condition.threshold < 1 ||
        !input.trigger_condition.operator
      ) {
        notify &&
          q.notify({
            type: "negative",
            message: "Threshold should not be empty",
            timeout: 1500,
          });
        return false;
      }

      if (input.trigger_condition.frequency_type === "cron") {
        try {
          cronParser.parseExpression(input.trigger_condition.cron);
        } catch (err) {
          console.log(err);
          scheduledAlertRef.value.cronJobError = "Invalid cron expression!";
          return;
        }
      }

      scheduledAlertRef.value?.validateFrequency(input.trigger_condition);

      if (scheduledAlertRef.value.cronJobError) {
        notify &&
          q.notify({
            type: "negative",
            message: scheduledAlertRef.value.cronJobError,
            timeout: 1500,
          });
        return false;
      }

      return true;
    };

    const validateSqlQuery = async () => {
      // Delaying the validation by 300ms, as editor has debounce of 300ms. Else old value will be used for validation
      await new Promise((resolve) => setTimeout(resolve, 300));

      if (!getParser(formData.value.query_condition.sql)) {
        return;
      }

      const query = buildQueryPayload({
        sqlMode: true,
        streamName: formData.value.stream_name,
      });

      delete query.aggs;

      // We get 15 minutes time range for the query, so reducing it by 13 minutes to get 2 minute data
      query.query.start_time = query.query.start_time + 780000000;

      query.query.sql = formData.value.query_condition.sql;

      if (formData.value.query_condition.vrl_function)
        query.query.query_fn = b64EncodeUnicode(
          formData.value.query_condition.vrl_function,
        );

      validateSqlQueryPromise.value = new Promise((resolve, reject) => {
        searchService
          .search({
            org_identifier: store.state.selectedOrganization.identifier,
            query,
            page_type: formData.value.stream_type,
          })
          .then((res: any) => {
            sqlQueryErrorMsg.value = "";

            if (res.data?.function_error) {
              vrlFunctionError.value = res.data.function_error;
              q.notify({
                type: "negative",
                message: "Invalid VRL Function",
                timeout: 3000,
              });
              reject("function_error");
            } else vrlFunctionError.value = "";

            resolve("");
          })
          .catch((err: any) => {
            sqlQueryErrorMsg.value = err.response?.data?.message
              ? err.response?.data?.message
              : "Invalid SQL Query";

            // Show error only if it is not real time alert
            // This case happens when user enters invalid query and then switches to real time alert
            if (formData.value.query_condition.type === "sql")
              q.notify({
                type: "negative",
                message: "Invalid SQL Query : " + err.response?.data?.message,
                timeout: 3000,
              });

            reject("sql_error");
          });
      });
    };

    const updateFunctionVisibility = () => {
      // if validateSqlQueryPromise has error "function_error" then reset the promise when function is disabled
      if (!showVrlFunction.value && vrlFunctionError.value) {
        validateSqlQueryPromise.value = Promise.resolve("");
        vrlFunctionError.value = "";
      }
    };
    const updateMultiTimeRange = (value: any) => {
      if (value) {
        formData.value.query_condition.multi_time_range = value;
      }
    };
    const updateSilence = (value: any) => {
      if (value) {
        formData.value.trigger_condition.silence = value;
      }
    }

    const routeToCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    const HTTP_FORBIDDEN = 403;

    const handleAlertError = (err: any) => {
      if (err.response?.status !== HTTP_FORBIDDEN) {
        console.log(err);
        q.notify({
          type: "negative",
          message: err.response?.data?.message || err.response?.data?.error,
        });
      }
    };
    const updateExpandState = (value: any) => {
      expandState.value = value;
    };

    const refreshDestinations = () => {
      emit("refresh:destinations");
    }
    const updateDestinations = (destinations: any[]) => {
      formData.value.destinations = destinations;
    }


// Method to handle the emitted changes and update the structure
//this method is used to update the group
//we need to update the group if it is changed 
  function updateGroup(updatedGroup:any) {
    formData.value.query_condition.conditions.items.forEach((element:any) => {
      if(element.groupId === updatedGroup.groupId){
        element.items = updatedGroup.items;
      }
    });
  }
//this method is used to remove the condition group
//we need to remove the condition group if it is empty because we cannot simply show empty group in the UI
  const removeConditionGroup = (targetGroupId: string, currentGroup: any = formData.value.query_condition.conditions) => {
    if (!currentGroup?.items || !Array.isArray(currentGroup.items)) return;

    // Recursive function to filter empty groups
    const filterEmptyGroups = (items: any[]): any[] => {
      return items.filter((item: any) => {
        // If this is the target group to remove, filter it out
        if (item.groupId === targetGroupId) {
          return false;
        }

        // If it's a group, recursively filter its items
        if (item.items && Array.isArray(item.items)) {
          item.items = filterEmptyGroups(item.items);
          // Remove groups that are empty after filtering
          return item.items.length > 0;
        }

        return true;
      });
    };

    // Apply the filtering to the root group
    currentGroup.items = filterEmptyGroups(currentGroup.items);
  };


  // Method to transform the form data to the backend format
  //so in the FE we are constructing the data like 
  //eg: 
  // {
  //   groupId: '123',
  //   label: 'and',
  //   items: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  // but in the BE we are expecting the data like 
  // {
  //   and: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
    const transformFEToBE = (node:any) => {
    if (!node || !node.items || !Array.isArray(node.items)) return {};

    const groupLabel = node.label?.toLowerCase(); // 'or' or 'and'
    if (!groupLabel || (groupLabel !== 'or' && groupLabel !== 'and')) return {};

    const transformedItems = node.items.map((item:any) => {
      // If the item has its own groupId and items, it's a nested group
      //that means the item is a group and we need to iterate over that group to get further conditions
      if (item.groupId && item.items) {
        return transformFEToBE(item);
      }

      //if not its a condition so we can simply return the condition
      return {
        column: item.column,
        operator: item.operator,
        value: item.value,
        ignore_case: !!item.ignore_case
      };
    });

    //return the transformed items in the format of the backend
    return {
      [groupLabel]: transformedItems
    };
  }

  // Method to transform the backend data to the frontend format
  //when we get response from the BE we need to transform it to the frontend format
  //eg: 
  // {
  //   and: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  // to
  // {
  //   groupId: '123',  
  //   label: 'and',
  //   items: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
  // }
  const retransformBEToFE = (data:any) => {
    if(!data) return null;
    const keys = Object.keys(data);
    if (keys.length !== 1) return null;

    const label = keys[0]; // 'and' or 'or'
    const itemsArray = data[label];

    const items = itemsArray.map((item: any) => {
      if (item.and || item.or) {
          // Nested group
          //so we need to iterate over the item and get the conditions and map that to one group
        return retransformBEToFE(item);
      } else {
        //if not its a condition so we can simply return the condition
        return {
          column: item.column,
          operator: item.operator,
          value: item.value,
          ignore_case: item.ignore_case,
          id: getUUID()
        };
      }
    });
    //here we will return the group with the conditions
    //the foramt looks like 
    //{
    //   groupId: '123',
    //   label: 'and',
    //   items: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
    // }
    return {
      groupId:  getUUID(),
      label,
      items
    };
  }
  const validateFormAndNavigateToErrorField = async (formRef: any) => {
      const isValid = await formRef.validate().then(async (valid: any) => {
        return valid;
      });
      if (!isValid) {
        navigateToErrorField(formRef);
        return false;
      }
      return true;
    }

    const navigateToErrorField = (formRef: any) => {
      const errorField = formRef.$el.querySelector('.q-field--error');
      if (errorField) { 
        errorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }




    return {
      t,
      q,
      disableColor,
      beingUpdated,
      formData,
      addAlertForm,
      store,
      indexOptions,
      editorRef,
      editorobj,
      prefixCode,
      suffixCode,
      editorData,
      selectedRelativeValue,
      selectedRelativePeriod,
      relativePeriods,
      editorUpdate,
      updateConditions,
      updateStreamFields,
      updateEditorContent,
      triggerCols,
      triggerOperators,
      sqlAST,
      schemaList,
      filteredColumns,
      streamTypes,
      streams,
      updateStreams,
      isFetchingStreams,
      filteredStreams,
      filterStreams,
      removeVariable,
      addVariable,
      selectedDestinations,
      scheduledAlertRef,
      router,
      isAggregationEnabled,
      plotChart,
      previewAlert,
      addAlertFormRef,
      validateInputs,
      getAlertPayload,
      getParser,
      onInputUpdate,
      showPreview,
      streamFieldsMap,
      previewQuery,
      previewAlertRef,
      outlinedInfo,
      getTimezoneOffset,
      showVrlFunction,
      validateSqlQuery,
      validateSqlQueryPromise,
      isValidResourceName,
      sqlQueryErrorMsg,
      vrlFunctionError,
      updateFunctionVisibility,
      convertDateToTimestamp,
      getTimezonesByOffset,
      showTimezoneWarning,
      updateMultiTimeRange,
      routeToCreateDestination,
      handleAlertError,
      activeFolderId,
      updateActiveFolderId,
      alertType,
      expandState,
      updateExpandState,
      updateSilence,
      refreshDestinations,
      updateDestinations,
      updateGroup,
      removeConditionGroup,
      transformFEToBE,
      retransformBEToFE,
      validateFormAndNavigateToErrorField,
      navigateToErrorField,
      realTimeAlertRef,
      originalStreamFields,
      generateSqlQuery,
      generateWhereClause
    };
  },

  created() {
    // TODO OK: Refactor this code
    this.formData.ingest = ref(false);
    this.formData = { ...defaultValue, ...cloneDeep(this.modelValue) };
    if(!this.isUpdated){
      this.formData.is_real_time = this.alertType === 'realTime'? true : false;
    }
      this.formData.is_real_time = this.formData.is_real_time.toString();

    // Set default frequency to min_auto_refresh_interval
    if (this.store.state?.zoConfig?.min_auto_refresh_interval)
      this.formData.trigger_condition.frequency = Math.ceil(
        this.store.state?.zoConfig?.min_auto_refresh_interval / 60 || 1,
      );

    this.beingUpdated = this.isUpdated;
    this.updateStreams(false)?.then(() => {
      this.updateEditorContent(this.formData.stream_name);
    });
    if (
      this.modelValue &&
      this.modelValue.name != undefined &&
      this.modelValue.name != ""
    ) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.formData = cloneDeep(this.modelValue);
      this.isAggregationEnabled = !!this.formData.query_condition.aggregation;

      if (!this.formData.trigger_condition?.timezone) {
        if (this.formData.tz_offset === 0) {
          this.formData.trigger_condition.timezone = "UTC";
        } else {
          this.getTimezonesByOffset(this.formData.tz_offset).then(
            (res: any) => {
              if (res.length > 1) this.showTimezoneWarning = true;
              this.formData.trigger_condition.timezone = res[0];
            },
          );
        }
      }

      if (this.formData.query_condition.vrl_function) {
        this.showVrlFunction = true;
        this.formData.query_condition.vrl_function = b64DecodeUnicode(
          this.formData.query_condition.vrl_function,
        );
      }
    }

    this.formData.is_real_time = this.formData.is_real_time.toString();
    this.formData.context_attributes = Object.keys(
      this.formData.context_attributes,
    ).map((attr) => {
      return {
        key: attr,
        value: this.formData.context_attributes[attr],
        id: getUUID(),
      };
    });
    //this is done because 
    //if we are getting the conditions as null or undefined then we need to create a new group 
    //if we are getting the conditions as an object then we need to transform it to the frontend format
    if(this.formData.query_condition.conditions && ( !Array.isArray(this.formData.query_condition.conditions) && Object.keys(this.formData.query_condition.conditions).length != 0)){
      this.formData.query_condition.conditions = this.retransformBEToFE(this.formData.query_condition.conditions);
    }
    else if (this.formData.query_condition.conditions == null || this.formData.query_condition.conditions == undefined || this.formData.query_condition.conditions.length == 0 || Object.keys(this.formData.query_condition.conditions).length == 0){

      this.formData.query_condition.conditions = {
        groupId: getUUID(),
        label: 'and',
        items: []
      }
    }
  },

  computed: {
    getFormattedDestinations: function () {
      return this.destinations.map((destination: any) => {
        return destination.name;
      });
    },
  },
  methods: {
    onRejected(rejectedEntries: string | any[]) {
      this.q.notify({
        type: "negative",
        message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
      });
    },

    async onSubmit() {
      // Delaying submission by 500ms to allow the form to validate, as query is validated in validateSqlQuery method
      // When user updated query and click on save
      await new Promise((resolve) => setTimeout(resolve, 500));


      if (
        this.formData.is_real_time == "false" &&
        this.formData.query_condition.type == "sql" &&
        !this.getParser(this.formData.query_condition.sql)
      ) {
        this.q.notify({
          type: "negative",
          message: "Selecting all Columns in SQL query is not allowed.",
          timeout: 1500,
        });
        return false;
      }

      // if (this.formData.stream_name == "") {
      //   this.q.notify({
      //     type: "negative",
      //     message: "Please select stream name.",
      //     timeout: 1500,
      //   });
      //   return false;
      // }

      if (
        this.formData.is_real_time == "false" &&
        this.formData.trigger_condition.frequency_type == "cron"
      ) {
        const now = new Date();

        // Get the day, month, and year from the date object
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0"); // January is 0!
        const year = now.getFullYear();

        // Combine them in the DD-MM-YYYY format
        const date = `${day}-${month}-${year}`;

        // Get the hours and minutes, ensuring they are formatted with two digits
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");

        // Combine them in the HH:MM format
        const time = `${hours}:${minutes}`;

        const convertedDateTime = this.convertDateToTimestamp(
          date,
          time,
          this.formData.trigger_condition.timezone,
        );

        this.formData.tz_offset = convertedDateTime.offset;
      }

            //from here validation starts so if there are any errors we need to navigate user to that paricular field
      //this is for main form validation
      let isAlertValid = true;
      let isScheduledAlertValid = true;
      let isRealTimeAlertValid = true;
        isAlertValid = await this.validateFormAndNavigateToErrorField(this.addAlertForm);
        //we need to handle scheduled alert validation separately 
        //if there are any scheduled alert errors then we need to navigate user to that field
        if(this.formData.is_real_time == "false"){
          isScheduledAlertValid = this.scheduledAlertRef?.$el?.querySelectorAll('.q-field--error').length == 0;
        }
        else{
          isRealTimeAlertValid = this.realTimeAlertRef?.$el?.querySelectorAll('.q-field--error').length == 0;
        }
        if( isAlertValid && !isScheduledAlertValid){
          this.navigateToErrorField(this.scheduledAlertRef); 
        }
        if( isAlertValid && !isRealTimeAlertValid){
          this.navigateToErrorField(this.realTimeAlertRef);
        }
        if (!isAlertValid || !isScheduledAlertValid || !isRealTimeAlertValid) return false;


        const payload = this.getAlertPayload();
        if (!this.validateInputs(payload)) return;

        const dismiss = this.q.notify({
          spinner: true,
          message: "Please wait...",
          timeout: 2000,
        });

        if (
          this.formData.is_real_time == "false" &&
          this.formData.query_condition.type == "sql"
        ) {
          try {
            // Wait for the promise to resolve
            // Storing the SQL query validation promise in a variable
            // Case: When user edits the query and directly saves it without waiting for the validation to complete
            // So waiting here for sql validation to complete
            await this.validateSqlQueryPromise;
          } catch (error) {

            dismiss();
            this.q.notify({
              type: "negative",
              message: "Error while validating sql query. Please check the query and try again.",
              timeout: 1500,
            });
            console.log("Error while validating sql query",error);
            return false;
          }
        }

        // Transform the form data to the backend format
        payload.query_condition.conditions = this.transformFEToBE(this.formData.query_condition.conditions);

        if (this.beingUpdated) {
          payload.folder_id = this.router.currentRoute.value.query.folder || "default";
          callAlert = alertsService.update_by_alert_id(
            this.store.state.selectedOrganization.identifier,
            payload,
            this.activeFolderId
          );
          callAlert
            .then((res: { data: any }) => {
              this.formData = { ...defaultValue() };
              this.$emit("update:list", this.activeFolderId);
              this.addAlertForm.resetValidation();
              dismiss();
              this.q.notify({
                type: "positive",
                message: `Alert updated successfully.`,
              });
            })
            .catch((err: any) => {
              dismiss();
              this.handleAlertError(err);
            });
          segment.track("Button Click", {
            button: "Update Alert",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.formData.stream_name,
            alert_name: this.formData.name,
            page: "Add/Update Alert",
          });
          return;
        } else {
          payload.folder_id = this.activeFolderId;
          callAlert = alertsService.create_by_alert_id(
            this.store.state.selectedOrganization.identifier,
            payload,
            this.activeFolderId
          );

          callAlert
            .then((res: { data: any }) => {
              this.formData = { ...defaultValue() };
              this.$emit("update:list", this.activeFolderId);
              this.addAlertForm.resetValidation();
              dismiss();
              this.q.notify({
                type: "positive",
                message: `Alert saved successfully.`,
              });
            })
            .catch((err: any) => {
              dismiss();
              this.handleAlertError(err);
            });
          segment.track("Button Click", {
            button: "Save Alert",
            user_org: this.store.state.selectedOrganization.identifier,
            user_id: this.store.state.userInfo.email,
            stream_name: this.formData.stream_name,
            alert_name: this.formData.name,
            page: "Add/Update Alert",
          });
        }

    },
  },
});
</script>

<style scoped lang="scss">
#editor {
  width: 100%;
  min-height: 5rem;
  // padding-bottom: 14px;
  resize: both;
}

.alert-condition {
  .__column,
  .__value {
    width: 250px;
  }

  .__operator {
    width: 100px;
  }
}
</style>
<style lang="scss">
.no-case .q-field__native span {
  text-transform: none !important;
}

.no-case .q-field__input {
  text-transform: none !important;
}

.add-alert-form {
  .q-field--dense .q-field__control {
    .q-field__native span {
      overflow: hidden;
    }
  }

  .alert-condition .__column .q-field__control .q-field__native span {
    max-width: 152px;
    text-overflow: ellipsis;
    text-align: left;
    white-space: nowrap;
  }

  .q-field__bottom {
    padding: 2px 0;
  }
}

.silence-notification-input,
.threshould-input {
  .q-field--filled .q-field__control {
    background-color: transparent !important;
  }

  .q-field--dark .q-field__control {
    background-color: rgba(255, 255, 255, 0.07) !important;
  }
}

.dark-mode{
  .alert-setup-container{
  background-color: #212121;
  padding: 12px 12px 24px 12px;
  margin-left: 24px;
  border-radius: 4px;
  border: 1px solid #343434;
}
.q-text-area-input > div > div  { 
  background-color:rgb(30, 31, 31) !important;
  border: 1px solid $input-border !important;
}
.dark-mode-row-template  > div > div  { 
  background-color:rgb(30, 31, 31) !important;
  border: 1px solid $input-border !important;
}
.custom-input-label{
  color: #BDBDBD;
}
}
.light-mode{
  .alert-setup-container{
    background-color: #ffffff;
    padding: 12px 12px 24px 12px;
    margin-left: 24px;
    border-radius: 4px;
    border: 1px solid #e6e6e6;
  }
  .custom-input-label{
    color: #5C5C5C;
  }
  .q-field--labeled.showLabelOnTop.q-field .q-field__control{
    border: 1px solid #d4d4d4;
  }
  .add-folder-btn{
    border: 1px solid #d4d4d4;
  }
  .dark-mode .q-text-area-input > div > div  { 
  background-color: #181a1b !important;
  border: 1px solid black !important;
}

.light-mode .q-text-area-input > div > div  { 
  background-color:#ffffff !important;
  border: 1px solid #e0e0e0 !important;
}
.dark-mode-row-template > div > div  { 
  background-color: #181a1b !important;
  border: 1px solid black !important;
}
.light-mode-row-template > div > div  { 
  background-color:#ffffff !important;
  border: 1px solid #e0e0e0 !important;
}
}
.q-text-area-input > div > div > div > textarea{  
    height: 80px !important;
    resize: none !important;
}
.row-template-input > div > div > div > textarea{
  height: 160px !important;
  resize: none !important;
}
.bottom-sticky-dark{
  background-color: #212121;
}
.bottom-sticky-light{
  background-color: #ffffff;
  border-top: 1px solid #d4d4d4
}
.input-box-bg-dark .q-field__control{
  background-color: #181a1b !important;
}
.input-box-bg-light .q-field__control{
  background-color: #ffffff !important;
}
.input-border-dark .q-field__control{
  border: 1px solid red !important;
}
.input-border-light .q-field__control{
  border: 1px solid #d4d4d4 !important;
}



  


</style>
