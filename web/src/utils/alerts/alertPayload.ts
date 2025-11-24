/**
 * Alert Payload Generation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import { cloneDeep } from "lodash-es";
import { b64EncodeUnicode } from "@/utils/zincutils";
import alertsService from "@/services/alerts";
import { transformFEToBE } from "./alertDataTransforms";

export interface PayloadFormData {
  name: string;
  description: string;
  is_real_time: boolean | string;
  trigger_condition: {
    threshold: number | string;
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
    vrl_function?: string;
  };
  stream_name: string;
  stream_type: string;
  row_template?: string;
  row_template_type?: string;
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
  q: any;
  store: any;
  props: any;
  emit: any;
  router: any;
  isAggregationEnabled: { value: boolean };
  activeFolderId: { value: string };
  handleAlertError: (err: any) => void;
}

export const getAlertPayload = (
  formData: PayloadFormData,
  context: PayloadContext,
): any => {
  const { store, isAggregationEnabled, getSelectedTab, beingUpdated } = context;
  const payload = cloneDeep(formData);

  // Deleting uuid from payload as it was added for reference of frontend
  if (payload.uuid) delete payload.uuid;

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
    q,
    store,
    props,
    emit,
    router,
    isAggregationEnabled,
    activeFolderId,
    handleAlertError,
  } = context;

  const payload = cloneDeep(data);
  
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
    const dismiss = q.notify({
      spinner: true,
      message: "Please wait...",
      timeout: 2000,
    });

    if (props.isUpdated) {
      await alertsService.update_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );
      emit("update:list", activeFolderId.value);
      q.notify({
        type: "positive",
        message: "Alert updated successfully.",
      });
    } else {
      await alertsService.create_by_alert_id(
        store.state.selectedOrganization.identifier,
        payload,
        activeFolderId.value,
      );
      emit("update:list", activeFolderId.value);
      q.notify({
        type: "positive",
        message: "Alert saved successfully.",
      });
    }
    dismiss();
  } catch (err: any) {
    handleAlertError(err);
  }
};
