/**
 * Alert Validation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import searchService from "@/services/search";
import cronParser from "cron-parser";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { validateAlert } from "@/utils/validateAlerts";
import useStreams from "@/composables/useStreams";

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

export interface JsonValidationContext {
  q: any;
  store: any;
  streams: any;
  getParser: (sql: string) => boolean;
  buildQueryPayload: (options: any) => any;
  prepareAndSaveAlert: (data: any) => Promise<void>;
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

export const saveAlertJson = async (
  json: any,
  props: any,
  validationErrors: any,
  showJsonEditorDialog: any,
  formData: any,
  context: JsonValidationContext,
): Promise<void> => {
  const {
    q,
    store,
    streams,
    getParser,
    buildQueryPayload,
    prepareAndSaveAlert,
  } = context;

  const { getStreams } = useStreams();

  let jsonPayload = JSON.parse(json);
  let destinationsList = [];
  props.destinations.forEach((destination: any) => {
    destinationsList.push(destination.name);
  });
  let streamList = [];

  if (!streams.value[jsonPayload.stream_type]) {
    try {
      const response: any = await getStreams(jsonPayload.stream_type, false);
      streams.value[jsonPayload.stream_type] = response.list;
    } catch (err: any) {
      if (err.response.status !== 403) {
        q.notify({
          type: "negative",
          message: err.response?.data?.message || "Error fetching streams",
          timeout: 3000,
        });
      }
    }
  }
  streams.value[jsonPayload.stream_type].forEach((stream: any) => {
    streamList.push(stream.name);
  });

  const validationResult = validateAlert(jsonPayload, {
    streamList: streamList,
    selectedOrgId: store.state.selectedOrganization.identifier,
    destinationsList: destinationsList,
  });

  if (!validationResult.isValid) {
    validationErrors.value = validationResult.errors;
    return;
  }

  // Validate SQL query if type is sql and not real-time
  if (
    jsonPayload.is_real_time === false &&
    jsonPayload.query_condition.type === "sql"
  ) {
    try {
      // First check if query has SELECT *
      if (!getParser(jsonPayload.query_condition.sql)) {
        validationErrors.value = [
          "Selecting all columns is not allowed. Please specify the columns explicitly",
        ];
        return;
      }

      // Set up query for validation
      const query = buildQueryPayload({
        sqlMode: true,
        streamName: jsonPayload.stream_name,
      });

      delete query.aggs;
      query.query.start_time = query.query.start_time + 780000000;
      query.query.sql = jsonPayload.query_condition.sql;

      if (jsonPayload.query_condition.vrl_function) {
        query.query.query_fn = b64EncodeUnicode(
          jsonPayload.query_condition.vrl_function,
        );
      }

      // Validate SQL query
      await searchService.search({
        org_identifier: store.state.selectedOrganization.identifier,
        query,
        page_type: jsonPayload.stream_type,
      });

      // If we get here, SQL is valid
      showJsonEditorDialog.value = false;
      formData.value = jsonPayload;
      await prepareAndSaveAlert(jsonPayload);
    } catch (err: any) {
      // Handle SQL validation errors
      const errorMessage = err.response?.data?.message || "Invalid SQL Query";
      validationErrors.value = [`SQL validation error: ${errorMessage}`];
      return;
    }
  } else {
    // If not SQL or is real-time, just close and update
    showJsonEditorDialog.value = false;
    formData.value = jsonPayload;
    await prepareAndSaveAlert(jsonPayload);
  }
};