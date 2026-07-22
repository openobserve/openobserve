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
import { useRouter } from "vue-router";
import { cloneDeep, debounce } from "lodash-es";

import alertsService from "@/services/alerts";
import searchService from "@/services/search";
import anomalyDetectionService from "@/services/anomaly_detection";
import segment from "@/services/segment_analytics";
import { useReo } from "@/services/reodotdev_analytics";

import useStreams from "@/composables/useStreams";
import useFunctions from "@/composables/useFunctions";
import useQuery from "@/composables/useQuery";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

import {
  getUUID,
  getTimezoneOffset,
  b64DecodeUnicode,
  b64EncodeUnicode,
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
import { type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import {
  getAlertPayload as getAlertPayloadUtil,
  prepareAndSaveAlert as prepareAndSaveAlertUtil,
  transformCompositeTermsForSave,
  stripFormExtras,
  type PayloadContext,
  type PayloadFormData,
  type SaveAlertContext,
} from "@/utils/alerts/alertPayload";
import { validateCompositeExpression } from "@/utils/alerts/compositeExpression";
import { makeDefaultComposite } from "@/components/alerts/composite/CompositeAlert.vue";
// Pure cron helpers — used by the cron save gate in runImperativeQueryChecks.
import {
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
} from "@/utils/queryUtils";
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
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import { toDetectionFunctionSql } from "@/utils/alerts/anomalySqlBuilder";
import config from "@/aws-exports";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeAddAlertSchema,
  defaultAddAlertMeta,
} from "@/components/alerts/AddAlert.schema";

// ─── Default Values ─────────────────────────────────────────────────────────

export const defaultAlertValue: any = () => {
  return {
    name: "",
    stream_type: "logs",
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
    // Enterprise-only: workflows linked to this alert (run when it fires).
    workflows: [],
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

// The full value set held by the ONE OForm: the alert payload shape plus the
// form-only extras seeded by withFormExtras (logGroupBy / _ui / _meta). Typing
// the form generic with this makes `form.state.values.*` reads (the synchronous
// source of truth) typed instead of `unknown`.
export type AlertFormValues = PayloadFormData & {
  logGroupBy: string[];
  _ui: Record<string, unknown>;
  _meta: Record<string, unknown>;
} & Record<string, unknown>;

export function useAlertForm(props: AlertFormProps, emit: AlertFormEmit) {
  const store: any = useStore();
  const { t } = useI18n();
  const router = useRouter();
  const { track } = useReo();
  const { getAllFunctions } = useFunctions();
  const { getStreams, getStream } = useStreams();
  const { buildQueryPayload } = useQuery();

  // ── Core State ──────────────────────────────────────────────────────────

  const beingUpdated = ref(false);
  const addAlertForm: any = ref(null);
  const disableColor: any = ref("");

  // ── Headless OForm ────────────────────────────────────────────────────────
  // AddAlert OWNS the ONE form for the whole wizard (topbar scalars + the
  // descendant steps QueryConfig/AlertSettings bind their fields by nested
  // `name=` into it). `formData` is a READ-VIEW of the form's values
  // (form.useStore) — the SINGLE source of truth, no mirror. Every write goes
  // through setF / resetForm; NEVER mutate the read-view directly (that bypasses
  // TanStack).
  /** The org's min evaluation frequency, in SECONDS (0 when unset — the schema
   *  then skips the floor rule rather than inventing one). */
  const minAutoRefreshInterval = (): number =>
    Number(store.state?.zoConfig?.min_auto_refresh_interval) || 0;

  /** Split an alert's STORED frequency (always MINUTES) into the display unit +
   *  the number the user actually sees. Mirrors QueryConfig's
   *  `initialFrequencyMode` / sync-watch rule: >= 60 and a whole number of hours
   *  shows as hours. The display value lives under `_ui` (display-only, stripped
   *  from the payload); the stored minutes stay in trigger_condition.frequency. */
  const frequencyDisplay = (
    obj: any,
  ): { mode: "minutes" | "hours" | "cron"; checkEvery: number } => {
    const mins = Number(obj?.trigger_condition?.frequency ?? 10);
    if (obj?.trigger_condition?.frequency_type === "cron")
      return { mode: "cron", checkEvery: mins };
    const isHours = mins >= 60 && mins % 60 === 0;
    return {
      mode: isHours ? "hours" : "minutes",
      checkEvery: isHours ? mins / 60 : mins,
    };
  };

  const buildDefaultForm = (): any => {
    const base = defaultAlertValue();
    return {
      ...base,
      logGroupBy: [] as string[],
      _ui: { checkEvery: frequencyDisplay(base).checkEvery },
      _meta: defaultAddAlertMeta({
        frequencyMode: frequencyDisplay(base).mode,
        minAutoRefreshInterval: minAutoRefreshInterval(),
      }),
    };
  };

  // Add the form-only extras (logGroupBy for logs measure group-by; `_ui` the
  // display-only state; `_meta` the QueryConfig discriminator block) to a plain
  // alert object so `form.reset(...)` always seeds a schema-complete value set.
  // QueryConfig then keeps `_meta` fresh via its own syncMeta watcher, and
  // re-seeds `_ui.checkEvery` from the stored frequency at setup.
  const withFormExtras = (obj: any): any => {
    const groupBy: string[] = Array.isArray(
      obj?.query_condition?.aggregation?.group_by,
    )
      ? obj.query_condition.aggregation.group_by.filter((g: string) => g)
      : [];
    const freq = frequencyDisplay(obj);
    return {
      ...obj,
      logGroupBy: groupBy,
      _ui: obj?._ui ?? { checkEvery: freq.checkEvery },
      _meta:
        obj?._meta ??
        defaultAddAlertMeta({
          tab: obj?.query_condition?.type || "custom",
          isRealTime: String(obj?.is_real_time ?? "false"),
          isEventBased: (obj?.stream_type ?? "logs") !== "metrics",
          aggregationEnabled: !!obj?.query_condition?.aggregation,
          hasGroupBy: groupBy.length > 0,
          hasConditions:
            !!obj?.query_condition?.conditions?.conditions?.length,
          frequencyMode: freq.mode,
          minAutoRefreshInterval: minAutoRefreshInterval(),
        }),
    };
  };

  // i18n-driven validation schema (messages resolve via `t` — see AddAlert.schema).
  // Workflows are enterprise/cloud-only; where they exist an alert may be
  // delivered to a destination OR a workflow, which relaxes "destinations ≥ 1"
  // into "at least one of the two". In OSS this stays false and the rule (and
  // its message) is byte-identical to before.
  // Also respects the backend /config flag: on an enterprise build with
  // workflows switched OFF the picker has no Workflows group, so relaxing the
  // rule would surface "destination or workflow required" for a choice the user
  // cannot make. Falls back to the strict "destination required" rule, which is
  // the same rule OSS gets. (Built once in setup — if /config has not landed
  // yet this is the stricter of the two, which is the safe direction.)
  const addAlertSchema = makeAddAlertSchema(
    t,
    (config.isEnterprise === "true" || config.isCloud === "true") &&
      store.state.zoConfig?.workflows_enabled === true,
  );
  const form = useOForm<AlertFormValues>({
    defaultValues: buildDefaultForm() as AlertFormValues,
    schema: addAlertSchema,
    onSubmit: async () => {
      await performSave();
    },
  });

  // READ-VIEW of the single form. Reactive; replaced immutably on every change.
  const formData: any = form.useStore((s: any) => s.values);

  /** Write a single (possibly nested, dot/bracket-path) field into the ONE form. */
  const setF = (path: string, value: any): void =>
    form.setFieldValue(path as any, value);

  // Composite alerts are edited on a LOCAL mutable model, decoupled from the
  // OForm: the form read-view is immutable (its nested fields can't be mutated
  // by the composite child components), and a composite has no top-level
  // stream/query for the composed schema to own. `composite` holds the spec
  // (terms/expression/notify/on_error); `compositeTrigger` holds its shared
  // schedule (period/frequency/silence). Both are seeded on edit-load and
  // injected into the payload at save.
  const composite = ref<any>(null);
  const compositeTrigger = ref<any>(null);
  const isComposite = computed(() => composite.value != null);
  const enableComposite = (): void => {
    if (composite.value) return;
    composite.value = makeDefaultComposite();
    compositeTrigger.value = { ...defaultAlertValue().trigger_condition };
    // A composite is scheduled and has no single top-level stream.
    setF("is_real_time", "false");
  };
  const disableComposite = (): void => {
    composite.value = null;
    compositeTrigger.value = null;
  };

  /** Reset the whole form (edit-prefill / post-save reset) to a complete alert
   *  object, re-seeding the form-only extras (logGroupBy / _meta). */
  const resetForm = (obj: any): void => form.reset(withFormExtras(obj));
  const indexOptions = ref([]);
  const schemaList = ref([]);
  const streams: any = ref({});
  const editorRef: any = ref(null);
  const filteredColumns: any = ref([]);
  const filteredStreams: Ref<string[]> = ref([]);
  let editorobj: any = null;
  const sqlAST: any = ref(null);
  const selectedRelativeValue = ref("1");
  // NOT i18n: "Minutes" here is DATA, not a label. It is the period *identifier*
  // that loadPanelData compares against ("Hours"/"Days"/"Weeks") to convert a
  // panel's relative range into minutes, and utils/date.ts keys off the very same
  // literal (`periodLabel === "Minutes"`) when building the `period` URL param.
  // Translating it would silently break that conversion.
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

  const anomalyStatusVariant = computed<BadgeVariant>(() => {
    switch (anomalyConfig.value.status) {
      case "active":
        return "success";
      case "training":
        return "primary";
      case "failed":
        return "error";
      default:
        return "default";
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
      toast({
        variant: "success",
        message: t("alerts.messages.trainingTriggered"),
      });
    } catch {
      toast({
        variant: "error",
        message: t("alerts.messages.trainingTriggerFailed"),
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
      return c.custom_sql || t("alerts.messages.sqlPreviewPlaceholder");
    }
    const stream = c.stream_name || "<stream>";
    const interval = anomalyHistogramInterval.value || "5m";
    const fn = toDetectionFunctionSql(
      c.detection_function,
      c.detection_function_field || "<field>",
    );
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
  // `value` is LOAD-BEARING data ("String" / "Json" are the values persisted in
  // `row_template_type` and compared against below) — only `label` is display
  // text, so only `label` is translated.
  const rowTemplateTypeOptions = [
    { label: t("alerts.advanced.templateTypeString"), value: "String" },
    { label: t("alerts.advanced.templateTypeJson"), value: "Json" },
  ];

  const focusManager = new AlertFocusManager();
  const streamFieldRef = ref(null);
  const streamTypeFieldRef = ref(null);

  const previewQuery = ref("");
  const isUsingBackendSql = ref(false);
  const sqlQueryErrorMsg = ref("");
  // Editor squiggle ranges for server SQL-validation errors (shared with editors
  // via provide/inject from AddAlert.vue).
  const sqlErrorRanges = ref<SqlErrorRange[]>([]);
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

  const folderQuery = router.currentRoute.value.query.folder;
  const activeFolderId = ref<string>(
    (Array.isArray(folderQuery) ? folderQuery[0] : folderQuery) || "default",
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

  // Topbar field refs (for focus-on-error only).
  const streamTypeRef = ref<any>(null);
  const streamNameRef = ref<any>(null);
  const anomalyNameRef = ref<any>(null);

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
      // NOT i18n: utils/date.ts reads `period.label` back as an identifier
      // (`periodLabel === "Minutes"` → unit "m") when turning this object into
      // query params, so the label is load-bearing data here, not display text.
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

  // The `{name}` / `{timestamp}` braces are LITERAL template syntax shown to the
  // user, so the locale values escape them for vue-i18n (`{'{'}` … `{'}'}`) and
  // render byte-identical to the pre-i18n literals. Same keys as Advanced.vue,
  // which owns the rendered placeholder.
  const rowTemplatePlaceholder = computed(() => {
    return formData.value.row_template_type === "Json"
      ? t("alerts.advanced.rowTemplatePlaceholderJson")
      : t("alerts.advanced.rowTemplatePlaceholderString");
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
          label: { formatter: t("alerts.messages.thresholdMarkLine") },
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

    // In SQL mode, generate a starter query when the editor is still empty
    if (
      formData.value.query_condition.type === "sql" &&
      !formData.value.query_condition.sql?.trim()
    ) {
      setF("query_condition.sql", `SELECT * FROM "${stream_name}"`);
    }

    onInputUpdate("stream_name", stream_name);
  };

  // ── SQL → stream-name sync ──────────────────────────────────────────────
  // When the user edits the SQL query and changes the stream name inside the
  // FROM clause, update the stream-name dropdown to match.
  // Guard flag prevents the auto-SQL-generation inside updateStreamFields from
  // firing while we are already syncing (SQL is not empty at that point, so
  // the guard in updateStreamFields would already prevent it, but this is an
  // extra safety layer).
  const isSyncingStreamFromSql = ref(false);

  const debouncedSyncStreamFromSql = debounce(async (sql: string) => {
    if (!sql || !parser || isSyncingStreamFromSql.value) return;
    try {
      const parsed = parser.parse(sql);
      const fromStream = parsed?.ast?.from?.[0]?.table as string | undefined;
      if (fromStream && fromStream !== formData.value.stream_name) {
        isSyncingStreamFromSql.value = true;
        setF("stream_name", fromStream);
        await updateStreamFields(fromStream);
        isSyncingStreamFromSql.value = false;
      }
    } catch {
      // ignore parse errors while user is mid-typing
    }
  }, 600);

  watch(
    () => formData.value.query_condition.sql,
    (sql) => {
      if (
        formData.value.query_condition.type === "sql" &&
        !isSyncingStreamFromSql.value
      ) {
        debouncedSyncStreamFromSql(sql || "");
      }
    },
  );

  const updateStreams = (resetStream = true) => {
    if (resetStream) setF("stream_name", "");
    // Read the synchronous source of truth (not the reactive read-view, which
    // can lag one tick behind a setF from the OFormSelect change handler).
    const streamType = form.state.values.stream_type;
    const streamName = form.state.values.stream_name;
    if (streams.value[streamType]) {
      schemaList.value = streams.value[streamType];
      indexOptions.value = streams.value[streamType].map((data: any) => {
        return data.name;
      });
      return;
    }

    if (!streamType) return Promise.resolve();

    isFetchingStreams.value = true;
    return getStreams(streamType, false)
      .then(async (res: any) => {
        streams.value[streamType] = res.list;
        schemaList.value = res.list;
        indexOptions.value = res.list.map((data: any) => {
          return data.name;
        });

        if (streamName) await updateStreamFields(streamName);
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
    // Read the synchronous source of truth (the form store), not the reactive
    // read-view, so a value written by setF immediately before save is included.
    return getAlertPayloadUtil(form.state.values, payloadContext);
  };

  const validateInputs = (input: any, notify: boolean = true) => {
    const validationContext: ValidationContext = {
      store,
      t,
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
      store,
      t,
      validateSqlQueryPromise,
      sqlQueryErrorMsg,
      sqlErrorRanges,
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

  // Validate a specific step (used by wizard navigation).
  // Always true by design: every step (topbar name/stream, QueryConfig,
  // AlertSettings) is a DESCENDANT of the ONE AddAlert form, so their field
  // rules run through the composed schema (AddAlert.schema.ts) on the real save
  // path (handleSave → form.handleSubmit), and the non-schema query-text gates
  // live in runImperativeQueryChecks. Kept as a function so wizard navigation
  // keeps its gate seam.
  const validateStep = async (_stepNumber: number) => {
    return true;
  };

  const validateCurrentStep = async () => {
    return await validateStep(wizardStep.value);
  };

  // Focus the first field showing a validation message. This used to query
  // a legacy error class — one with no producer left in the app after the
  // OForm migration, so it silently matched nothing and the "fix the highlighted
  // fields" toast pointed at a field we never actually focused. OInput/OSelect
  // render their message as [role="alert"] inside the field wrapper, so walk up
  // from the message to the nearest ancestor holding the control.
  //
  // Scoped to the <form>: toasts are also role="alert" and would otherwise win.
  // Invisible messages are skipped — a v-show'd tab has no offsetParent, and
  // focusing a display:none control does nothing.
  const focusVisibleError = (form: HTMLElement): boolean => {
    const messages = Array.from(
      form.querySelectorAll<HTMLElement>('[role="alert"]'),
    ).filter((el) => el.offsetParent !== null && el.textContent?.trim());

    for (const message of messages) {
      let node: HTMLElement | null = message.parentElement;
      while (node && node !== form) {
        const control = node.querySelector<HTMLElement>(
          'input:not([type="hidden"]), textarea, [role="combobox"], button[aria-haspopup]',
        );
        if (control) {
          control.focus();
          control.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
        node = node.parentElement;
      }
    }
    return false;
  };

  const focusOnFirstError = () => {
    nextTick(async () => {
      const form = document.querySelector("form");
      if (!form) return;

      // The offending field is on the tab the user is already looking at.
      if (focusVisibleError(form)) return;

      // Nothing VISIBLE is erroring, but the form is still invalid — so the
      // offending field lives on a tab the user isn't looking at. That pane is
      // v-show'd off, so every message inside it has a null offsetParent and the
      // scan above skips it: the toast fires, points at nothing, and the user is
      // told to fix a field they cannot see. Bring the owning tab forward first,
      // then focus for real (this is what the pre-migration save gate did by
      // hardcoding `activeTab = "condition"` before focusing).
      // Only hop to a tab that is REACHABLE in the current mode. Every pane stays
      // in the DOM in both modes (v-show, not v-if) while `alertTabs` swaps the
      // headers wholesale between anomaly and alert — so a stale message on a
      // pane whose header isn't rendered would strand the user on a tab the
      // toggle group cannot show or leave.
      const stranded = Array.from(
        form.querySelectorAll<HTMLElement>('[role="alert"]'),
      ).find((el) => {
        if (!el.textContent?.trim()) return false;
        const key = el.closest<HTMLElement>("[data-tab-pane]")?.dataset.tabPane;
        return !!key && !!form.querySelector(`[data-test="add-alert-tab-${key}"]`);
      });
      const pane = stranded?.closest<HTMLElement>("[data-tab-pane]");
      const tab = pane?.dataset.tabPane;
      if (!tab || tab === activeTab.value) return;

      activeTab.value = tab;
      await nextTick();
      // Re-scan with the visibility filter intact: now that the pane is shown,
      // its messages have an offsetParent. Anything still hidden (a collapsed
      // section) is correctly skipped rather than focused into the void.
      focusVisibleError(form);
    });
  };

  // Focus a topbar select/input by its Vue component ref
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

  // Regex matching backend RE_OFGA_UNSUPPORTED_NAME in src/common/utils/auth.rs
  const ALERT_NAME_UNSUPPORTED_CHARS = /[:#?\s'"%&]+/;

  // Validates a composite alert before save (mirrors the back-end §4.2 rules).
  const validateCompositeAlert = (): boolean => {
    const c = composite.value;
    if (!c || !Array.isArray(c.terms) || c.terms.length < 2) {
      toast({ variant: "error", message: t("alerts.composite.minTermsError") });
      return false;
    }
    if (c.terms.length > 10) {
      toast({ variant: "error", message: t("alerts.composite.maxTermsError") });
      return false;
    }
    const names = new Set<string>();
    for (const term of c.terms) {
      if (!/^[a-zA-Z0-9_]+$/.test(term.name)) {
        toast({ variant: "error", message: t("alerts.composite.invalidTermName", { name: term.name }) });
        return false;
      }
      if (names.has(term.name)) {
        toast({ variant: "error", message: t("alerts.composite.duplicateTermName", { name: term.name }) });
        return false;
      }
      names.add(term.name);
      if (term.mode === "new") {
        // Scratch term: must have a stream + a query.
        const draft = term.draft || {};
        const type = draft.query_condition?.type || "custom";
        if (!draft.stream_name) {
          toast({ variant: "error", message: t("alerts.composite.termStreamRequired", { name: term.name }) });
          return false;
        }
        if (type === "sql" && !draft.query_condition?.sql?.trim()) {
          toast({ variant: "error", message: t("alerts.composite.termSqlRequired", { name: term.name }) });
          return false;
        }
        if (type === "promql" && !draft.query_condition?.promql?.trim()) {
          toast({ variant: "error", message: t("alerts.composite.termPromqlRequired", { name: term.name }) });
          return false;
        }
      } else if (!term.alert_id) {
        // Existing term: must reference a member alert.
        toast({ variant: "error", message: t("alerts.composite.termMemberRequired", { name: term.name }) });
        return false;
      }
    }
    const res = validateCompositeExpression(
      c.expression || "",
      c.terms.map((tm: any) => tm.name),
    );
    if (!res.valid) {
      toast({ variant: "error", message: res.error || t("alerts.composite.invalidExpression") });
      return false;
    }
    if (!c.notify?.on_composite?.length) {
      toast({ variant: "error", message: t("alerts.composite.onCompositeRequired") });
      return false;
    }
    return true;
  };

  // Schema-driven validity predicate (validation ONLY — never triggers the save;
  // the real save path is handleSave → form.handleSubmit). The ONE composed
  // schema owns name/stream + the step field rules, so this just runs the
  // imperative query-text gates (re-homed from the descendant QueryConfig) and
  // parses the current form values against the schema. Kept exported for
  // programmatic callers (Rule ④ — same name/stream/§4 gating as before, now via
  // the schema).
  const validateAndFocus = async (): Promise<boolean> => {
    // Composite alerts validate their terms + expression + destinations rather
    // than a single top-level stream/query/settings.
    if (composite.value) {
      return validateCompositeAlert();
    }
    if (isAnomalyMode.value) {
      if (!anomalyConfig.value.name?.trim()) {
        toast({
          variant: "error",
          message: t("alerts.messages.anomalyDetectionNameRequired"),
        });
        focusTopbarField(anomalyNameRef);
        return false;
      }
      return true;
    }
    if (!runImperativeQueryChecks()) return false;
    const parsed = addAlertSchema.safeParse(form.state.values);
    if (!parsed.success) {
      // No hardcoded tab switch: focusOnFirstError now walks to the pane that
      // actually owns the first error, so a topbar error (name/stream) no longer
      // yanks the user onto the condition tab to look at a field that isn't there.
      focusOnFirstError();
      return false;
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

    // The per-step validate() calls that used to run here (condition tab /
    // alert settings) are gone — those steps bind into the ONE form and the
    // composed schema validates them on save (handleSave → form.handleSubmit).

    return { valid: true, firstErrorTab: null };
  };

  // ── Condition Transforms ────────────────────────────────────────────────

  // Build a mutable {query_condition:{conditions}} context off a CLONE of the
  // form's current conditions tree. The transform utils mutate context.formData
  // in place, so it must NOT be the readonly form read-view (formData.value) —
  // writing to that silently fails (the form store values are readonly).
  const conditionsTransformContext = (): TransformContext => ({
    formData: {
      query_condition: {
        conditions: cloneDeep(
          form.state.values.query_condition?.conditions ?? {
            filterType: "group",
            logicalOperator: "AND",
            groupId: "",
            conditions: [],
          },
        ),
      },
    },
  });

  const updateGroup = (updatedGroup: any) => {
    const ctx = conditionsTransformContext();
    updateGroupUtil(updatedGroup, ctx);
    setF(
      "query_condition.conditions",
      JSON.parse(JSON.stringify(ctx.formData.query_condition.conditions)),
    );
  };

  const removeConditionGroup = (
    targetGroupId: string,
    currentGroup?: any,
  ) => {
    const ctx = conditionsTransformContext();
    removeConditionGroupUtil(targetGroupId, currentGroup, ctx);
    setF(
      "query_condition.conditions",
      JSON.parse(JSON.stringify(ctx.formData.query_condition.conditions)),
    );
  };

  const transformFEToBE = (node: any) => {
    return transformFEToBEUtil(node);
  };

  const retransformBEToFE = (data: any) => {
    return retransformBEToFEUtil(data);
  };


  // Rehydrates a composite alert's terms on edit-load. A term is either a
  // reference to an existing alert (`alert_id`) or an inline query (`query`)
  // stored on the composite. Reference terms show the picker; inline terms
  // repopulate the query-builder draft so the user can edit them in place.
  const rehydrateCompositeTerms = (composite: any) => {
    if (!composite || !Array.isArray(composite.terms)) return;
    composite.terms.forEach((term: any) => {
      if (term.member_name === undefined) term.member_name = "";
      // An inline term carries a `query`; a reference term carries `alert_id`.
      if (term.query && !term.alert_id) {
        term.mode = "new";
        term.draft = draftFromInlineQuery(term.query);
      } else if (term.mode === undefined) {
        term.mode = "existing";
      }
      // Ensure a draft always exists so toggling Existing/New never crashes.
      if (!term.draft) term.draft = draftFromInlineQuery(null);
    });
  };

  // Reconstructs a query-builder draft from a stored inline term query (the
  // inverse of the payload's `buildInlineTermQuery`). `null` yields an empty
  // draft (the shape `makeMemberDraft` produces).
  const draftFromInlineQuery = (query: any): any => {
    const q = query || {};
    const beQc = q.query_condition || {};
    const emptyGroup = {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "",
      conditions: [],
    };
    return {
      stream_type: q.stream_type || "logs",
      stream_name: q.stream_name || "",
      query_condition: {
        // Unwrap the versioned conditions back to the FE group the builder edits.
        conditions: beQc.conditions?.conditions || emptyGroup,
        sql: beQc.sql || "",
        promql: beQc.promql || "",
        type: beQc.type || "custom",
        aggregation: beQc.aggregation || {
          group_by: [],
          function: "avg",
          having: { column: "", operator: ">=", value: 1 },
        },
        promql_condition: beQc.promql_condition || null,
        vrl_function: beQc.vrl_function
          ? b64DecodeUnicode(beQc.vrl_function)
          : null,
        multi_time_range: beQc.multi_time_range || [],
      },
      operator: q.operator || ">=",
      threshold: q.threshold ?? 1,
    };
  };

  // ── UI Update Methods ───────────────────────────────────────────────────

  const updateActiveFolderId = (folderId: any) => {
    activeFolderId.value = folderId.value;
  };

  const addVariable = () => {
    setF("context_attributes", [
      ...(formData.value.context_attributes ?? []),
      { name: "", value: "", id: getUUID() },
    ]);
  };

  const removeVariable = (variable: any) => {
    setF(
      "context_attributes",
      (formData.value.context_attributes ?? []).filter(
        (_variable: any) => _variable.id !== variable.id,
      ),
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
      setF("query_condition.multi_time_range", value);
    }
  };

  const updateSilence = (value: any) => {
    if (value) {
      setF("trigger_condition.silence", value);
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
    setF("destinations", destinations);
  };

  const updateWorkflows = (workflows: any[]) => {
    setF("workflows", workflows);
  };

  const updateTab = (tab: string) => {
    setF("query_condition.type", tab);
  };

  // ── @update bridges from steps into the ONE form (Rule ② / ③) ─────────────
  // The already-migrated descendants (QueryConfig/AlertSettings) bind their
  // scalars directly by nested `name=`, so their update:* emits no-op in
  // descendant mode; these handlers still route the out-of-form widget values
  // (SQL/PromQL/VRL editors) and the bare wizard steps B (Advanced /
  // CompareWithPast / Deduplication) into the form via setFieldValue.
  const updateSqlQuery = (value: any) => setF("query_condition.sql", value);
  const updatePromqlQuery = (value: any) =>
    setF("query_condition.promql", value);
  const updateVrlFunction = (value: any) =>
    setF("query_condition.vrl_function", value);
  const updateAggregation = (value: any) =>
    setF("query_condition.aggregation", value);
  const updatePromqlCondition = (value: any) =>
    setF("query_condition.promql_condition", value);
  const updateTriggerCondition = (value: any) =>
    setF("trigger_condition", value);
  const updateTemplate = (value: any) => setF("template", value);
  const updateContextAttributes = (value: any) =>
    setF("context_attributes", value);
  const updateDescription = (value: any) => setF("description", value);
  const updateRowTemplate = (value: any) => setF("row_template", value);
  const updateRowTemplateType = (value: any) =>
    setF("row_template_type", value);
  const updateDeduplication = (value: any) => setF("deduplication", value);

  const handleGoToSqlEditor = () => {
    setF("query_condition.type", "sql");
    if (isAnomalyMode.value) {
      activeTab.value = "anomaly-config";
    } else {
      activeTab.value = "condition";
    }
  };

  const clearMultiWindows = () => {
    setF("query_condition.multi_time_range", []);
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
    setF("sql", e.target.value);
  };

  // ── Error Handling ──────────────────────────────────────────────────────

  const HTTP_FORBIDDEN = 403;
  const handleAlertError = (err: any) => {
    if (err.response?.status !== HTTP_FORBIDDEN) {
      toast({
        variant: "error",
        message:
          err.response?.data?.message ||
          err.response?.data?.error ||
          err.response?.data,
      });
    }
  };

  // ── JSON Editor Save ────────────────────────────────────────────────────

  /** What the JSON editor DISPLAYS. `formData` is the whole form value set, so
   *  it carries the form-only keys (_ui/_meta/logGroupBy); pre-migration
   *  formData had none of them, so strip them to show the alert resource the
   *  user actually edits (Rule ④). cloneDeep first — formData is a readonly
   *  read-view and stripFormExtras mutates. */
  const jsonEditorData = computed(() =>
    stripFormExtras(cloneDeep(formData.value)),
  );

  const saveAlertJson = async (json: any) => {
    const saveContext: SaveAlertContext = {
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
      store,
      t,
      streams,
      getStreams,
      getParser,
      buildQueryPayload,
      prepareAndSaveAlert: prepareAndSaveAlertFunction,
    };

    // Seed the ONE form with the edited JSON (Rule ③ — `formData` is a readonly
    // read-view, so the old `formData.value = payload` was a silent no-op).
    // Matters on server-side rejection: the drawer is already closed, so without
    // this the user's JSON edits are lost and can't be retried.
    await saveAlertJsonUtil(
      json,
      props,
      validationErrors,
      showJsonEditorDialog,
      resetForm,
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

          // Panel import mutates a LOCAL working copy of the current form
          // values, then seeds the ONE form with a single resetForm() at the
          // end (Rule ③ — no read-view mutation).
          const data: any = cloneDeep(formData.value);
          data.name = `Alert_from_${sanitizePanelTitle(panelData.panelTitle)}`;

          toast({
            variant: "success",
            message: t("alerts.importedFromPanel", {
              panelTitle: panelData.panelTitle,
            }),
          });

          if (query.fields?.stream_type) {
            data.stream_type = query.fields.stream_type;
          }

          if (query.fields?.stream) {
            data.stream_name = query.fields.stream;
            // Seed the form's stream fields so updateStreams fetches the right
            // schema (it reads them off the form). resetForm() below re-seeds.
            setF("stream_type", data.stream_type);
            setF("stream_name", data.stream_name);
            await updateStreams(false);
          }

          if (panelData.queryType === "sql") {
            data.query_condition.type = "sql";
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

              data.query_condition.sql = sqlQuery;
            }
          } else if (panelData.queryType === "promql") {
            data.query_condition.type = "promql";
            const sourceQuery = panelData.executedQuery || query.query;
            if (sourceQuery) {
              data.query_condition.promql = sourceQuery;
            }
          } else {
            data.query_condition.type = "sql";
          }

          if (
            panelData.queryType === "sql" &&
            query.customQuery === false &&
            query.fields
          ) {
            isAggregationEnabled.value = true;

            if (query.fields.x && query.fields.x.length > 0) {
              if (!data.query_condition.aggregation) {
                data.query_condition.aggregation = {
                  group_by: [],
                  function: "count",
                  having: {
                    column: "",
                    operator: ">=",
                    value: 1,
                  },
                };
              }
              data.query_condition.aggregation.group_by =
                query.fields.x.map((x: any) => x.alias || x.column);
            }

            if (query.fields.y && query.fields.y.length > 0) {
              const yField = query.fields.y[0];
              if (yField.aggregationFunction) {
                if (!data.query_condition.aggregation) {
                  data.query_condition.aggregation = {
                    group_by: [""],
                    function: "count",
                    having: {
                      column: "",
                      operator: ">=",
                      value: 1,
                    },
                  };
                }
                data.query_condition.aggregation.function =
                  yField.aggregationFunction.toLowerCase();
                data.query_condition.aggregation.having.column =
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
                data.query_condition.conditions = {
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
            data.query_condition.vrl_function = query.vrlFunctionQuery;
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

            data.trigger_condition.period = periodInMinutes;
          }

          if (panelData.threshold !== undefined && panelData.condition) {
            if (panelData.queryType === "promql") {
              if (!data.query_condition.promql_condition) {
                data.query_condition.promql_condition = {
                  column: "value",
                  operator: ">=",
                  value: 1,
                };
              }
              data.query_condition.promql_condition.value =
                panelData.threshold;
              data.query_condition.promql_condition.operator =
                panelData.condition === "above" ? ">=" : "<=";
            } else {
              if (
                isAggregationEnabled.value &&
                data.query_condition.aggregation
              ) {
                if (!data.query_condition.aggregation.having) {
                  data.query_condition.aggregation.having = {
                    column: "",
                    operator: ">=",
                    value: 1,
                  };
                }
                data.query_condition.aggregation.having.value =
                  panelData.threshold;
                data.query_condition.aggregation.having.operator =
                  panelData.condition === "above" ? ">=" : "<=";
              }
            }

            data.trigger_condition.threshold = 1;
            data.trigger_condition.operator = ">=";
          }

          resetForm(data);
        }

        await nextTick();
        if (previewAlertRef.value?.refreshData) {
          previewAlertRef.value.refreshData();
        }
      } catch (error) {
        console.error("Error loading panel data:", error);
        toast({
          variant: "error",
          message: t("alerts.messages.failedToLoadPanelData"),
        });
      } finally {
        isLoadingPanelData.value = false;
      }
    }
  };

  // ── Wizard Navigation (kept for anomaly) ────────────────────────────────

  const goToStep2 = async () => {
    wizardStep.value = 2;
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
      toast({
        variant: "error",
        message: t("alerts.messages.anomalyNameRequired"),
      });
      return;
    }

    // These two gates must move the user to the tab holding the offending field.
    // They used to set `wizardStep`, which the V2 stepper navigated by — the V3
    // single-pane layout navigates by `activeTab` and passes a hardcoded
    // wizard-step to the summary, so setting it here steered nothing and Save &
    // Train just appeared dead. Toast as well: the invalid field is on a tab the
    // user isn't looking at, so the highlight alone is invisible.
    if (anomalyStep2Ref.value) {
      const step2Valid = await anomalyStep2Ref.value.validate();
      if (!step2Valid) {
        activeTab.value = "anomaly-config";
        toast({
          variant: "error",
          message: t("alerts.messages.fixHighlightedFields"),
        });
        return;
      }
    }

    if (
      anomalyConfig.value.alert_enabled &&
      anomalyConfig.value.alert_destination_ids.length === 0
    ) {
      activeTab.value = "anomaly-alerting";
      toast({
        variant: "error",
        message: t("alerts.validation.destinationRequired"),
      });
      return;
    }

    anomalySaving.value = true;
    const orgId = store.state.selectedOrganization.identifier;
    const c = anomalyConfig.value;

    if (c.query_mode === "custom_sql") {
      if (!c.custom_sql?.trim()) {
        toast({
          variant: "error",
          message: t("alerts.messages.customSqlRequired"),
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
          sqlErr?.response?.data?.message ||
          t("alerts.messages.invalidSqlQueryLower");
        toast({
          variant: "error",
          message: t("alerts.validation.sqlValidationError", { error: msg }),
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
        toast({
          variant: "success",
          message: t("alerts.messages.anomalyConfigUpdated"),
        });
      } else {
        await anomalyDetectionService.create(orgId, payload);
        toast({
          variant: "success",
          message: t("alerts.anomalyCreated"),
        });
      }

      emit("update:list", (activeFolderId.value as string) || "default");
    } catch (err: any) {
      toast({
        variant: "error",
        message:
          err?.response?.data?.message ||
          t("alerts.messages.anomalyConfigSaveFailed"),
      });
    } finally {
      anomalySaving.value = false;
    }
  };

  // ── Save gate (Rule ③/④) ──────────────────────────────────────────────────
  // The footer Save button (and Enter) drives `form.handleSubmit()`; the ONE
  // composed schema now owns name/stream + the step field rules, so
  // `useOForm({ onSubmit: performSave })` runs the actual save ONLY when the
  // schema passes. handleSave adds the block-on-invalid + focus + toast that the
  // old validateAndFocus() gave.
  //
  // Anomaly runs this too. It used to be excluded because the anomaly branch was
  // a pure pass-through — the schema could never fail, so the block was dead code
  // and saveAnomalyDetection's own toasts were the only feedback. Now that the
  // branch enforces `name`, excluding anomaly would make a blank name fail
  // SILENTLY: handleSubmit rejects, performSave never runs, and nothing tells the
  // user why. The anomaly branch's ONLY rule is the blank name, so this can only
  // fire for that.
  const handleSave = async () => {
    // Composite alerts have no top-level stream/query for the composed schema to
    // validate, so they bypass form.handleSubmit and run their own validation.
    if (composite.value) {
      if (!validateCompositeAlert()) return;
      await performSave();
      return;
    }
    await form.handleSubmit();
    if (!form.state.isValid) {
      focusOnFirstError();
      toast({
        variant: "error",
        message: t("alerts.messages.fixHighlightedFields"),
      });
    }
  };

  // Imperative pre-save gates RE-HOMED from QueryConfig.validate(), which returns
  // true early in DESCENDANT mode — so its non-schema query-text gates (empty
  // SQL / empty PromQL / aggregate-column toast) no longer fire. Re-home them
  // here with the SAME messages so save stays blocked (Rule ④). The field rules
  // (threshold / frequency / conditions / promql-condition / group_by / period /
  // silence / destinations / name / stream) are covered by the composed schema.
  const runImperativeQueryChecks = (): boolean => {
    // ── Cron gate (R4 RESTORE) ───────────────────────────────────────────────
    // Pre-migration AlertSettings.validate() ran validateFrequency() first and
    // returned {valid:false} on any cronJobError, which the orchestrator turned
    // into a block + toast + switch to the condition tab. QueryConfig still
    // RENDERS cronError inline but nothing gated save. Recomputed here from the
    // form (not QueryConfig's local ref) so the gate holds regardless of which
    // step is mounted. Messages are verbatim from validateFrequency.
    // Minutes/hours mode needs no branch here: the ≥1 rule and the org-floor
    // rule both live in the schema, keyed on `_ui.checkEvery`.
    const tc = formData.value.trigger_condition || {};
    if (tc.frequency_type === "cron") {
      // Old validate() returned {valid:false, message:null} for a missing cron
      // or timezone, and the orchestrator only toasted `if (message)` — so this
      // case blocked + switched tab with NO toast, relying on QueryConfig's
      // inline "Cron expression and timezone are required". Parity: no toast.
      if (!tc.cron || !tc.timezone) {
        activeTab.value = "condition";
        return false;
      }
      try {
        const intervalInSecs = getCronIntervalDifferenceInSeconds(tc.cron);
        if (
          typeof intervalInSecs === "number" &&
          !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
        ) {
          const minInterval =
            Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
          activeTab.value = "condition";
          toast({
            variant: "error",
            message: t("alerts.queryConfig.frequencyGreaterThanSeconds", {
              seconds: minInterval - 1,
            }),
          });
          return false;
        }
      } catch {
        activeTab.value = "condition";
        toast({
          variant: "error",
          message: t("alerts.queryConfig.invalidCronExpression"),
        });
        return false;
      }
    }

    const qc = formData.value.query_condition || {};
    const tab = qc.type || "custom";
    if (tab === "sql") {
      if (!qc.sql || String(qc.sql).trim() === "") {
        activeTab.value = "condition";
        toast({
          variant: "error",
          message: t("alerts.messages.sqlQueryEmpty"),
        });
        return false;
      }
      if (sqlQueryErrorMsg.value && sqlQueryErrorMsg.value.trim() !== "") {
        activeTab.value = "condition";
        toast({
          variant: "error",
          message: t("alerts.messages.fixSqlErrorBeforeSaving"),
        });
        return false;
      }
    } else if (tab === "promql") {
      if (!qc.promql || String(qc.promql).trim() === "") {
        activeTab.value = "condition";
        toast({
          variant: "error",
          message: t("alerts.messages.promqlQueryEmpty"),
        });
        return false;
      }
    }
    // NOTE: the custom/measure "Column is required when using an aggregate
    // function." gate USED to live here as a toast-only check. It moved into the
    // composed schema (QueryConfig.schema.ts, the isCustom && isMeasure block)
    // so the name-bound <OFormSelect> actually renders the error — an imperative
    // toast can never paint a field, which is why the red highlight main drew
    // (via QueryConfig's `columnSelectError` ref) went missing. Save stays
    // blocked: a schema issue fails handleSubmit before onSubmit runs, so this
    // function is never even reached in that state.
    return true;
  };

  let callAlert: Promise<{ data: any }>;

  // Post-schema scheduled/realtime save. Runs ONLY after the composed schema
  // passes (via handleSubmit); preserves the imperative gates + the payload
  // assembly byte-for-byte (Rule ④ payload parity). The payload is built from
  // `form.state.values` — the synchronous source of truth (formData is its
  // reactive read-view and can lag by a tick after a just-written setF).
  const onSubmit = async () => {
    // Composite alerts have no top-level query/cron/UDS to gate — skip those
    // checks (they were already validated via validateCompositeAlert).
    if (!composite.value) {
    if (!runImperativeQueryChecks()) return false;

    if (
      formData.value.is_real_time == "false" &&
      formData.value.query_condition.type == "sql" &&
      !getParser(formData.value.query_condition.sql)
    ) {
      activeTab.value = "condition";
      toast({
        variant: "error",
        message: t("alerts.messages.selectAllColumnsNotAllowed"),
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
      setF("tz_offset", convertedDateTime.offset);
    }

    // Validate UDS
    const udsValidation = validateConditionsAgainstUDS();
    if (!udsValidation.isValid) {
      const invalidCount = udsValidation.invalidFields.length;
      let message = "";

      // Three DISTINCT sentence shapes (singular / short list / truncated list),
      // not one pluralised message — vue-i18n plural forms can't reproduce the
      // third branch's extra params, so the hand-rolled branching stays and each
      // shape gets its own key.
      if (invalidCount === 1) {
        message = t("alerts.messages.udsFieldNotAvailable", {
          field: udsValidation.invalidFields[0],
        });
      } else if (invalidCount <= 3) {
        message = t("alerts.messages.udsFieldsNotAvailable", {
          fields: udsValidation.invalidFields
            .map((f: string) => `"${f}"`)
            .join(", "),
        });
      } else {
        const firstThree = udsValidation.invalidFields
          .slice(0, 3)
          .map((f: string) => `"${f}"`)
          .join(", ");
        const remaining = invalidCount - 3;
        message = t("alerts.messages.udsFieldsNotAvailableTruncated", {
          count: invalidCount,
          fields: firstThree,
          remaining,
        });
      }

      toast({
        variant: "error",
        message: message,
        timeout: 6000,
      });

      activeTab.value = "condition";
      return false;
    }
    } // end if (!composite.value)

    const payload = getAlertPayload();

    // Composite alerts are edited on a local model kept out of the OForm: inject
    // the spec + its shared schedule into the payload here. The backend ignores
    // the top-level stream/query for a composite.
    if (composite.value) {
      payload.composite = cloneDeep(composite.value);
      payload.is_real_time = false;
      const ct = compositeTrigger.value || {};
      payload.trigger_condition = {
        ...payload.trigger_condition,
        period: parseInt(ct.period),
        frequency: parseInt(ct.frequency),
        silence: parseInt(ct.silence),
        frequency_type: ct.frequency_type || "minutes",
        cron: ct.cron || "",
        timezone: ct.timezone || "UTC",
      };
    }

    const dismiss = toast({
      variant: "loading",
      message: t("common.pleaseWait"),
      timeout: 0,
    });

    if (
      formData.value.is_real_time == "false" &&
      formData.value.query_condition.type == "sql"
    ) {
      try {
        await validateSqlQueryPromise.value;
      } catch (error) {
        dismiss();
        toast({
          variant: "error",
          message: t("alerts.messages.sqlValidationRequestFailed"),
          timeout: 1500,
        });
        console.error("Error while validating sql query", error);
        return false;
      }
    }

    // VERSION HANDLING - wrap conditions with version field for backend
    payload.query_condition.conditions = {
      version: 2,
      conditions: form.state.values.query_condition.conditions,
    };

    // Composite alerts carry their query on each term, not the top-level
    // query_condition. Normalize each term for the back-end payload.
    if (payload.composite) {
      transformCompositeTermsForSave(payload);
    }

    if (beingUpdated.value) {
      payload.folder_id =
        router.currentRoute.value.query.folder || "default";
      callAlert = alertsService.update_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );
      // Hold the settled promise so onSubmit (and therefore the form's
      // isSubmitting) spans the whole request — otherwise the Save button
      // re-enables in the same tick and repeat clicks fire duplicate saves.
      const request = callAlert
        .then((res: { data: any }) => {
          resetForm(defaultAlertValue());
          emit("update:list", activeFolderId.value);
          addAlertForm.value?.resetValidation();
          dismiss();
          toast({
            variant: "success",
            message: t("alerts.messages.alertUpdated"),
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
      return request;
    } else {
      payload.folder_id = activeFolderId.value;
      callAlert = alertsService.create_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );

      // Same as the update branch: returned below so isSubmitting spans the request.
      const request = callAlert
        .then((res: { data: any }) => {
          resetForm(defaultAlertValue());
          emit("update:list", activeFolderId.value);
          addAlertForm.value?.resetValidation();
          dismiss();
          toast({
            variant: "success",
            message: t("alerts.messages.alertSaved"),
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
      return request;
    }
  };

  // useOForm's onSubmit handler (wired at form creation). Runs after the schema
  // passes. Anomaly bypasses the alert form/payload entirely (its own OForm +
  // saveAnomalyDetection). The anomaly schema branch is pass-through, so this is
  // still reached in anomaly mode and delegates correctly.
  const performSave = async () => {
    if (isAnomalyMode.value) {
      await saveAnomalyDetection();
      return;
    }
    await onSubmit();
  };

  // ── Data Initialization (replaces created() hook) ───────────────────────

  const initializeFormData = async () => {
    // Build the full alert object in a LOCAL var, apply every transform, then
    // seed the ONE form with a single form.reset (Rule ③ — NOT a per-field
    // setFieldValue loop, NOT a mirror). The form-only extras (logGroupBy /
    // _meta) are added by resetForm().
    const data: any = { ...defaultAlertValue(), ...cloneDeep(props.modelValue) };

    const route = router.currentRoute.value;
    const isFromPanel =
      route.query.fromPanel === "true" && route.query.panelData;

    if (!props.isUpdated) {
      data.is_real_time = alertType.value === "realTime" ? true : false;
    }
    data.is_real_time = data.is_real_time.toString();

    if (store.state?.zoConfig?.min_auto_refresh_interval)
      data.trigger_condition.frequency = Math.max(
        10,
        Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60 || 10),
      );

    beingUpdated.value = props.isUpdated;

    // Edit prefill (modelValue carries a saved alert).
    let pendingTimezoneOffset: number | null = null;
    if (
      props.modelValue &&
      props.modelValue.name != undefined &&
      props.modelValue.name != ""
    ) {
      beingUpdated.value = true;
      disableColor.value = "grey-5";
      // Replace the working object with the saved alert (mirrors the old
      // `formData.value = cloneDeep(modelValue)` full swap).
      Object.keys(data).forEach((k) => delete data[k]);
      Object.assign(data, cloneDeep(props.modelValue));
      // Guard the enterprise workflows link: the edited alert is expected to
      // carry `workflows` (v2 GET returns it, serde-defaulted to []), but if a
      // partially-populated row is ever passed, default it so an edit-save can't
      // silently wipe existing links. Must run AFTER the swap above, which
      // replaces every key on `data`.
      if (!Array.isArray(data.workflows)) data.workflows = [];
      isAggregationEnabled.value = !!data.query_condition.aggregation;

      if (data.query_condition.promql_condition) {
        if (!data.query_condition.promql_condition.column) {
          data.query_condition.promql_condition.column = "value";
        }
        if (!data.query_condition.promql_condition.operator) {
          data.query_condition.promql_condition.operator = ">=";
        }
        if (
          data.query_condition.promql_condition.value === undefined ||
          data.query_condition.promql_condition.value === null
        ) {
          data.query_condition.promql_condition.value = 1;
        }
      }

      lastValidStep.value = 6;

      if (!data.trigger_condition?.timezone) {
        if (data.tz_offset === 0) {
          data.trigger_condition.timezone = "UTC";
        } else {
          // Resolved async AFTER the form.reset below → setF in the .then.
          pendingTimezoneOffset = data.tz_offset;
        }
      }

      if (data.query_condition.vrl_function) {
        showVrlFunction.value = true;
        data.query_condition.vrl_function = smartDecodeVrlFunction(
          data.query_condition.vrl_function,
        );
      }

    }

    data.is_real_time = data.is_real_time.toString();

    // Convert context_attributes from object to array format
    if (
      data.context_attributes &&
      typeof data.context_attributes === "object" &&
      !Array.isArray(data.context_attributes)
    ) {
      data.context_attributes = Object.keys(data.context_attributes).map(
        (attr) => ({
          key: attr,
          value: data.context_attributes[attr],
          id: getUUID(),
        }),
      );
    } else if (!data.context_attributes) {
      data.context_attributes = [];
    }

    // VERSION DETECTION AND CONVERSION
    if (
      data.query_condition.conditions?.version === "2" ||
      data.query_condition.conditions?.version === 2
    ) {
      data.query_condition.conditions = ensureIds(
        data.query_condition.conditions.conditions,
      );
    } else if (
      data.query_condition.conditions &&
      !Array.isArray(data.query_condition.conditions) &&
      Object.keys(data.query_condition.conditions).length != 0
    ) {
      const version = detectConditionsVersion(data.query_condition.conditions);

      if (version === 0) {
        data.query_condition.conditions = ensureIds(
          convertV0ToV2(data.query_condition.conditions),
        );
      } else if (version === 1) {
        if (
          data.query_condition.conditions.and ||
          data.query_condition.conditions.or
        ) {
          data.query_condition.conditions = ensureIds(
            convertV1BEToV2(data.query_condition.conditions),
          );
        } else if (
          data.query_condition.conditions.label &&
          data.query_condition.conditions.items
        ) {
          data.query_condition.conditions = ensureIds(
            convertV1ToV2(data.query_condition.conditions),
          );
        }
      } else {
        data.query_condition.conditions = ensureIds(
          data.query_condition.conditions,
        );
      }
    } else if (
      Array.isArray(data.query_condition.conditions) &&
      data.query_condition.conditions.length > 0
    ) {
      data.query_condition.conditions = ensureIds(
        convertV0ToV2(data.query_condition.conditions),
      );
    } else if (
      data.query_condition.conditions == null ||
      data.query_condition.conditions == undefined ||
      data.query_condition.conditions.length == 0 ||
      Object.keys(data.query_condition.conditions).length == 0
    ) {
      data.query_condition.conditions = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
        groupId: getUUID(),
      };
    }

    // Composite alerts are edited on a local mutable model (the form read-view
    // is immutable). Seed it from the loaded alert, rehydrate each term's query
    // (BE→FE), and keep it OUT of the OForm so the composed schema never gates
    // a composite on the missing top-level stream/query.
    if (data.composite) {
      composite.value = cloneDeep(data.composite);
      rehydrateCompositeTerms(composite.value);
      compositeTrigger.value = cloneDeep(data.trigger_condition);
      delete data.composite;
    } else {
      composite.value = null;
      compositeTrigger.value = null;
    }

    // Seed the ONE form (single source of truth) with the fully-transformed obj.
    resetForm(data);

    // Resolve the timezone from the stored offset (edit prefill) after the reset.
    if (pendingTimezoneOffset != null) {
      getTimezonesByOffset(pendingTimezoneOffset).then((res: any) => {
        if (res.length > 1) showTimezoneWarning.value = true;
        setF("trigger_condition.timezone", res[0]);
      });
    }

    // Panel import writes into the now-seeded form via setFieldValue.
    if (isFromPanel) {
      setF("query_condition.type", "");
      await loadPanelDataIfPresent();
    }

    updateStreams(false)?.then(() => {
      updateEditorContent(formData.value.stream_name);
    });
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
      setF(
        "destinations",
        (formData.value.destinations ?? []).filter((destination: any) => {
          return props.destinations.some((dest: any) => {
            return dest.name === destination;
          });
        }),
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
          setF("query_condition.promql_condition", {
            column: "value",
            operator: ">=",
            value: 1,
          });
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
      setF("is_real_time", "anomaly");
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
        setF("is_real_time", "anomaly");
        setF("name", data.name);
        setF("stream_name", data.stream_name);
        setF("stream_type", data.stream_type);
        if (data.folder_id) activeFolderId.value = data.folder_id;
        anomalyEditMode.value = true;
        lastValidStep.value = 6;
      } catch {
        toast({
          variant: "error",
          message: t("alerts.messages.anomalyConfigLoadFailed"),
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
    store,
    router,
    track,

    // Composite alert local model (decoupled from the OForm)
    composite,
    compositeTrigger,
    isComposite,
    enableComposite,
    disableComposite,

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
    anomalyStatusVariant,
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
    sqlErrorRanges,
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
    getFormattedDestinations,
    generatedSqlQuery,

    // Form (Rule ③ owner) + write helpers
    form,
    setF,
    resetForm,

    // Methods
    editorUpdate,
    updateEditorContent,
    updateStreamFields,
    updateStreams,
    filterStreams,
    generateSqlQuery: generateSqlQueryLocal,
    onInputUpdate,
    getAlertPayload,
    updateSqlQuery,
    updatePromqlQuery,
    updateVrlFunction,
    updateAggregation,
    updatePromqlCondition,
    updateTriggerCondition,
    updateTemplate,
    updateContextAttributes,
    updateDescription,
    updateRowTemplate,
    updateRowTemplateType,
    updateDeduplication,
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
    updateWorkflows,
    updateTab,
    handleGoToSqlEditor,
    clearMultiWindows,
    handleEditorStateChanged,
    handleEditorClosed,
    routeToCreateDestination,
    openEditorDialog,
    openJsonEditor,
    jsonEditorData,
    saveAlertJson,
    loadPanelDataIfPresent,
    handleSave,
    onSubmit,
    saveAnomalyDetection,
    previewAlert,
    focusOnFirstError,
    handleAlertError,
    getParser,
    initializeFormData,

    // Constants/utils
    "info": "info",
    getTimezoneOffset,
    isValidResourceName,
    convertDateToTimestamp,
    getTimezonesByOffset,
  };
}
