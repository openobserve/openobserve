/**
 * Alert Payload Generation Utilities
 */

import { cloneDeep } from "lodash-es";
import { b64EncodeUnicode } from "@/utils/zincutils";
import alertsService from "@/services/alerts";
import { transformFEToBE } from "./alertDataTransforms";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, type TranslateFn, type I18nText } from "@/types/i18n";

export interface PayloadFormData {
  name: string;
  description: I18nText;
  is_real_time: boolean | string;
  /** Minutes on the form; getAlertPayload converts to seconds on the wire. */
  pending_period_sec: number | string;
  trigger_condition: {
    threshold: number | string;
    operator: string;
    period: number | string;
    frequency: number | string;
    silence: number | string;
    /**
     * The second, lower rung of the count gate (T-5 multi-level thresholds).
     * Optional because the field is only rendered for the alert families that
     * have a count axis — `QueryConfig.vue` registers it as
     * `trigger_condition.warning_threshold` and the schema types it
     * `z.unknown().optional()`, so it arrives as the raw input string, as a
     * number, or not at all. An SLO alert has no count axis and this key is
     * DELETED from its payload (SA-4), which is why the type has to admit its
     * absence rather than the builder casting around it.
     */
    warning_threshold?: number | string | null;
  };
  context_attributes: Array<{ key: string; value: string }>;
  query_condition: {
    type: string;
    aggregation?: any;
    conditions: any[];
    promql_condition?: any;
    sql: string;
    vrl_function?: string | null;
    /**
     * The SLO burn/budget condition. The backend enforces
     * `query_type == "slo"` IFF this is present, in BOTH directions, so a
     * non-SLO alert must ship it as an explicit `null` rather than leaving a
     * stale one behind — which is exactly what the builder below does, and
     * what it could not express while this key was undeclared.
     */
    slo_condition?: any;
  };
  stream_name: string;
  stream_type: string;
  row_template?: string;
  row_template_type?: string;
  creates_incident?: boolean;
  /** Feature 2: integer storage id 1..5, or null/undefined when unset. */
  priority?: number | string | null;
  tags?: string[];
  uuid?: string;
  updatedAt?: string;
  createdAt?: string;
  owner?: string;
  lastTriggeredAt?: number;
  lastEditedBy?: string;
}

export interface PayloadContext {
  store: any;
  isAggregationEnabled: { value: boolean };
  getSelectedTab: { value: string };
  beingUpdated: boolean;
}

export interface SaveAlertContext {
  store: any;
  t: TranslateFn;
  props: any;
  emit: any;
  router: any;
  isAggregationEnabled: { value: boolean };
  activeFolderId: { value: string };
  handleAlertError: (err: any) => void;
}

/**
 * Drop the FORM-ONLY keys that are seeded into the form (by `withFormExtras`) but
 * are not part of the alert resource:
 *   _ui        → display-only state (the "Check every" hours/minutes value the
 *                user sees; the real value is trigger_condition.frequency)
 *   _meta      → schema discriminators (tab / mode / org floor)
 *   logGroupBy → the logs group-by field array (mirrored into
 *                query_condition.aggregation.group_by)
 * Mutates and returns `obj`.
 *
 * BOTH save paths must use this: the normal one (getAlertPayload) and the JSON
 * editor one (prepareAndSaveAlert). It is also applied to the JSON editor's
 * displayed data, so users never see or edit these internal keys.
 */
export const stripFormExtras = <T>(obj: T): T => {
  delete (obj as any)._ui;
  delete (obj as any)._meta;
  delete (obj as any).logGroupBy;
  return obj;
};

export const getAlertPayload = (formData: PayloadFormData, context: PayloadContext): any => {
  const { store, isAggregationEnabled, getSelectedTab, beingUpdated } = context;
  const payload = cloneDeep(formData);

  // Deleting uuid from payload as it was added for reference of frontend
  if (payload.uuid) delete payload.uuid;

  // Same reason: `payload` is a cloneDeep of the whole form value set, so
  // anything seeded into the form leaks to the backend unless dropped here.
  stripFormExtras(payload);

  payload.is_real_time = payload.is_real_time === "true";

  payload.context_attributes = {} as any;

  payload.query_condition.type = payload.is_real_time ? "custom" : formData.query_condition.type;

  formData.context_attributes.forEach((attr: any) => {
    if (attr.key?.trim() && attr.value?.trim()) payload.context_attributes[attr.key] = attr.value;
  });

  // SQL tab's Simple/Multi choice (no group-by picker): QueryConfig.vue
  // already builds `aggregation` via the same having.operator/.value fields
  // Custom's Measure mode uses, plus a value-column dropdown sourced from the
  // query's resolved output columns (sql_simple_multi_alert_fe_prd.md §11) —
  // this flag decides whether that object survives the tab-based null below,
  // and gates the field-pinning required by the backend's SQL multi-alert
  // schema contract (group_by: [], function: "count"; having.column is
  // whatever column the user picked).
  const isSqlMultiAlert =
    getSelectedTab.value === "sql" && !!formData.query_condition.aggregation?.multi_alert;

  payload.trigger_condition.threshold = parseInt(formData.trigger_condition.threshold as any);

  // If aggregation is enabled in custom (builder) mode but no group-by fields are set,
  // the "Having groups" row is hidden — force threshold to >= 1 so no stale value leaks into the payload.
  if (
    isAggregationEnabled.value &&
    getSelectedTab.value === "custom" &&
    !(formData.query_condition?.aggregation?.group_by || []).filter((g: string) => g?.trim()).length
  ) {
    payload.trigger_condition.threshold = 1;
    payload.trigger_condition.operator = ">=";
  }

  // SQL Multi Alert: the any-group-count gate is always "at least 1" (M-10),
  // same rule as the Custom group-by case above.
  if (isSqlMultiAlert) {
    payload.trigger_condition.threshold = 1;
    payload.trigger_condition.operator = ">=";
  }

  payload.trigger_condition.period = parseInt(formData.trigger_condition.period as any);

  payload.trigger_condition.frequency = parseInt(formData.trigger_condition.frequency as any);

  payload.trigger_condition.silence = parseInt(formData.trigger_condition.silence as any);

  // Minutes on the form, seconds on the wire. Forced to 0 for realtime even
  // though the field is unreachable in that template — same belt-and-suspenders
  // as the warning_threshold strip below, in case a stale value survives a
  // realtime<->scheduled toggle without a full remount.
  payload.pending_period_sec = payload.is_real_time
    ? 0
    : Math.round((parseInt(formData.pending_period_sec as any, 10) || 0) * 60);

  payload.description = raw(formData.description.trim());

  if (!isSqlMultiAlert && (!isAggregationEnabled.value || getSelectedTab.value !== "custom")) {
    payload.query_condition.aggregation = null;
  } else if (isSqlMultiAlert) {
    // Pin the fields this simple flow has no picker for (src/core/src/alerts/alert.rs,
    // prepare_alert) — group_by is always empty, function is fixed. The value
    // column is NOT pinned: it's user-chosen via a dropdown sourced from the
    // query's resolved output columns (sql_simple_multi_alert_fe_prd.md §11),
    // so `having.column` already carries the user's selection from form state.
    payload.query_condition.aggregation.group_by = [];
    payload.query_condition.aggregation.function = "count";
  }

  if (getSelectedTab.value === "sql" || getSelectedTab.value === "promql")
    payload.query_condition.conditions = [];

  if (getSelectedTab.value === "sql" || getSelectedTab.value === "custom") {
    payload.query_condition.promql_condition = null;
  }

  if (getSelectedTab.value === "promql") {
    payload.query_condition.sql = "";
  }

  // Feature 5 (§6b.6). The backend enforces `query_type == slo` IFF
  // `slo_condition` is present, in BOTH directions, so the two must be kept in
  // lockstep here:
  //
  //  * a non-SLO alert must not carry a condition left over from a mode switch — it is rejected
  //    outright, not ignored;
  //  * an SLO alert runs NO query, so any SQL, builder condition, aggregation or PromQL condition
  //    it picked up on the way would be stored and then never read.
  if (getSelectedTab.value === "slo") {
    payload.query_condition.sql = "";
    payload.query_condition.conditions = [];
    payload.query_condition.promql_condition = null;
    payload.query_condition.aggregation = null;

    // SA-4: an SLO alert has no count axis, and the backend REJECTS a
    // non-default count gate rather than ignoring it. The SLO tab renders no
    // count-gate field, but the form still holds whatever the Builder tab
    // defaulted to (">=" / 3) — so without this reset the save fails with
    // "SLO alerts have no count gate", naming a control the user cannot see.
    //
    // The values must match `TriggerCondition::default()` on the backend:
    // `Operator::EqualTo` serializes to "=" and `threshold` is 0.
    payload.trigger_condition.operator = "=";
    payload.trigger_condition.threshold = 0;
    // Part of the same gate: a warning on a count gate has no meaning for a
    // family that has no gate, and is rejected alongside the other two.
    delete payload.trigger_condition.warning_threshold;
  } else {
    payload.query_condition.slo_condition = null;
  }

  // `having.value` and `promql_condition.value` arrive here as the RAW STRING the
  // input produced. Both are name=-owned OFormInputs, and OFormInput registers
  // `v-bind="$attrs"` BEFORE its own @update:model-value="field.handleChange" — so
  // QueryConfig's Number()-coercing consumer handler runs FIRST and handleChange
  // commits the raw string LAST, overwriting it. Without this the saved type
  // silently drifts string-vs-number.
  //
  // Coerced HERE rather than in the form, for two reasons:
  //   • it is the same last-mile rescue threshold/period/frequency/silence already
  //     get above — one place owns payload numerics;
  //   • form state must stay the raw string while typing. Coercing on each
  //     keystroke would fight the user: "5." (mid-way to "5.5") is Number-ed to 5,
  //     snapping the field back and eating the decimal point.
  const toNumericValue = (v: unknown) => {
    if (v === "" || v === null || v === undefined) return v;
    const n = Number(v);
    // Zero-safe (Number("0") === 0). A non-numeric value is passed through
    // untouched rather than shipped as NaN (which JSON-serializes to null).
    return Number.isNaN(n) ? v : n;
  };

  if (payload.query_condition.aggregation?.having) {
    payload.query_condition.aggregation.having.value = toNumericValue(
      payload.query_condition.aggregation.having.value,
    );
  }

  if (payload.query_condition.promql_condition) {
    payload.query_condition.promql_condition.value = toNumericValue(
      payload.query_condition.promql_condition.value,
    );
  }

  // Optional WARNING fields (alerts_2.md Feature 1) get the same last-mile
  // repair: the inputs produce raw strings, and clearing one leaves "".
  // A configured value must ship numeric (the Rust fields are Option<i64>/
  // Option<f64>), and a blank must be DELETED — a serialized "" is a 400.
  const normalizeOptionalNumber = (obj: any, key: string) => {
    if (!obj || !(key in obj)) return;
    const v = obj[key];
    if (v === "" || v === null || v === undefined) {
      delete obj[key];
      return;
    }
    obj[key] = toNumericValue(v);
  };
  normalizeOptionalNumber(payload.trigger_condition, "warning_threshold");
  normalizeOptionalNumber(payload.query_condition?.aggregation, "warning_value");
  normalizeOptionalNumber(payload.query_condition, "promql_warning_value");

  // Family exclusivity (D13): a warning left over from another tab/mode must
  // not ship — the backend rejects warning_threshold on aggregation/PromQL
  // alerts (their count threshold is coverage, not severity), and
  // promql_warning_value is meaningless off the promql tab.
  if (
    getSelectedTab.value === "promql" ||
    (isAggregationEnabled.value && getSelectedTab.value === "custom") ||
    isSqlMultiAlert
  ) {
    delete (payload.trigger_condition as any).warning_threshold;
  }
  if (getSelectedTab.value !== "promql") {
    delete (payload.query_condition as any).promql_warning_value;
  }
  // Realtime alerts carry no warning family at all (D12) — and the form hides
  // the fields when realtime is selected, so anything left over from a
  // scheduled configuration is invisible to the user. The backend rejects it;
  // stripping here keeps the scheduled→realtime switch saveable.
  if (payload.is_real_time === true) {
    delete (payload.trigger_condition as any).warning_threshold;
    delete (payload.query_condition as any).promql_warning_value;
    if (payload.query_condition.aggregation) {
      delete (payload.query_condition.aggregation as any).warning_value;
    }
  }
  // notify_on_warning was removed from the UI — a breached warning always sends
  // to the destination. Never emit the flag, so the backend applies its default
  // (`notify_on_warning.unwrap_or(true)` = always notify).
  delete (payload.trigger_condition as any).notify_on_warning;

  // Feature 2 (PT-1/PT-6). The select yields a string when a user picks a
  // value, so coerce; an unset priority is DELETED rather than sent as null or
  // 0, keeping pre-Feature-2 payloads byte-identical (G5).
  if (payload.priority === null || payload.priority === undefined || payload.priority === "") {
    delete (payload as any).priority;
  } else {
    const n = Number(payload.priority);
    if (Number.isNaN(n)) delete (payload as any).priority;
    else payload.priority = n;
  }
  // Tags are normalized server-side (that is the authority); here we only drop
  // the field when empty so an untagged alert adds no key.
  if (!Array.isArray(payload.tags) || payload.tags.length === 0) {
    delete (payload as any).tags;
  }

  if (formData.query_condition.vrl_function) {
    payload.query_condition.vrl_function = b64EncodeUnicode(
      formData.query_condition.vrl_function.trim(),
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
    formData.updatedAt = new Date().toISOString();
  }

  return payload;
};

export const prepareAndSaveAlert = async (data: any, context: SaveAlertContext): Promise<void> => {
  const { store, t, props, emit, router, isAggregationEnabled, activeFolderId, handleAlertError } =
    context;

  const payload = cloneDeep(data);

  // The JSON editor's data comes from the form value set, so it can carry the
  // form-only keys.
  stripFormExtras(payload);

  if (!isAggregationEnabled.value) {
    payload.query_condition.aggregation = null;
  }

  if (Array.isArray(payload.context_attributes) && payload.context_attributes.length === 0) {
    payload.context_attributes = {};
  }

  // Transform conditions to backend format
  payload.query_condition.conditions = transformFEToBE(payload.query_condition.conditions);

  // Convert string boolean to actual boolean
  payload.is_real_time = payload.is_real_time === "true" || payload.is_real_time === true;

  // Handle VRL function encoding if present
  if (payload.query_condition.vrl_function) {
    payload.query_condition.vrl_function = b64EncodeUnicode(
      payload.query_condition.vrl_function.trim(),
    );
  }

  // Set timestamps and metadata
  if (props.isUpdated) {
    payload.updatedAt = new Date().toISOString();
    payload.lastEditedBy = store.state.userInfo.email;
    payload.folder_id = router.currentRoute.value.query.folder || "default";
  } else {
    payload.createdAt = new Date().toISOString();
    payload.owner = store.state.userInfo.email;
    payload.lastTriggeredAt = new Date().getTime();
    payload.lastEditedBy = store.state.userInfo.email;
    payload.folder_id = activeFolderId.value;
  }

  try {
    const dismiss = toast({
      variant: "loading",
      message: t("toastMessages.alerts.pleaseWait"),
      timeout: 0,
    });

    if (props.isUpdated) {
      await alertsService.update_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );
      emit("update:list", activeFolderId.value);
      toast({
        variant: "success",
        message: t("toastMessages.alerts.alertUpdatedSuccessfully"),
      });
    } else {
      await alertsService.create_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );
      emit("update:list", activeFolderId.value);
      toast({
        variant: "success",
        message: t("toastMessages.alerts.alertSavedSuccessfully"),
      });
    }
    dismiss();
  } catch (err: any) {
    handleAlertError(err);
  }
};
