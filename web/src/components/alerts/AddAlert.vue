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
  <div class="full-width q-mx-lg q-pt-xs">
    <div class="row items-center no-wrap card-container tw:mx-[0.625rem]  tw:mb-[0.625rem]">
      <div class="flex items-center justify-between tw:w-full card-container tw:h-[68px] tw:px-2 tw:py-3">
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
        <div class="flex items-center tw:gap-2">
          <q-btn
            outline
            class="pipeline-icons q-px-sm hideOnPrintMode"
            size="sm"
            no-caps
            icon="code"
            data-test="pipeline-json-edit-btn"
            @click="openJsonEditor"
            >
        <q-tooltip>{{ t("dashboard.editJson") }}</q-tooltip>
        </q-btn>
        </div>
      </div>
    </div>

    <!-- WIZARD VIEW -->
    <div
      class="wizard-view-container tw:mb-2"
      style="
        max-height: calc(100vh - 194px);
        overflow-y: auto;
        scroll-behavior: smooth;
      "
    >
      <div class="card-container tw:px-2 tw:mx-[0.675rem] tw:py-2">
        <!-- Stepper Header (Full Width) -->
        <q-form class="add-alert-form" ref="addAlertForm" @submit="onSubmit">
        <q-stepper
          v-model="wizardStep"
          ref="wizardStepper"
          color="primary"
          flat
          class="alert-wizard-stepper"
          header-nav
          keep-alive
        >
        <!-- Persistent Step Caption (Between Header and Content) -->
        <template v-slot:message>
          <div
            v-if="currentStepCaption"
            class="persistent-step-caption tw:px-3 tw:py-1 tw:mb-1 tw:mt-2"
            :class="store.state.theme === 'dark' ? 'dark-mode-caption' : 'light-mode-caption'"
          >
            {{ currentStepCaption }}
          </div>
        </template>

        <!-- Step 1: Alert Setup -->
        <q-step
          :name="1"
          :title="t('alerts.steps.alertSetup') + ' *'"
          caption=""
          icon="settings"
          :done="wizardStep > 1"
          :disable="1 > lastValidStep"
        >
          <!-- 60/40 Split Layout with Equal Heights -->
          <div class="tw:flex tw:gap-[0.625rem] tw:items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (60%) -->
            <div class="tw:flex-[0_0_60%] tw:flex tw:flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw:flex-1" style="overflow: auto;">
                <AlertSetup
                  ref="step1Ref"
                  :formData="formData"
                  :beingUpdated="beingUpdated"
                  :streamTypes="streamTypes"
                  :filteredStreams="filteredStreams"
                  :isFetchingStreams="isFetchingStreams"
                  :activeFolderId="Array.isArray(activeFolderId) ? activeFolderId[0] : activeFolderId"
                  :streamFieldRef="streamFieldRef"
                  :streamTypeFieldRef="streamTypeFieldRef"
                  @update:streams="updateStreams()"
                  @filter:streams="filterStreams"
                  @update:stream-name="updateStreamFields"
                  @update:active-folder-id="updateActiveFolderId"
                />
              </div>

            </div>

            <div class="tw:flex-1">
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
              />
            </div>
          </div>
        </q-step>

        <!-- Step 2: Query Configuration -->
        <q-step
          :name="2"
          :title="t('alerts.steps.conditions') + ' *'"
          caption=""
          icon="search"
          :done="wizardStep > 2"
          :disable="2 > lastValidStep"
        >
          <!-- 60/40 Split Layout with Equal Heights -->
          <div class="tw:flex tw:gap-[0.625rem] tw:items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (60%) -->
            <div class="tw:flex-[0_0_60%] tw:flex tw:flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw:flex-1" style="overflow: auto;">
                <QueryConfig
                  ref="step2Ref"
                  :tab="formData.query_condition.type || 'custom'"
                  :multiTimeRange="formData.query_condition.multi_time_range"
                  :columns="filteredColumns"
                  :streamFieldsMap="streamFieldsMap"
                  :generatedSqlQuery="generatedSqlQuery"
                  :inputData="formData.query_condition"
                  :streamType="formData.stream_type"
                  :isRealTime="formData.is_real_time"
                  :sqlQuery="formData.query_condition.sql"
                  :promqlQuery="formData.query_condition.promql"
                  :vrlFunction="decodedVrlFunction"
                  :streamName="formData.stream_name"
                  :sqlQueryErrorMsg="sqlQueryErrorMsg"
                  @update:tab="updateTab"
                  @update-group="updateGroup"
                  @remove-group="removeConditionGroup"
                  @input:update="onInputUpdate"
                  @update:sqlQuery="(value) => formData.query_condition.sql = value"
                  @update:promqlQuery="(value) => formData.query_condition.promql = value"
                  @update:vrlFunction="(value) => formData.query_condition.vrl_function = value"
                  @validate-sql="validateSqlQuery"
                  @clear-multi-windows="clearMultiWindows"
                />
              </div>

            </div>

            <div class="tw:flex-1">
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
              />
            </div>
          </div>
        </q-step>

        <!-- Step 3: Compare with Past (Scheduled only) -->
        <q-step
          v-if="formData.is_real_time === 'false'"
          :name="3"
          :title="t('alerts.steps.compareWithPast')"
          caption=""
          icon="compare_arrows"
          :done="wizardStep > 3"
          :disable="3 > lastValidStep"
        >
          <!-- 60/40 Split Layout with Equal Heights -->
          <div class="tw:flex tw:gap-[0.625rem] tw:items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (60%) -->
            <div class="tw:flex-[0_0_60%] tw:flex tw:flex-col" style="height: 100%; overflow: hidden;">
              <div class="tw:flex-1" style="overflow: auto;">
                <CompareWithPast
                  ref="step3Ref"
                  :multiTimeRange="formData.query_condition.multi_time_range"
                  :period="formData.trigger_condition.period"
                  :frequency="formData.trigger_condition.frequency"
                  :frequencyType="formData.trigger_condition.frequency_type"
                  :cron="formData.trigger_condition.cron"
                  :selectedTab="formData.query_condition.type || 'custom'"
                  @update:multiTimeRange="(val) => formData.query_condition.multi_time_range = val"
                  @goToSqlEditor="handleGoToSqlEditor"
                />
              </div>

            </div>

            <div class="tw:flex-1">
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
              />
            </div>
          </div>
        </q-step>

        <!-- Step 4: Alert Settings -->
        <q-step
          :name="4"
          :title="t('alerts.steps.alertSettings') + ' *'"
          caption=""
          icon="tune"
          :done="wizardStep > 4"
          :disable="4 > lastValidStep"
        >
          <!-- 60/40 Split Layout with Equal Heights -->
          <div class="tw:flex tw:gap-[0.625rem] tw:items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (60%) -->
            <div class="tw:flex-[0_0_60%] tw:flex tw:flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw:flex-1" style="overflow: auto;">
                <AlertSettings
                  ref="step4Ref"
                  :formData="formData"
                  :isRealTime="formData.is_real_time"
                  :columns="filteredColumns"
                  :isAggregationEnabled="isAggregationEnabled"
                  :destinations="formData.destinations"
                  :formattedDestinations="getFormattedDestinations"
                  :template="formData.template"
                  :templates="templates"
                  @update:trigger="(val) => formData.trigger_condition = val"
                  @update:aggregation="(val) => formData.query_condition.aggregation = val"
                  @update:isAggregationEnabled="(val) => isAggregationEnabled = val"
                  @update:promqlCondition="(val) => formData.query_condition.promql_condition = val"
                  @update:destinations="updateDestinations"
                  @update:template="(val) => formData.template = val"
                  @refresh:destinations="refreshDestinations"
                  @refresh:templates="refreshTemplates"
                />
              </div>

            </div>

            <div class="tw:flex-1">
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
              />
            </div>
          </div>
        </q-step>

        <!-- Step 5: Deduplication (Scheduled only) -->
        <q-step
          v-if="formData.is_real_time === 'false'"
          :name="5"
          :title="t('alerts.steps.deduplication')"
          caption=""
          icon="filter_list"
          :done="wizardStep > 5"
          :disable="5 > lastValidStep"
        >
          <!-- 60/40 Split Layout with Equal Heights -->
          <div class="tw:flex tw:gap-[0.625rem] tw:items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (60%) -->
            <div class="tw:flex-[0_0_60%] tw:flex tw:flex-col" style="height: calc(100vh - 302px); overflow: hidden;">
              <div class="tw:flex-1" style="overflow: auto;">
                <Deduplication
                  :deduplication="formData.deduplication"
                  :columns="filteredColumns"
                  @update:deduplication="(val) => formData.deduplication = val"
                />
              </div>

            </div>

            <div class="tw:flex-1">
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
              />
            </div>
          </div>
        </q-step>

        <!-- Step 6: Advanced Settings -->
        <q-step
          :name="6"
          :title="t('alerts.steps.advanced')"
          caption=""
          icon="settings_applications"
          :done="false"
          :disable="6 > lastValidStep"
        >
          <!-- 60/40 Split Layout with Equal Heights -->
          <div class="tw:flex tw:gap-[0.625rem] tw:items-stretch" style="height: calc(100vh - 302px); overflow-x: hidden;">
            <!-- Left Column: Step Content (60%) -->
            <div class="tw:flex-[0_0_60%] tw:flex tw:flex-col" style="height: 100%; overflow: hidden;">
              <div class="tw:flex-1" style="overflow: auto;">
                <Advanced
                  :contextAttributes="formData.context_attributes"
                  :description="formData.description"
                  :rowTemplate="formData.row_template"
                  :rowTemplateType="formData.row_template_type"
                  @update:contextAttributes="(val) => formData.context_attributes = val"
                  @update:description="(val) => formData.description = val"
                  @update:rowTemplate="(val) => formData.row_template = val"
                  @update:rowTemplateType="(val) => formData.row_template_type = val"
                />
              </div>

            </div>

            <div class="tw:flex-1">
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
              />
            </div>
          </div>
        </q-step>
      </q-stepper>
      </q-form>
      </div>
    </div>
    <div class="tw:mx-2">
      <div
          class="flex q-px-md full-width tw:py-3 card-container tw:justify-end"
          style="position: sticky; bottom: 0px; z-index: 2"
        >
        <!-- All Buttons (Right Side) -->
        <div class="tw:flex tw:items-center tw:gap-2">
          <!-- Wizard Navigation Buttons -->
          <q-btn
            flat
            label="Back"
            icon="arrow_back"
            class="o2-secondary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            :disable="wizardStep === 1"
            no-caps
            @click="goToPreviousStep"
          />
          <q-btn
            flat
            label="Continue"
            icon-right="arrow_forward"
            class="o2-secondary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            :disable="isLastStep"
            no-caps
            @click="goToNextStep"
          />
          <q-separator vertical class="tw:mx-2" style="height: 36px;" />

          <!-- Cancel and Save Buttons -->
          <q-btn
            data-test="add-alert-cancel-btn"
            v-close-popup="true"
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            @click="$emit('cancel:hideform')"
          />
          <q-btn
            data-test="add-alert-submit-btn"
            class="o2-primary-button no-border tw:h-[36px]"
            :label="t('alerts.save')"
            type="submit"
            no-caps
            flat
            :disable="!isLastStep"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="onSubmit"
          />
        </div>
      </div>
    </div>

  </div>

    <q-dialog
      v-model="showJsonEditorDialog"
      position="right"
      full-height
      maximized
      :persistent="true"
    >
      <JsonEditor
        :data="formData"
        :title="'Edit Alert JSON'"
        :type="'alerts'"
        :validation-errors="validationErrors"
        @close="showJsonEditorDialog = false"
        @saveJson="saveAlertJson"
        :isEditing="beingUpdated"
      />
    </q-dialog>

</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onUnmounted,
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
import { convertDateToTimestamp } from "@/utils/date";
import {
  generateSqlQuery,
} from "@/utils/alerts/alertQueryBuilder";
import {
  validateInputs as validateInputsUtil,
  validateSqlQuery as validateSqlQueryUtil,
  saveAlertJson as saveAlertJsonUtil,
  type ValidationContext,
  type JsonValidationContext,
} from "@/utils/alerts/alertValidation";
import {
  getAlertPayload as getAlertPayloadUtil,
  prepareAndSaveAlert as prepareAndSaveAlertUtil,
  type PayloadContext,
  type SaveAlertContext,
} from "@/utils/alerts/alertPayload";
import {
  getParser as getParserUtil,
  addHavingClauseToQuery,
  type SqlUtilsContext,
} from "@/utils/alerts/alertSqlUtils";

import JsonEditor from "../common/JsonEditor.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { createAlertsContextProvider, contextRegistry } from "@/composables/contextProviders";
import HorizontalStepper from "./HorizontalStepper.vue";
import AlertSetup from "./steps/AlertSetup.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Deduplication from "./steps/Deduplication.vue";
import Advanced from "./steps/Advanced.vue";
import AlertWizardRightColumn from "./AlertWizardRightColumn.vue";
import {
  updateGroup as updateGroupUtil,
  removeConditionGroup as removeConditionGroupUtil,
  transformFEToBE as transformFEToBEUtil,
  retransformBEToFE as retransformBEToFEUtil,
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  ensureIds,
  type TransformContext,
} from "@/utils/alerts/alertDataTransforms";
import { AlertFocusManager } from "@/utils/alerts/focusManager";

const defaultValue: any = () => {
  return {
    name: "",
    stream_type: "",
    stream_name: "",
    is_real_time: "false",
    query_condition: {
      conditions:
      {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "",
        conditions: []
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
      frequency: 10,
      cron: "",
      threshold: 3,
      silence: 10,
      frequency_type: "minutes",
      timezone: "UTC",
    },
    destinations: [],
    template: "",
    context_attributes: [],
    enabled: true,
    description: "",
    row_template: "",
    row_template_type: "String",
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
    templates: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:list", "cancel:hideform", "refresh:destinations", "refresh:templates"],
  components: {
    JsonEditor,
    HorizontalStepper,
    AlertSetup,
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Deduplication,
    Advanced,
    AlertWizardRightColumn,
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
    const expandState = ref({
      alertSetup: true,
      queryMode: true,
      advancedSetup: true,
      realTimeMode: true,
      thresholds: true,
      multiWindowSelection: false,
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
    const rowTemplateTypeOptions = [
      { label: 'String', value: 'String' },
      { label: 'JSON', value: 'Json' }
    ];
    const editorUpdate = (e: any) => {
      formData.value.sql = e.target.value;
    };
    const { getAllFunctions } = useFunctions();

    const { getStreams, getStream } = useStreams();

    const { buildQueryPayload } = useQuery();

    // Focus manager for alert summary clickable fields
    const focusManager = new AlertFocusManager();
    const streamFieldRef = ref(null);
    const streamTypeFieldRef = ref(null);

    const previewQuery = ref("");

    // Flag to track if we're using backend-generated SQL for preview
    const isUsingBackendSql = ref(false);

    const sqlQueryErrorMsg = ref("");

    const validateSqlQueryPromise = ref<Promise<unknown>>();

    const addAlertFormRef = ref(null);

    const router = useRouter();
    const viewSqlEditorDialog = ref(false);

    const plotChart: any = ref(null);

    const previewAlertRef: any = ref(null);

    let parser: any = null;

    const vrlFunctionError = ref("");

    const showTimezoneWarning = ref(false);

    const showJsonEditorDialog = ref(false);
    const validationErrors = ref([]);

    const isLoadingPanelData = ref(false);

    const { track } = useReo();

    const activeFolderId = ref(router.currentRoute.value.query.folder || "default");

    const updateActiveFolderId = (folderId: any) => {
      activeFolderId.value = folderId.value;
    };

    // Wizard step state
    const wizardStep = ref(1);
    const wizardStepper = ref(null);
    const step1Ref = ref(null);
    const step2Ref = ref(null);
    const step3Ref = ref(null);
    const step4Ref = ref(null);
    const lastValidStep = ref(1); // Track the last successfully validated step

    // Computed property for step captions to avoid flickering
    const currentStepCaption = computed(() => {
      const captions: Record<number, string> = {
        1: t('alerts.stepCaptions.alertSetup'),
        2: t('alerts.stepCaptions.conditions'),
        3: t('alerts.stepCaptions.compareWithPast'),
        4: t('alerts.stepCaptions.alertSettings'),
        5: t('alerts.stepCaptions.deduplication'),
        6: t('alerts.stepCaptions.advanced'),
      };
      return captions[wizardStep.value] || '';
    });

    const goToStep2 = async () => {
      // Validate step 1 before proceeding
      if (step1Ref.value && typeof step1Ref.value.validate === 'function') {
        const isValid = await step1Ref.value.validate();
        if (isValid) {
          wizardStep.value = 2;
        }
      } else {
        wizardStep.value = 2;
      }
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

    const rowTemplatePlaceholder = computed(() => {
      return formData.value.row_template_type === 'Json'
        ? 'e.g - {"user": "{name}", "timestamp": "{timestamp}"}'
        : 'e.g - Alert was triggered at {timestamp}';
    });

    const decodedVrlFunction = computed(() => {
      if (!formData.value.query_condition.vrl_function) {
        return "";
      }
      try {
        return b64DecodeUnicode(formData.value.query_condition.vrl_function);
      } catch (e) {
        return formData.value.query_condition.vrl_function;
      }
    });

    const editorData = ref("");
    const prefixCode = ref("");
    const suffixCode = ref("");
    const alertType = ref(router.currentRoute.value.query.alert_type || "all");

    onMounted(async () => {
      // Set up alerts context provider
      const alertsProvider = createAlertsContextProvider(formData, store, props.isUpdated);
      contextRegistry.register('alerts', alertsProvider);
      contextRegistry.setActive('alerts');

      // Register fields with focus manager for clickable summary
      // Wait for next tick to ensure refs are available
      await nextTick();
      focusManager.registerField('streamType', {
        ref: streamTypeFieldRef,
        onBeforeFocus: () => {
          // Navigate to step 1 for wizard mode
          if (wizardStep.value !== 1) {
            wizardStep.value = 1;
          }
        }
      });
      focusManager.registerField('stream', {
        ref: streamFieldRef,
        onBeforeFocus: () => {
          // Navigate to step 1 for wizard mode
          if (wizardStep.value !== 1) {
            wizardStep.value = 1;
          }
        }
      });
      focusManager.registerField('alertType', {
        ref: streamTypeFieldRef, // Use any ref, we just need navigation
        onBeforeFocus: () => {
          // Navigate to step 1 for wizard mode
          if (wizardStep.value !== 1) {
            wizardStep.value = 1;
          }
        }
      });
      // Note: query, conditions, period, threshold, destinations, and silence fields
      // are registered in their respective component watchers (step2Ref, step4Ref)
      // with proper field refs for highlighting
    });

    // Watch for step4Ref (AlertSettings) to register wizard mode field refs
    watch(step4Ref, (newVal) => {
      if (newVal) {
        nextTick(() => {
          // Register wizard mode fields with proper navigation and highlighting
          if (newVal.periodFieldRef) {
            focusManager.registerField('period', {
              ref: newVal.periodFieldRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 4) {
                  wizardStep.value = 4;
                }
              }
            });
          }
          if (newVal.thresholdFieldRef) {
            focusManager.registerField('threshold', {
              ref: newVal.thresholdFieldRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 4) {
                  wizardStep.value = 4;
                }
              }
            });
          }
          if (newVal.silenceFieldRef) {
            focusManager.registerField('silence', {
              ref: newVal.silenceFieldRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 4) {
                  wizardStep.value = 4;
                }
              }
            });
          }
          if (newVal.destinationsFieldRef) {
            focusManager.registerField('destinations', {
              ref: newVal.destinationsFieldRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 4) {
                  wizardStep.value = 4;
                }
              }
            });
          }
        });
      }
    }, { immediate: true });

    // Watch for step2Ref to register query field
    watch(step2Ref, (newVal) => {
      if (newVal) {
        nextTick(() => {
          // Determine which ref to use based on query type
          const queryType = formData.value.query_condition?.type || 'custom';

          // Register the query field with appropriate ref based on query type
          if (queryType === 'custom' && newVal.customPreviewRef) {
            focusManager.registerField('query', {
              ref: newVal.customPreviewRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 2) {
                  wizardStep.value = 2;
                }
              }
            });
          } else if ((queryType === 'sql' || queryType === 'promql') && newVal.sqlPromqlPreviewRef) {
            focusManager.registerField('query', {
              ref: newVal.sqlPromqlPreviewRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 2) {
                  wizardStep.value = 2;
                }
              }
            });
          }
        });
      }
    }, { immediate: true });

    // Watch for step3Ref (CompareWithPast) to register multiwindow field
    watch(step3Ref, (newVal) => {
      if (newVal && newVal.multiWindowContainerRef) {
        nextTick(() => {
          focusManager.registerField('multiwindow', {
            ref: newVal.multiWindowContainerRef,
            onBeforeFocus: () => {
              if (wizardStep.value !== 3) {
                wizardStep.value = 3;
              }
            }
          });
        });
      }
    }, { immediate: true });

    // Watch for query type changes and re-register with correct ref
    watch(() => formData.value.query_condition?.type, (newType) => {
      if (step2Ref.value && newType) {
        nextTick(() => {
          // Re-register the query field with the correct ref for the new type
          if (newType === 'custom' && step2Ref.value.customPreviewRef) {
            focusManager.registerField('query', {
              ref: step2Ref.value.customPreviewRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 2) {
                  wizardStep.value = 2;
                }
              }
            });
          } else if ((newType === 'sql' || newType === 'promql') && step2Ref.value.sqlPromqlPreviewRef) {
            focusManager.registerField('query', {
              ref: step2Ref.value.sqlPromqlPreviewRef,
              onBeforeFocus: () => {
                if (wizardStep.value !== 2) {
                  wizardStep.value = 2;
                }
              }
            });
          }
        });
      }
    });

    onUnmounted(() => {
      // Clean up alerts-specific context provider
      contextRegistry.unregister('alerts');
      contextRegistry.setActive('');

      // Clean up focus manager
      focusManager.clear();
    });

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

      // Fetch stream details including schema and settings
      const streams: any = await getStream(
        stream_name,
        formData.value.stream_type,
        true,
      );

      // Map all schema fields to column objects with label, value, and type
      if (streams && Array.isArray(streams.schema)) {
        streamCols = streams.schema.map((column: any) => ({
          label: column.name,
          value: column.name,
          type: column.type,
        }));
      }

      // Check if User Defined Schema (UDS) fields are configured
      // If defined_schema_fields exists and is not empty, we should filter to show only those fields
      if (
        streams?.settings?.defined_schema_fields &&
        Array.isArray(streams.settings.defined_schema_fields) &&
        streams.settings.defined_schema_fields.length > 0
      ) {
        const definedFields = streams.settings.defined_schema_fields;

        // get timestamp and all fields 
        // why we need this because we need to show timestamp and all fields in defined schema fields 
        // we dont get them in defined_schema_fields so if they are present in schema then we should keep them as it is
        const timestampColumn = store.state.zoConfig?.timestamp_column || '_timestamp';
        const allFieldsName = store.state.zoConfig?.all_fields_name;

        // Filter the columns to include:
        // 1.(timestamp and all_fields) (_timestamp , _all) --> this will be varied depending upon the env variables
        // 2. User-defined schema fields - only the fields user explicitly configured as UDS
        streamCols = streamCols.filter((col: any) => {
          // Always include timestamp column (e.g., '_timestamp')
          // Always include all fields column (e.g., '_all')
          if (col.value === timestampColumn || col.value === allFieldsName) {
            return true;
          }
          // Include field only if it's in the defined_schema_fields list
          return definedFields.includes(col.value);
        });
      }
      // If defined_schema_fields is not present or empty, show all schema fields (default behavior)

      // Store the filtered/unfiltered columns for use in the component
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
      return formData.value.query_condition.type || null;
    });

    const openEditorDialog = () => {
      viewSqlEditorDialog.value = true;
    };

    // Watch for SQL query changes and update preview
    watch(() => formData.value.query_condition?.sql, (newValue) => {
      if (getSelectedTab.value === 'sql') {
        previewQuery.value = newValue ? newValue.trim() : '';
      }
    });

    // Watch for PromQL query changes and update preview
    watch(() => formData.value.query_condition?.promql, (newValue) => {
      if (getSelectedTab.value === 'promql') {
        previewQuery.value = newValue ? newValue.trim() : '';
      }
    });

    // Watch for tab changes and update preview query
    watch(() => formData.value.query_condition?.type, (newType) => {
      if (newType === 'sql') {
        previewQuery.value = formData.value.query_condition?.sql ? formData.value.query_condition.sql.trim() : '';
        isUsingBackendSql.value = false;
      } else if (newType === 'promql') {
        previewQuery.value = formData.value.query_condition?.promql ? formData.value.query_condition.promql.trim() : '';
        isUsingBackendSql.value = false;
        // Initialize promql_condition if it doesn't exist
        if (!formData.value.query_condition.promql_condition) {
          formData.value.query_condition.promql_condition = {
            column: 'value',
            operator: '>=',
            value: 1,
          };
        }
      } else if (newType === 'custom') {
        // Start with local SQL, backend SQL will update it when ready
        previewQuery.value = generateSqlQueryLocal();
        isUsingBackendSql.value = false;
        // Trigger backend SQL generation for preview
        debouncedGenerateSql();
      }
    });

    // Watch for changes in conditions or stream to regenerate SQL
    watch(
      () => [
        formData.value.query_condition?.conditions,
        formData.value.stream_name,
        formData.value.query_condition?.aggregation,
        isAggregationEnabled.value,
      ],
      () => {
        if (formData.value.query_condition?.type === 'custom') {
          debouncedGenerateSql();
        }
      },
      { deep: true }
    );

    const previewAlert = async () => {
      if (getSelectedTab.value === "custom"){
        previewQuery.value = generateSqlQueryLocal();

      }
      else if (getSelectedTab.value === "sql")
        previewQuery.value = formData.value.query_condition.sql.trim();
      else if (getSelectedTab.value === "promql")
        previewQuery.value = formData.value.query_condition.promql.trim();

      if (formData.value.is_real_time === "true") {
        previewQuery.value = generateSqlQueryLocal();
      }

      await nextTick();
      if (getSelectedTab.value !== "sql") {
        previewAlertRef.value?.refreshData();
      }
    };




    const generateSqlQueryLocal = () => {
      return generateSqlQuery(
        formData.value,
        streamFieldsMap.value,
        isAggregationEnabled.value,
        store.state.zoConfig.timestamp_column || "_timestamp"
      );
    };

    // Generated SQL query for preview in FilterGroup
    // This will be updated via API call when conditions change
    const generatedSqlQuery = ref('');

    // Helper function to check if all conditions have valid column and value
    const allConditionsValid = (conditions: any): boolean => {
      if (!conditions || typeof conditions !== 'object') {
        return false;
      }

      // If it's a condition (not a group), check if column and value are filled
      if (conditions.filterType === 'condition') {
        return !!(conditions.column && conditions.value !== undefined && conditions.value !== '');
      }

      // If it's a group, recursively check all nested conditions
      if (conditions.filterType === 'group' && Array.isArray(conditions.conditions)) {
        // All conditions must be valid (using .every() instead of .some())
        return conditions.conditions.every((cond: any) => allConditionsValid(cond));
      }

      return false;
    };

    // Helper function to validate aggregation having clause
    const isAggregationValid = (): boolean => {
      // If aggregation is disabled, it's valid (will be removed from payload)
      if (!isAggregationEnabled.value) {
        return true;
      }

      const aggregation = formData.value.query_condition.aggregation;

      // If aggregation is enabled but no aggregation object, skip
      if (!aggregation) {
        return false;
      }

      // If having clause exists, validate it has required fields
      if (aggregation.having) {
        const { column, operator, value } = aggregation.having;
        // All having fields must be filled
        return !!(column && operator && value !== undefined && value !== '');
      }

      // If no having clause but aggregation is enabled, it's still valid
      // (group_by can exist without having)
      return true;
    };

    // Function to generate SQL from backend API
    const generateSqlFromBackend = async () => {
      try {
        // Only generate if we have conditions and stream info
        if (!formData.value.stream_name ||
            !formData.value.query_condition?.conditions ||
            Object.keys(formData.value.query_condition.conditions).length === 0) {
          // Don't clear SQL, just skip the API call
          return;
        }

        // Skip if not in custom mode
        if (formData.value.query_condition.type !== 'custom') {
          return;
        }

        // Check if all conditions have valid column and value
        // If any condition is empty, skip the API call but keep the previous preview
        if (!allConditionsValid(formData.value.query_condition.conditions)) {
          // Don't clear the previous SQL, just skip the API call
          return;
        }

        // Validate aggregation (having clause if present)
        if (!isAggregationValid()) {
          // Don't clear the previous SQL, just skip the API call
          return;
        }

        // Prepare payload
        const payload: any = {
          stream_name: formData.value.stream_name,
          stream_type: formData.value.stream_type || 'logs',
          query_condition: {
            type: 'custom',
            conditions: {
              version: 2,
              conditions: formData.value.query_condition.conditions,
            },
          },
        };

        // Only include aggregation if enabled
        if (isAggregationEnabled.value && formData.value.query_condition.aggregation) {
          payload.query_condition.aggregation = formData.value.query_condition.aggregation;
        }

        const response = await alertsService.generate_sql(
          store.state.selectedOrganization.identifier,
          payload
        );

        if (response.data && response.data.sql) {
          generatedSqlQuery.value = response.data.sql;
          // Update preview query with backend SQL
          previewQuery.value = response.data.sql;
          // Set flag to indicate we're using backend-generated SQL
          isUsingBackendSql.value = true;
        }
      } catch (error) {
        console.error('Error generating SQL from backend:', error);
        // Fallback to local generation if API fails
        const localSql = generateSqlQueryLocal();
        generatedSqlQuery.value = localSql;
        previewQuery.value = localSql;
        isUsingBackendSql.value = false;
      }
    };

    // Debounced version for heavy debouncing (1 second)
    const debouncedGenerateSql = debounce(generateSqlFromBackend, 1000);

    const debouncedPreviewAlert = debounce(previewAlert, 500);

    const onInputUpdate = async (name: string, value: any) => {
      // Trigger SQL generation when conditions change
      // SQL generation will automatically update previewQuery and trigger preview refresh
      if (formData.value.query_condition.type === 'custom') {
        debouncedGenerateSql();
      } else if (showPreview.value) {
        // Only call preview directly if not in custom mode
        debouncedPreviewAlert();
      }
    };
    const getParser = (sqlQuery: string) => {
      const sqlUtilsContext: SqlUtilsContext = {
        parser,
        sqlQueryErrorMsg,
      };
      return getParserUtil(sqlQuery, sqlUtilsContext);
    };

    const getAlertPayload = () => {
      const payloadContext: PayloadContext = {
        store,
        isAggregationEnabled,
        getSelectedTab,
        beingUpdated,
      };
      return getAlertPayloadUtil(formData.value, payloadContext);
    };

    const validateInputs = (input: any, notify: boolean = true) => {
      const validationContext: ValidationContext = {
        q,
        store,
        validateSqlQueryPromise,
        sqlQueryErrorMsg,
        vrlFunctionError,
        buildQueryPayload,
        getParser,
      };
      return validateInputsUtil(input, validationContext, notify);
    };

    const validateSqlQuery = async () => {
      const validationContext: ValidationContext = {
        q,
        store,
        validateSqlQueryPromise,
        sqlQueryErrorMsg,
        vrlFunctionError,
        buildQueryPayload,
        getParser,
      };
      return validateSqlQueryUtil(formData.value, validationContext);
    };

    /**
     * Validates that all condition fields are in the available filtered fields when UDS is configured
     * This ensures users only create conditions using fields that are part of the defined schema
     *
     * Note: We skip validation for "sql" and "promql" query types as users write custom queries there
     * We use the already filtered originalStreamFields instead of fetching stream again for efficiency
     *
     * @returns {{ isValid: boolean, invalidFields: string[] }} Validation result with invalid fields list
     */
    const validateConditionsAgainstUDS = () => {
      // Skip validation if no stream is selected or no fields are available
      if (
        !formData.value.stream_name ||
        !formData.value.stream_type ||
        !originalStreamFields.value ||
        originalStreamFields.value.length === 0
      ) {
        return { isValid: true, invalidFields: [] };
      }

      // For scheduled alerts: Skip validation if query type is "sql" or "promql" - users write custom queries there
      // For real-time alerts: Always validate since they use the conditions UI
      const isRealTime = formData.value.is_real_time === "true" || formData.value.is_real_time === true;
      const isScheduled = !isRealTime;
      const queryType = formData.value.query_condition?.type;

      if (isScheduled && (queryType === "sql" || queryType === "promql")) {
        return { isValid: true, invalidFields: [] };
      }

      // Use the already filtered fields from originalStreamFields
      // These are already filtered by UDS in updateStreamFields function
      const allowedFieldNames = new Set(
        originalStreamFields.value.map((field: any) => field.value)
      );



      // Recursively collect all column names used in conditions
      const invalidFields: string[] = [];

      const checkConditionFields = (condition: any) => {
        if (!condition) return;

        // V2: If it's a condition group (has conditions array with filterType: "group")
        if (condition.filterType === "group" && condition.conditions && Array.isArray(condition.conditions)) {
          condition.conditions.forEach((item: any) => {
            checkConditionFields(item);
          });
        }
        // V1: If it's a condition group (has items array)
        else if (condition.items && Array.isArray(condition.items)) {
          condition.items.forEach((item: any) => {
            checkConditionFields(item);
          });
        }
        // If it's a single condition (has column property)
        else if (condition.column) {
          // Check if the column is in the allowed fields
          // Skip empty columns
          if (condition.column && condition.column !== "" && !allowedFieldNames.has(condition.column)) {
            // Add to invalid fields if not already present
            if (!invalidFields.includes(condition.column)) {
              invalidFields.push(condition.column);
            }
          }
        }
      };

      // Check conditions based on alert type
      if (isRealTime) {
        // Real-time alerts: Always check conditions since they use the conditions UI
        if (formData.value.query_condition?.conditions) {
          checkConditionFields(formData.value.query_condition.conditions);
        }
      } else {
        // Scheduled alerts: Only check if query type is "custom"
        if (
          formData.value.query_condition?.conditions &&
          queryType === "custom"
        ) {
          checkConditionFields(formData.value.query_condition.conditions);
        }

        // Also check aggregation having clause if present (for scheduled alerts with custom query type)
        if (
          isAggregationEnabled.value &&
          queryType === "custom" &&
          formData.value.query_condition?.aggregation?.having?.column
        ) {
          const havingColumn = formData.value.query_condition.aggregation.having.column;
          if (havingColumn && havingColumn !== "" && !allowedFieldNames.has(havingColumn)) {
            if (!invalidFields.includes(havingColumn)) {
              invalidFields.push(havingColumn);
            }
          }
        }

        // Also check group_by fields if present (for scheduled alerts with custom query type)
        if (
          isAggregationEnabled.value &&
          queryType === "custom" &&
          formData.value.query_condition?.aggregation?.group_by &&
          Array.isArray(formData.value.query_condition.aggregation.group_by)
        ) {
          formData.value.query_condition.aggregation.group_by.forEach((field: string) => {
            if (field && field !== "" && !allowedFieldNames.has(field)) {
              if (!invalidFields.includes(field)) {
                invalidFields.push(field);
              }
            }
          });
        }
      }

      return {
        isValid: invalidFields.length === 0,
        invalidFields
      };
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
          message: err.response?.data?.message || err.response?.data?.error || err.response?.data,
        });
      }
    };
    const updateExpandState = (value: any) => {
      expandState.value = value;
    };

    const refreshDestinations = () => {
      emit("refresh:destinations");
    }
    const refreshTemplates = () => {
      emit("refresh:templates");
    }
    const updateDestinations = (destinations: any[]) => {
      formData.value.destinations = destinations;
    }

    const updateTab = (tab: string) => {
      // Save to formData so it persists when navigating between steps
      formData.value.query_condition.type = tab;
    }

    const handleGoToSqlEditor = () => {
      // Switch to SQL mode
      formData.value.query_condition.type = 'sql';
      // Navigate to step 2 (Query Config)
      wizardStep.value = 2;
    }

    const clearMultiWindows = () => {
      formData.value.query_condition.multi_time_range = [];
    }


// Method to handle the emitted changes and update the structure
  const updateGroup = (updatedGroup: any) => {
    const transformContext: TransformContext = { formData: formData.value };
    updateGroupUtil(updatedGroup, transformContext);
  };
  const removeConditionGroup = (targetGroupId: string, currentGroup?: any) => {
    const transformContext: TransformContext = { formData: formData.value };
    removeConditionGroupUtil(targetGroupId, currentGroup, transformContext);
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
  const transformFEToBE = (node: any) => {
    return transformFEToBEUtil(node);
  };

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
  const retransformBEToFE = (data: any) => {
    return retransformBEToFEUtil(data);
  };
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

    const loadPanelDataIfPresent = async () => {
      const route = router.currentRoute.value;

      if (route.query.fromPanel === "true" && route.query.panelData) {
        isLoadingPanelData.value = true;
        try {
          const panelData = JSON.parse(decodeURIComponent(route.query.panelData as string));

          if (panelData.queries && panelData.queries.length > 0) {
            const query = panelData.queries[0];

            // Sanitize panel title for use in alert name
            // Remove invalid characters (: # ? & % ' " and whitespace)
            // Collapse multiple underscores, trim leading/trailing underscores
            // Limit length to 200 characters (reasonable limit for alert names)
            const sanitizePanelTitle = (title: string | undefined): string => {
              if (!title || title.trim() === '') {
                return 'panel';
              }

              // Replace invalid characters with underscores
              let sanitized = title.replace(/[:#?&%'"\s]+/g, '_');

              // Collapse multiple consecutive underscores into single underscore
              sanitized = sanitized.replace(/_+/g, '_');

              // Remove leading/trailing underscores
              sanitized = sanitized.replace(/^_+|_+$/g, '');

              // If empty after sanitization, use default
              if (sanitized === '') {
                return 'panel';
              }

              // Truncate to reasonable length (leaving room for "Alert_from_" prefix)
              const maxLength = 200;
              if (sanitized.length > maxLength) {
                sanitized = sanitized.substring(0, maxLength);
                // Remove trailing underscore if truncation created one
                sanitized = sanitized.replace(/_+$/, '');
              }

              return sanitized;
            };

            formData.value.name = `Alert_from_${sanitizePanelTitle(panelData.panelTitle)}`;

            // Show notification that query was imported
            q.notify({
              type: "positive",
              message: t("alerts.importedFromPanel", { panelTitle: panelData.panelTitle }),
              timeout: 3000,
            });

            if (query.fields?.stream_type) {
              formData.value.stream_type = query.fields.stream_type;
            }

            if (query.fields?.stream) {
              formData.value.stream_name = query.fields.stream;
              await updateStreams(false);
              await updateStreamFields(query.fields.stream);
            }

            // Set query type based on panel (SQL or PromQL)
            // Always set a specific type - never leave it as empty string to avoid defaulting to quick mode
            if (panelData.queryType === "sql") {
              formData.value.query_condition.type = "sql";
              // Use executedQuery if available (has variables replaced), otherwise use query.query
              const sourceQuery = panelData.executedQuery || query.query;
              if (sourceQuery) {
                let sqlQuery = sourceQuery;

                // If threshold is provided and we have a SQL query with GROUP BY,
                // add a HAVING clause to filter the aggregated column
                if (panelData.threshold !== undefined && panelData.condition && panelData.yAxisColumn) {
                  const threshold = panelData.threshold;
                  const operator = panelData.condition === 'above' ? '>=' : '<=';
                  const yAxisColumn = panelData.yAxisColumn;

                  // Use node-sql-parser to properly insert HAVING clause in the correct position
                  // This handles queries with ORDER BY, LIMIT, OFFSET, etc.
                  // Ensure parser is initialized first
                  if (!parser) {
                    await importSqlParser();
                  }
                  sqlQuery = addHavingClauseToQuery(sqlQuery, yAxisColumn, operator, threshold, parser);
                }

                formData.value.query_condition.sql = sqlQuery;
              }
            } else if (panelData.queryType === "promql") {
              formData.value.query_condition.type = "promql";
              // Use executedQuery if available (has variables replaced), otherwise use query.query
              const sourceQuery = panelData.executedQuery || query.query;
              if (sourceQuery) {
                formData.value.query_condition.promql = sourceQuery;
              }
            } else {
              // Default to SQL mode if queryType is not specified
              // This prevents falling back to quick mode
              formData.value.query_condition.type = "sql";
            }

            // Handle query builder fields for SQL panels
            if (panelData.queryType === "sql" && query.customQuery === false && query.fields) {
              // Enable aggregation for query builder generated SQL
              isAggregationEnabled.value = true;

              if (query.fields.x && query.fields.x.length > 0) {
                if (!formData.value.query_condition.aggregation) {
                  formData.value.query_condition.aggregation = {
                    group_by: [],
                    function: "count",
                    having: {
                      column: "",
                      operator: ">=",
                      value: 1,
                    },
                  };
                }
                formData.value.query_condition.aggregation.group_by = query.fields.x.map((x: any) => x.alias || x.column);
              }

              if (query.fields.y && query.fields.y.length > 0) {
                const yField = query.fields.y[0];
                if (yField.aggregationFunction) {
                  if (!formData.value.query_condition.aggregation) {
                    formData.value.query_condition.aggregation = {
                      group_by: [""],
                      function: "count",
                      having: {
                        column: "",
                        operator: ">=",
                        value: 1,
                      },
                    };
                  }
                  formData.value.query_condition.aggregation.function = yField.aggregationFunction.toLowerCase();
                  // Set the having.column to the Y-axis field for threshold comparison
                  formData.value.query_condition.aggregation.having.column = yField.alias || yField.column;
                }
              }

              if (query.fields.filter && query.fields.filter.length > 0) {
                const conditions: any[] = [];
                query.fields.filter.forEach((filter: any) => {
                  if (filter.type === 'list' && filter.values && filter.values.length > 0) {
                    // V2: Create condition with filterType and logicalOperator
                    conditions.push({
                      filterType: 'condition',
                      column: filter.column,
                      operator: "=",
                      value: filter.values[0],
                      values: [],
                      logicalOperator: 'AND',
                      id: getUUID()
                    });
                  }
                });

                if (conditions.length > 0) {
                  // V2: Create group with filterType and conditions array
                  formData.value.query_condition.conditions = {
                    filterType: 'group',
                    logicalOperator: 'AND',
                    groupId: getUUID(),
                    conditions: conditions
                  };
                }
              }
            }

            if (query.vrlFunctionQuery) {
              showVrlFunction.value = true;
              formData.value.query_condition.vrl_function = query.vrlFunctionQuery;
            }

            if (panelData.timeRange?.value_type === "relative") {
              const relativeValue = panelData.timeRange.relative_value || 15;
              const relativePeriod = panelData.timeRange.relative_period || "Minutes";

              let periodInMinutes = relativeValue;
              if (relativePeriod === "Hours") {
                periodInMinutes = relativeValue * 60;
              } else if (relativePeriod === "Days") {
                periodInMinutes = relativeValue * 60 * 24;
              } else if (relativePeriod === "Weeks") {
                periodInMinutes = relativeValue * 60 * 24 * 7;
              }

              formData.value.trigger_condition.period = periodInMinutes;
            }

            // Handle threshold and condition from context menu
            if (panelData.threshold !== undefined && panelData.condition) {
              // For SQL with aggregation: use HAVING clause for value comparison
              // For PromQL: use promql_condition for value comparison
              // In both cases, set trigger_condition.threshold to 1 (fire when any row/result is returned)

              if (panelData.queryType === 'promql') {
                // For PromQL: Set up promql_condition with the threshold
                if (!formData.value.query_condition.promql_condition) {
                  formData.value.query_condition.promql_condition = {
                    column: 'value',
                    operator: '>=',
                    value: 1,
                  };
                }
                formData.value.query_condition.promql_condition.value = panelData.threshold;
                formData.value.query_condition.promql_condition.operator =
                  panelData.condition === 'above' ? '>=' : '<=';
              } else {
                // For SQL: Set up aggregation HAVING clause with the threshold
                // If aggregation is enabled, set the having clause
                if (isAggregationEnabled.value && formData.value.query_condition.aggregation) {
                  if (!formData.value.query_condition.aggregation.having) {
                    formData.value.query_condition.aggregation.having = {
                      column: "",
                      operator: ">=",
                      value: 1,
                    };
                  }
                  formData.value.query_condition.aggregation.having.value = panelData.threshold;
                  formData.value.query_condition.aggregation.having.operator =
                    panelData.condition === 'above' ? '>=' : '<=';
                }
              }

              // Set alert trigger threshold to 1 and operator to >=
              // This means: fire the alert when ANY row is returned from the query
              // (The actual value comparison is done in HAVING clause for SQL or in PromQL query)
              formData.value.trigger_condition.threshold = 1;
              formData.value.trigger_condition.operator = '>=';
            }
          }
        } catch (error) {
          console.error("Error loading panel data:", error);
          q.notify({
            type: "negative",
            message: "Failed to load panel data",
            timeout: 2000
          });
        } finally {
          isLoadingPanelData.value = false;
        }
      }
    };


    const openJsonEditor = () => {
      showJsonEditorDialog.value = true;
    };

    const saveAlertJson = async (json: any) => {
      const saveContext: SaveAlertContext = {
        q,
        store,
        props,
        emit,
        router,
        isAggregationEnabled,
        activeFolderId: { value: Array.isArray(activeFolderId.value) ? activeFolderId.value[0] : activeFolderId.value },
        handleAlertError,
      };

      const prepareAndSaveAlertFunction = (data: any) => prepareAndSaveAlertUtil(data, saveContext);

      const jsonValidationContext: JsonValidationContext = {
        q,
        store,
        streams,
        getParser,
        buildQueryPayload,
        prepareAndSaveAlert: prepareAndSaveAlertFunction,
      };

      await saveAlertJsonUtil(
        json,
        props,
        validationErrors,
        showJsonEditorDialog,
        formData,
        jsonValidationContext,
      );
    };

    // Wizard step navigation logic
    const goToNextStep = async () => {
      // Validate current step before moving to next
      const isValid = await validateCurrentStep();
      if (!isValid) {
        return; // Stop navigation if validation fails
      }

      if (formData.value.is_real_time === 'true') {
        // For real-time alerts: 1 -> 2 -> 4 -> 6 (skip 3 and 5)
        if (wizardStep.value === 2) {
          wizardStep.value = 4;
        } else if (wizardStep.value === 4) {
          wizardStep.value = 6;
        } else {
          wizardStep.value = wizardStep.value + 1;
        }
      } else {
        // For scheduled alerts: normal progression 1 -> 2 -> 3 -> 4 -> 5 -> 6
        wizardStep.value = wizardStep.value + 1;
      }

      // Only update lastValidStep if moving forward (don't reduce it when editing)
      if (wizardStep.value > lastValidStep.value) {
        lastValidStep.value = wizardStep.value;
      }
    };

    // Validate a specific step (used by both Continue button and header navigation)
    const validateStep = async (stepNumber: number) => {
      // Step 1: Alert Setup
      if (stepNumber === 1) {
        if (step1Ref.value && (step1Ref.value as any).validate) {
          const isValid = await (step1Ref.value as any).validate();
          if (!isValid) {
            // Focus on the first invalid field
            focusOnFirstError();
            return false;
          }
        }
      }


      // Step 2: Query Config
      if (stepNumber === 2) {
        if (step2Ref.value && (step2Ref.value as any).validate) {
          const validationResult = (step2Ref.value as any).validate();

          // Handle async validation
          const isValid = validationResult instanceof Promise
            ? await validationResult
            : validationResult;

          if (!isValid) {
            // Don't show toast notification for custom mode
            // The fields themselves should show validation errors
            const queryType = formData.value.query_condition.type || 'custom';

            // Only show toast for SQL mode
            if (queryType === 'sql') {
              let errorMsg = '';
              if (sqlQueryErrorMsg.value) {
                errorMsg = `SQL validation error: ${sqlQueryErrorMsg.value}`;
              } else {
                errorMsg = 'Please provide a valid SQL query.';
              }

              q.notify({
                type: 'negative',
                message: errorMsg,
                timeout: 2000,
              });
            }

            return false;
          }
        }
      }

      // Step 4: Alert Settings
      if (stepNumber === 4) {
        if (step4Ref.value && (step4Ref.value as any).validate) {
          const validationResult = (step4Ref.value as any).validate();

          // Handle async validation
          const result = validationResult instanceof Promise
            ? await validationResult
            : validationResult;

          // Handle validation result - could be boolean (backward compat) or object
          const isValid = typeof result === 'boolean' ? result : result.valid;
          const errorMessage = typeof result === 'object' ? result.message : null;

          if (!isValid) {
            // Show toaster only if there's a specific error message
            // If message is null, it means inline validation errors are sufficient
            if (errorMessage) {
              q.notify({
                type: 'negative',
                message: errorMessage,
                timeout: 1500,
              });
            }
            return false;
          }
        }
      }

      // Add validation for other steps here in the future
      // Step 3: Compare with Past (skipped - optional)
      // Step 5: Deduplication
      // Step 6: Advanced

      return true;
    };

    // Validate current step (convenience wrapper)
    const validateCurrentStep = async () => {
      return await validateStep(wizardStep.value);
    };

    // Focus on first error field
    const focusOnFirstError = () => {
      // Use nextTick to ensure DOM is updated with error states
      nextTick(() => {
        // Find the first field with error class
        const errorField = document.querySelector('.q-field--error input, .q-field--error .q-select__dropdown-icon');
        if (errorField) {
          (errorField as HTMLElement).focus();
          // Scroll to the error field
          errorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    };

    // Simpler approach: Remove header-nav and only allow Continue/Back buttons
    // This way we don't fight with Quasar's navigation system

    const goToPreviousStep = () => {
      if (formData.value.is_real_time === 'true') {
        // For real-time alerts: 6 -> 4 -> 2 -> 1 (skip 5 and 3)
        if (wizardStep.value === 6) {
          wizardStep.value = 4;
        } else if (wizardStep.value === 4) {
          wizardStep.value = 2;
        } else {
          wizardStep.value = wizardStep.value - 1;
        }
      } else {
        // For scheduled alerts: normal progression 6 -> 5 -> 4 -> 3 -> 2 -> 1
        wizardStep.value = wizardStep.value - 1;
      }
    };

    const isLastStep = computed(() => {
      if (formData.value.is_real_time === 'true') {
        // For real-time alerts, step 6 is the last step
        return wizardStep.value === 6;
      } else {
        // For scheduled alerts, step 6 is also the last step
        return wizardStep.value === 6;
      }
    });

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
      updateStreamFields,
      updateEditorContent,
      triggerCols,
      triggerOperators,
      sqlAST,
      schemaList,
      filteredColumns,
      streamTypes,
      rowTemplateTypeOptions,
      streams,
      updateStreams,
      isFetchingStreams,
      filteredStreams,
      filterStreams,
      removeVariable,
      addVariable,
      selectedDestinations,
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
      rowTemplatePlaceholder,
      streamFieldsMap,
      generatedSqlQuery,
      previewQuery,
      previewAlertRef,
      isUsingBackendSql,
      outlinedInfo,
      getTimezoneOffset,
      showVrlFunction,
      validateSqlQuery,
      validateSqlQueryPromise,
      validateConditionsAgainstUDS,
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
      refreshTemplates,
      updateDestinations,
      updateTab,
      updateGroup,
      removeConditionGroup,
      transformFEToBE,
      retransformBEToFE,
      validateFormAndNavigateToErrorField,
      openEditorDialog,
      decodedVrlFunction,
      viewSqlEditorDialog,
      navigateToErrorField,
      openJsonEditor,
      showJsonEditorDialog,
      saveAlertJson,
      validationErrors,
      originalStreamFields,
      generateSqlQuery: generateSqlQueryLocal,
      track,
      loadPanelDataIfPresent,
      isLoadingPanelData,
      focusManager,
      streamFieldRef,
      streamTypeFieldRef,
      wizardStep,
      wizardStepper,
      step1Ref,
      currentStepCaption,
      goToStep2,
      goToNextStep,
      goToPreviousStep,
      isLastStep,
      step2Ref,
      step3Ref,
      step4Ref,
      lastValidStep,
      clearMultiWindows,
      validateStep,
      handleGoToSqlEditor,
    };
  },

  async created() {
    // TODO OK: Refactor this code
    this.formData.ingest = ref(false);
    this.formData = { ...defaultValue, ...cloneDeep(this.modelValue) };

    // Check if this is from a dashboard panel - if so, don't set default query type
    const route = this.router.currentRoute.value;
    const isFromPanel = route.query.fromPanel === "true" && route.query.panelData;

    if(!this.isUpdated){
      this.formData.is_real_time = this.alertType === 'realTime'? true : false;
    }
      this.formData.is_real_time = this.formData.is_real_time.toString();

    // If from panel, load panel data BEFORE initializing child components
    if (isFromPanel) {
      this.formData.query_condition.type = ""; // Temporarily set to empty
      await this.loadPanelDataIfPresent(); // Load panel data and set correct type
    }

    // Set default frequency to min_auto_refresh_interval
    if (this.store.state?.zoConfig?.min_auto_refresh_interval)
      this.formData.trigger_condition.frequency = Math.ceil(
        this.store.state?.zoConfig?.min_auto_refresh_interval / 60 || 10,
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

      // Defensive initialization for legacy or malformed promql_condition
      // Ensures all required fields are present (column, operator, value)
      // this makes sure that we dont pass any null values while creating or updating an existing alert
      if (this.formData.query_condition.promql_condition) {
        if (!this.formData.query_condition.promql_condition.column) {
          this.formData.query_condition.promql_condition.column = 'value';
        }
        if (!this.formData.query_condition.promql_condition.operator) {
          this.formData.query_condition.promql_condition.operator = '>=';
        }
        if (this.formData.query_condition.promql_condition.value === undefined ||
            this.formData.query_condition.promql_condition.value === null) {
          this.formData.query_condition.promql_condition.value = 1;
        }
      }

      // Enable all steps when editing an existing alert
      this.lastValidStep = 6;

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
    // Convert context_attributes from object to array format (only if it's an object)
    if (this.formData.context_attributes && typeof this.formData.context_attributes === 'object' && !Array.isArray(this.formData.context_attributes)) {
      this.formData.context_attributes = Object.keys(
        this.formData.context_attributes,
      ).map((attr) => {
        return {
          key: attr,
          value: this.formData.context_attributes[attr],
          id: getUUID(),
        };
      });
    } else if (!this.formData.context_attributes) {
      // If null or undefined, initialize as empty array
      this.formData.context_attributes = [];
    }
    // VERSION DETECTION AND CONVERSION
    // Supports three versions:
    // - V0: Flat array of conditions with implicit AND between all (no groups)
    // - V1: Tree-based structure with {and: [...]} or {or: [...]} or {label, items, groupId}
    // - V2: Linear structure with filterType, logicalOperator per condition

    // Check for V2 format from backend
    // Backend sends: query_condition: { conditions: { version: 2, conditions: {...} } }
    if (this.formData.query_condition.conditions?.version === "2" || this.formData.query_condition.conditions?.version === 2) {
      // V2: Extract the nested conditions object
      // Backend sends { version: 2, conditions: {...} }, we need just the inner conditions
      this.formData.query_condition.conditions = ensureIds(this.formData.query_condition.conditions.conditions);
    } else if(this.formData.query_condition.conditions && ( !Array.isArray(this.formData.query_condition.conditions) && Object.keys(this.formData.query_condition.conditions).length != 0)){
      // No version field - could be V1 or old V2
      // Detect version by structure
      const version = detectConditionsVersion(this.formData.query_condition.conditions);

      if (version === 0) {
        // V0: Flat array format - convert to V2
        // V0 had implicit AND between all conditions (no groups)
        this.formData.query_condition.conditions = ensureIds(convertV0ToV2(this.formData.query_condition.conditions));
      } else if (version === 1) {
        // V1 format - need to convert to V2
        // First check if it's BE format ({and: [...]}) or FE format ({label, items, groupId})
        if (this.formData.query_condition.conditions.and || this.formData.query_condition.conditions.or) {
          // V1 Backend format - convert to V2
          this.formData.query_condition.conditions = ensureIds(convertV1BEToV2(this.formData.query_condition.conditions));
        } else if (this.formData.query_condition.conditions.label && this.formData.query_condition.conditions.items) {
          // V1 Frontend format - convert to V2
          // this wont be executed atleast once but we are keeping it incase any FE logics got saved already 
          this.formData.query_condition.conditions = ensureIds(convertV1ToV2(this.formData.query_condition.conditions));
        }
      } else {
        // V2 format - ensure all IDs exist
        this.formData.query_condition.conditions = ensureIds(this.formData.query_condition.conditions);
      }
    } else if (Array.isArray(this.formData.query_condition.conditions) && this.formData.query_condition.conditions.length > 0) {
      // V0: Flat array of conditions - convert to V2
      // This handles the case where conditions is directly an array at the top level
      this.formData.query_condition.conditions = ensureIds(convertV0ToV2(this.formData.query_condition.conditions));
    }
    else if (this.formData.query_condition.conditions == null || this.formData.query_condition.conditions == undefined || this.formData.query_condition.conditions.length == 0 || Object.keys(this.formData.query_condition.conditions).length == 0){
      // No conditions - create empty V2 group
      this.formData.query_condition.conditions = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [],
        groupId: getUUID(),
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

      // FINAL VALIDATION CHECKPOINT
      // Validate all steps before submission to catch any errors from navigating back

      // Validate Step 1: Alert Setup
      if (this.$refs.step1Ref && (this.$refs.step1Ref as any).validate) {
        const isValid = await (this.$refs.step1Ref as any).validate();
        if (!isValid) {
          this.wizardStep = 1;
          this.q.notify({
            type: "negative",
            message: "Please complete Alert Setup step correctly.",
            timeout: 2000,
          });
          return false;
        }
      }

      // Validate Step 2: Query Config
      if (this.$refs.step2Ref && (this.$refs.step2Ref as any).validate) {
        const validationResult = (this.$refs.step2Ref as any).validate();
        const isValid = validationResult instanceof Promise
          ? await validationResult
          : validationResult;
        if (!isValid) {
          this.wizardStep = 2;
          this.q.notify({
            type: "negative",
            message: "Please complete Query Configuration step correctly.",
            timeout: 2000,
          });
          return false;
        }
      }

      // Validate Step 3: Compare with Past (only if not real-time)
      // Step 3 is optional, no strict validation needed

      // Validate Step 4: Alert Settings
      if (this.$refs.step4Ref && (this.$refs.step4Ref as any).validate) {
        const validationResult = (this.$refs.step4Ref as any).validate();
        const result = validationResult instanceof Promise
          ? await validationResult
          : validationResult;

        // Handle validation result - could be boolean (backward compat) or object
        const isValid = typeof result === 'boolean' ? result : result.valid;

        if (!isValid) {
          this.wizardStep = 4;
          this.q.notify({
            type: "negative",
            message: "Please complete Alert Settings step correctly.",
            timeout: 2000,
          });
          return false;
        }
      }

      if (
        this.formData.is_real_time == "false" &&
        this.formData.query_condition.type == "sql" &&
        !this.getParser(this.formData.query_condition.sql)
      ) {
        this.wizardStep = 2; // Navigate to query step
        this.q.notify({
          type: "negative",
          message: "Selecting all Columns in SQL query is not allowed.",
          timeout: 1500,
        });
        return false;
      }


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
              // Validate that conditions use only available fields (respects UDS filtering if configured)
        // Only validates "custom" query type - skips "sql" and "promql" as users write custom queries
        const udsValidation = this.validateConditionsAgainstUDS();
        if (!udsValidation.isValid) {
          const invalidCount = udsValidation.invalidFields.length;
          let message = '';

          if (invalidCount === 1) {
            // Single field - show the field name
            message = `Field "${udsValidation.invalidFields[0]}" is not available. Please use only the available fields in your conditions.`;
          } else if (invalidCount <= 3) {
            // 2-3 fields - show all field names
            message = `Fields ${udsValidation.invalidFields.map((f: string) => `"${f}"`).join(', ')} are not available. Please use only the available fields in your conditions.`;
          } else {
            // More than 3 fields - show count and first few fields
            const firstThree = udsValidation.invalidFields.slice(0, 3).map((f: string) => `"${f}"`).join(', ');
            const remaining = invalidCount - 3;
            message = `${invalidCount} fields are not available (${firstThree} and ${remaining} more). Please use only the available fields in your conditions.`;
          }

          this.q.notify({
            type: "negative",
            message: message,
            timeout: 6000,
          });

          // Navigate back to step 2 (Query) where fields can be corrected
          this.wizardStep = 2;

          return false;
        }

      const payload = this.getAlertPayload();

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
            console.error("Error while validating sql query",error);
            return false;
          }
        }

        // VERSION HANDLING
        // All conditions are converted to V2 format during data loading,
        // so we always wrap with version field for backend
        // Backend expects: query_condition: { conditions: { version: 2, conditions: {...} } }
        payload.query_condition.conditions = {
          version: 2,
          conditions: this.formData.query_condition.conditions,
        };

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
          this.track("Button Click", {
            button: "Update Alert",
            page: "Alerts"
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
          this.track("Button Click", {
            button: "Create Alert",
            page: "Alerts"
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
  padding: 8px 16px;
  margin-left: 8px;
  border: 1px solid #343434;
  border-top: 0px !important;
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px ;
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
    padding: 8px 16px;
    margin-left: 8px;
    border: 1px solid #e6e6e6;
    border-top: 0px !important;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px ;
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
  border: 1px solid #181a1b !important;
}
.input-border-light .q-field__control{
  border: 1px solid #d4d4d4 !important;
}


.o2-alert-tab-border{
  border-top: 0.0625rem solid var(--o2-border-color);
}

// Wizard Stepper Styles
.alert-wizard-stepper {
  box-shadow: none;
  .q-stepper__step-inner{
    padding: 0.375rem !important;
  }
  .q-stepper__tab{
    padding-left: 0.375rem !important;
    min-height: 30px !important;

  }

  :deep(.q-stepper__header) {
    border-bottom: 1px solid #e0e0e0;
  }

  :deep(.q-stepper__tab) {
    padding: 12px 16px;
    min-height: 60px;
  }

  // Hide captions for inactive steps
  :deep(.q-stepper__tab) {
    .q-stepper__caption {
      display: none !important;
    }
  }

  // Show caption only on active step
  :deep(.q-stepper__tab--active) {
    .q-stepper__caption {
      display: block !important;
      opacity: 0.7;
      font-size: 12px;
      margin-top: 4px;
    }
  }

  :deep(.q-stepper__tab--active) {
    color: #1976d2;
    font-weight: 600;
  }

  :deep(.q-stepper__tab--done) {
    color: #4caf50;
    cursor: pointer;
  }

  :deep(.q-stepper__dot) {
    width: 32px;
    height: 32px;
    font-size: 14px;
  }

  .q-stepper--horizontal .q-stepper__step-inner {
    padding: 8px !important;
  }

  // Make step titles more compact
  :deep(.q-stepper__title) {
    font-size: 14px;
    line-height: 1.2;
  }
}

.wizard-view-container {
  .q-stepper {
    background: transparent !important;
  }
}

// Dark mode adjustments
.dark-mode1 {
  .alert-wizard-stepper {
    :deep(.q-stepper__header) {
      border-bottom-color: #424242;
    }
  }
}

// Persistent step caption styles (helper text style)
.persistent-step-caption {
  font-size: 12px;
  line-height: 1.6;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-weight: 400;
  margin-left: 0.375rem;
  letter-spacing: 0.01em;
}

.dark-mode-caption {
  background-color: transparent;
  color: #9e9e9e;
  border-left: 3px solid #5a5a5a;
  padding-left: 12px !important;
}

.light-mode-caption {
  background-color: transparent;
  color: #757575;
  border-left: 3px solid #bdbdbd;
  padding-left: 12px !important;
}

</style>