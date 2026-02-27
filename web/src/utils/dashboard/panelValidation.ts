import { CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";
import functionValidation from "@/components/dashboards/addPanel/dynamicFunction/functionValidation.json";

// will find first valid mapped value based on given fieldToCheck
export const findFirstValidMappedValue = (
  value: any,
  mappings: any[],
  fieldToCheck: string,
) => {
  return mappings?.find((v: any) => {
    let isMatch = false;

    // Check based on type
    if (v?.type == "value") {
      isMatch = v?.value == value;
    } else if (v?.type == "range") {
      if (
        v?.from &&
        v?.to &&
        !Number.isNaN(+v?.from) &&
        !Number.isNaN(+v?.to)
      ) {
        isMatch = +v?.from <= +value && +v?.to >= +value;
      }
    } else if (v?.type == "regex") {
      isMatch = new RegExp(v?.pattern ?? "").test(value);
    }

    // If a match is found, check if the required field (color or text) is valid
    if (isMatch && v[fieldToCheck]) {
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
const validateConditionItem = (condition: any, errors: string[]) => {
  if (condition.type === "list" && !condition.values?.length) {
    errors.push(
      `Filter: ${condition.column}: Select at least 1 item from the list`,
    );
  }

  if (condition.type === "condition") {
    if (condition.operator == null) {
      errors.push(`Filter: ${condition.column}: Operator selection required`);
    }

    if (
      !["Is Null", "Is Not Null"].includes(condition.operator) &&
      (condition.value == null || condition.value == "")
    ) {
      errors.push(`Filter: ${condition.column}: Condition value required`);
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
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  if (!arg.value || typeof arg.value !== "object" || !("field" in arg.value)) {
    errors.push(
      `${fieldPath}: Argument ${index + 1} is a field but haven't selected any field`,
    );
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
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  if (arg.value === null || arg.value === undefined || arg.value === "") {
    errors.push(
      `${fieldPath}: Argument ${index + 1} is a number but no value entered`,
    );
  } else if (typeof arg.value !== "number" || isNaN(arg.value)) {
    errors.push(`${fieldPath}: Argument ${index + 1} must be a valid number`);
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
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  if (arg.value === null || arg.value === undefined) {
    errors.push(
      `${fieldPath}: Argument ${index + 1} is a string but no value entered`,
    );
  } else if (typeof arg.value !== "string" || arg.value.trim() === "") {
    errors.push(
      `${fieldPath}: Argument ${index + 1} must be a non-empty string`,
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
  arg: any,
  fieldPath: string,
  index: number,
  errors: string[],
) => {
  // if arg value is null, value not present or not a string
  if (!(arg.value === null || !arg.value || typeof arg.value === "string")) {
    errors.push(
      `${fieldPath}: Argument ${index + 1} must be a valid histogram interval`,
    );
  }
};

/**
 * Validate the filters in the panel
 * @param conditions the conditions array
 * @param errors the array to push the errors to
 */
function validateConditions(conditions: any, errors: any) {
  conditions.forEach((it: any) => {
    if (it.filterType === "condition") {
      validateConditionItem(it, errors);
    } else if (it.filterType === "group") {
      // Recursively validate the conditions in the group
      validateConditions(it.conditions, errors);
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
 * @param fieldPath - Path for error messages (e.g., "Field", "Field ΓåÆ Arg 2")
 * @param errors - Array to collect errors
 */
const validateFunction = (
  funcConfig: any,
  fieldPath: string,
  errors: string[],
) => {
  // Handle raw query fields
  if (funcConfig.type === "raw") {
    if (
      !funcConfig.rawQuery ||
      typeof funcConfig.rawQuery !== "string" ||
      funcConfig.rawQuery.trim() === ""
    ) {
      errors.push(`${fieldPath}: Raw query cannot be empty`);
    }
    return;
  }

  // Get the selected function schema
  const selectedFunction: any = functionValidation?.find(
    (fn: any) => fn?.functionName === (funcConfig?.functionName ?? null),
  );

  // If function is not found, push error
  if (!selectedFunction) {
    errors.push(`${fieldPath}: Invalid aggregation function`);
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
      errors.push(`${fieldPath}: Requires at least ${minArgDef.min} arguments`);
    }
  }

  // Validate all provided arguments have correct types
  args.forEach((arg: any, index: number) => {
    // Skip null/undefined args only if they're optional
    if (!arg) {
      // Check if this position is required
      const isOptional =
        index < argsDefinition.length && !argsDefinition[index]?.required;
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
        errors.push(`${fieldPath}: Too many arguments provided`);
        return;
      }
      // Default to the variable argument definition
      argDefIndex = variableArgPosition;
    }

    const allowedTypes = argsDefinition[argDefIndex].type.map(
      (t: any) => t.value,
    );

    // Check if current argument type is among the allowed types
    if (arg && !allowedTypes.includes(arg.type)) {
      errors.push(
        `${fieldPath}: Argument ${index + 1} has invalid type (expected: ${allowedTypes.join(" or ")})`,
      );
      return;
    }

    // Handle different argument types
    if (arg.type === "field") {
      validateFieldArgument(arg, fieldPath, index, errors);
    } else if (arg.type === "function") {
      // RECURSIVE VALIDATION: If argument is a function, validate it recursively
      if (!arg.value || typeof arg.value !== "object") {
        errors.push(
          `${fieldPath}: Argument ${index + 1} is a function but has invalid structure`,
        );
      } else {
        // Recursively validate the nested function
        const nestedPath = `${fieldPath} ΓåÆ Arg ${index + 1}`;
        validateFunction(arg.value, nestedPath, errors);
      }
    } else if (arg.type === "number") {
      validateNumberArgument(arg, fieldPath, index, errors);
    } else if (arg.type === "string") {
      validateStringArgument(arg, fieldPath, index, errors);
    } else if (arg.type === "histogramInterval") {
      validateHistogramIntervalArgument(arg, fieldPath, index, errors);
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
        `${fieldPath}: Missing required argument at position ${index + 1}`,
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
  chartType: string,
  fields: any,
  errors: string[],
  xAxisLabel: string = "X-Axis",
  yAxisLabel: string = "Y-Axis",
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
            ? "Unable to extract value field from the query."
            : "Add one value field for donut and pie charts";
        errors.push(errorMsg);
      }

      if (fields?.x?.length > 1 || fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract label field from the query."
            : "Add one label field for donut and pie charts";
        errors.push(errorMsg);
      }
      break;
    }
    case "metric": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : "Add one value field for metric charts";
        errors.push(errorMsg);
      }

      if (fields?.x?.length) {
        const errorMsg =
          pageKey === "logs"
            ? "Grouping field is not allowed for Metric chart"
            : `${xAxisLabel} field is not allowed for Metric chart`;
        errors.push(errorMsg);
      }
      break;
    }
    case "gauge": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : "Add one value field for gauge chart";
        errors.push(errorMsg);
      }
      // gauge can have zero or one label
      if (fields?.x?.length !== 1 && fields?.x?.length !== 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract grouping field from the query."
            : "Add one label field for gauge chart";
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
            ? "Unable to extract value field from the query."
            : `Add at least one field for the ${yAxisLabel}`;
        errors.push(errorMsg);
      }

      if (fields?.x?.length > 1 || fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract grouping field from the query."
            : `Add one fields for the ${xAxisLabel}`;
        errors.push(errorMsg);
      }
      break;
    }
    case "table": {
      if (fields?.y?.length === 0 && fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract fields from the query."
            : `Add at least one field on ${xAxisLabel} or ${yAxisLabel}`;
        errors.push(errorMsg);
      }
      break;
    }
    case "heatmap": {
      if (fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract grouping field from the query."
            : `Add at least one field for the ${yAxisLabel}`;
        errors.push(errorMsg);
      }

      if (fields?.x?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract second level grouping field from the query."
            : `Add one field for the ${xAxisLabel}`;
        errors.push(errorMsg);
      }

      if (fields?.z?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : "Add one field for the Z-Axis";
        errors.push(errorMsg);
      }
      break;
    }
    case "stacked":
    case "h-stacked": {
      if (fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : `Add at least one field for the ${yAxisLabel}`;
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1 || fields?.breakdown?.length !== 1) {
        const breakdownErrMsg =
          pageKey === "logs"
            ? "Unable to extract grouping field from the query."
            : `Add exactly one field on the ${xAxisLabel} and breakdown for stacked and h-stacked charts`;
        errors.push(breakdownErrMsg);
      }
      break;
    }
    case "area-stacked": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : `Add exactly one field on ${yAxisLabel} for area-stacked charts`;
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1 || fields?.breakdown?.length !== 1) {
        const breakdownErrMsg =
          pageKey === "logs"
            ? "Unable to extract grouping field from the query."
            : `Add exactly one field on the ${xAxisLabel} and breakdown for area-stacked charts`;
        errors.push(breakdownErrMsg);
      }
      break;
    }
    case "geomap": {
      if (fields?.latitude == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract latitude field from the query."
            : "Add one field for the latitude";
        errors.push(errorMsg);
      }
      if (fields?.longitude == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract longitude field from the query."
            : "Add one field for the longitude";
        errors.push(errorMsg);
      }
      break;
    }
    case "sankey": {
      if (fields?.source == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract source field from the query."
            : "Add one field for the source";
        errors.push(errorMsg);
      }
      if (fields?.target == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract target field from the query."
            : "Add one field for the target";
        errors.push(errorMsg);
      }
      if (fields?.value == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : "Add one field for the value";
        errors.push(errorMsg);
      }
      break;
    }
    case "maps": {
      if (fields?.name == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract name field from the query."
            : "Add one field for the name";
        errors.push(errorMsg);
      }
      if (fields?.value_for_maps == null) {
        const errorMsg =
          pageKey === "logs"
            ? "Unable to extract value field from the query."
            : "Add one field for the value";
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
      const fieldPath = it.alias || "Field";
      validateFunction(it, fieldPath, errors);
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
    !panelData?.queries?.[0]?.customQuery &&
    isFieldsValidationRequired
  ) {
    // Validate fields configuration based on chart type
    validateChartFieldsConfiguration(
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
  queries: any[] = [],
  errors: string[],
  customMessage?: string,
) => {
  queries.forEach((q: any, index: number) => {
    if (q && q?.query === "") {
      errors.push(customMessage || `Query-${index + 1} is empty`);
    }
  });
};

/**
 * Validates that a content field isn't empty
 * @param content Content field to validate
 * @param errors Array to collect error messages
 * @param errorMessage Error message to add if validation fails
 */
const validateContentNotEmpty = (
  content: string = "",
  errors: string[],
  errorMessage: string,
) => {
  if (content.trim() === "") {
    errors.push(errorMessage);
  }
};

/**
 * Validates panel content based on panel type
 * @param panel The panel to validate
 * @param errors Array to collect error messages
 */
const validatePanelContentByType = (panel: any, errors: string[]) => {
  // Check for promQL query type
  if (panel?.queryType === "promql") {
    validateQueriesNotEmpty(panel?.queries, errors);
  }

  // Check by panel type
  switch (panel?.type) {
    case "geomap":
      validateQueriesNotEmpty(panel?.queries, errors);
      break;
    case "html":
      validateContentNotEmpty(
        panel?.htmlContent,
        errors,
        "Please enter your HTML code",
      );
      break;
    case "markdown":
      validateContentNotEmpty(
        panel?.markdownContent,
        errors,
        "Please enter your markdown code",
      );
      break;
    case "custom_chart":
      validateQueriesNotEmpty(
        [panel?.queries?.[0]],
        errors,
        "Please enter query for custom chart",
      );
      break;
  }
};

const validateJoinField = (join: any, errors: string[], joinIndex: number) => {
  // validate stream
  if (!join?.stream) {
    errors.push(`Join #${joinIndex + 1}: Stream is required`);
  }

  // validate join type
  if (!join?.joinType) {
    errors.push(`Join #${joinIndex + 1}: Join type is required`);
  }

  // validate clauses
  // at least one clause is required
  // and each clause should have leftField, rightField, operation
  if (!join?.conditions || join?.conditions?.length === 0) {
    errors.push(`Join #${joinIndex + 1}: At least one clause is required`);
  }

  // validate each clause
  join?.conditions?.forEach((condition: any, conditionIndex: number) => {
    // validate leftField
    if (!condition?.leftField?.field) {
      errors.push(
        `Join #${joinIndex + 1}: Clause ${conditionIndex + 1}: Left field is required`,
      );
    }

    // validate rightField
    if (!condition?.rightField?.field) {
      errors.push(
        `Join #${joinIndex + 1}: Clause ${conditionIndex + 1}: Right field is required`,
      );
    }

    // validate operation
    if (!condition?.operation) {
      errors.push(
        `Join #${joinIndex + 1}: Clause ${conditionIndex + 1}: Operation is required`,
      );
    }
  });
};

const validateJoinFields = (joins: any, errors: string[]) => {
  // validate join fields
  if (joins) {
    joins.forEach((join: any, index: number) =>
      validateJoinField(join, errors, index),
    );
  }
};

/**
 * Validates panel fields without validating stream field existence
 *
 * @param panel The panel to validate
 * @param errors Array to collect error messages
 */
const validatePanelFields = (panel: any, errors: string[] = []) => {
  // Check if panel has promQL query type
  const isPromQLMode = panel?.queryType === "promql" || panel?.queryType === "promql-builder";
  const currentQueryIndex = 0; // Default to first query

  // Validate panel content based on type
  validatePanelContentByType(panel, errors);

  // validate fields if not promQL mode and customQuery is false
  if (
    !isPromQLMode &&
    !panel?.queries?.[currentQueryIndex]?.customQuery &&
    panel.queries?.[currentQueryIndex]?.fields
  ) {
    // Validate fields configuration based on chart type
    validateChartFieldsConfiguration(
      panel?.type,
      panel?.queries?.[currentQueryIndex]?.fields ?? {},
      errors,
    );

    // Check filter conditions validity
    if (
      panel?.queries?.[currentQueryIndex]?.fields?.filter?.conditions?.length
    ) {
      // Validate the conditions
      validateConditions(
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
const validatePanelContent = (panel: any): string[] => {
  const errors: string[] = [];

  // Required fields validation
  if (!panel?.type) {
    errors.push(`Panel ${panel?.id}: Panel type is required`);
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
      `Panel ${panel?.id}: Chart type "${panel?.type}" is not supported.`,
    );
  }

  if (!panel?.title) {
    errors.push(`Panel ${panel?.id}: Panel title is required`);
  }

  // Layout validation
  if (!panel?.layout) {
    errors.push(`Panel ${panel?.id}: Layout is required`);
  } else {
    if (typeof panel?.layout?.x !== "number")
      errors.push(`Panel ${panel?.id}: Layout x must be a number`);
    if (typeof panel?.layout?.y !== "number")
      errors.push(`Panel ${panel?.id}: Layout y must be a number`);
    if (typeof panel?.layout?.w !== "number")
      errors.push(`Panel ${panel?.id}: Layout w must be a number`);
    if (typeof panel?.layout?.h !== "number")
      errors.push(`Panel ${panel?.id}: Layout h must be a number`);
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
  panelData: any,
  errors: string[] = [],
  isFieldsValidationRequired: boolean = true,
  allStreamFields: any[] = [],
  pageKey: string = "dashboard",
  store: any,
  checkTimestampAlias: any,
) => {
  // Get current query index
  const currentQueryIndex = panelData?.layout?.currentQueryIndex || 0;

  // Check if panel has promQL query type
  const isPromQLMode = panelData?.data?.queryType === "promql" || panelData?.data?.queryType === "promql-builder";

  // Validate panel content based on type
  validatePanelContentByType(panelData?.data, errors);

  // Validate timestamp alias for SQL queries with custom query mode
  if (panelData?.data?.queryType === "sql") {
    const timestampColumn =
      store.state.zoConfig.timestamp_column || "_timestamp";

    panelData?.data?.queries?.forEach((queryObj: any, index: number) => {
      if (queryObj?.query && queryObj?.customQuery) {
        if (!checkTimestampAlias(queryObj.query)) {
          errors.push(
            `Alias '${timestampColumn}' is not allowed.`,
          );
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
      errors.push(
        "Selected chart type is not supported for PromQL. Only line chart is supported.",
      );
    }

    // 2. x axis, y axis, filters should be blank for PromQL
    if (panelData?.data?.queries?.[currentQueryIndex]?.fields?.x?.length > 0) {
      errors.push(
        "X-Axis is not supported for PromQL. Remove anything added to the X-Axis.",
      );
    }

    if (panelData?.data?.queries?.[currentQueryIndex]?.fields?.y?.length > 0) {
      errors.push(
        "Y-Axis is not supported for PromQL. Remove anything added to the Y-Axis.",
      );
    }

    if (
      panelData?.data?.queries?.[currentQueryIndex]?.fields?.filter?.conditions
        ?.length > 0
    ) {
      errors.push(
        "Filters are not supported for PromQL. Remove anything added to the Filters.",
      );
    }
  } else {
    // Calculate the x and y axis labels based on chart type
    const currentXLabel =
      panelData?.data?.type === "table"
        ? "First Column"
        : panelData?.data?.type === "h-bar"
          ? "Y-Axis"
          : "X-Axis";

    const currentYLabel =
      panelData?.data?.type === "table"
        ? "Other Columns"
        : panelData?.data?.type === "h-bar"
          ? "X-Axis"
          : "Y-Axis";

    // Validate panel fields based on chart type
    validateSQLPanelFields(
      panelData?.data,
      currentQueryIndex,
      currentXLabel,
      currentYLabel,
      errors,
      isFieldsValidationRequired,
      pageKey,
    );

    // validate join fields
    validateJoinFields(
      panelData?.data?.queries?.[currentQueryIndex]?.joins,
      errors,
    );
  }

  return errors;
};

/**
 * Validates the dashboard JSON structure
 *
 * @param dashboardJson The dashboard JSON to validate
 * @returns Array of validation errors or empty array if valid
 */
export const validateDashboardJson = (dashboardJson: any): string[] => {
  const errors: string[] = [];

  // Basic structure validation
  if (!dashboardJson) {
    errors.push("Dashboard JSON is empty or invalid");
    return errors;
  }

  // Required fields validation
  if (!dashboardJson?.dashboardId) {
    errors.push("Dashboard ID is required");
  }

  if (!dashboardJson?.title) {
    errors.push("Dashboard title is required");
  }

  // Version should be present and match current schema version
  if (!dashboardJson?.version) {
    errors.push("Dashboard version is required");
  } else if (dashboardJson.version !== CURRENT_DASHBOARD_SCHEMA_VERSION) {
    errors.push(
      `Dashboard version must be ${CURRENT_DASHBOARD_SCHEMA_VERSION}.`,
    );
  }

  // Check tabs
  if (
    !Array.isArray(dashboardJson?.tabs) ||
    dashboardJson?.tabs?.length === 0
  ) {
    errors.push("Dashboard must have at least one tab");
    return errors;
  }

  // Check for unique tab IDs
  const tabIds = new Set<string>();
  for (const tab of dashboardJson?.tabs) {
    if (!tab?.tabId) {
      errors.push("Each tab must have a tabId");
    } else if (tabIds.has(tab?.tabId)) {
      errors.push(`Duplicate tab ID found: ${tab?.tabId}`);
    } else {
      tabIds.add(tab?.tabId);
    }

    if (!tab?.name) {
      errors.push(`Tab ${tab?.tabId} must have a name`);
    }
  }

  // Check for unique panel IDs across all tabs and validate each panel
  const panelIds = new Set<string>();
  const layoutIValues = new Map<string, Set<string>>();

  for (const tab of dashboardJson.tabs) {
    if (!Array.isArray(tab?.panels)) {
      errors.push(`Tab ${tab?.tabId} must have a panels array`);
      continue;
    }

    // Create a set for layout i values for this tab
    layoutIValues.set(tab?.tabId, new Set<string>());

    for (const panel of tab.panels) {
      // Check panel ID uniqueness
      if (!panel?.id) {
        errors.push(`Panel in tab ${tab?.tabId} is missing an ID`);
      } else if (panelIds.has(panel?.id)) {
        errors.push(`Duplicate panel ID found: ${panel?.id}`);
      } else {
        panelIds.add(panel?.id);
      }

      // Check layout i value uniqueness within the tab
      if (!panel?.layout || !panel?.layout?.i) {
        errors.push(`Panel ${panel?.id} is missing a layout.i value`);
      } else {
        const tabLayoutValues = layoutIValues.get(tab?.tabId);
        if (
          tabLayoutValues &&
          tabLayoutValues.has(panel?.layout?.i?.toString())
        ) {
          errors.push(
            `Duplicate layout.i value found in tab ${tab?.tabId}: ${panel?.layout?.i}`,
          );
        } else if (tabLayoutValues) {
          tabLayoutValues.add(panel?.layout?.i?.toString());
        }
      }

      // Validate basic panel structure
      const panelStructureErrors = validatePanelContent(panel);
      errors.push(...panelStructureErrors);

      // Validate panel fields but skip stream validation
      if (panel?.type !== "markdown" && panel?.type !== "html") {
        try {
          const panelDetailErrors: string[] = [];

          // Only validate the panel fields (not stream field existence)
          validatePanelFields(panel, panelDetailErrors);

          // Add panel identifier to each error
          const prefixedErrors = panelDetailErrors.map(
            (error) => `Panel ${panel?.id || "unknown"}: ${error}`,
          );

          errors.push(...prefixedErrors);
        } catch (error) {
          // If validation fails
          errors.push(
            `Panel ${panel?.id || "unknown"}: ${
              error instanceof Error
                ? error?.message
                : "Unable to validate panel configuration"
            }`,
          );
        }
      }
    }
  }

  return errors;
};
