/**
 * Alert Payload Generation Utilities
 */

import { cloneDeep } from "lodash-es";
import { b64EncodeUnicode } from "@/utils/zincutils";
import alertsService from "@/services/alerts";
import { transformFEToBE } from "./alertDataTransforms";
import { toast } from "@/lib/feedback/Toast/useToast";

export interface PayloadFormData {
  name: string;
  description: string;
  is_real_time: boolean | string;
  trigger_condition: {
    threshold: number | string;
    operator: string;
    period: number | string;
    frequency: number | string;
    silence: number | string;
  };
  context_attributes: Array<{ key: string; value: string }>;
  query_condition: {
    type: string;
    aggregation?: any;
    conditions: any[];
    promql_condition?: any;
    sql: string;
    vrl_function?: string | null;
  };
  stream_name: string;
  stream_type: string;
  row_template?: string;
  row_template_type?: string;
  creates_incident?: boolean;
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

export const getAlertPayload = (
  formData: PayloadFormData,
  context: PayloadContext,
): any => {
  const { store, isAggregationEnabled, getSelectedTab, beingUpdated } = context;
  const payload = cloneDeep(formData);

  // Deleting uuid from payload as it was added for reference of frontend
  if (payload.uuid) delete payload.uuid;

  // Same reason: `payload` is a cloneDeep of the whole form value set, so
  // anything seeded into the form leaks to the backend unless dropped here.
  stripFormExtras(payload);

  payload.is_real_time = payload.is_real_time === "true";

  payload.context_attributes = {} as any;

  payload.query_condition.type = payload.is_real_time
    ? "custom"
    : formData.query_condition.type;

  formData.context_attributes.forEach((attr: any) => {
    if (attr.key?.trim() && attr.value?.trim())
      payload.context_attributes[attr.key] = attr.value;
  });

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

  payload.trigger_condition.period = parseInt(formData.trigger_condition.period as any);

  payload.trigger_condition.frequency = parseInt(formData.trigger_condition.frequency as any);

  payload.trigger_condition.silence = parseInt(formData.trigger_condition.silence as any);

  payload.description = formData.description.trim();

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

export const prepareAndSaveAlert = async (
  data: any,
  context: SaveAlertContext,
): Promise<void> => {
  const {
    store,
    props,
    emit,
    router,
    isAggregationEnabled,
    activeFolderId,
    handleAlertError,
  } = context;

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
      message: "Please wait...",
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
        message: "Alert updated successfully.",
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
        message: "Alert saved successfully.",
      });
    }
    dismiss();
  } catch (err: any) {
    handleAlertError(err);
  }
};
