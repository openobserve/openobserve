// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  onBeforeMount,
  nextTick,
  type Ref,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar, debounce } from "quasar";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";

import alertsService from "@/services/alerts";
import searchService from "@/services/search";
import anomalyDetectionService from "@/services/anomaly_detection";
import segment from "@/services/segment_analytics";
import { useReo } from "@/services/reodotdev_analytics";

import useStreams from "@/composables/useStreams";
import useFunctions from "@/composables/useFunctions";
import useQuery from "@/composables/useQuery";

import {
  getUUID,
  getTimezoneOffset,
  b64DecodeUnicode,
  smartDecodeVrlFunction,
  isValidResourceName,
  getTimezonesByOffset,
} from "@/utils/zincutils";
import { convertDateToTimestamp } from "@/utils/date";
import { generateSqlQuery } from "@/utils/alerts/alertQueryBuilder";
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
import {
  createAlertsContextProvider,
  contextRegistry,
} from "@/composables/contextProviders";
import {
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";

// ─── Default Values ─────────────────────────────────────────────────────────

export const defaultAlertValue: any = () => {
  return {
    name: "",
    stream_type: "",
    stream_name: "",
    is_real_time: "false",
    query_condition: {
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "",
        conditions: [],
      },
      sql: "",
      promql: "",
      type: "custom",
      aggregation: {
        group_by: [],
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
    folder_id: "",
    creates_incident: false,
  };
};

export const defaultAnomalyConfig = () => ({
  name: "",
  description: "",
  stream_type: "logs",
  stream_name: "",
  query_mode: "filters" as "filters" | "custom_sql",
  filters: [] as any[],
  custom_sql: "",
  detection_function: "count",
  detection_function_field: "",
  histogram_interval_value: 5,
  histogram_interval_unit: "m" as "m" | "h",
  schedule_interval_value: 1,
  schedule_interval_unit: "h" as "m" | "h",
  detection_window_value: 1,
  detection_window_unit: "h" as "m" | "h",
  training_window_days: 14,
  retrain_interval_days: 7,
  threshold: 100,
  alert_enabled: true,
  alert_destination_ids: [] as string[],
  folder_id: "default",
  status: undefined as string | undefined,
  is_trained: false,
  enabled: true,
  last_error: undefined as string | undefined,
  last_detection_run: undefined as number | undefined,
  next_run_at: undefined as number | undefined,
});

// ─── Composable ─────────────────────────────────────────────────────────────

export interface AlertFormProps {
  modelValue: any;
  isUpdated: boolean;
  destinations: any[];
  templates?: any[];
}

export interface AlertFormEmit {
  (e: "update:list", folderId?: string): void;
  (e: "cancel:hideform"): void;
  (e: "refresh:destinations"): void;
  (e: "refresh:templates"): void;
}

export function useAlertForm(props: AlertFormProps, emit: AlertFormEmit) {
  const store: any = useStore();
  const { t } = useI18n();
  const q = useQuasar();
  const router = useRouter();
  const { track } = useReo();
  const { getAllFunctions } = useFunctions();
  const { getStreams, getStream } = useStreams();
  const { buildQueryPayload } = useQuery();

  // ── Core State ──────────────────────────────────────────────────────────

  const beingUpdated = ref(false);
  const addAlertForm: any = ref(null);
  const disableColor: any = ref("");
  const formData: any = ref(defaultAlertValue());
  const indexOptions = ref([]);
  const schemaList = ref([]);
  const streams: any = ref({});
  const editorRef: any = ref(null);
  const filteredColumns: any = ref([]);
  const filteredStreams: Ref<string[]> = ref([]);
  let editorobj: any = null;
  const sqlAST: any = ref(null);
  const selectedRelativeValue = ref("1");
  const selectedRelativePeriod = ref("Minutes");
  const relativePeriods: any = ref(["Minutes"]);
  const triggerCols: any = ref([]);
  const selectedDestinations = ref("slack");
  const originalStreamFields: any = ref([]);
  const isAggregationEnabled = ref(false);
  const isEditorOpen = ref(false);

  // ── Anomaly Detection State ─────────────────────────────────────────────

  const anomalyConfig = ref(defaultAnomalyConfig());
  const anomalyStep2Ref = ref<any>(null);
  const showAnomalySummary = ref(true);
  const anomalyEditMode = ref(false);
  const anomalyRetraining = ref(false);
  const anomalySaving = ref(false);

  const anomalyStatusColor = computed(() => {
    switch (anomalyConfig.value.status) {
      case "active":
        return "positive";
      case "training":
        return "info";
      case "failed":
        return "negative";
      default:
        return "grey";
    }
  });

  const anomalyFormatTs = (ts: number) => {
    const d = new Date(ts / 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const anomalyTriggerRetrain = async () => {
    const anomalyId = router.currentRoute.value.params.anomaly_id as
      | string
      | undefined;
    if (!anomalyId) return;
    anomalyRetraining.value = true;
    try {
      await anomalyDetectionService.triggerTraining(
        store.state.selectedOrganization.identifier,
        anomalyId,
      );
      q.notify({ type: "positive", message: "Training triggered." });
    } catch {
      q.notify({
        type: "negative",
        message: "Failed to trigger training.",
      });
    } finally {
      anomalyRetraining.value = false;
    }
  };

  const isAnomalyMode = computed(
    () => formData.value.is_real_time === "anomaly",
  );

  const anomalyHistogramInterval = computed(
    () =>
      `${anomalyConfig.value.histogram_interval_value}${anomalyConfig.value.histogram_interval_unit}`,
  );
  const anomalyScheduleInterval = computed(
    () =>
      `${anomalyConfig.value.schedule_interval_value}${anomalyConfig.value.schedule_interval_unit}`,
  );
  const anomalyDetectionWindowSeconds = computed(() => {
    const mult =
      anomalyConfig.value.detection_window_unit === "h" ? 3600 : 60;
    return anomalyConfig.value.detection_window_value * mult;
  });

  const anomalyPreviewSql = computed(() => {
    const c = anomalyConfig.value;
    if (c.query_mode === "custom_sql") {
      return c.custom_sql || "-- Enter your SQL in Detection Config step";
    }
    const stream = c.stream_name || "<stream>";
    const interval = anomalyHistogramInterval.value || "5m";
    const fn =
      c.detection_function === "count"
        ? "count(*)"
        : `${c.detection_function}(${c.detection_function_field || "<field>"})`;
    const filterLines = (c.filters || [])
      .filter(
        (f: any) =>
          f.field && (operatorNeedsValue(f.operator) ? f.value : true),
      )
      .map(
        (f: any) =>
          `  AND ${buildAnomalyFilterExpression(f.field, f.operator, f.value)}`,
      );
    const where = filterLines.length
      ? [
          "WHERE",
          ...filterLines.map((l: string, i: number) =>
            i === 0 ? l.replace(/^\s+AND /, "  ") : l,
          ),
        ].join("\n")
      : "";
    const autoSeasonality = c.training_window_days >= 7 ? "week" : "day";
    const seasonalSelect =
      autoSeasonality === "week"
        ? ",\n       date_part('hour', to_timestamp(_timestamp / 1000000)) AS hour,\n       date_part('dow', to_timestamp(_timestamp / 1000000)) AS dow"
        : ",\n       date_part('hour', to_timestamp(_timestamp / 1000000)) AS hour";
    const seasonalGroup =
      autoSeasonality === "week" ? ", hour, dow" : ", hour";
    return [
      `SELECT histogram(_timestamp, '${interval}') AS time_bucket,`,
      `       ${fn} AS value${seasonalSelect}`,
      `FROM ${stream}`,
      where,
      `GROUP BY time_bucket${seasonalGroup}`,
      `ORDER BY time_bucket`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const anomalySummarySectionStyle = computed(() => {
    if (!showAnomalySummary.value) return { flex: "0 0 auto" };
    return { flex: "1", minHeight: "150px" };
  });

  // ── Expand / UI State ───────────────────────────────────────────────────

  const expandState = ref({
    alertSetup: true,
    queryMode: true,
    advancedSetup: true,
    realTimeMode: true,
    thresholds: true,
    multiWindowSelection: false,
  });

  const triggerOperators: any = ref([
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
    { label: "String", value: "String" },
    { label: "JSON", value: "Json" },
  ];

  const focusManager = new AlertFocusManager();
  const streamFieldRef = ref(null);
  const streamTypeFieldRef = ref(null);

  const previewQuery = ref("");
  const isUsingBackendSql = ref(false);
  const sqlQueryErrorMsg = ref("");
  const validateSqlQueryPromise = ref<Promise<unknown>>();
  const addAlertFormRef = ref(null);
  const viewSqlEditorDialog = ref(false);
  const plotChart: any = ref(null);
  const previewAlertRef: any = ref(null);
  let parser: any = null;
  const vrlFunctionError = ref("");
  const showTimezoneWarning = ref(false);
  const showJsonEditorDialog = ref(false);
  const validationErrors = ref([]);
  const isLoadingPanelData = ref(false);

  const activeFolderId = ref(
    router.currentRoute.value.query.folder || "default",
  );
  const alertType = ref(
    router.currentRoute.value.query.alert_type || "all",
  );

  // ── Wizard State (kept for anomaly flow) ────────────────────────────────

  const wizardStep = ref(1);
  const wizardStepper = ref(null);
  const step1Ref = ref(null);
  const step2Ref = ref(null);
  const step3Ref = ref(null);
  const step4Ref = ref(null);
  const lastValidStep = ref(1);

  // Topbar field refs + error states for stream type / stream name
  const streamTypeRef = ref<any>(null);
  const streamNameRef = ref<any>(null);
  const anomalyNameRef = ref<any>(null);
  const alertNameError = ref(false);
  const streamTypeError = ref(false);
  const streamNameError = ref(false);

  // ── V3 Tab State (for standard alerts) ──────────────────────────────────

  const activeTab = ref("condition");
  const tabErrors = ref<Record<string, boolean>>({
    condition: false,
    rules: false,
    compare: false,
    dedup: false,
    advanced: false,
  });
  const chartCollapsed = ref(false);

  // Preview DateTimePicker value — controls the time range for preview data
  const previewDateTimeValue = ref({
    tab: "relative",
    relative: {
      period: { label: "Minutes", value: "Minutes" },
      value: 15,
    },
    absolute: {
      date: {
        from: new Date().toLocaleDateString("en-ZA"),
        to: new Date().toLocaleDateString("en-ZA"),
      },
      startTime: "00:00",
      endTime: "23:59",
    },
  });

  // ── Computed Properties ─────────────────────────────────────────────────

  const editorData = ref("");
  const prefixCode = ref("");
  const suffixCode = ref("");

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
    return formData.value.row_template_type === "Json"
      ? 'e.g - {"user": "{name}", "timestamp": "{timestamp}"}'
      : "e.g - Alert was triggered at {timestamp}";
  });

  const decodedVrlFunction = computed(() => {
    if (!formData.value.query_condition.vrl_function) {
      return "";
    }
    return formData.value.query_condition.vrl_function;
  });

  const getSelectedTab = computed(() => {
    return formData.value.query_condition.type || null;
  });

  const currentStepCaption = computed(() => {
    const captions: Record<number, string> = {
      1: t("alerts.stepCaptions.alertSetup"),
      2: t("alerts.stepCaptions.conditions"),
      3: t("alerts.stepCaptions.compareWithPast"),
      4: t("alerts.stepCaptions.alertSettings"),
      5: t("alerts.stepCaptions.deduplication"),
      6: t("alerts.stepCaptions.advanced"),
    };
    return captions[wizardStep.value] || "";
  });

  const isLastStep = computed(() => {
    if (formData.value.is_real_time === "anomaly") {
      return wizardStep.value === 3;
    }
    return wizardStep.value === 6;
  });

  const canSaveAlert = computed(() => {
    if (formData.value.is_real_time === "anomaly") {
      if (!anomalyConfig.value.name?.trim()) {
        return false;
      }
      if (
        anomalyConfig.value.alert_enabled &&
        anomalyConfig.value.alert_destination_ids.length === 0
      ) {
        return false;
      }
      return true;
    }
    // For V3 layout, always allow save (validation happens on save)
    return true;
  });

  const getFormattedDestinations = computed(() => {
    return props.destinations.map((destination: any) => {
      return destination.name;
    });
  });

  // Threshold mark line for chart
  const thresholdMarkLine = computed(() => {
    if (!formData.value.trigger_condition?.threshold) return null;
    return {
      data: [
        {
          yAxis: formData.value.trigger_condition.threshold,
          label: { formatter: "Threshold" },
        },
      ],
      lineStyle: { color: "#ff4444", type: "dashed", width: 2 },
      symbol: "none",
    };
  });

  // ── Parser ──────────────────────────────────────────────────────────────

  const importSqlParser = async () => {
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    parser = await sqlParser();
  };

  const getParser = (sqlQuery: string) => {
    const sqlUtilsContext: SqlUtilsContext = {
      parser,
      sqlQueryErrorMsg,
    };
    return getParserUtil(sqlQuery, sqlUtilsContext);
  };

  // ── Stream Methods ──────────────────────────────────────────────────────

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

    const streamsData: any = await getStream(
      stream_name,
      formData.value.stream_type,
      true,
    );

    if (streamsData && Array.isArray(streamsData.schema)) {
      streamCols = streamsData.schema.map((column: any) => ({
        label: column.name,
        value: column.name,
        type: column.type,
      }));
    }

    if (
      streamsData?.settings?.defined_schema_fields &&
      Array.isArray(streamsData.settings.defined_schema_fields) &&
      streamsData.settings.defined_schema_fields.length > 0
    ) {
      const definedFields = streamsData.settings.defined_schema_fields;
      const timestampColumn =
        store.state.zoConfig?.timestamp_column || "_timestamp";
      const allFieldsName = store.state.zoConfig?.all_fields_name;

      streamCols = streamCols.filter((col: any) => {
        if (col.value === timestampColumn || col.value === allFieldsName) {
          return true;
        }
        return definedFields.includes(col.value);
      });
    }

    originalStreamFields.value = [...streamCols];
    filteredColumns.value = [...streamCols];

    onInputUpdate("stream_name", stream_name);
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
      .then(async (res: any) => {
        streams.value[formData.value.stream_type] = res.list;
        schemaList.value = res.list;
        indexOptions.value = res.list.map((data: any) => {
          return data.name;
        });

        if (formData.value.stream_name)
          await updateStreamFields(formData.value.stream_name);
        return Promise.resolve();
      })
      .catch(() => Promise.reject())
      .finally(() => (isFetchingStreams.value = false));
  };

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

  const filterStreams = (val: string, update: any) => {
    filteredStreams.value = filterColumns(indexOptions.value, val, update);
  };

  // ── SQL Generation ──────────────────────────────────────────────────────

  const generateSqlQueryLocal = () => {
    return generateSqlQuery(
      formData.value,
      streamFieldsMap.value,
      isAggregationEnabled.value,
      store.state.zoConfig.timestamp_column || "_timestamp",
    );
  };

  const generatedSqlQuery = ref("");

  const allConditionsValid = (conditions: any): boolean => {
    if (!conditions || typeof conditions !== "object") {
      return false;
    }
    if (conditions.filterType === "condition") {
      return !!(
        conditions.column &&
        conditions.value !== undefined &&
        conditions.value !== ""
      );
    }
    if (
      conditions.filterType === "group" &&
      Array.isArray(conditions.conditions)
    ) {
      return conditions.conditions.every((cond: any) =>
        allConditionsValid(cond),
      );
    }
    return false;
  };

  const isAggregationValid = (): boolean => {
    if (!isAggregationEnabled.value) {
      return true;
    }
    const aggregation = formData.value.query_condition.aggregation;
    if (!aggregation) {
      return false;
    }
    if (aggregation.having) {
      const { column, operator, value } = aggregation.having;
      return !!(column && operator && value !== undefined && value !== "");
    }
    return true;
  };

  // Generation counter to discard stale async responses when the user switches
  // tabs (e.g. builder → SQL) before the API call completes.
  const generateRequestId = ref(0);

  const generateSqlFromBackend = async () => {
    const requestId = ++generateRequestId.value;

    try {
      // If no stream name or not custom mode, nothing to do
      if (!formData.value.stream_name) {
        return;
      }
      if (formData.value.query_condition.type !== "custom") {
        return;
      }

      const hasConditions =
        formData.value.query_condition?.conditions &&
        Object.keys(formData.value.query_condition.conditions).length > 0;
      const conditionsValid =
        hasConditions &&
        allConditionsValid(formData.value.query_condition.conditions);
      const aggregationValid = isAggregationValid();

      // If conditions are incomplete/missing, fall back to local SQL so the
      // preview chart still loads with raw stream data (no WHERE clause).
      if (!conditionsValid || !aggregationValid) {
        const localSql = generateSqlQueryLocal();
        generatedSqlQuery.value = localSql;
        previewQuery.value = localSql;
        isUsingBackendSql.value = false;
        await nextTick();
        previewAlertRef.value?.refreshData();
        return;
      }

      const payload: any = {
        stream_name: formData.value.stream_name,
        stream_type: formData.value.stream_type || "logs",
        query_condition: {
          type: "custom",
          conditions: {
            version: 2,
            conditions: formData.value.query_condition.conditions,
          },
        },
      };

      if (
        isAggregationEnabled.value &&
        formData.value.query_condition.aggregation
      ) {
        const groupBy =
          formData.value.query_condition.aggregation.group_by || [];
        const filteredGroupBy = groupBy.filter(
          (field: string) => field && field.trim() !== "",
        );
        payload.query_condition.aggregation = {
          ...formData.value.query_condition.aggregation,
          group_by: filteredGroupBy,
        };
      }

      const response = await alertsService.generate_sql(
        store.state.selectedOrganization.identifier,
        payload,
      );

      // Discard if a newer request was started (e.g. user changed tabs or
      // conditions before this response arrived).
      if (requestId !== generateRequestId.value) return;

      if (response.data && response.data.sql) {
        generatedSqlQuery.value = response.data.sql;
        previewQuery.value = response.data.sql;
        isUsingBackendSql.value = true;
        await nextTick();
        previewAlertRef.value?.refreshData();
      }
    } catch (error) {
      // Discard stale error fallback if a newer request has started.
      if (requestId !== generateRequestId.value) return;

      console.error("Error generating SQL from backend:", error);
      const localSql = generateSqlQueryLocal();
      generatedSqlQuery.value = localSql;
      previewQuery.value = localSql;
      isUsingBackendSql.value = false;
      await nextTick();
      previewAlertRef.value?.refreshData();
    }
  };

  const debouncedGenerateSql = debounce(generateSqlFromBackend, 1000);

  const previewAlert = async () => {
    if (getSelectedTab.value === "custom") {
      previewQuery.value = generateSqlQueryLocal();
    } else if (getSelectedTab.value === "sql")
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

  const debouncedPreviewAlert = debounce(previewAlert, 500);

  const onInputUpdate = async (name: string, value: any) => {
    if (formData.value.query_condition.type === "custom") {
      debouncedGenerateSql();
    } else if (showPreview.value) {
      debouncedPreviewAlert();
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────

  const getAlertPayload = () => {
    const payloadContext: PayloadContext = {
      store,
      isAggregationEnabled,
      getSelectedTab,
      beingUpdated: beingUpdated.value,
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

  const validateConditionsAgainstUDS = () => {
    if (
      !formData.value.stream_name ||
      !formData.value.stream_type ||
      !originalStreamFields.value ||
      originalStreamFields.value.length === 0
    ) {
      return { isValid: true, invalidFields: [] };
    }

    const isRealTime =
      formData.value.is_real_time === "true" ||
      formData.value.is_real_time === true;
    const queryType = formData.value.query_condition?.type;

    if (!isRealTime && (queryType === "sql" || queryType === "promql")) {
      return { isValid: true, invalidFields: [] };
    }

    const allowedFieldNames = new Set(
      originalStreamFields.value.map((field: any) => field.value),
    );

    const invalidFields: string[] = [];

    const checkConditionFields = (condition: any) => {
      if (!condition) return;

      if (
        condition.filterType === "group" &&
        condition.conditions &&
        Array.isArray(condition.conditions)
      ) {
        condition.conditions.forEach((item: any) => {
          checkConditionFields(item);
        });
      } else if (condition.items && Array.isArray(condition.items)) {
        condition.items.forEach((item: any) => {
          checkConditionFields(item);
        });
      } else if (condition.column) {
        if (
          condition.column &&
          condition.column !== "" &&
          !allowedFieldNames.has(condition.column)
        ) {
          if (!invalidFields.includes(condition.column)) {
            invalidFields.push(condition.column);
          }
        }
      }
    };

    if (isRealTime) {
      if (formData.value.query_condition?.conditions) {
        checkConditionFields(formData.value.query_condition.conditions);
      }
    } else {
      if (
        formData.value.query_condition?.conditions &&
        queryType === "custom"
      ) {
        checkConditionFields(formData.value.query_condition.conditions);
      }

      if (
        isAggregationEnabled.value &&
        queryType === "custom" &&
        formData.value.query_condition?.aggregation?.having?.column
      ) {
        const havingColumn =
          formData.value.query_condition.aggregation.having.column;
        if (
          havingColumn &&
          havingColumn !== "" &&
          !allowedFieldNames.has(havingColumn)
        ) {
          if (!invalidFields.includes(havingColumn)) {
            invalidFields.push(havingColumn);
          }
        }
      }

      if (
        isAggregationEnabled.value &&
        queryType === "custom" &&
        formData.value.query_condition?.aggregation?.group_by &&
        Array.isArray(formData.value.query_condition.aggregation.group_by)
      ) {
        formData.value.query_condition.aggregation.group_by.forEach(
          (field: string) => {
            if (field && field !== "" && !allowedFieldNames.has(field)) {
              if (!invalidFields.includes(field)) {
                invalidFields.push(field);
              }
            }
          },
        );
      }
    }

    return {
      isValid: invalidFields.length === 0,
      invalidFields,
    };
  };

  // Validate a specific step (used by wizard navigation and save)
  const validateStep = async (stepNumber: number) => {
    if (stepNumber === 1) {
      if (step1Ref.value && (step1Ref.value as any).validate) {
        const isValid = await (step1Ref.value as any).validate();
        if (!isValid) {
          focusOnFirstError();
          return false;
        }
      }
    }

    if (stepNumber === 2) {
      if (step2Ref.value && (step2Ref.value as any).validate) {
        const validationResult = (step2Ref.value as any).validate();
        const isValid =
          validationResult instanceof Promise
            ? await validationResult
            : validationResult;

        if (!isValid) {
          const queryType = formData.value.query_condition.type || "custom";
          if (queryType === "sql") {
            let errorMsg = "";
            if (sqlQueryErrorMsg.value) {
              errorMsg = `SQL validation error: ${sqlQueryErrorMsg.value}`;
            } else {
              errorMsg = "Please provide a valid SQL query.";
            }
            q.notify({
              type: "negative",
              message: errorMsg,
              timeout: 2000,
            });
          }
          return false;
        }
      }
    }

    if (stepNumber === 4) {
      if (step4Ref.value && (step4Ref.value as any).validate) {
        const validationResult = (step4Ref.value as any).validate();
        const result =
          validationResult instanceof Promise
            ? await validationResult
            : validationResult;

        const isValid = typeof result === "boolean" ? result : result.valid;
        const errorMessage =
          typeof result === "object" ? result.message : null;

        if (!isValid) {
          if (errorMessage) {
            q.notify({
              type: "negative",
              message: errorMessage,
              timeout: 1500,
            });
          }
          return false;
        }
      }
    }

    return true;
  };

  const validateCurrentStep = async () => {
    return await validateStep(wizardStep.value);
  };

  const focusOnFirstError = () => {
    nextTick(() => {
      const errorField = document.querySelector(
        ".q-field--error input, .q-field--error .q-select__dropdown-icon",
      );
      if (errorField) {
        (errorField as HTMLElement).focus();
        errorField.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  };

  // Focus a topbar q-select/q-input by its Vue component ref
  const focusTopbarField = (fieldRef: any) => {
    nextTick(() => {
      const el = fieldRef?.value?.$el as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = el.querySelector("input") as HTMLElement | null;
        input?.focus();
      }
    });
  };

  // Sequential top-to-bottom validation with auto-focus for V3 layout
  const validateAndFocus = async (): Promise<boolean> => {
    // 1. Alert name
    if (!formData.value.name?.trim()) {
      alertNameError.value = true;
      q.notify({ type: "negative", message: "Alert name is required.", timeout: 2000 });
      focusTopbarField(step1Ref);
      return false;
    }
    alertNameError.value = false;

    // 2. Stream Type
    if (!formData.value.stream_type) {
      streamTypeError.value = true;
      q.notify({ type: "negative", message: "Stream type is required.", timeout: 2000 });
      focusTopbarField(streamTypeRef);
      return false;
    }
    streamTypeError.value = false;

    // 3. Stream Name
    if (!formData.value.stream_name) {
      streamNameError.value = true;
      q.notify({ type: "negative", message: "Stream name is required.", timeout: 2000 });
      focusTopbarField(streamNameRef);
      return false;
    }
    streamNameError.value = false;

    // 4. Query + Conditions (QueryConfig validates SQL/PromQL content + custom conditions)
    if (step2Ref.value && (step2Ref.value as any).validate) {
      activeTab.value = "condition";
      await nextTick();
      const isValid = await (step2Ref.value as any).validate();
      if (!isValid) {
        // QueryConfig.validate() focuses its own editor/fields on failure
        return false;
      }
    }

    // 5. Alert Settings (trigger conditions, destinations)
    if (step4Ref.value && (step4Ref.value as any).validate) {
      const result = await (step4Ref.value as any).validate();
      const isValid = typeof result === "boolean" ? result : result?.valid;
      const message = typeof result === "object" ? result?.message : null;
      const shouldFocusDestination = typeof result === "object" ? result?.focusDestination : false;
      if (!isValid) {
        activeTab.value = "condition";
        await nextTick();
        if (message) q.notify({ type: "negative", message, timeout: 2000 });
        if (shouldFocusDestination && (step4Ref.value as any).focusDestination) {
          (step4Ref.value as any).focusDestination();
        } else {
          focusOnFirstError();
        }
        return false;
      }
    }

    return true;
  };

  // Validate all tabs for V3 layout save
  const validateAllTabs = async (): Promise<{
    valid: boolean;
    firstErrorTab: string | null;
  }> => {
    // Reset tab errors
    tabErrors.value = {
      condition: false,
      rules: false,
      compare: false,
      dedup: false,
      advanced: false,
    };

    // Validate top bar (name, stream)
    if (step1Ref.value && (step1Ref.value as any).validate) {
      const isValid = await (step1Ref.value as any).validate();
      if (!isValid) {
        return { valid: false, firstErrorTab: null }; // Error is in top bar, not a tab
      }
    }

    // Validate condition tab
    const condValid = await validateStep(2);
    if (!condValid) {
      tabErrors.value.condition = true;
      return { valid: false, firstErrorTab: "condition" };
    }

    // Validate alert settings (now part of condition tab)
    const rulesValid = await validateStep(4);
    if (!rulesValid) {
      tabErrors.value.condition = true;
      return { valid: false, firstErrorTab: "condition" };
    }

    return { valid: true, firstErrorTab: null };
  };

  // ── Condition Transforms ────────────────────────────────────────────────

  const updateGroup = (updatedGroup: any) => {
    const transformContext: TransformContext = { formData: formData.value };
    updateGroupUtil(updatedGroup, transformContext);
  };

  const removeConditionGroup = (
    targetGroupId: string,
    currentGroup?: any,
  ) => {
    const transformContext: TransformContext = { formData: formData.value };
    removeConditionGroupUtil(targetGroupId, currentGroup, transformContext);
  };

  const transformFEToBE = (node: any) => {
    return transformFEToBEUtil(node);
  };

  const retransformBEToFE = (data: any) => {
    return retransformBEToFEUtil(data);
  };

  // ── UI Update Methods ───────────────────────────────────────────────────

  const updateActiveFolderId = (folderId: any) => {
    activeFolderId.value = folderId.value;
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

  const updateFunctionVisibility = () => {
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
  };

  const updateExpandState = (value: any) => {
    expandState.value = value;
  };

  const refreshDestinations = () => {
    emit("refresh:destinations");
  };

  const refreshTemplates = () => {
    emit("refresh:templates");
  };

  const updateDestinations = (destinations: any[]) => {
    formData.value.destinations = destinations;
  };

  const updateTab = (tab: string) => {
    formData.value.query_condition.type = tab;
  };

  const handleGoToSqlEditor = () => {
    formData.value.query_condition.type = "sql";
    if (isAnomalyMode.value) {
      activeTab.value = "anomaly-config";
    } else {
      activeTab.value = "condition";
    }
  };

  const clearMultiWindows = () => {
    formData.value.query_condition.multi_time_range = [];
  };

  const handleEditorStateChanged = (isOpen: boolean) => {
    isEditorOpen.value = isOpen;
  };

  const handleEditorClosed = () => {
    if (
      previewAlertRef.value &&
      typeof previewAlertRef.value.refreshData === "function"
    ) {
      previewAlertRef.value.refreshData();
    }
  };

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

  const openEditorDialog = () => {
    viewSqlEditorDialog.value = true;
  };

  const openJsonEditor = () => {
    showJsonEditorDialog.value = true;
  };

  const editorUpdate = (e: any) => {
    formData.value.sql = e.target.value;
  };

  // ── Error Handling ──────────────────────────────────────────────────────

  const HTTP_FORBIDDEN = 403;
  const handleAlertError = (err: any) => {
    if (err.response?.status !== HTTP_FORBIDDEN) {
      q.notify({
        type: "negative",
        message:
          err.response?.data?.message ||
          err.response?.data?.error ||
          err.response?.data,
      });
    }
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
  };

  const navigateToErrorField = (formRef: any) => {
    const errorField = formRef.$el.querySelector(".q-field--error");
    if (errorField) {
      errorField.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // ── JSON Editor Save ────────────────────────────────────────────────────

  const saveAlertJson = async (json: any) => {
    const saveContext: SaveAlertContext = {
      q,
      store,
      props,
      emit,
      router,
      isAggregationEnabled,
      activeFolderId: {
        value: Array.isArray(activeFolderId.value)
          ? activeFolderId.value[0]
          : activeFolderId.value,
      },
      handleAlertError,
    };

    const prepareAndSaveAlertFunction = (data: any) =>
      prepareAndSaveAlertUtil(data, saveContext);

    const jsonValidationContext: JsonValidationContext = {
      q,
      store,
      streams,
      getStreams,
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

  // ── Panel Data Import ───────────────────────────────────────────────────

  const loadPanelDataIfPresent = async () => {
    const route = router.currentRoute.value;

    if (route.query.fromPanel === "true" && route.query.panelData) {
      isLoadingPanelData.value = true;
      try {
        const panelData = JSON.parse(
          decodeURIComponent(route.query.panelData as string),
        );

        if (panelData.queries && panelData.queries.length > 0) {
          const query = panelData.queries[0];

          const sanitizePanelTitle = (title: string | undefined): string => {
            if (!title || title.trim() === "") {
              return "panel";
            }
            let sanitized = title.replace(/[:#?&%'"\s]+/g, "_");
            sanitized = sanitized.replace(/_+/g, "_");
            sanitized = sanitized.replace(/^_+|_+$/g, "");
            if (sanitized === "") {
              return "panel";
            }
            const maxLength = 200;
            if (sanitized.length > maxLength) {
              sanitized = sanitized.substring(0, maxLength);
              sanitized = sanitized.replace(/_+$/, "");
            }
            return sanitized;
          };

          formData.value.name = `Alert_from_${sanitizePanelTitle(panelData.panelTitle)}`;

          q.notify({
            type: "positive",
            message: t("alerts.importedFromPanel", {
              panelTitle: panelData.panelTitle,
            }),
            timeout: 3000,
          });

          if (query.fields?.stream_type) {
            formData.value.stream_type = query.fields.stream_type;
          }

          if (query.fields?.stream) {
            formData.value.stream_name = query.fields.stream;
            await updateStreams(false);
          }

          if (panelData.queryType === "sql") {
            formData.value.query_condition.type = "sql";
            const sourceQuery = panelData.executedQuery || query.query;
            if (sourceQuery) {
              let sqlQuery = sourceQuery;

              if (
                panelData.threshold !== undefined &&
                panelData.condition &&
                panelData.yAxisColumn
              ) {
                const threshold = panelData.threshold;
                const operator =
                  panelData.condition === "above" ? ">=" : "<=";
                const yAxisColumn = panelData.yAxisColumn;

                if (!parser) {
                  await importSqlParser();
                }
                sqlQuery = addHavingClauseToQuery(
                  sqlQuery,
                  yAxisColumn,
                  operator,
                  threshold,
                  parser,
                );
              }

              formData.value.query_condition.sql = sqlQuery;
            }
          } else if (panelData.queryType === "promql") {
            formData.value.query_condition.type = "promql";
            const sourceQuery = panelData.executedQuery || query.query;
            if (sourceQuery) {
              formData.value.query_condition.promql = sourceQuery;
            }
          } else {
            formData.value.query_condition.type = "sql";
          }

          if (
            panelData.queryType === "sql" &&
            query.customQuery === false &&
            query.fields
          ) {
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
              formData.value.query_condition.aggregation.group_by =
                query.fields.x.map((x: any) => x.alias || x.column);
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
                formData.value.query_condition.aggregation.function =
                  yField.aggregationFunction.toLowerCase();
                formData.value.query_condition.aggregation.having.column =
                  yField.alias || yField.column;
              }
            }

            if (query.fields.filter && query.fields.filter.length > 0) {
              const conditions: any[] = [];
              query.fields.filter.forEach((filter: any) => {
                if (
                  filter.type === "list" &&
                  filter.values &&
                  filter.values.length > 0
                ) {
                  conditions.push({
                    filterType: "condition",
                    column: filter.column,
                    operator: "=",
                    value: filter.values[0],
                    values: [],
                    logicalOperator: "AND",
                    id: getUUID(),
                  });
                }
              });

              if (conditions.length > 0) {
                formData.value.query_condition.conditions = {
                  filterType: "group",
                  logicalOperator: "AND",
                  groupId: getUUID(),
                  conditions: conditions,
                };
              }
            }
          }

          if (query.vrlFunctionQuery) {
            showVrlFunction.value = true;
            formData.value.query_condition.vrl_function =
              query.vrlFunctionQuery;
          }

          if (panelData.timeRange?.value_type === "relative") {
            const relativeValue = panelData.timeRange.relative_value || 15;
            const relativePeriodVal =
              panelData.timeRange.relative_period || "Minutes";

            let periodInMinutes = relativeValue;
            if (relativePeriodVal === "Hours") {
              periodInMinutes = relativeValue * 60;
            } else if (relativePeriodVal === "Days") {
              periodInMinutes = relativeValue * 60 * 24;
            } else if (relativePeriodVal === "Weeks") {
              periodInMinutes = relativeValue * 60 * 24 * 7;
            }

            formData.value.trigger_condition.period = periodInMinutes;
          }

          if (panelData.threshold !== undefined && panelData.condition) {
            if (panelData.queryType === "promql") {
              if (!formData.value.query_condition.promql_condition) {
                formData.value.query_condition.promql_condition = {
                  column: "value",
                  operator: ">=",
                  value: 1,
                };
              }
              formData.value.query_condition.promql_condition.value =
                panelData.threshold;
              formData.value.query_condition.promql_condition.operator =
                panelData.condition === "above" ? ">=" : "<=";
            } else {
              if (
                isAggregationEnabled.value &&
                formData.value.query_condition.aggregation
              ) {
                if (!formData.value.query_condition.aggregation.having) {
                  formData.value.query_condition.aggregation.having = {
                    column: "",
                    operator: ">=",
                    value: 1,
                  };
                }
                formData.value.query_condition.aggregation.having.value =
                  panelData.threshold;
                formData.value.query_condition.aggregation.having.operator =
                  panelData.condition === "above" ? ">=" : "<=";
              }
            }

            formData.value.trigger_condition.threshold = 1;
            formData.value.trigger_condition.operator = ">=";
          }
        }

        await nextTick();
        if (previewAlertRef.value?.refreshData) {
          previewAlertRef.value.refreshData();
        }
      } catch (error) {
        console.error("Error loading panel data:", error);
        q.notify({
          type: "negative",
          message: "Failed to load panel data",
          timeout: 2000,
        });
      } finally {
        isLoadingPanelData.value = false;
      }
    }
  };

  // ── Wizard Navigation (kept for anomaly) ────────────────────────────────

  const goToStep2 = async () => {
    if (step1Ref.value && typeof (step1Ref.value as any).validate === "function") {
      const isValid = await (step1Ref.value as any).validate();
      if (isValid) {
        wizardStep.value = 2;
      }
    } else {
      wizardStep.value = 2;
    }
  };

  const goToNextStep = async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) {
      return;
    }

    if (formData.value.is_real_time === "anomaly") {
      if (wizardStep.value === 2 && anomalyStep2Ref.value) {
        const valid = await anomalyStep2Ref.value.validate();
        if (!valid) return;
      }
      if (wizardStep.value < 3) {
        wizardStep.value = wizardStep.value + 1;
        if (wizardStep.value > lastValidStep.value) {
          lastValidStep.value = wizardStep.value;
        }
      }
      return;
    }

    if (formData.value.is_real_time === "true") {
      if (wizardStep.value === 2) {
        wizardStep.value = 4;
      } else if (wizardStep.value === 4) {
        wizardStep.value = 6;
      } else {
        wizardStep.value = wizardStep.value + 1;
      }
    } else {
      wizardStep.value = wizardStep.value + 1;
    }

    if (wizardStep.value > lastValidStep.value) {
      lastValidStep.value = wizardStep.value;
    }
  };

  const goToPreviousStep = () => {
    if (formData.value.is_real_time === "anomaly") {
      if (wizardStep.value > 1) wizardStep.value = wizardStep.value - 1;
      return;
    }
    if (formData.value.is_real_time === "true") {
      if (wizardStep.value === 6) {
        wizardStep.value = 4;
      } else if (wizardStep.value === 4) {
        wizardStep.value = 2;
      } else {
        wizardStep.value = wizardStep.value - 1;
      }
    } else {
      wizardStep.value = wizardStep.value - 1;
    }
  };

  // ── Save Methods ────────────────────────────────────────────────────────

  const saveAnomalyDetection = async () => {
    if (!anomalyConfig.value.name?.trim()) {
      q.notify({
        type: "negative",
        message: "Anomaly name is required.",
        timeout: 2000,
      });
      return;
    }

    if (anomalyStep2Ref.value) {
      const step2Valid = await anomalyStep2Ref.value.validate();
      if (!step2Valid) {
        wizardStep.value = 2;
        return;
      }
    }

    if (
      anomalyConfig.value.alert_enabled &&
      anomalyConfig.value.alert_destination_ids.length === 0
    ) {
      wizardStep.value = 3;
      return;
    }

    anomalySaving.value = true;
    const orgId = store.state.selectedOrganization.identifier;
    const c = anomalyConfig.value;

    if (c.query_mode === "custom_sql") {
      if (!c.custom_sql?.trim()) {
        q.notify({
          type: "negative",
          message: "Custom SQL is required in custom SQL mode.",
        });
        wizardStep.value = 2;
        anomalySaving.value = false;
        return;
      }
      try {
        await searchService.search({
          org_identifier: orgId,
          query: {
            query: {
              sql: c.custom_sql,
              start_time: (Date.now() - 3600000) * 1000,
              end_time: Date.now() * 1000,
              from: 0,
              size: 1,
            },
          },
          page_type: c.stream_type,
        });
      } catch (sqlErr: any) {
        const msg =
          sqlErr?.response?.data?.message || "Invalid SQL query";
        q.notify({
          type: "negative",
          message: `SQL validation error: ${msg}`,
        });
        wizardStep.value = 2;
        anomalySaving.value = false;
        return;
      }
    }

    try {
      const payload: any = {
        alert_type: "anomaly_detection",
        name: c.name,
        description: c.description || undefined,
        stream_name: c.stream_name,
        stream_type: c.stream_type,
        enabled: c.enabled ?? true,
        folder_id: (activeFolderId.value as string) || "default",
        alert_destinations:
          c.alert_enabled && c.alert_destination_ids?.length
            ? c.alert_destination_ids
            : [],
        anomaly_config: {
          query_mode: c.query_mode,
          filters: c.query_mode === "filters" ? (c.filters ?? []) : null,
          custom_sql: c.query_mode === "custom_sql" ? c.custom_sql : null,
          detection_function: c.detection_function || "count(*)",
          detection_function_field:
            c.query_mode === "filters" && c.detection_function !== "count"
              ? c.detection_function_field || undefined
              : undefined,
          histogram_interval: anomalyHistogramInterval.value,
          schedule_interval: anomalyScheduleInterval.value,
          detection_window_seconds: anomalyDetectionWindowSeconds.value,
          training_window_days: c.training_window_days,
          retrain_interval_days: c.retrain_interval_days,
          threshold: c.threshold,
          alert_enabled: c.alert_enabled,
        },
      };

      const routeAnomalyId = router.currentRoute.value.params
        .anomaly_id as string | undefined;
      if (routeAnomalyId) {
        await anomalyDetectionService.update(orgId, routeAnomalyId, payload);
        q.notify({
          type: "positive",
          message: "Anomaly detection config updated.",
        });
      } else {
        await anomalyDetectionService.create(orgId, payload);
        q.notify({
          type: "positive",
          message:
            t("alerts.anomalyCreated") ||
            "Anomaly detection config created. Training will start shortly.",
        });
      }

      emit("update:list", (activeFolderId.value as string) || "default");
    } catch (err: any) {
      q.notify({
        type: "negative",
        message:
          err?.response?.data?.message || "Failed to save anomaly config.",
      });
    } finally {
      anomalySaving.value = false;
    }
  };

  const handleSave = () => {
    if (formData.value.is_real_time === "anomaly") {
      saveAnomalyDetection();
    } else {
      onSubmit();
    }
  };

  let callAlert: Promise<{ data: any }>;

  const onSubmit = async () => {
    // Delaying submission by 500ms to allow the form to validate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // FINAL VALIDATION CHECKPOINT
    // For V3 layout, validate sequentially with auto-focus
    if (!isAnomalyMode.value) {
      const valid = await validateAndFocus();
      if (!valid) return false;
    } else {
      // Anomaly wizard validation — validate name from topbar ref
      if (!anomalyConfig.value.name?.trim()) {
        q.notify({
          type: "negative",
          message: "Anomaly detection name is required.",
          timeout: 2000,
        });
        focusTopbarField(anomalyNameRef);
        return false;
      }
    }

    if (
      formData.value.is_real_time == "false" &&
      formData.value.query_condition.type == "sql" &&
      !getParser(formData.value.query_condition.sql)
    ) {
      activeTab.value = "condition";
      q.notify({
        type: "negative",
        message: "Selecting all Columns in SQL query is not allowed.",
        timeout: 1500,
      });
      return false;
    }

    if (
      formData.value.is_real_time == "false" &&
      formData.value.trigger_condition.frequency_type == "cron"
    ) {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = now.getFullYear();
      const date = `${day}-${month}-${year}`;
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const time = `${hours}:${minutes}`;

      const convertedDateTime = convertDateToTimestamp(
        date,
        time,
        formData.value.trigger_condition.timezone,
      );
      formData.value.tz_offset = convertedDateTime.offset;
    }

    // Validate UDS
    const udsValidation = validateConditionsAgainstUDS();
    if (!udsValidation.isValid) {
      const invalidCount = udsValidation.invalidFields.length;
      let message = "";

      if (invalidCount === 1) {
        message = `Field "${udsValidation.invalidFields[0]}" is not available. Please use only the available fields in your conditions.`;
      } else if (invalidCount <= 3) {
        message = `Fields ${udsValidation.invalidFields.map((f: string) => `"${f}"`).join(", ")} are not available. Please use only the available fields in your conditions.`;
      } else {
        const firstThree = udsValidation.invalidFields
          .slice(0, 3)
          .map((f: string) => `"${f}"`)
          .join(", ");
        const remaining = invalidCount - 3;
        message = `${invalidCount} fields are not available (${firstThree} and ${remaining} more). Please use only the available fields in your conditions.`;
      }

      q.notify({
        type: "negative",
        message: message,
        timeout: 6000,
      });

      activeTab.value = "condition";
      return false;
    }

    const payload = getAlertPayload();

    const dismiss = q.notify({
      spinner: true,
      message: "Please wait...",
      timeout: 2000,
    });

    if (
      formData.value.is_real_time == "false" &&
      formData.value.query_condition.type == "sql"
    ) {
      try {
        await validateSqlQueryPromise.value;
      } catch (error) {
        dismiss();
        q.notify({
          type: "negative",
          message:
            "Error while validating sql query. Please check the query and try again.",
          timeout: 1500,
        });
        console.error("Error while validating sql query", error);
        return false;
      }
    }

    // VERSION HANDLING - wrap conditions with version field for backend
    payload.query_condition.conditions = {
      version: 2,
      conditions: formData.value.query_condition.conditions,
    };

    if (beingUpdated.value) {
      payload.folder_id =
        router.currentRoute.value.query.folder || "default";
      callAlert = alertsService.update_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );
      callAlert
        .then((res: { data: any }) => {
          formData.value = { ...defaultAlertValue() };
          emit("update:list", activeFolderId.value);
          addAlertForm.value?.resetValidation();
          dismiss();
          q.notify({
            type: "positive",
            message: `Alert updated successfully.`,
          });
        })
        .catch((err: any) => {
          dismiss();
          handleAlertError(err);
        });
      track("Button Click", {
        button: "Update Alert",
        page: "Alerts",
      });
      segment.track("Button Click", {
        button: "Update Alert",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        stream_name: formData.value.stream_name,
        alert_name: formData.value.name,
        page: "Add/Update Alert",
      });
      return;
    } else {
      payload.folder_id = activeFolderId.value;
      callAlert = alertsService.create_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );

      callAlert
        .then((res: { data: any }) => {
          formData.value = { ...defaultAlertValue() };
          emit("update:list", activeFolderId.value);
          addAlertForm.value?.resetValidation();
          dismiss();
          q.notify({
            type: "positive",
            message: `Alert saved successfully.`,
          });
        })
        .catch((err: any) => {
          dismiss();
          handleAlertError(err);
        });
      track("Button Click", {
        button: "Create Alert",
        page: "Alerts",
      });
      segment.track("Button Click", {
        button: "Save Alert",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        stream_name: formData.value.stream_name,
        alert_name: formData.value.name,
        page: "Add/Update Alert",
      });
    }
  };

  // ── Data Initialization (replaces created() hook) ───────────────────────

  const initializeFormData = async () => {
    formData.value = { ...defaultAlertValue(), ...cloneDeep(props.modelValue) };

    const route = router.currentRoute.value;
    const isFromPanel =
      route.query.fromPanel === "true" && route.query.panelData;

    if (!props.isUpdated) {
      formData.value.is_real_time =
        alertType.value === "realTime" ? true : false;
    }
    formData.value.is_real_time = formData.value.is_real_time.toString();

    if (isFromPanel) {
      formData.value.query_condition.type = "";
      await loadPanelDataIfPresent();
    }

    if (store.state?.zoConfig?.min_auto_refresh_interval)
      formData.value.trigger_condition.frequency = Math.max(
        10,
        Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60 || 10),
      );

    beingUpdated.value = props.isUpdated;
    updateStreams(false)?.then(() => {
      updateEditorContent(formData.value.stream_name);
    });

    if (
      props.modelValue &&
      props.modelValue.name != undefined &&
      props.modelValue.name != ""
    ) {
      beingUpdated.value = true;
      disableColor.value = "grey-5";
      formData.value = cloneDeep(props.modelValue);
      isAggregationEnabled.value =
        !!formData.value.query_condition.aggregation;

      if (formData.value.query_condition.promql_condition) {
        if (!formData.value.query_condition.promql_condition.column) {
          formData.value.query_condition.promql_condition.column = "value";
        }
        if (!formData.value.query_condition.promql_condition.operator) {
          formData.value.query_condition.promql_condition.operator = ">=";
        }
        if (
          formData.value.query_condition.promql_condition.value ===
            undefined ||
          formData.value.query_condition.promql_condition.value === null
        ) {
          formData.value.query_condition.promql_condition.value = 1;
        }
      }

      lastValidStep.value = 6;

      if (!formData.value.trigger_condition?.timezone) {
        if (formData.value.tz_offset === 0) {
          formData.value.trigger_condition.timezone = "UTC";
        } else {
          getTimezonesByOffset(formData.value.tz_offset).then((res: any) => {
            if (res.length > 1) showTimezoneWarning.value = true;
            formData.value.trigger_condition.timezone = res[0];
          });
        }
      }

      if (formData.value.query_condition.vrl_function) {
        showVrlFunction.value = true;
        formData.value.query_condition.vrl_function = smartDecodeVrlFunction(
          formData.value.query_condition.vrl_function,
        );
      }
    }

    formData.value.is_real_time = formData.value.is_real_time.toString();

    // Convert context_attributes from object to array format
    if (
      formData.value.context_attributes &&
      typeof formData.value.context_attributes === "object" &&
      !Array.isArray(formData.value.context_attributes)
    ) {
      formData.value.context_attributes = Object.keys(
        formData.value.context_attributes,
      ).map((attr) => {
        return {
          key: attr,
          value: formData.value.context_attributes[attr],
          id: getUUID(),
        };
      });
    } else if (!formData.value.context_attributes) {
      formData.value.context_attributes = [];
    }

    // VERSION DETECTION AND CONVERSION
    if (
      formData.value.query_condition.conditions?.version === "2" ||
      formData.value.query_condition.conditions?.version === 2
    ) {
      formData.value.query_condition.conditions = ensureIds(
        formData.value.query_condition.conditions.conditions,
      );
    } else if (
      formData.value.query_condition.conditions &&
      !Array.isArray(formData.value.query_condition.conditions) &&
      Object.keys(formData.value.query_condition.conditions).length != 0
    ) {
      const version = detectConditionsVersion(
        formData.value.query_condition.conditions,
      );

      if (version === 0) {
        formData.value.query_condition.conditions = ensureIds(
          convertV0ToV2(formData.value.query_condition.conditions),
        );
      } else if (version === 1) {
        if (
          formData.value.query_condition.conditions.and ||
          formData.value.query_condition.conditions.or
        ) {
          formData.value.query_condition.conditions = ensureIds(
            convertV1BEToV2(formData.value.query_condition.conditions),
          );
        } else if (
          formData.value.query_condition.conditions.label &&
          formData.value.query_condition.conditions.items
        ) {
          formData.value.query_condition.conditions = ensureIds(
            convertV1ToV2(formData.value.query_condition.conditions),
          );
        }
      } else {
        formData.value.query_condition.conditions = ensureIds(
          formData.value.query_condition.conditions,
        );
      }
    } else if (
      Array.isArray(formData.value.query_condition.conditions) &&
      formData.value.query_condition.conditions.length > 0
    ) {
      formData.value.query_condition.conditions = ensureIds(
        convertV0ToV2(formData.value.query_condition.conditions),
      );
    } else if (
      formData.value.query_condition.conditions == null ||
      formData.value.query_condition.conditions == undefined ||
      formData.value.query_condition.conditions.length == 0 ||
      Object.keys(formData.value.query_condition.conditions).length == 0
    ) {
      formData.value.query_condition.conditions = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
        groupId: getUUID(),
      };
    }
  };

  // ── Watchers ────────────────────────────────────────────────────────────

  // Sync shared fields from alert formData into anomaly config
  watch(
    () => [
      formData.value.name,
      formData.value.stream_type,
      formData.value.stream_name,
    ],
    ([name, streamType, streamName]) => {
      anomalyConfig.value.name = name as string;
      anomalyConfig.value.stream_type = (streamType as string) || "logs";
      anomalyConfig.value.stream_name = streamName as string;
    },
  );

  watch(
    () => activeFolderId.value,
    (folderId) => {
      anomalyConfig.value.folder_id = (folderId as string) || "default";
    },
  );

  // When switching to anomaly mode, seed anomalyConfig
  watch(
    () => formData.value.is_real_time,
    (val) => {
      if (val === "anomaly") {
        anomalyConfig.value.name = formData.value.name || "";
        anomalyConfig.value.stream_type =
          formData.value.stream_type || "logs";
        anomalyConfig.value.stream_name = formData.value.stream_name || "";
        anomalyConfig.value.folder_id =
          (activeFolderId.value as string) || "default";
        if (wizardStep.value > 3) wizardStep.value = 1;
      }
    },
  );

  // Watch for destination changes
  watch(
    () => props.destinations.length,
    () => {
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

  // Watch for SQL query changes
  watch(
    () => formData.value.query_condition?.sql,
    (newValue) => {
      if (getSelectedTab.value === "sql") {
        previewQuery.value = newValue ? newValue.trim() : "";
      }
    },
  );

  // Watch for PromQL query changes
  watch(
    () => formData.value.query_condition?.promql,
    (newValue) => {
      if (getSelectedTab.value === "promql") {
        previewQuery.value = newValue ? newValue.trim() : "";
      }
    },
  );

  // Watch for tab changes
  watch(
    () => formData.value.query_condition?.type,
    (newType) => {
      if (newType === "sql") {
        previewQuery.value = formData.value.query_condition?.sql
          ? formData.value.query_condition.sql.trim()
          : "";
        isUsingBackendSql.value = false;
      } else if (newType === "promql") {
        previewQuery.value = formData.value.query_condition?.promql
          ? formData.value.query_condition.promql.trim()
          : "";
        isUsingBackendSql.value = false;
        if (!formData.value.query_condition.promql_condition) {
          formData.value.query_condition.promql_condition = {
            column: "value",
            operator: ">=",
            value: 1,
          };
        }
      } else if (newType === "custom") {
        previewQuery.value = "";
        isUsingBackendSql.value = false;
        debouncedGenerateSql();
      }
    },
  );

  // Watch for condition/stream/aggregation changes to regenerate SQL
  watch(
    () => [
      formData.value.query_condition?.conditions,
      formData.value.stream_name,
      formData.value.query_condition?.aggregation,
      isAggregationEnabled.value,
    ],
    () => {
      if (formData.value.query_condition?.type === "custom") {
        debouncedGenerateSql();
      }
    },
    { deep: true },
  );

  // Watch for stream changes to update context provider
  watch(
    () => [formData.value.stream_name, formData.value.stream_type],
    ([newStreamName, newStreamType]) => {
      const alertsProvider = createAlertsContextProvider(
        formData,
        store,
        props.isUpdated,
        newStreamName,
        newStreamType,
      );
      contextRegistry.register("alerts", alertsProvider);
    },
  );

  // Watch for step4Ref to register focus manager fields
  watch(
    step4Ref,
    (newVal) => {
      if (newVal) {
        nextTick(() => {
          if ((newVal as any).periodFieldRef) {
            focusManager.registerField("period", {
              ref: (newVal as any).periodFieldRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-alerting";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          }
          if ((newVal as any).thresholdFieldRef) {
            focusManager.registerField("threshold", {
              ref: (newVal as any).thresholdFieldRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-alerting";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          }
          if ((newVal as any).silenceFieldRef) {
            focusManager.registerField("silence", {
              ref: (newVal as any).silenceFieldRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-alerting";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          }
          if ((newVal as any).destinationsFieldRef) {
            focusManager.registerField("destinations", {
              ref: (newVal as any).destinationsFieldRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-alerting";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          }
        });
      }
    },
    { immediate: true },
  );

  // Watch for step2Ref to register query field
  watch(
    step2Ref,
    (newVal) => {
      if (newVal) {
        nextTick(() => {
          const queryType = formData.value.query_condition?.type || "custom";
          if (queryType === "custom" && (newVal as any).customPreviewRef) {
            focusManager.registerField("query", {
              ref: (newVal as any).customPreviewRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-config";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          } else if (
            (queryType === "sql" || queryType === "promql") &&
            (newVal as any).sqlPromqlPreviewRef
          ) {
            focusManager.registerField("query", {
              ref: (newVal as any).sqlPromqlPreviewRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-config";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          }
        });
      }
    },
    { immediate: true },
  );

  // Watch for step3Ref to register multiwindow field
  watch(
    step3Ref,
    (newVal) => {
      if (newVal && (newVal as any).multiWindowContainerRef) {
        nextTick(() => {
          focusManager.registerField("multiwindow", {
            ref: (newVal as any).multiWindowContainerRef,
            onBeforeFocus: () => {
              if (isAnomalyMode.value) {
                activeTab.value = "anomaly-alerting";
              } else {
                activeTab.value = "compare";
              }
            },
          });
        });
      }
    },
    { immediate: true },
  );

  // Watch for query type changes to re-register correct ref
  watch(
    () => formData.value.query_condition?.type,
    (newType) => {
      if (step2Ref.value && newType) {
        nextTick(() => {
          if (newType === "custom" && (step2Ref.value as any).customPreviewRef) {
            focusManager.registerField("query", {
              ref: (step2Ref.value as any).customPreviewRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-config";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          } else if (
            (newType === "sql" || newType === "promql") &&
            (step2Ref.value as any).sqlPromqlPreviewRef
          ) {
            focusManager.registerField("query", {
              ref: (step2Ref.value as any).sqlPromqlPreviewRef,
              onBeforeFocus: () => {
                if (isAnomalyMode.value) {
                  activeTab.value = "anomaly-config";
                } else {
                  activeTab.value = "condition";
                }
              },
            });
          }
        });
      }
    },
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────

  onBeforeMount(async () => {
    await importSqlParser();
    await getAllFunctions();
  });

  onMounted(async () => {
    // Initialize form data (replaces created() hook)
    await initializeFormData();

    // Pre-set anomaly mode
    if (router.currentRoute.value.name === "addAnomalyDetection") {
      formData.value.is_real_time = "anomaly";
    }

    // Load anomaly detection config when editing
    const routeAnomalyId = router.currentRoute.value.params
      .anomaly_id as string | undefined;
    if (routeAnomalyId) {
      try {
        const res = await anomalyDetectionService.get(
          store.state.selectedOrganization.identifier,
          routeAnomalyId,
        );
        const data = res.data;
        const parseInterval = (
          raw: string,
          defaultValue: number,
          defaultUnit: "m" | "h",
        ) => {
          if (!raw) return { value: defaultValue, unit: defaultUnit };
          if (raw.endsWith("h"))
            return {
              value: parseInt(raw) || defaultValue,
              unit: "h" as const,
            };
          return {
            value: parseInt(raw) || defaultValue,
            unit: "m" as const,
          };
        };
        const parseSeconds = (secs: number) => {
          if (secs >= 3600 && secs % 3600 === 0)
            return { value: secs / 3600, unit: "h" as const };
          return { value: Math.round(secs / 60), unit: "m" as const };
        };
        const histInterval = parseInterval(
          data.histogram_interval || "5m",
          5,
          "m",
        );
        const sched = parseInterval(
          data.schedule_interval || "1h",
          1,
          "h",
        );
        const win = data.detection_window_seconds
          ? parseSeconds(data.detection_window_seconds)
          : parseSeconds(
              sched.value * (sched.unit === "h" ? 3600 : 60),
            );
        const rawDestIds =
          data.alert_destinations ??
          data.alert_destination_ids ??
          data.alert_destination_id;
        const destIds: string[] = Array.isArray(rawDestIds)
          ? rawDestIds
          : rawDestIds
            ? [rawDestIds]
            : [];
        const rawFn: string = data.detection_function || "count";
        const fnMatch = rawFn.match(/^(\w+)\(([^)]*)\)$/);
        const parsedFn = fnMatch ? fnMatch[1] : rawFn;
        const parsedField =
          data.detection_function_field ||
          (fnMatch && fnMatch[2] !== "*" ? fnMatch[2] : "");
        anomalyConfig.value = {
          ...defaultAnomalyConfig(),
          ...data,
          detection_function: parsedFn,
          detection_function_field: parsedField,
          threshold: data.threshold ?? data.percentile ?? 97,
          filters: data.filters ?? [],
          histogram_interval_value: histInterval.value,
          histogram_interval_unit: histInterval.unit,
          schedule_interval_value: sched.value,
          schedule_interval_unit: sched.unit,
          detection_window_value: win.value,
          detection_window_unit: win.unit,
          alert_destination_ids: destIds,
        };
        formData.value.is_real_time = "anomaly";
        formData.value.name = data.name;
        formData.value.stream_name = data.stream_name;
        formData.value.stream_type = data.stream_type;
        if (data.folder_id) activeFolderId.value = data.folder_id;
        anomalyEditMode.value = true;
        lastValidStep.value = 6;
      } catch {
        q.notify({
          type: "negative",
          message: "Failed to load anomaly detection config.",
        });
      }
    }

    // Set up alerts context provider
    const alertsProvider = createAlertsContextProvider(
      formData,
      store,
      props.isUpdated,
      formData.value.stream_name,
      formData.value.stream_type,
    );
    contextRegistry.register("alerts", alertsProvider);
    contextRegistry.setActive("alerts");

    // Register focus manager fields
    await nextTick();
    focusManager.registerField("streamType", {
      ref: streamTypeFieldRef,
      onBeforeFocus: () => {
        if (isAnomalyMode.value) {
          if (wizardStep.value !== 1) wizardStep.value = 1;
        }
        // For V3 layout, streamType is always visible in top bar
      },
    });
    focusManager.registerField("stream", {
      ref: streamFieldRef,
      onBeforeFocus: () => {
        if (isAnomalyMode.value) {
          if (wizardStep.value !== 1) wizardStep.value = 1;
        }
      },
    });
    focusManager.registerField("alertType", {
      ref: streamTypeFieldRef,
      onBeforeFocus: () => {
        if (isAnomalyMode.value) {
          if (wizardStep.value !== 1) wizardStep.value = 1;
        }
      },
    });
  });

  onUnmounted(() => {
    contextRegistry.unregister("alerts");
    contextRegistry.setActive("");
    focusManager.clear();
  });

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    // Dependencies
    t,
    q,
    store,
    router,
    track,

    // Core state
    beingUpdated,
    addAlertForm,
    disableColor,
    formData,
    indexOptions,
    schemaList,
    streams,
    editorRef,
    filteredColumns,
    filteredStreams,
    editorobj,
    sqlAST,
    selectedRelativeValue,
    selectedRelativePeriod,
    relativePeriods,
    triggerCols,
    selectedDestinations,
    originalStreamFields,
    isAggregationEnabled,
    isEditorOpen,

    // Anomaly state
    anomalyConfig,
    anomalyStep2Ref,
    showAnomalySummary,
    anomalyEditMode,
    anomalyRetraining,
    anomalySaving,
    anomalyStatusColor,
    anomalyFormatTs,
    anomalyTriggerRetrain,
    isAnomalyMode,
    anomalyPreviewSql,
    anomalySummarySectionStyle,

    // UI state
    expandState,
    triggerOperators,
    showVrlFunction,
    isFetchingStreams,
    streamTypes,
    rowTemplateTypeOptions,
    focusManager,
    streamFieldRef,
    streamTypeFieldRef,
    previewQuery,
    isUsingBackendSql,
    sqlQueryErrorMsg,
    validateSqlQueryPromise,
    addAlertFormRef,
    viewSqlEditorDialog,
    plotChart,
    previewAlertRef,
    vrlFunctionError,
    showTimezoneWarning,
    showJsonEditorDialog,
    validationErrors,
    isLoadingPanelData,
    activeFolderId,
    alertType,

    // Wizard state (anomaly)
    wizardStep,
    wizardStepper,
    step1Ref,
    step2Ref,
    step3Ref,
    step4Ref,
    lastValidStep,
    streamTypeRef,
    streamNameRef,
    anomalyNameRef,
    alertNameError,
    streamTypeError,
    streamNameError,
    currentStepCaption,
    isLastStep,
    goToStep2,
    goToNextStep,
    goToPreviousStep,

    // V3 tab state
    activeTab,
    tabErrors,
    chartCollapsed,
    previewDateTimeValue,
    thresholdMarkLine,

    // Computed
    editorData,
    prefixCode,
    suffixCode,
    streamFieldsMap,
    showPreview,
    rowTemplatePlaceholder,
    decodedVrlFunction,
    getSelectedTab,
    canSaveAlert,
    getFormattedDestinations,
    generatedSqlQuery,

    // Methods
    editorUpdate,
    updateEditorContent,
    updateStreamFields,
    updateStreams,
    filterStreams,
    generateSqlQuery: generateSqlQueryLocal,
    onInputUpdate,
    getAlertPayload,
    validateInputs,
    validateSqlQuery,
    validateConditionsAgainstUDS,
    validateStep,
    validateAllTabs,
    validateAndFocus,
    updateGroup,
    removeConditionGroup,
    transformFEToBE,
    retransformBEToFE,
    updateActiveFolderId,
    addVariable,
    removeVariable,
    updateFunctionVisibility,
    updateMultiTimeRange,
    updateSilence,
    updateExpandState,
    refreshDestinations,
    refreshTemplates,
    updateDestinations,
    updateTab,
    handleGoToSqlEditor,
    clearMultiWindows,
    handleEditorStateChanged,
    handleEditorClosed,
    routeToCreateDestination,
    openEditorDialog,
    openJsonEditor,
    saveAlertJson,
    loadPanelDataIfPresent,
    handleSave,
    onSubmit,
    saveAnomalyDetection,
    previewAlert,
    validateFormAndNavigateToErrorField,
    navigateToErrorField,
    focusOnFirstError,
    handleAlertError,
    getParser,
    initializeFormData,

    // Constants/utils
    outlinedInfo,
    getTimezoneOffset,
    isValidResourceName,
    convertDateToTimestamp,
    getTimezonesByOffset,
  };
}
