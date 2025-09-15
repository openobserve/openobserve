/**
 * Alert Validation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import searchService from "@/services/search";
import cronParser from "cron-parser";
import { b64EncodeUnicode } from "@/utils/zincutils";

export interface ValidationContext {
  q: any;
  store: any;
  scheduledAlertRef: any;
  validateSqlQueryPromise: any;
  sqlQueryErrorMsg: any;
  vrlFunctionError: any;
  buildQueryPayload: any;
  getParser: (sqlQuery: string) => boolean;
}

export interface AlertFormData {
  trigger_condition: {
    silence: number | string;
    period: number | string;
    threshold: number | string;
    operator: string;
    frequency_type: string;
    cron?: string;
  };
  is_real_time: boolean | string;
  query_condition: {
    aggregation?: {
      having: {
        value: number | string;
        column: string;
        operator: string;
      };
    };
    type: string;
    sql: string;
    vrl_function?: string;
  };
  stream_name: string;
  stream_type: string;
}

export const validateInputs = (
  input: AlertFormData,
  context: ValidationContext,
  notify: boolean = true,
): boolean => {
  const { q, scheduledAlertRef } = context;

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
      isNaN(Number(input.trigger_condition.threshold)) ||
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
    isNaN(Number(input.trigger_condition.threshold)) ||
    Number(input.trigger_condition.threshold) < 1 ||
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
      cronParser.parseExpression(input.trigger_condition.cron!);
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

export const validateSqlQuery = async (
  formData: AlertFormData,
  context: ValidationContext,
): Promise<void> => {
  const {
    store,
    q,
    validateSqlQueryPromise,
    sqlQueryErrorMsg,
    vrlFunctionError,
    buildQueryPayload,
    getParser,
  } = context;

  // Delaying the validation by 300ms, as editor has debounce of 300ms. Else old value will be used for validation
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (!getParser(formData.query_condition.sql)) {
    return;
  }

  const query = buildQueryPayload({
    sqlMode: true,
    streamName: formData.stream_name,
  });

  delete query.aggs;

  // We get 15 minutes time range for the query, so reducing it by 13 minutes to get 2 minute data
  query.query.start_time = query.query.start_time + 780000000;

  query.query.sql = formData.query_condition.sql;

  if (formData.query_condition.vrl_function)
    query.query.query_fn = b64EncodeUnicode(
      formData.query_condition.vrl_function,
    );

  validateSqlQueryPromise.value = new Promise((resolve, reject) => {
    searchService
      .search({
        org_identifier: store.state.selectedOrganization.identifier,
        query,
        page_type: formData.stream_type,
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
        if (formData.query_condition.type === "sql")
          q.notify({
            type: "negative",
            message: "Invalid SQL Query : " + err.response?.data?.message,
            timeout: 3000,
          });

        reject("sql_error");
      });
  });
};