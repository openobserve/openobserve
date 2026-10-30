import type { TranslateFn } from "@/types/i18n";
import { CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";
import functionValidation from "@/components/dashboards/addPanel/dynamicFunction/functionValidation.json";
import { isFormulaQuery } from "@/utils/dashboard/promql/formula";
import { HEATMAP_MAX_ROWS, isHeatmapColorRangeInverted } from "@/utils/dashboard/heatmapDefaults";
import {
  heatmapYBucketError,
  isHeatmapYRangeInverted,
  isNumericYField,
} from "@/utils/dashboard/heatmapYAxis";
import { addCommasToNumber } from "@/utils/formatters";
import { validateAnnotationSources } from "@/utils/dashboard/validateAnnotationSources";
import {
  CARTESIAN_CHART_TYPES,
  CARTESIAN_TOOLTIP_MODES,
  LINE_STYLES,
  SORT_ORDERS,
  STACK_MODES,
  Y_AXIS_LOG_BASES,
  Y_AXIS_SCALES,
} from "@/utils/dashboard/cartesianOptions";
import { TOOLTIP_SORT_VALUES } from "@/utils/dashboard/tooltipSort";
import { isAdditiveSizeField, SUNBURST_MAX_LEVELS } from "@/utils/dashboard/convertSunburstData";
import { STAT_TEXT_MODES } from "@/utils/dashboard/metricOptions";
import {
  GAUGE_STYLES,
  PIE_LABEL_CONTENTS,
  STATE_VALUE_ALIGNS,
} from "@/utils/dashboard/panelTypeOptions";
import { TABLE_DENSITIES, TABLE_FOOTER_CALCS } from "@/utils/dashboard/tableOptions";
import { SPECIAL_VALUE_MATCHES } from "@/utils/dashboard/tableConfigUtils";
import { BAR_GAUGE_MODES, BAR_GAUGE_ORIENTATIONS } from "@/utils/dashboard/convertBarGaugeData";
import { DISTRIBUTION_MAX_BUCKETS } from "@/utils/dashboard/convertDistributionData";
import { FUNNEL_ORIENTS, FUNNEL_SORTS } from "@/utils/dashboard/convertFunnelData";
import { NODE_GRAPH_LAYOUTS } from "@/utils/dashboard/convertNodeGraphData";
import {
  ALERT_LIST_MAX_LIMIT,
  ALERT_LIST_SORTS,
  ALERT_LIST_STATES,
} from "@/utils/dashboard/alertListPanel";
import { HOSTMAP_MAX_GROUP_LEVELS } from "@/utils/dashboard/convertHostmapData";
import { STATE_TIMELINE_DISPLAYS } from "@/utils/dashboard/convertStateTimelineData";
import { TREEMAP_MAX_LEVELS, TREEMAP_SIZE_FUNCTIONS } from "@/utils/dashboard/convertTreemapData";
import { isGaugeFixedRangeValid, type GaugeQueryConfig } from "@/utils/dashboard/gaugeDial";
import { MAX_LINE_THICKNESS, isValidLineThickness } from "@/utils/dashboard/promqlChartSeriesProps";
import {
  shouldShowBarWidthConfig,
  shouldShowScatterPointConfig,
} from "@/utils/dashboard/configUtils";
import { SYMBOL_SIZE_MAX, isScatterSymbolSizeValid } from "@/utils/dashboard/scatterPointStyle";
import { BAR_WIDTH_MAX, isBarWidthValid } from "@/utils/dashboard/barTrack";

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
export function validateConditions(t: TranslateFn, conditions: any, errors: any) {
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
    case "gauge":
    case "bar-gauge": {
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
    case "state-timeline": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      break;
    }
    case "distribution": {
      if (!fields?.y?.length) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addAtLeastOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (fields?.x?.length) {
        errors.push(t("dashboard.utils.fieldNotAllowedForDistribution", { label: xAxisLabel }));
      }
      break;
    }
    case "treemap": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (!fields?.x?.length) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addAtLeastOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      if ((fields?.x?.length ?? 0) + (fields?.breakdown?.length ?? 0) > TREEMAP_MAX_LEVELS) {
        errors.push(t("dashboard.utils.treemapTooManyLevels", { count: TREEMAP_MAX_LEVELS }));
      }
      const size = fields?.y?.[0];
      // A raw expression is the user's own SQL; only a builder function can be checked.
      if (
        size?.type === "build" &&
        !size.isDerived &&
        !TREEMAP_SIZE_FUNCTIONS.includes(size.functionName)
      ) {
        errors.push(t("dashboard.utils.sizeMustBeCountOrSum"));
      }
      break;
    }
    case "sunburst": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (!fields?.x?.length) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addAtLeastOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      if ((fields?.x?.length ?? 0) + (fields?.breakdown?.length ?? 0) > SUNBURST_MAX_LEVELS) {
        errors.push(t("dashboard.utils.sunburstMaxLevels", { count: SUNBURST_MAX_LEVELS }));
      }
      if (!isAdditiveSizeField(fields?.y?.[0])) {
        errors.push(t("dashboard.utils.sizeMustBeCountOrSum"));
      }
      break;
    }
    case "funnel": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      break;
    }
    case "hostmap": {
      if (fields?.y?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractValueField")
            : t("dashboard.utils.addOneFieldFor", { label: yAxisLabel });
        errors.push(errorMsg);
      }
      if (fields?.x?.length !== 1) {
        const errorMsg =
          pageKey === "logs"
            ? t("dashboard.utils.unableToExtractGroupingField")
            : t("dashboard.utils.addOneFieldFor", { label: xAxisLabel });
        errors.push(errorMsg);
      }
      if ((fields?.breakdown?.length ?? 0) > HOSTMAP_MAX_GROUP_LEVELS) {
        errors.push(t("dashboard.utils.hostmapTooManyGroups", { count: HOSTMAP_MAX_GROUP_LEVELS }));
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
    case "sankey":
    case "node-graph": {
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
    if (q && (isFormulaQuery(q) ? q.config.formula : q?.query) === "") {
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
    case "flame-graph":
      validateQueriesNotEmpty(t, [panel?.queries?.[0]], errors);
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

export const validateJoinFields = (t: TranslateFn, joins: any, errors: string[]) => {
  // validate join fields
  if (joins) {
    joins.forEach((join: any, index: number) => validateJoinField(t, join, errors, index));
  }
};

const validateGaugeRanges = (t: TranslateFn, panel: any, errors: string[]) => {
  if (panel?.type !== "gauge") return;
  const queries = panel?.queries ?? [];
  queries.forEach((query: { config?: GaugeQueryConfig }, index: number) => {
    if (isGaugeFixedRangeValid(query?.config)) return;
    const error = t("dashboard.utils.gaugeMinBelowMax");
    errors.push(
      queries.length > 1
        ? t("dashboard.utils.queryErrorPrefix", { index: index + 1, error })
        : error,
    );
  });
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
    "state-timeline",
    "distribution",
    "treemap",
    "sunburst",
    "funnel",
    "hostmap",
    "metric",
    "gauge",
    "bar-gauge",
    "geomap",
    "maps",
    "table",
    "sankey",
    "node-graph",
    "custom_chart",
    "html",
    "markdown",
    "alert-list",
    "flame-graph",
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

/** Heatmap settings the renderer would silently ignore, or under which the builder generates an empty query. */
const validateHeatmapConfig = (
  t: TranslateFn,
  panelData: any,
  errors: string[],
  isPromQLMode: boolean,
) => {
  if (panelData?.data?.type !== "heatmap") return;
  const config = panelData.data.config;
  if (isHeatmapColorRangeInverted(config)) {
    errors.push(t("dashboard.utils.heatmapColorRangeInverted"));
  }
  if (isPromQLMode || !config?.heatmap_y_bucket?.mode) return;
  // Only a builder query over a numeric y column is bucketed; elsewhere the setting is hidden and unused.
  const bucketed = (panelData.data.queries ?? []).some(
    (query: any) => !query?.customQuery && isNumericYField(query?.fields?.y?.[0], panelData),
  );
  if (!bucketed) return;
  const bucketError = heatmapYBucketError(config);
  if (bucketError === "invalidSize") errors.push(t("dashboard.utils.heatmapYBucketSizeInvalid"));
  if (bucketError === "tooManyBuckets") {
    errors.push(
      t("dashboard.utils.heatmapYBucketTooMany", { max: addCommasToNumber(HEATMAP_MAX_ROWS) }),
    );
  }
  if (isHeatmapYRangeInverted(config)) errors.push(t("dashboard.utils.heatmapYRangeInverted"));
};

// The state timeline stores its own tooltip modes in the same key.
const TOOLTIP_MODE_VALUES: readonly unknown[] = [...CARTESIAN_TOOLTIP_MODES, "segment", "all_rows"];

const CARTESIAN_CHOICE_KEYS: ReadonlyArray<[string, readonly unknown[]]> = [
  ["tooltip_mode", TOOLTIP_MODE_VALUES],
  ["tooltip_sort", TOOLTIP_SORT_VALUES],
  ["y_axis_scale", Y_AXIS_SCALES],
  ["y_axis_log_base", Y_AXIS_LOG_BASES],
  ["line_style", LINE_STYLES],
  ["stack_mode", STACK_MODES],
  ["sort_order", SORT_ORDERS],
];

const NON_NEGATIVE_KEYS = ["connect_nulls_threshold", "bar_radius"];

const isSetValue = (value: unknown) => value !== null && value !== undefined && value !== "";

const asFiniteNumber = (value: unknown): number | null => {
  if (!isSetValue(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const validateCartesianChoices = (t: TranslateFn, config: any, errors: string[]) => {
  for (const [key, allowed] of CARTESIAN_CHOICE_KEYS) {
    const value = key === "y_axis_log_base" ? Number(config[key]) : config[key];
    if (isSetValue(config[key]) && !allowed.includes(value)) {
      errors.push(
        t("dashboard.utils.unsupportedConfigValue", {
          setting: key,
          value: String(config[key]),
        }),
      );
    }
  }
  for (const key of NON_NEGATIVE_KEYS) {
    const value = asFiniteNumber(config[key]);
    if (isSetValue(config[key]) && (value === null || value < 0)) {
      errors.push(t("dashboard.utils.configValueNotNegative", { setting: key }));
    }
  }
};

const validateCartesianRanges = (t: TranslateFn, config: any, errors: string[]) => {
  const hardMin = asFiniteNumber(config.y_axis_hard_min);
  const hardMax = asFiniteNumber(config.y_axis_hard_max);
  if (hardMin !== null && hardMax !== null && hardMin >= hardMax) {
    errors.push(t("dashboard.utils.yAxisHardRangeInverted"));
  }
  const softMin = asFiniteNumber(config.y_axis_min);
  if (config.y_axis_scale === "log" && softMin !== null && softMin <= 0) {
    errors.push(t("dashboard.utils.yAxisLogMinInvalid"));
  }
};

const validateMarkAreas = (t: TranslateFn, panel: any, errors: string[]) => {
  const areas = panel?.config?.mark_area;
  if (!Array.isArray(areas)) return;
  const verticalValueAxis = !["h-bar", "h-stacked"].includes(panel?.type);
  areas.forEach((area: any, index: number) => {
    const position = index + 1;
    if (
      !area ||
      (area.axis !== "x" && area.axis !== "y") ||
      !isSetValue(area.from) ||
      !isSetValue(area.to)
    ) {
      errors.push(t("dashboard.utils.markAreaIncomplete", { index: position }));
      return;
    }
    const numericAxis = area.axis === "y" ? verticalValueAxis : !verticalValueAxis;
    if (numericAxis && (asFiniteNumber(area.from) === null || asFiniteNumber(area.to) === null)) {
      errors.push(t("dashboard.utils.markAreaNotNumeric", { index: position }));
    }
  });
};

const validateScatterEncoding = (
  t: TranslateFn,
  panel: any,
  errors: string[],
  isPromQLMode: boolean,
) => {
  const config = panel?.config ?? {};
  if (panel?.type !== "scatter" || isPromQLMode) return;
  const aliases = (panel?.queries?.[0]?.fields?.y ?? []).map((field: any) => field?.alias);
  for (const key of ["scatter_size_field", "scatter_color_field"]) {
    if (isSetValue(config[key]) && !aliases.includes(config[key])) {
      errors.push(t("dashboard.utils.scatterFieldUnknown", { setting: key }));
    }
  }
  const minSize = asFiniteNumber(config.scatter_size_min);
  const maxSize = asFiniteNumber(config.scatter_size_max);
  if (minSize !== null && maxSize !== null && minSize > maxSize) {
    errors.push(t("dashboard.utils.scatterSizeRangeInverted"));
  }
};

/** Cartesian settings the renderer would silently ignore or misread. */
const validateCartesianConfig = (
  t: TranslateFn,
  panelData: any,
  errors: string[],
  isPromQLMode: boolean,
) => {
  const panel = panelData?.data;
  if (!CARTESIAN_CHART_TYPES.has(panel?.type) || !panel?.config) return;
  validateCartesianChoices(t, panel.config, errors);
  validateCartesianRanges(t, panel.config, errors);
  validateMarkAreas(t, panel, errors);
  validateScatterEncoding(t, panel, errors, isPromQLMode);
};

const PANEL_TYPE_CHOICE_KEYS: ReadonlyArray<[string, string[], readonly unknown[]]> = [
  ["stat_text_mode", ["metric"], STAT_TEXT_MODES],
  ["gauge_style", ["gauge"], GAUGE_STYLES],
  ["table_density", ["table"], TABLE_DENSITIES],
  ["state_value_align", ["state-timeline"], STATE_VALUE_ALIGNS],
  ["bar_gauge_mode", ["bar-gauge"], BAR_GAUGE_MODES],
  ["bar_gauge_orientation", ["bar-gauge"], BAR_GAUGE_ORIENTATIONS],
  ["state_timeline_display", ["state-timeline"], STATE_TIMELINE_DISPLAYS],
  ["sort_order", ["pie", "donut"], SORT_ORDERS],
  ["funnel_sort", ["funnel"], FUNNEL_SORTS],
  ["funnel_orient", ["funnel"], FUNNEL_ORIENTS],
  ["node_graph_layout", ["node-graph"], NODE_GRAPH_LAYOUTS],
  ["alert_list_sort", ["alert-list"], ALERT_LIST_SORTS],
];

const PANEL_TYPE_LIST_KEYS: ReadonlyArray<[string, string[], readonly unknown[]]> = [
  ["pie_label_content", ["pie", "donut"], PIE_LABEL_CONTENTS],
  ["table_footer_calcs", ["table"], TABLE_FOOTER_CALCS],
  ["alert_list_state", ["alert-list"], ALERT_LIST_STATES],
];

// [key, chart types, lowest allowed, highest allowed, lowest is exclusive]
const PANEL_TYPE_RANGE_KEYS: ReadonlyArray<[string, string[], number, number, boolean]> = [
  ["value_font_size", ["metric"], 0, Infinity, true],
  ["gauge_segments", ["gauge"], 2, 100, false],
  ["pie_other_threshold", ["pie", "donut"], 0, 100, false],
  ["donut_inner_radius", ["donut"], 0, 95, false],
  ["heatmap_cell_gap", ["heatmap"], 0, Infinity, false],
  ["map_cluster_radius", ["geomap"], 0, Infinity, true],
  ["distribution_bucket_count", ["distribution"], 1, DISTRIBUTION_MAX_BUCKETS, false],
  ["distribution_bucket_size", ["distribution"], 0, Infinity, true],
  ["alert_list_max", ["alert-list"], 1, ALERT_LIST_MAX_LIMIT, false],
];

const validatePanelTypeChoices = (t: TranslateFn, panel: any, errors: string[]) => {
  const config = panel.config;
  const unsupported = (setting: string, value: unknown) =>
    errors.push(t("dashboard.utils.unsupportedConfigValue", { setting, value: String(value) }));
  for (const [key, types, allowed] of PANEL_TYPE_CHOICE_KEYS) {
    if (types.includes(panel.type) && isSetValue(config[key]) && !allowed.includes(config[key])) {
      unsupported(key, config[key]);
    }
  }
  for (const [key, types, allowed] of PANEL_TYPE_LIST_KEYS) {
    if (!types.includes(panel.type) || !isSetValue(config[key])) continue;
    const values = Array.isArray(config[key]) ? config[key] : [config[key]];
    values
      .filter((value: unknown) => !allowed.includes(value))
      .forEach((value: unknown) => {
        unsupported(key, value);
      });
  }
};

const validatePanelTypeRanges = (t: TranslateFn, panel: any, errors: string[]) => {
  const config = panel.config;
  for (const [key, types, min, max, exclusive] of PANEL_TYPE_RANGE_KEYS) {
    if (!types.includes(panel.type) || !isSetValue(config[key])) continue;
    const value = asFiniteNumber(config[key]);
    const tooLow = value === null || (exclusive ? value <= min : value < min);
    if (tooLow || (value as number) > max) {
      errors.push(
        t("dashboard.utils.configValueOutOfRange", {
          setting: key,
          min: exclusive ? `> ${min}` : String(min),
          max: Number.isFinite(max) ? String(max) : "∞",
        }),
      );
    }
  }
  if (panel.type === "gauge" && isSetValue(config.gauge_neutral)) {
    if (asFiniteNumber(config.gauge_neutral) === null) {
      errors.push(t("dashboard.utils.configValueNotNumeric", { setting: "gauge_neutral" }));
    }
  }
  if (panel.type === "distribution" && isSetValue(config.distribution_bucket_offset)) {
    if (asFiniteNumber(config.distribution_bucket_offset) === null) {
      errors.push(
        t("dashboard.utils.configValueNotNumeric", { setting: "distribution_bucket_offset" }),
      );
    }
  }
  if (panel.type === "heatmap" && isSetValue(config.heatmap_hide_below)) {
    if (asFiniteNumber(config.heatmap_hide_below) === null) {
      errors.push(t("dashboard.utils.configValueNotNumeric", { setting: "heatmap_hide_below" }));
    }
  }
};

/** A special value mapping that names no known match would never apply. */
const validateSpecialMappings = (t: TranslateFn, panel: any, errors: string[]) => {
  const mappings = panel?.config?.mappings;
  if (!Array.isArray(mappings)) return;
  mappings.forEach((mapping: any, index: number) => {
    if (mapping?.type === "special" && !SPECIAL_VALUE_MATCHES.includes(mapping.match)) {
      errors.push(t("dashboard.utils.valueMappingSpecialInvalid", { index: index + 1 }));
    }
  });
};

/** Chart-specific settings the renderer would silently ignore or misread. */
const validatePanelTypeConfig = (t: TranslateFn, panelData: any, errors: string[]) => {
  const panel = panelData?.data;
  if (!panel?.config) return;
  validatePanelTypeChoices(t, panel, errors);
  validatePanelTypeRanges(t, panel, errors);
  validateSpecialMappings(t, panel, errors);
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
  validateHeatmapConfig(t, panelData, errors, isPromQLMode);
  validateCartesianConfig(t, panelData, errors, isPromQLMode);
  validatePanelTypeConfig(t, panelData, errors);

  if (
    ["area", "area-stacked", "line"].includes(panelData?.data?.type) &&
    !isValidLineThickness(panelData?.data?.config?.line_thickness)
  ) {
    errors.push(t("dashboard.lineThicknessRange", { max: MAX_LINE_THICKNESS }));
  }

  if (
    panelData?.data &&
    shouldShowScatterPointConfig(panelData) &&
    !isScatterSymbolSizeValid(panelData.data.config?.symbol_size)
  ) {
    errors.push(t("dashboard.pointSizeInvalid", { max: SYMBOL_SIZE_MAX }));
  }

  if (
    panelData?.data &&
    shouldShowBarWidthConfig(panelData, isPromQLMode) &&
    !isBarWidthValid(panelData.data.config?.bar_width)
  ) {
    errors.push(t("dashboard.barWidthInvalid", { max: BAR_WIDTH_MAX }));
  }

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

  validateGaugeRanges(t, panelData?.data, errors);

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
      "state-timeline",
      "bar-gauge",
      "hostmap",
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

  errors.push(...validateAnnotationSources(t, dashboardJson?.annotationSources));

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
      // `i` is a grid index, so 0 is a valid value — only null/undefined is missing.
      if (!panel?.layout || panel?.layout?.i == null) {
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
