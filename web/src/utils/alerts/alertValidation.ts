/**
 * Alert Validation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import searchService from "@/services/search";
import CronExpressionParser from "cron-parser";
import { b64EncodeUnicode } from "@/utils/zincutils";
import useStreams from "@/composables/useStreams";

interface QueryCondition {
  conditions?: {
    groupId?: string;
    label?: string;
    items?: Array<{
      column: string;
      operator: string;
      value: string;
      ignore_case: boolean;
      id: string;
    }>;
    or?: Array<{
      column: string;
      operator: string;
      value: string;
      ignore_case?: boolean;
    }>;
    and?: Array<{
      column: string;
      operator: string;
      value: string;
      ignore_case?: boolean;
    }>;
  };
  sql?: string | null;
  promql?: string | null;
  type: 'custom' | 'sql' | 'promql';
  aggregation?: {
    group_by: string[];
    function: string;
    having: {
      column: string;
      operator: string;
      value: number;
    };
  };
  promql_condition?: any | null;
  vrl_function?: string | null;
  multi_time_range?: any[] | null;
}

interface TriggerCondition {
  period: number;
  operator: string;
  frequency: number;
  cron: string;
  threshold: number;
  silence: number;
  frequency_type: 'minutes' | 'cron';
  timezone: string;
}

interface Alert {
  name: string;
  stream_type: string;
  stream_name: string;
  is_real_time: boolean | string;
  query_condition: QueryCondition;
  trigger_condition: TriggerCondition;
  destinations: string[];
  context_attributes: any[];
  enabled: boolean;
  description?: string;
  lastTriggeredAt?: number;
  createdAt?: string;
  updatedAt?: string;
  owner?: string;
  lastEditedBy?: string;
  folder_id?: string;
  org_id?: string;
}

interface AlertValidationContext {
  streamList: string[];
  destinationsList: string[];
  selectedOrgId: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateAlert(alert: Alert, context?: AlertValidationContext): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: []
  };

  // Validate name
  if (!alert.name || typeof alert.name !== 'string' || alert.name.trim() === '') {
    result.errors.push('Name is mandatory and should be a valid string');
  }

  // Validate org_id if provided
  if (alert.org_id) {
    if (alert.org_id !== context?.selectedOrgId) {
      result.errors.push(`Organization Id should be equal to ${context?.selectedOrgId}`);
    }
  }

  // Validate stream_type
  const validStreamTypes = ['logs', 'metrics', 'traces'];
  if (!alert.stream_type || !validStreamTypes.includes(alert.stream_type)) {
    result.errors.push('Stream Type is mandatory and should be one of: logs, metrics, traces');
  }

  // Validate stream_name
  if (!alert.stream_name || typeof alert.stream_name !== 'string') {
    result.errors.push('Stream Name is mandatory and should be a valid string');
  } else if (context?.streamList && !context.streamList.includes(alert.stream_name)) {
    result.errors.push(`Stream "${alert.stream_name}" does not exist in the stream list`);
  }

  // Validate is_real_time
  if (typeof alert.is_real_time === 'string') {
    // Convert string 'true'/'false' to boolean
    alert.is_real_time = alert.is_real_time.toLowerCase() === 'true';
  }
  if (typeof alert.is_real_time !== 'boolean') {
    result.errors.push('Is Real-Time is mandatory and should be a boolean value');
  }

  // Validate query_condition
  if (alert.query_condition) {
    // Validate based on query type
    switch (alert.query_condition.type) {
      case 'custom':
        // Handle both condition formats
        if (alert.query_condition.conditions) {
          // Format 1: Using groupId and items
          if (alert.query_condition.conditions.items) {
            if (!Array.isArray(alert.query_condition.conditions.items)) {
              result.errors.push('Query conditions items should be an array');
            } else {
              // Validate each condition item
              alert.query_condition.conditions.items.forEach((item, index) => {
                if (!item.column || !item.operator || item.value === undefined) {
                  result.errors.push(`Query condition item ${index + 1} must have column, operator, and value`);
                }
                
                const validOperators = ['=', '>', '<', '>=', '<=', 'Contains', 'NotContains'];
                if (!validOperators.includes(item.operator)) {
                  result.errors.push(`Invalid operator "${item.operator}" in query condition item ${index + 1}`);
                }
              });
            }
          }
          // Format 2: Using or/and array
          else if (alert.query_condition.conditions.or || alert.query_condition.conditions.and) {
            const conditions = alert.query_condition.conditions.or || alert.query_condition.conditions.and;
            if (!Array.isArray(conditions)) {
              result.errors.push('Query conditions or/and should be an array');
            } else {
              conditions.forEach((condition, index) => {
                if (!condition.column || !condition.operator || condition.value === undefined) {
                  result.errors.push(`Query condition ${index + 1} must have column, operator, and value`);
                }

                const validOperators = ['=', '>', '<', '>=', '<=', 'Contains', 'NotContains'];
                if (!validOperators.includes(condition.operator)) {
                  result.errors.push(`Invalid operator "${condition.operator}" in condition ${index + 1}`);
                }

                // Validate ignore_case if present
                if (condition.ignore_case !== undefined && typeof condition.ignore_case !== 'boolean') {
                  result.errors.push(`ignore_case must be a boolean in condition ${index + 1}`);
                }
              });
            }
          } else {
            result.errors.push('Invalid conditions format. Must use either items array or or/and array');
          }
        }

        // Validate multi_time_range for custom type
        if (alert.query_condition.multi_time_range !== null && 
            (!Array.isArray(alert.query_condition.multi_time_range) || alert.query_condition.multi_time_range.length !== 0)) {
          result.errors.push('Multi Time Range should be an empty array or null');
        }

        // Remove the SQL/PromQL validation for custom type since it's not needed
        break;

      case 'sql':
        if (!alert.query_condition.sql || typeof alert.query_condition.sql !== 'string' || alert.query_condition.sql.trim() === '') {
          result.errors.push('SQL query is required');
        } else {
          const sqlQuery = alert.query_condition.sql.trim().toLowerCase();
          // Check for select * pattern
          if (sqlQuery.includes('select *') || sqlQuery.includes('select\n*') || sqlQuery.includes('select\t*')) {
            result.errors.push('Selecting all columns is not allowed. Please specify the columns explicitly');
          }
          // Check if it's a valid SELECT query
          if (!sqlQuery.startsWith('select ')) {
            result.errors.push('SQL query must start with SELECT');
          }
        }
        break;

      case 'promql':
        if (!alert.query_condition.promql || typeof alert.query_condition.promql !== 'string' || alert.query_condition.promql.trim() === '') {
          result.errors.push('PromQL query is required');
        }
        break;

      default:
        result.errors.push('Invalid query condition type');
    }

    // Validate VRL function if present
    if (alert.query_condition.vrl_function && typeof alert.query_condition.vrl_function !== 'string') {
      result.errors.push('VRL function should be a string when provided');
    }

    // Validate aggregation if present
    if (alert.query_condition.aggregation) {
      const agg = alert.query_condition.aggregation;
      
      // Validate group_by array
      if (!Array.isArray(agg.group_by)) {
        result.errors.push('Aggregation group_by should be an array');
      }

      // Validate function
      if (!agg.function || typeof agg.function !== 'string' || agg.function.trim() === '') {
        result.errors.push('Aggregation function is required and should be a non-empty string');
      }

      // Validate having clause structure
      if (agg.having && typeof agg.having === 'object') {
        // Only validate operator and value if they are provided
        if (agg.having.operator && (typeof agg.having.operator !== 'string' || !['>=', '<=', '>', '<', '=', '!='].includes(agg.having.operator))) {
          result.errors.push('Aggregation having clause operator must be a valid comparison operator');
        }
        if (agg.having.value !== undefined && typeof agg.having.value !== 'number') {
          result.errors.push('Aggregation having clause value must be a number when provided');
        }
      }
    }
  }

  // Validate trigger_condition
  if (alert.trigger_condition) {
    const trigger = alert.trigger_condition;

    // Validate period
    if (typeof trigger.period !== 'number' || trigger.period < 1) {
      result.errors.push('Period should be a positive number greater than 0');
    }

    // Validate operator
    const validOperators = ['=', '!=', '>=', '<=', '>', '<', 'Contains', 'NotContains'];
    if (!validOperators.includes(trigger.operator)) {
      result.errors.push(`Invalid operator "${trigger.operator}" in trigger condition`);
    }

    // Validate frequency
    if (typeof trigger.frequency !== 'number' || trigger.frequency < 1) {
      result.errors.push('Frequency should be a positive number greater than 0');
    }

    // Validate threshold
    if (typeof trigger.threshold !== 'number' || trigger.threshold < 1) {
      result.errors.push('Threshold should be a positive number greater than 0');
    }

    // Validate silence
    if (typeof trigger.silence !== 'number' || trigger.silence < 1) {
      result.errors.push('Silence should be a positive number greater than 0');
    }

    // Validate frequency_type and related fields
    if (!['minutes', 'cron'].includes(trigger.frequency_type)) {
      result.errors.push('Frequency Type must be either minutes or cron');
    }

    if (trigger.frequency_type === 'cron') {
      if (!trigger.cron || trigger.cron.trim() === '') {
        result.errors.push('Cron expression is required when frequency type is cron');
      }
      if (!trigger.timezone || trigger.timezone.trim() === '') {
        result.errors.push('Timezone is required when frequency type is cron');
      }
    }
  } else {
    result.errors.push('Trigger condition is required');
  }
  // Validate destinations
  if (!Array.isArray(alert.destinations)) {
    result.errors.push('Destinations must be an array');
  } else if (alert.destinations.length === 0) {
    result.errors.push('At least one destination is required');
  } else if (context?.destinationsList) {
    // Debug check for destinations list
    if (!Array.isArray(context.destinationsList) || context.destinationsList.length === 0) {
      result.errors.push('No available destinations found in system');
    } else {
      const invalidDestinations = alert.destinations.filter(dest => !context.destinationsList.includes(dest));
      if (invalidDestinations.length > 0) {
        result.errors.push(`Invalid destinations: ${invalidDestinations.map(dest => `"${dest}"`).join(', ')} - must be from available destinations list`);
      }
    }
  }

  // Validate enabled flag
  if (typeof alert.enabled !== 'boolean') {
    result.errors.push('Enabled flag must be a boolean');
  }

  result.isValid = result.errors.length === 0;
  return result;
}

export interface ValidationContext {
  q: any;
  store: any;
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
  const { q } = context;

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

  // Validate cron expression if frequency type is cron
  if (input.trigger_condition.frequency_type === "cron") {
    try {
      CronExpressionParser.parse(input.trigger_condition.cron!, {
        currentDate: new Date(),
        utc: true,
      });
    } catch (err) {
      console.log(err);
      notify &&
        q.notify({
          type: "negative",
          message: "Invalid cron expression!",
          timeout: 1500,
        });
      return false;
    }

    // Validate timezone is set for cron
    if (!input.trigger_condition.timezone || input.trigger_condition.timezone.trim() === '') {
      notify &&
        q.notify({
          type: "negative",
          message: "Timezone is required for cron schedule",
          timeout: 1500,
        });
      return false;
    }
  } else if (input.trigger_condition.frequency_type === "minutes") {
    // Validate frequency for minutes type
    const frequency = Number(input.trigger_condition.frequency);
    if (isNaN(frequency) || frequency < 1) {
      notify &&
        q.notify({
          type: "negative",
          message: "Frequency should be greater than 0",
          timeout: 1500,
        });
      return false;
    }
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

  // Skip validation if SQL query is empty or only whitespace
  if (!formData.query_condition.sql || formData.query_condition.sql.trim() === '') {
    sqlQueryErrorMsg.value = "";
    return;
  }

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
        validate: true,
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

        // Error message is displayed inline below the editor
        // No need for toast notification as it's redundant

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