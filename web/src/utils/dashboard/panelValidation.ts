import type { TranslateFn } from "@/types/i18n";
import { CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";
import functionValidation from "@/components/dashboards/addPanel/dynamicFunction/functionValidation.json";
import { parseRegexPattern } from "@/utils/dashboard/tableConfigUtils";

// will find first valid mapped value based on given fieldToCheck
export const findFirstValidMappedValue = (value: any, mappings: any[], fieldToCheck: string) => {
  return mappings?.find((v: any) => {
    let isMatch = false;

    // Check based on type
    if (v?.type == "value") {
      isMatch = v?.value == value;
    } else if (v?.type == "range") {
      if (v?.from && v?.to && !Number.isNaN(+v?.from) && !Number.isNaN(+v?.to)) {
        isMatch = +v?.from <= +value && +v?.to >= +value;
      }
    } else if (v?.type == "regex") {
      try {
        const { pattern, flags } = parseRegexPattern(v?.pattern ?? "");
        isMatch = new RegExp(pattern, flags).test(value);
      } catch {
        // invalid regex pattern, skip
      }
    }

    // If a match is found, check if the required field (color or text) is valid
    if (isMatch && v[fieldToCheck] != null && v[fieldToCheck] !== "") {
      return true;
    }

    return false;
  });
};

/**
 * Validates a single condition item
 * @param condition The condition to validate
 * @param errors Array to collect errors
 */
const validateConditionItem = (t: TranslateFn, condition: any, errors: string[]) => {
  if (condition.type === "list" && !condition.values?.length) {
    errors.push(t("dashboard.utils.filterSelectAtLeastOne", { column: condition.column }));
  }

  if (condition.type === "condition") {
    if (condition.operator == null) {
      errors.push(t("dashboard.utils.filterOperatorRequired", { column: condition.column }));
    }

    if (
      !["Is Null", "Is Not Null"].includes(condition.operator) &&
      (condition.value == null || condition.value == "")
    ) {
      errors.push(t("dashboard.utils.filterConditionValueRequired", { column: condition.column }));
    }
  }
};

/**
 * Validates a field-type argument
 * @param arg The argument to validate
 * @param fieldPath Path for error messages
 * @param index Argument index
 * @param errors Array to collect errors
 */
const validateFieldArgument = (
  t: TranslateFn,
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  if (!arg.value || typeof arg.value !== "object" || !("field" in arg.value)) {
    errors.push(t("dashboard.utils.argFieldNotSelected", { field: fieldPath, index: index + 1 }));
  }
};

/**
 * Validates a number-type argument
 * @param arg The argument to validate
 * @param fieldPath Path for error messages
 * @param index Argument index
 * @param errors Array to collect errors
 */
const validateNumberArgument = (
  t: TranslateFn,
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  if (arg.value === null || arg.value === undefined || arg.value === "") {
    errors.push(t("dashboard.utils.argNumberNoValue", { field: fieldPath, index: index + 1 }));
  } else if (typeof arg.value !== "number" || isNaN(arg.value)) {
    errors.push(t("dashboard.utils.argMustBeValidNumber", { field: fieldPath, index: index + 1 }));
  }
};

/**
 * Validates a string-type argument
 * @param arg The argument to validate
 * @param fieldPath Path for error messages
 * @param index Argument index
 * @param errors Array to collect errors
 */
const validateStringArgument = (
  t: TranslateFn,
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  if (arg.value === null || arg.value === undefined) {
    errors.push(t("dashboard.utils.argStringNoValue", { field: fieldPath, index: index + 1 }));
  } else if (typeof arg.value !== "string" || arg.value.trim() === "") {
    errors.push(
      t("dashboard.utils.argMustBeNonEmptyString", { field: fieldPath, index: index + 1 }),
    );
  }
};

/**
 * Validates a histogramInterval-type argument
 * @param arg The argument to validate
 * @param fieldPath Path for error messages
 * @param index Argument index
 * @param errors Array to collect errors
 */
const validateHistogramIntervalArgument = (
  t: TranslateFn,
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  // if arg value is null, value not present or not a string
  if (!(arg.value === null || !arg.value || typeof arg.value === "string")) {
    errors.push(
      t("dashboard.utils.argMustBeValidHistogramInterval", {
        field: fieldPath,
        index: index + 1,
      }),
    );
  }
};

/**
 * Validate the filters in the panel
 * @param conditions the conditions array
 * @param errors the array to push the errors to
 */
function validateConditions(t: TranslateFn, conditions: any, errors: any) {
  conditions.forEach((it: any) => {
    if (it.filterType === "condition") {
      validateConditionItem(t, it, errors);
    } else if (it.filterType === "group") {
      // Recursively validate the conditions in the group
      validateConditions(t, it.conditions, errors);
    }
  });
}

/**
 * Validates a function and its nested function arguments, or validates raw query fields
 *
 * Handles the following validation scenarios:
 *
 * 1. **Raw Query Fields**: Fields with `type: "raw"` must have non-empty rawQuery
 *    Example: Custom SQL query field must have valid query string
 *
 * 2. **Required Arguments**: Arguments with `required: true` must be present
 *    Example: count(field) - field is required
 *
 * 3. **Optional Arguments**: Arguments with `required: false` can be omitted
 *    Example: substring(field, start, length?) - length is optional
 *    Example: from_unixtime(timestamp, format?) - format is optional
 *
 * 4. **Variable Arguments**: Functions with `allowAddArgAt` can accept N arguments
 *    - `allowAddArgAt: "n"` means position 0 can repeat infinitely
 *      Example: concat(arg1, arg2, arg3, ..., argN) with min=2
 *    - `allowAddArgAt: "n-1"` means (argsLength-1) position can repeat
 *    - Combined with `min` property to enforce minimum arg count
 *
 * 5. **Nested Functions**: Arguments with type "function" are validated recursively
 *    Example: sum(count(field)) - both sum and count are validated
 *    Example: concat(upper(field1), lower(field2)) - all 3 functions validated
 *
 * 6. **Type Validation**: Each argument type is validated against allowed types
 *    - field: Must have valid field selection
 *    - function: Recursively validated
 *    - number: Must be valid number
 *    - string: Must be non-empty string
 *    - histogramInterval: Must be valid interval string
 *
 * @param funcConfig - The function configuration to validate
 * @param fieldPath - Path for error messages (e.g., "Field", "Field → Arg 2"), built
 *                    from the `dashboard.utils.nestedArgPath` key for nested arguments
 * @param errors - Array to collect errors
 */
const validateFunction = (t: TranslateFn, funcConfig: any, fieldPath: string, errors: string[]) => {
  // Handle raw query fields
  if (funcConfig.type === "raw") {
    if (
      !funcConfig.rawQuery ||
      typeof funcConfig.rawQuery !== "string" ||
      funcConfig.rawQuery.trim() === ""
    ) {
      errors.push(t("dashboard.utils.rawQueryCannotBeEmpty", { field: fieldPath }));
    }
    return;
  }

  // Get the selected function schema
  const selectedFunction: any = functionValidation?.find(
    (fn: any) => fn?.functionName === (funcConfig?.functionName ?? null),
  );

  // If function is not found, push error
  if (!selectedFunction) {
    errors.push(t("dashboard.utils.invalidAggregationFunction", { field: fieldPath }));
    return; // Skip further validation if function is invalid
  }

  // Check if args are valid based on selected function schema
  const args = funcConfig.args || [];
  const argsDefinition = selectedFunction.args || [];

  // OPTIONAL ARGUMENTS: Handled by "required": false in argDefinition
  // VARIABLE ARGUMENTS: Handled by "allowAddArgAt" property
  // Examples:
  // - concat: allowAddArgAt="n" with min=2 (can have 2+ args)
  // - substring: 3rd arg has required=false (optional)
  const allowAddArgAtValue = selectedFunction.allowAddArgAt;
  const hasVariableArgs = !!allowAddArgAtValue;

  // Parse the allowAddArgAt value to determine variable argument position
  // "n" means position 0 (all args can repeat)
  // "n-1" means (argsLength - 1) position
  // "n-2" means (argsLength - 2) position
  let variableArgPosition = -1;
  if (hasVariableArgs) {
    if (allowAddArgAtValue === "n") {
      variableArgPosition = 0; // All arguments can be variable
    } else if (allowAddArgAtValue.startsWith("n-")) {
      // Format is "n-1", "n-2", etc.
      const offset = parseInt(allowAddArgAtValue.substring(2));
      variableArgPosition = argsDefinition.length - offset;
    }
  }

  // Special handling for functions with min requirements
  // Find the argDefinition that has the min property
  const minArgDef = argsDefinition.find((def: any) => "min" in def);
  const minPosition = minArgDef ? argsDefinition.indexOf(minArgDef) : -1;

  // If min is specified and position is valid, check the requirement
  if (minArgDef && minPosition !== -1) {
    // For variable args, we count all arguments from the variable position
    const relevantArgsCount =
      hasVariableArgs && variableArgPosition <= minPosition
        ? args.length - variableArgPosition + 1 // +1 because we count the variable position itself
        : args.length;

    if (relevantArgsCount < minArgDef.min) {
      errors.push(
        t("dashboard.utils.requiresAtLeastArguments", {
          field: fieldPath,
          count: minArgDef.min,
        }),
      );
    }
  }

  // Validate all provided arguments have correct types
  args.forEach((arg: any, index: number) => {
    // Skip null/undefined args only if they're optional
    if (!arg) {
      // Check if this position is required
      const isOptional = index < argsDefinition.length && !argsDefinition[index]?.required;
      if (!isOptional && !hasVariableArgs) {
        // This is a required arg that's missing - will be caught in "missing required" check below
      }
      return;
    }

    // Determine which arg definition to use for validation
    let argDefIndex = index;

    // For variable arguments
    if (hasVariableArgs && index >= variableArgPosition) {
      // Use the definition at the variable position
      argDefIndex = variableArgPosition;
    }

    // Handle out-of-bounds index for non-variable args or unknown formats
    if (argDefIndex >= argsDefinition.length) {
      if (!hasVariableArgs) {
        errors.push(t("dashboard.utils.tooManyArguments", { field: fieldPath }));
        return;
      }
      // Default to the variable argument definition
      argDefIndex = variableArgPosition;
    }

    const allowedTypes = argsDefinition[argDefIndex].type.map((t: any) => t.value);

    // Check if current argument type is among the allowed types
    if (arg && !allowedTypes.includes(arg.type)) {
      errors.push(
        t("dashboard.utils.argInvalidType", {
          field: fieldPath,
          index: index + 1,
          expected: allowedTypes.join(" or "),
        }),
      );
      return;
    }

    // Handle different argument types
    if (arg.type === "field") {
      validateFieldArgument(t, arg, fieldPath, index, errors);
    } else if (arg.type === "function") {
      // RECURSIVE VALIDATION: If argument is a function, validate it recursively
      if (!arg.value || typeof arg.value !== "object") {
        errors.push(
          t("dashboard.utils.argFunctionInvalidStructure", {
            field: fieldPath,
            index: index + 1,
          }),
        );
      } else {
        // Recursively validate the nested function
        const nestedPath = t("dashboard.utils.nestedArgPath", {
          field: fieldPath,
          index: index + 1,
        });
        validateFunction(t, arg.value, nestedPath, errors);
      }
    } else if (arg.type === "number") {
      validateNumberArgument(t, arg, fieldPath, index, errors);
    } else if (arg.type === "string") {
      validateStringArgument(t, arg, fieldPath, index, errors);
    } else if (arg.type === "histogramInterval") {
      validateHistogramIntervalArgument(t, arg, fieldPath, index, errors);
    }
  });

  // Check for missing required arguments
  // This validates:
  // 1. Required args that are missing (required: true)
  // 2. Optional args are allowed to be missing (required: false)
  // 3. Variable args beyond the first instance are allowed (allowAddArgAt)
  argsDefinition.forEach((argDef: any, index: number) => {
    // Skip checking variable arg positions beyond the first instance
    // Example: concat(arg1, arg2, arg3, ...) - only check first 2, rest are variable
    if (hasVariableArgs && index > variableArgPosition) return;

    // Check if required argument is missing or null/undefined
    if (argDef.required && (index >= args.length || !args[index])) {
      errors.push(
        t("dashboard.utils.missingRequiredArgument", { field: fieldPath, index: index + 1 }),
      );
    }
  });
};

/**
 * Shared validation logic for panel field configuration based on chart type
 *
 * @param chartType The type of chart being validated
 * @param fields The fields configuration to validate
 * @param errors Array to collect error messages
 * @param xAxisLabel Optional custom label for X-Axis in error messages
 * @param yAxisLabel Optional custom label for Y-Axis in error messages
 */
const validateChartFieldsConfiguration = (
  t: TranslateFn,
  chartType: string,
  fields: any,
  errors: string[],
  // Defaults reference the `t` parameter above, so callers that omit the labels
  // still get translated text in the error message.
  xAxisLabel: string = t("panel.xAxisShort"),
  yAxisLabel: string = t("panel.yAxisShort"),
  pageKey: string = "dashboard",
) => {
  if (!chartType || !fields) {
    return;
  }

  switch (chartType) {
    case "donut":
    case "pie": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addValueFieldForPieDonut");
        errors.push(errorMsg);
      }

      if (fields?.x?.length > 1 || fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractLabelField")
            : t("dashboard.utils.addLabelFieldForPieDonut");
        errors.push(errorMsg);
      }
      break;
    }
    case "metric": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addValueFieldForMetric");
        errors.push(errorMsg);
      }

      if (fields?.x?.length) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.groupingNotAllowedForMetric")
            : t("dashboard.utils.fieldNotAllowedForMetric", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      break;
    }
    case "gauge": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addValueFieldForGauge");
        errors.push(errorMsg);
      }
      // gauge can have zero or one label
      if (fields?.x?.length !== 1 && fields?.x?.length !== 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addLabelFieldForGauge");
        errors.push(errorMsg);
      }
      break;
    }
    case "h-bar":
    case "area":
    case "line":
    case "scatter":
    case "bar": {
      if (fields?.y?.length < 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addAtLeastOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }

      if (fields?.x?.length > 1 || fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      break;
    }
    case "table": {
      if (fields?.y?.length === 0 && fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractFields")
            : t("dashboard.utils.addAtLeastOneFieldOnEither", {
                xLabel: xAxisLabel,
                yLabel: yAxisLabel,
              });
        errors.push(errorMsg);
      }
      break;
    }
    case "heatmap": {
      if (fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addAtLeastOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }

      if (fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractSecondLevelGroupingField")
            : t("dashboard.utils.addOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }

      if (fields?.z?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addFieldForZAxis");
        errors.push(errorMsg);
      }
      break;
    }
    case "stacked":
    case "h-stacked": {
      if (fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addAtLeastOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1 || fields?.breakdown?.length !== 1) {
        const breakdownErrMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addExactlyOneFieldStacked", { label: xAxisLabel });
        errors.push(breakdownErrMsg);
      }
      break;
    }
    case "area-stacked": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addExactlyOneFieldOnAreaStacked", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1 || fields?.breakdown?.length !== 1) {
        const breakdownErrMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addExactlyOneFieldAreaStacked", { label: xAxisLabel });
        errors.push(breakdownErrMsg);
      }
      break;
    }
    case "geomap": {
      if (fields?.latitude == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractLatitudeField")
            : t("dashboard.utils.addFieldForLatitude");
        errors.push(errorMsg);
      }
      if (fields?.longitude == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractLongitudeField")
            : t("dashboard.utils.addFieldForLongitude");
        errors.push(errorMsg);
      }
      break;
    }
    case "sankey": {
      if (fields?.source == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractSourceField")
            : t("dashboard.utils.addFieldForSource");
        errors.push(errorMsg);
      }
      if (fields?.target == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractTargetField")
            : t("dashboard.utils.addFieldForTarget");
        errors.push(errorMsg);
      }
      if (fields?.value == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addFieldForValue");
        errors.push(errorMsg);
      }
      break;
    }
    case "maps": {
      if (fields?.name == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractNameField")
            : t("dashboard.utils.addFieldForName");
        errors.push(errorMsg);
      }
      if (fields?.value_for_maps == null) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addFieldForValue");
        errors.push(errorMsg);
      }
      break;
    }
    default:
      break;
  }

  // need to validate all the fields based on the selected aggregation function
  // get all the fields that are not derived and type is build
  const aggregationFunctionError = [
    ...(fields?.y ?? []),
    ...(fields?.x ?? []),
    ...(fields?.breakdown ?? []),
    ...(fields?.z ?? []),
    fields?.source ?? null,
    fields?.target ?? null,
    fields?.value ?? null,
    fields?.name ?? null,
    fields?.value_for_maps ?? null,
    fields?.latitude ?? null,
    fields?.longitude ?? null,
  ]?.filter((it: any) => it && !it?.isDerived);

  if (aggregationFunctionError?.length) {
    //  loop on each fields config
    // compare with function validation schema
    // if validation fails, push error
    aggregationFunctionError?.forEach((it: any) => {
      const fieldPath = it.alias || t("common.field");
      validateFunction(t, it, fieldPath, errors);
    });
  }
};

/**
 * Validates the fields configuration for SQL panels
 * @param {object} panelData - The panel data object
 * @param {number} queryIndex - The current query index
 * @param {string} currentXLabel - Label for X-Axis (for error messages)
 * @param {string} currentYLabel - Label for Y-Axis (for error messages)
 * @param {array} errors - Array to collect errors
 * @param {boolean} isFieldsValidationRequired - Whether field validation is required
 */
export const validateSQLPanelFields = (
  t: TranslateFn,
  panelData: any,
  queryIndex: number,
  currentXLabel: string,
  currentYLabel: string,
  errors: string[],
  isFieldsValidationRequired: boolean = true,
  pageKey?: string,
) => {
  const isPromQLMode = panelData?.queryType === "promql";
  if (
    !isPromQLMode &&
    !panelData?.queries?.[queryIndex]?.customQuery &&
    isFieldsValidationRequired
  ) {
    // Validate fields configuration based on chart type
    validateChartFieldsConfiguration(
      t,
      panelData?.type,
      panelData?.queries?.[queryIndex]?.fields ?? {},
      errors,
      currentXLabel,
      currentYLabel,
      pageKey,
    );
  }
};

/**
 * Validates that queries aren't empty
 * @param queries Array of queries to validate
 * @param errors Array to collect error messages
 * @param customMessage Optional custom error message
 */
const validateQueriesNotEmpty = (
  t: TranslateFn,
  queries: any[] = [],
  errors: string[],
  customMessage?: string,
) => {
  queries.forEach((q: any, index: number) => {
    if (q && q?.query === "") {
      errors.push(customMessage || t("dashboard.utils.queryIsEmpty", { index: index + 1 }));
    }
  });
};

/**
 * Validates that a content field isn't empty
 * @param content Content field to validate
 * @param errors Array to collect error messages
 * @param errorMessage Error message to add if validation fails
 */
const validateContentNotEmpty = (content: string = "", errors: string[], errorMessage: string) => {
  if (content.trim() === "") {
    errors.push(errorMessage);
  }
};

/**
 * Validates panel content based on panel type
 * @param panel The panel to validate
 * @param errors Array to collect error messages
 */
const validatePanelContentByType = (t: TranslateFn, panel: any, errors: string[]) => {
  // Check for promQL query type
  if (panel?.queryType === "promql") {
    validateQueriesNotEmpty(t, panel?.queries, errors);
  }

  // Check by panel type
  switch (panel?.type) {
    case "geomap":
      validateQueriesNotEmpty(t, panel?.queries, errors);
      break;
    case "html":
      validateContentNotEmpty(panel?.htmlContent, errors, t("dashboard.utils.enterHtmlCode"));
      break;
    case "markdown":
      validateContentNotEmpty(
        panel?.markdownContent,
        errors,
        t("dashboard.utils.enterMarkdownCode"),
      );
      break;
    case "custom_chart":
      validateQueriesNotEmpty(
        t,
        [panel?.queries?.[0]],
        errors,
        t("dashboard.utils.enterCustomChartQuery"),
      );
      break;
  }
};

const validateJoinField = (t: TranslateFn, join: any, errors: string[], joinIndex: number) => {
  // validate stream
  if (!join?.stream) {
    errors.push(t("dashboard.utils.joinStreamRequired", { index: joinIndex + 1 }));
  }

  // validate join type
  if (!join?.joinType) {
    errors.push(t("dashboard.utils.joinTypeRequired", { index: joinIndex + 1 }));
  }

  // validate clauses
  // at least one clause is required
  // and each clause should have leftField, rightField, operation
  if (!join?.conditions || join?.conditions?.length === 0) {
    errors.push(t("dashboard.utils.joinClauseRequired", { index: joinIndex + 1 }));
  }

  // validate each clause
  join?.conditions?.forEach((condition: any, conditionIndex: number) => {
    // validate leftField
    if (!condition?.leftField?.field) {
      errors.push(
        t("dashboard.utils.joinClauseLeftFieldRequired", {
          index: joinIndex + 1,
          clause: conditionIndex + 1,
        }),
      );
    }

    // validate rightField
    if (!condition?.rightField?.field) {
      errors.push(
        t("dashboard.utils.joinClauseRightFieldRequired", {
          index: joinIndex + 1,
          clause: conditionIndex + 1,
        }),
      );
    }

    // validate operation
    if (!condition?.operation) {
      errors.push(
        t("dashboard.utils.joinClauseOperationRequired", {
          index: joinIndex + 1,
          clause: conditionIndex + 1,
        }),
      );
    }
  });
};

const validateJoinFields = (t: TranslateFn, joins: any, errors: string[]) => {
  // validate join fields
  if (joins) {
    joins.forEach((join: any, index: number) => validateJoinField(t, join, errors, index));
  }
};

/**
 * Validates panel fields without validating stream field existence
 *
 * @param panel The panel to validate
 * @param errors Array to collect error messages
 */
const validatePanelFields = (t: TranslateFn, panel: any, errors: string[] = []) => {
  // Check if panel has promQL query type
  const isPromQLMode = panel?.queryType === "promql" || panel?.queryType === "promql-builder";
  const currentQueryIndex = 0; // Default to first query

  // Validate panel content based on type
  validatePanelContentByType(t, panel, errors);

  // validate fields if not promQL mode and customQuery is false
  if (
    !isPromQLMode &&
    !panel?.queries?.[currentQueryIndex]?.customQuery &&
    panel.queries?.[currentQueryIndex]?.fields
  ) {
    // Validate fields configuration based on chart type
    validateChartFieldsConfiguration(
      t,
      panel?.type,
      panel?.queries?.[currentQueryIndex]?.fields ?? {},
      errors,
    );

    // Check filter conditions validity
    if (panel?.queries?.[currentQueryIndex]?.fields?.filter?.conditions?.length) {
      // Validate the conditions
      validateConditions(
        t,
        panel?.queries?.[currentQueryIndex]?.fields?.filter?.conditions ?? [],
        errors,
      );
    }
  }

  return errors;
};

/**
 * Validates an individual panel's content
 * Only checks basic structure, used by validateDashboardJson
 *
 * @param panel The panel object to validate
 * @returns Array of validation errors
 */
const validatePanelContent = (t: TranslateFn, panel: any): string[] => {
  const errors: string[] = [];

  // Required fields validation
  if (!panel?.type) {
    errors.push(t("dashboard.utils.panelTypeRequired", { id: panel?.id }));
    return errors;
  }

  // Check if panel type is in the allowed types list
  const allowedTypes = [
    "area",
    "line",
    "bar",
    "scatter",
    "area-stacked",
    "donut",
    "pie",
    "h-bar",
    "stacked",
    "h-stacked",
    "heatmap",
    "metric",
    "gauge",
    "geomap",
    "maps",
    "table",
    "sankey",
    "custom_chart",
    "html",
    "markdown",
  ];

  if (!allowedTypes.includes(panel?.type)) {
    errors.push(
      t("dashboard.utils.panelChartTypeUnsupported", { id: panel?.id, type: panel?.type }),
    );
  }

  if (!panel?.title) {
    errors.push(t("dashboard.utils.panelTitleRequired", { id: panel?.id }));
  }

  // Layout validation
  if (!panel?.layout) {
    errors.push(t("dashboard.utils.panelLayoutRequired", { id: panel?.id }));
  } else {
    if (typeof panel?.layout?.x !== "number")
      errors.push(t("dashboard.utils.panelLayoutXMustBeNumber", { id: panel?.id }));
    if (typeof panel?.layout?.y !== "number")
      errors.push(t("dashboard.utils.panelLayoutYMustBeNumber", { id: panel?.id }));
    if (typeof panel?.layout?.w !== "number")
      errors.push(t("dashboard.utils.panelLayoutWMustBeNumber", { id: panel?.id }));
    if (typeof panel?.layout?.h !== "number")
      errors.push(t("dashboard.utils.panelLayoutHMustBeNumber", { id: panel?.id }));
  }

  return errors;
};

/**
 * Validates a dashboard panel's configuration
 * @param {object} panelData - The panel data object to validate
 * @param {array} errors - Array to collect errors
 * @param {boolean} isFieldsValidationRequired - Whether to validate fields (default: true)
 * @returns {array} An array of validation error messages
 */
export const validatePanel = (
  t: TranslateFn,
  panelData: any,
  errors: string[] = [],
  isFieldsValidationRequired: boolean = true,
  _allStreamFields: any[] = [],
  pageKey: string = "dashboard",
  store: any,
  checkTimestampAlias: any,
) => {
  // Get current query index
  const currentQueryIndex = panelData?.layout?.currentQueryIndex || 0;

  // Check if panel has promQL query type
  const isPromQLMode =
    panelData?.data?.queryType === "promql" || panelData?.data?.queryType === "promql-builder";

  // Validate panel content based on type
  validatePanelContentByType(t, panelData?.data, errors);

  // Validate timestamp alias for SQL queries with custom query mode
  if (panelData?.data?.queryType === "sql") {
    const timestampColumn = store.state.zoConfig.timestamp_column || "_timestamp";

    panelData?.data?.queries?.forEach((queryObj: any) => {
      if (queryObj?.query && queryObj?.customQuery) {
        if (!checkTimestampAlias(queryObj.query)) {
          errors.push(t("dashboard.utils.aliasNotAllowed", { alias: timestampColumn }));
        }
      }
    });
  }

  if (isPromQLMode) {
    // 1. Chart type: only specific chart types are supported for PromQL
    const allowedChartTypes = [
      "area",
      "line",
      "bar",
      "scatter",
      "area-stacked",
      "metric",
      "gauge",
      "html",
      "markdown",
      "custom_chart",
      "table",
      "maps",
      "heatmap",
      "geomap",
      "donut",
      "pie",
      "h-bar",
      "stacked",
      "h-stacked",
    ];
    if (!allowedChartTypes.includes(panelData?.data?.type)) {
      errors.push(t("dashboard.utils.promqlChartTypeUnsupported"));
    }

    // 2. x axis, y axis, filters should be blank for PromQL
    if (panelData?.data?.queries?.[currentQueryIndex]?.fields?.x?.length > 0) {
      errors.push(t("dashboard.utils.promqlXAxisUnsupported"));
    }

    if (panelData?.data?.queries?.[currentQueryIndex]?.fields?.y?.length > 0) {
      errors.push(t("dashboard.utils.promqlYAxisUnsupported"));
    }

    if (panelData?.data?.queries?.[currentQueryIndex]?.fields?.filter?.conditions?.length > 0) {
      errors.push(t("dashboard.utils.promqlFiltersUnsupported"));
    }
  } else {
    // Calculate the x and y axis labels based on chart type
    const currentXLabel =
      panelData?.data?.type === "table"
        ? t("panel.firstColumn")
        : panelData?.data?.type === "h-bar"
          ? t("panel.yAxisShort")
          : t("panel.xAxisShort");

    const currentYLabel =
      panelData?.data?.type === "table"
        ? t("panel.otherColumn")
        : panelData?.data?.type === "h-bar"
          ? t("panel.xAxisShort")
          : t("panel.yAxisShort");

    // Validate panel fields based on chart type for all queries
    const queries = panelData?.data?.queries ?? [];
    const hasMultipleQueries = queries.length > 1;

    // Validate ALL queries (not just the active tab) so that errors are shown
    // consistently regardless of which query tab is currently selected.
    // In multi-query mode each query's errors are prefixed with "Query N:".
    queries.forEach((query: any, queryIndex: number) => {
      const queryErrors: string[] = [];

      // Validate panel fields based on chart type
      validateSQLPanelFields(
        t,
        panelData?.data,
        queryIndex,
        currentXLabel,
        currentYLabel,
        queryErrors,
        isFieldsValidationRequired,
        pageKey,
      );

      // validate join fields for this query
      validateJoinFields(t, query?.joins, queryErrors);

      // Prefix errors with query number when multiple queries exist
      if (hasMultipleQueries) {
        queryErrors.forEach((err) =>
          errors.push(t("dashboard.utils.queryErrorPrefix", { index: queryIndex + 1, error: err })),
        );
      } else {
        errors.push(...queryErrors);
      }
    });
  }

  return errors;
};

/**
 * Validates the dashboard JSON structure
 *
 * @param dashboardJson The dashboard JSON to validate
 * @returns Array of validation errors or empty array if valid
 */
export const validateDashboardJson = (t: TranslateFn, dashboardJson: any): string[] => {
  const errors: string[] = [];

  // Basic structure validation
  if (!dashboardJson) {
    errors.push(t("dashboard.utils.dashboardJsonInvalid"));
    return errors;
  }

  // Required fields validation
  if (!dashboardJson?.dashboardId) {
    errors.push(t("dashboard.utils.dashboardIdRequired"));
  }

  if (!dashboardJson?.title) {
    errors.push(t("dashboard.utils.dashboardTitleRequired"));
  }

  // Version should be present and match current schema version
  if (!dashboardJson?.version) {
    errors.push(t("dashboard.utils.dashboardVersionRequired"));
  } else if (dashboardJson.version !== CURRENT_DASHBOARD_SCHEMA_VERSION) {
    errors.push(
      t("dashboard.utils.dashboardVersionMustBe", {
        version: CURRENT_DASHBOARD_SCHEMA_VERSION,
      }),
    );
  }

  // Check tabs
  if (!Array.isArray(dashboardJson?.tabs) || dashboardJson?.tabs?.length === 0) {
    errors.push(t("dashboard.utils.dashboardTabRequired"));
    return errors;
  }

  // Check for unique tab IDs
  const tabIds = new Set<string>();
  for (const tab of dashboardJson?.tabs ?? []) {
    if (!tab?.tabId) {
      errors.push(t("dashboard.utils.tabIdRequired"));
    } else if (tabIds.has(tab?.tabId)) {
      errors.push(t("dashboard.utils.duplicateTabId", { tabId: tab?.tabId }));
    } else {
      tabIds.add(tab?.tabId);
    }

    if (!tab?.name) {
      errors.push(t("dashboard.utils.tabMustHaveName", { tabId: tab?.tabId }));
    }
  }

  // Check for unique panel IDs across all tabs and validate each panel
  const panelIds = new Set<string>();
  const layoutIValues = new Map<string, Set<string>>();

  for (const tab of dashboardJson.tabs) {
    if (!Array.isArray(tab?.panels)) {
      errors.push(t("dashboard.utils.tabMustHavePanelsArray", { tabId: tab?.tabId }));
      continue;
    }

    // Create a set for layout i values for this tab
    layoutIValues.set(tab?.tabId, new Set<string>());

    for (const panel of tab.panels) {
      // Check panel ID uniqueness
      if (!panel?.id) {
        errors.push(t("dashboard.utils.panelMissingId", { tabId: tab?.tabId }));
      } else if (panelIds.has(panel?.id)) {
        errors.push(t("dashboard.utils.duplicatePanelId", { id: panel?.id }));
      } else {
        panelIds.add(panel?.id);
      }

      // Check layout i value uniqueness within the tab
      if (!panel?.layout || !panel?.layout?.i) {
        errors.push(t("dashboard.utils.panelMissingLayoutI", { id: panel?.id }));
      } else {
        const tabLayoutValues = layoutIValues.get(tab?.tabId);
        if (tabLayoutValues && tabLayoutValues.has(panel?.layout?.i?.toString())) {
          errors.push(
            t("dashboard.utils.duplicateLayoutI", {
              tabId: tab?.tabId,
              value: panel?.layout?.i,
            }),
          );
        } else if (tabLayoutValues) {
          tabLayoutValues.add(panel?.layout?.i?.toString());
        }
      }

      // Validate basic panel structure
      const panelStructureErrors = validatePanelContent(t, panel);
      errors.push(...panelStructureErrors);

      // Validate panel fields but skip stream validation
      if (panel?.type !== "markdown" && panel?.type !== "html") {
        try {
          const panelDetailErrors: string[] = [];

          // Only validate the panel fields (not stream field existence)
          validatePanelFields(t, panel, panelDetailErrors);

          // Add panel identifier to each error
          const prefixedErrors = panelDetailErrors.map((error) =>
            t("dashboard.utils.panelErrorPrefix", {
              id: panel?.id || "unknown",
              error,
            }),
          );

          errors.push(...prefixedErrors);
        } catch (error) {
          // If validation fails
          errors.push(
            t("dashboard.utils.panelErrorPrefix", {
              id: panel?.id || "unknown",
              error:
                error instanceof Error
                  ? error?.message
                  : t("dashboard.utils.unableToValidatePanel"),
            }),
          );
        }
      }
    }
  }

  return errors;
};
