/**
 * Alert Validation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import searchService from "@/services/search";
import { rangesFromServerError } from "@/utils/query/sqlDiagnostics";
import CronExpressionParser from "cron-parser";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { toast } from "@/lib/feedback/Toast/useToast";

/**
 * Injected translator. Same shape as the one the alerts `*.schema.ts` factories
 * take (see `Translator` in components/alerts/steps/QueryConfig.schema.ts) —
 * re-declared here rather than imported so this pure util keeps NO dependency on
 * the component layer. Callers pass vue-i18n's `t` (from `useI18n()`), which
 * this module cannot obtain itself: it has no Vue context.
 */
export type Translator = (key: string, named?: Record<string, unknown>) => string;

/** Last-resort translator for `validateAlert(alert)` — the context (and hence
 *  `t`) is optional there. Echoes the key back. The ONLY production caller
 *  (saveAlertJson) always supplies `t`; this exists so the no-context overload
 *  stays callable (it is exercised by validateAlerts.spec.ts, which asserts
 *  validity rather than message text on that path). */
const echoKeyTranslator: Translator = (key) => key;

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
  /** vue-i18n `t`. Optional only because `context` itself is optional; supply it
   *  from any caller whose errors reach a user. */
  t?: Translator;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateAlert(alert: Alert, context?: AlertValidationContext): ValidationResult {
  const t = context?.t ?? echoKeyTranslator;
  const result: ValidationResult = {
    isValid: true,
    errors: []
  };

  // Validate name
  if (!alert.name || typeof alert.name !== 'string' || alert.name.trim() === '') {
    result.errors.push(t('alerts.validation.nameMandatoryString'));
  }

  // Validate org_id if provided
  if (alert.org_id) {
    if (alert.org_id !== context?.selectedOrgId) {
      result.errors.push(t('alerts.validation.orgIdMismatch', { orgId: context?.selectedOrgId }));
    }
  }

  // Validate stream_type
  const validStreamTypes = ['logs', 'metrics', 'traces'];
  if (!alert.stream_type || !validStreamTypes.includes(alert.stream_type)) {
    result.errors.push(t('alerts.validation.streamTypeMandatory'));
  }

  // Validate stream_name
  if (!alert.stream_name || typeof alert.stream_name !== 'string') {
    result.errors.push(t('alerts.validation.streamNameMandatoryString'));
  } else if (context?.streamList && !context.streamList.includes(alert.stream_name)) {
    result.errors.push(t('alerts.validation.streamNotInList', { streamName: alert.stream_name }));
  }

  // Validate is_real_time
  if (typeof alert.is_real_time === 'string') {
    // Convert string 'true'/'false' to boolean
    alert.is_real_time = alert.is_real_time.toLowerCase() === 'true';
  }
  if (typeof alert.is_real_time !== 'boolean') {
    result.errors.push(t('alerts.validation.isRealTimeMandatoryBoolean'));
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
              result.errors.push(t('alerts.validation.conditionItemsArray'));
            } else {
              // Validate each condition item
              alert.query_condition.conditions.items.forEach((item, index) => {
                if (!item.column || !item.operator || item.value === undefined) {
                  result.errors.push(t('alerts.validation.conditionItemIncomplete', { index: index + 1 }));
                }

                const validOperators = ['=', '>', '<', '>=', '<=', 'Contains', 'NotContains'];
                if (!validOperators.includes(item.operator)) {
                  result.errors.push(t('alerts.validation.invalidOperatorInConditionItem', { operator: item.operator, index: index + 1 }));
                }
              });
            }
          }
          // Format 2: Using or/and array
          else if (alert.query_condition.conditions.or || alert.query_condition.conditions.and) {
            const conditions = alert.query_condition.conditions.or || alert.query_condition.conditions.and;
            if (!Array.isArray(conditions)) {
              result.errors.push(t('alerts.validation.conditionsOrAndArray'));
            } else {
              conditions.forEach((condition, index) => {
                if (!condition.column || !condition.operator || condition.value === undefined) {
                  result.errors.push(t('alerts.validation.conditionIncomplete', { index: index + 1 }));
                }

                const validOperators = ['=', '>', '<', '>=', '<=', 'Contains', 'NotContains'];
                if (!validOperators.includes(condition.operator)) {
                  result.errors.push(t('alerts.validation.invalidOperatorInCondition', { operator: condition.operator, index: index + 1 }));
                }

                // Validate ignore_case if present
                if (condition.ignore_case !== undefined && typeof condition.ignore_case !== 'boolean') {
                  result.errors.push(t('alerts.validation.ignoreCaseBoolean', { index: index + 1 }));
                }
              });
            }
          } else {
            result.errors.push(t('alerts.validation.invalidConditionsFormat'));
          }
        }

        // Validate multi_time_range for custom type
        if (alert.query_condition.multi_time_range !== null && 
            (!Array.isArray(alert.query_condition.multi_time_range) || alert.query_condition.multi_time_range.length !== 0)) {
          result.errors.push(t('alerts.validation.multiTimeRangeEmpty'));
        }

        // Remove the SQL/PromQL validation for custom type since it's not needed
        break;

      case 'sql':
        if (!alert.query_condition.sql || typeof alert.query_condition.sql !== 'string' || alert.query_condition.sql.trim() === '') {
          result.errors.push(t('alerts.validation.sqlQueryRequired'));
        } else {
          const sqlQuery = alert.query_condition.sql.trim().toLowerCase();
          // Check for select * pattern
          if (sqlQuery.includes('select *') || sqlQuery.includes('select\n*') || sqlQuery.includes('select\t*')) {
            result.errors.push(t('alerts.validation.selectAllNotAllowed'));
          }
          // Check if it's a valid SELECT query
          if (!sqlQuery.startsWith('select ')) {
            result.errors.push(t('alerts.validation.sqlQueryMustStartWithSelect'));
          }
        }
        break;

      case 'promql':
        if (!alert.query_condition.promql || typeof alert.query_condition.promql !== 'string' || alert.query_condition.promql.trim() === '') {
          result.errors.push(t('alerts.validation.promqlQueryRequired'));
        }
        break;

      default:
        result.errors.push(t('alerts.validation.invalidQueryConditionType'));
    }

    // Validate VRL function if present
    if (alert.query_condition.vrl_function && typeof alert.query_condition.vrl_function !== 'string') {
      result.errors.push(t('alerts.validation.vrlFunctionString'));
    }

    // Validate aggregation if present
    if (alert.query_condition.aggregation) {
      const agg = alert.query_condition.aggregation;
      
      // Validate group_by array
      if (!Array.isArray(agg.group_by)) {
        result.errors.push(t('alerts.validation.aggregationGroupByArray'));
      }

      // Validate function
      if (!agg.function || typeof agg.function !== 'string' || agg.function.trim() === '') {
        result.errors.push(t('alerts.validation.aggregationFunctionRequired'));
      }

      // Validate having clause structure
      if (agg.having && typeof agg.having === 'object') {
        // Only validate operator and value if they are provided
        if (agg.having.operator && (typeof agg.having.operator !== 'string' || !['>=', '<=', '>', '<', '=', '!='].includes(agg.having.operator))) {
          result.errors.push(t('alerts.validation.aggregationHavingOperator'));
        }
        if (agg.having.value !== undefined && typeof agg.having.value !== 'number') {
          result.errors.push(t('alerts.validation.aggregationHavingValue'));
        }
      }
    }
  }

  // Validate trigger_condition
  if (alert.trigger_condition) {
    const trigger = alert.trigger_condition;

    // Validate period
    if (typeof trigger.period !== 'number' || trigger.period < 1) {
      result.errors.push(t('alerts.validation.periodPositiveNumber'));
    }

    // Validate operator
    const validOperators = ['=', '!=', '>=', '<=', '>', '<', 'Contains', 'NotContains'];
    if (!validOperators.includes(trigger.operator)) {
      result.errors.push(t('alerts.validation.invalidOperatorInTrigger', { operator: trigger.operator }));
    }

    // Validate frequency
    if (typeof trigger.frequency !== 'number' || trigger.frequency < 1) {
      result.errors.push(t('alerts.validation.frequencyPositiveNumber'));
    }

    // Validate threshold
    if (typeof trigger.threshold !== 'number' || trigger.threshold < 1) {
      result.errors.push(t('alerts.validation.thresholdPositiveNumber'));
    }

    // Validate silence
    if (typeof trigger.silence !== 'number' || trigger.silence < 1) {
      result.errors.push(t('alerts.validation.silencePositiveNumber'));
    }

    // Validate frequency_type and related fields
    if (!['minutes', 'cron'].includes(trigger.frequency_type)) {
      result.errors.push(t('alerts.validation.frequencyTypeMinutesOrCron'));
    }

    if (trigger.frequency_type === 'cron') {
      if (!trigger.cron || trigger.cron.trim() === '') {
        result.errors.push(t('alerts.validation.cronRequiredForCronType'));
      }
      if (!trigger.timezone || trigger.timezone.trim() === '') {
        result.errors.push(t('alerts.validation.timezoneRequiredForCronType'));
      }
    }
  } else {
    result.errors.push(t('alerts.validation.triggerConditionRequired'));
  }
  // Validate destinations
  if (!Array.isArray(alert.destinations)) {
    result.errors.push(t('alerts.validation.destinationsArray'));
  } else if (alert.destinations.length === 0) {
    // NOTE: no trailing period — deliberately NOT the same string as
    // `alerts.validation.destinationRequired` ("At least one destination is
    // required."), which the AlertSettings schema owns.
    result.errors.push(t('alerts.validation.destinationRequiredPlain'));
  } else if (context?.destinationsList) {
    // Debug check for destinations list
    if (!Array.isArray(context.destinationsList) || context.destinationsList.length === 0) {
      result.errors.push(t('alerts.validation.noDestinationsInSystem'));
    } else {
      const invalidDestinations = alert.destinations.filter(dest => !context.destinationsList.includes(dest));
      if (invalidDestinations.length > 0) {
        result.errors.push(t('alerts.validation.invalidDestinations', {
          destinations: invalidDestinations.map(dest => `"${dest}"`).join(', '),
        }));
      }
    }
  }

  // Validate enabled flag
  if (typeof alert.enabled !== 'boolean') {
    result.errors.push(t('alerts.validation.enabledFlagBoolean'));
  }

  result.isValid = result.errors.length === 0;
  return result;
}

export interface ValidationContext {
  store: any;
  /** vue-i18n `t`, injected by the composable (this module has no Vue context). */
  t: Translator;
  validateSqlQueryPromise: any;
  sqlQueryErrorMsg: any;
  /** Ref<SqlErrorRange[]> — editor squiggle ranges (optional). */
  sqlErrorRanges?: any;
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
    timezone?: string;
    frequency?: number | string;
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
  store: any;
  /** vue-i18n `t`, injected by the composable (this module has no Vue context). */
  t: Translator;
  streams: any;
  getStreams: (streamType: string, schema: boolean) => Promise<any>;
  getParser: (sql: string) => boolean;
  buildQueryPayload: (options: any) => any;
  prepareAndSaveAlert: (data: any) => Promise<void>;
}

export const validateInputs = (
  input: AlertFormData,
  context: ValidationContext,
  notify: boolean = true,
): boolean => {
  const { t } = context;

  if (isNaN(Number(input.trigger_condition.silence))) {
    notify &&
      toast({
        variant: "error",
        message: t("alerts.validation.silenceNotificationRequired"),
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
      toast({
        variant: "error",
        message: t("alerts.validation.periodPositive"),
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
        toast({
          variant: "error",
          message: t("alerts.validation.thresholdNotEmpty"),
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
      toast({
        variant: "error",
        message: t("alerts.validation.thresholdNotEmpty"),
        timeout: 1500,
      });
    return false;
  }

  // Validate cron expression if frequency type is cron
  if (input.trigger_condition.frequency_type === "cron") {
    try {
      // `utc` is a cron-parser v4 option; v5 types only accept `tz` — cast keeps runtime unchanged
      CronExpressionParser.parse(input.trigger_condition.cron!, {
        currentDate: new Date(),
        utc: true,
      } as Parameters<typeof CronExpressionParser.parse>[1]);
    } catch (err) {
      console.log(err);
      notify &&
        toast({
          variant: "error",
          message: t("alerts.validation.invalidCronExpressionBang"),
          timeout: 1500,
        });
      return false;
    }

    // Validate timezone is set for cron
    if (!input.trigger_condition.timezone || input.trigger_condition.timezone.trim() === '') {
      notify &&
        toast({
          variant: "error",
          message: t("alerts.validation.timezoneRequiredForCron"),
          timeout: 1500,
        });
      return false;
    }
  } else if (input.trigger_condition.frequency_type === "minutes") {
    // Validate frequency for minutes type
    const frequency = Number(input.trigger_condition.frequency);
    if (isNaN(frequency) || frequency < 1) {
      notify &&
        toast({
          variant: "error",
          message: t("alerts.validation.frequencyPositive"),
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
    t,
    validateSqlQueryPromise,
    sqlQueryErrorMsg,
    sqlErrorRanges,
    vrlFunctionError,
    buildQueryPayload,
    getParser,
  } = context;
  const clearRanges = () => {
    if (sqlErrorRanges) sqlErrorRanges.value = [];
  };

  // Delaying the validation by 300ms, as editor has debounce of 300ms. Else old value will be used for validation
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Skip validation if SQL query is empty or only whitespace
  if (!formData.query_condition.sql || formData.query_condition.sql.trim() === '') {
    sqlQueryErrorMsg.value = "";
    clearRanges();
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
    query.query.query_fn = b64EncodeUnicode(formData.query_condition.vrl_function)

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
        clearRanges();

        if (res.data?.function_error) {
          vrlFunctionError.value = res.data.function_error;
          toast({
            variant: "error",
            message: t("alerts.validation.invalidVrlFunction"),
          });
          reject("function_error");
        } else vrlFunctionError.value = "";

        resolve("");
      })
      .catch((err: any) => {
        sqlQueryErrorMsg.value = err.response?.data?.message
          ? err.response?.data?.message
          : t("alerts.validation.invalidSqlQuery");

        // Error message is displayed inline below the editor
        // No need for toast notification as it's redundant

        // Locate the offending token in the SQL and squiggle it in the editor.
        if (sqlErrorRanges) {
          rangesFromServerError({
            code: err.response?.data?.code,
            message: err.response?.data?.message,
            errorDetail: err.response?.data?.error_detail,
            sqlMode: true,
            query: formData.query_condition.sql,
            streamName: formData.stream_name,
          }).then((ranges) => {
            sqlErrorRanges.value = ranges;
          });
        }

        reject("sql_error");
      });
  });
};

export const saveAlertJson = async (
  json: any,
  props: any,
  validationErrors: any,
  showJsonEditorDialog: any,
  applyFormData: (obj: any) => void,
  context: JsonValidationContext,
): Promise<void> => {
  const {
    store,
    t,
    streams,
    getParser,
    buildQueryPayload,
    getStreams,
    prepareAndSaveAlert,
  } = context;

  let jsonPayload = JSON.parse(json);
  let destinationsList: string[] = [];
  props.destinations.forEach((destination: any) => {
    destinationsList.push(destination.name);
  });
  let streamList: string[] = [];

  if (!streams.value[jsonPayload.stream_type]) {
    try {
      const response: any = await getStreams(jsonPayload.stream_type, false);
      streams.value[jsonPayload.stream_type] = response.list;
    } catch (err: any) {
      if (err.response.status !== 403) {
        toast({
          variant: "error",
          message:
            err.response?.data?.message ||
            t("alerts.validation.errorFetchingStreams"),
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
    t,
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
          t("alerts.validation.selectAllNotAllowed"),
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
      applyFormData(jsonPayload);
      await prepareAndSaveAlert(jsonPayload);
    } catch (err: any) {
      // Handle SQL validation errors
      const errorMessage =
        err.response?.data?.message || t("alerts.validation.invalidSqlQuery");
      validationErrors.value = [
        t("alerts.validation.sqlValidationError", { error: errorMessage }),
      ];
      return;
    }
  } else {
    // If not SQL or is real-time, just close and update
    showJsonEditorDialog.value = false;
    applyFormData(jsonPayload);
    await prepareAndSaveAlert(jsonPayload);
  }
};