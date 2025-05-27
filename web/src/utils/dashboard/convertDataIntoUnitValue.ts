import { date } from "quasar";
import { CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";

const units: any = {
  bytes: [
    { unit: "B", divisor: 1 },
    { unit: "KB", divisor: 1024 },
    { unit: "MB", divisor: 1024 * 1024 },
    { unit: "GB", divisor: 1024 * 1024 * 1024 },
    { unit: "TB", divisor: 1024 * 1024 * 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
  ],
  seconds: [
    { unit: "ns", divisor: 0.000000001 },
    { unit: "μs", divisor: 0.000001 },
    { unit: "ms", divisor: 0.001 },
    { unit: "s", divisor: 1 },
    { unit: "m", divisor: 60 },
    { unit: "h", divisor: 3600 },
    { unit: "D", divisor: 86400 },
    { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
  ],
  microseconds: [
    { unit: "ns", divisor: 0.001 },
    { unit: "μs", divisor: 1 },
    { unit: "ms", divisor: 1000 },
    { unit: "s", divisor: 1000000 },
    { unit: "m", divisor: 60 * 1000000 },
    { unit: "h", divisor: 3600 * 1000000 },
    { unit: "D", divisor: 86400 * 1000000 },
    { unit: "M", divisor: 2592000 * 1000000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 * 1000000 }, // Assuming 365 days in a year
  ],
  milliseconds: [
    { unit: "ns", divisor: 0.000001 },
    { unit: "μs", divisor: 0.001 },
    { unit: "ms", divisor: 1 },
    { unit: "s", divisor: 1000 },
    { unit: "m", divisor: 60 * 1000 },
    { unit: "h", divisor: 3600 * 1000 },
    { unit: "D", divisor: 86400 * 1000 },
    { unit: "M", divisor: 2592000 * 1000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 * 1000 }, // Assuming 365 days in a year
  ],
  nanoseconds: [
    { unit: "ns", divisor: 1 },
    { unit: "μs", divisor: 1000 },
    { unit: "ms", divisor: 1000000 },
    { unit: "s", divisor: 1000000000 },
    { unit: "m", divisor: 60 * 1000000000 },
    { unit: "h", divisor: 3600 * 1000000000 },
    { unit: "D", divisor: 86400 * 1000000000 },
    { unit: "M", divisor: 2592000 * 1000000000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 * 1000000000 }, // Assuming 365 days in a year
  ],
  bps: [
    { unit: "B/s", divisor: 1 },
    { unit: "KB/s", divisor: 1024 },
    { unit: "MB/s", divisor: 1024 * 1024 },
    { unit: "GB/s", divisor: 1024 * 1024 * 1024 },
    { unit: "TB/s", divisor: 1024 * 1024 * 1024 * 1024 },
    { unit: "PB/s", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
  ],
  kilobytes: [
    { unit: "B", divisor: 1 / 1024 },
    { unit: "KB", divisor: 1 },
    { unit: "MB", divisor: 1024 },
    { unit: "GB", divisor: 1024 * 1024 },
    { unit: "TB", divisor: 1024 * 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 },
  ],
  megabytes: [
    { unit: "B", divisor: 1 / (1024 * 1024) },
    { unit: "KB", divisor: 1 / 1024 },
    { unit: "MB", divisor: 1 },
    { unit: "GB", divisor: 1024 },
    { unit: "TB", divisor: 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 },
  ],
  numbers: [
    { unit: "", divisor: 1 },
    { unit: "K", divisor: 1e3 },
    { unit: "M", divisor: 1e6 },
    { unit: "B", divisor: 1e9 },
    { unit: "T", divisor: 1e12 },
    { unit: "Q", divisor: 1e15 },
  ],
};

/**
 * Converts a value to a specific unit of measurement.
 *
 * @param {any} value - The value to be converted.
 * @param {string} unit - The unit of measurement to convert to.
 * @param {string} customUnit - (optional) A custom unit of measurement.
 * @return {object} An object containing the converted value and unit.
 */
export const getUnitValue = (
  value: any,
  unit: string,
  customUnit: string,
  decimals: number = 2,
) => {
  // console.time("getUnitValue:");
  let formattedValue;
  if (
    [
      "currency-dollar",
      "currency-euro",
      "currency-pound",
      "currency-yen",
      "currency-rupee",
    ].includes(unit)
  ) {
    const numericValue = parseFloat(value) || 0;
    const formattedNumber = numericValue.toFixed(decimals);

    const localeMap: any = {
      "currency-dollar": "en-US", // US Dollar
      "currency-euro": "de-DE", // Euro
      "currency-pound": "en-GB", // British Pound
      "currency-yen": "ja-JP", // Japanese Yen
      "currency-rupee": "en-IN", // Indian Rupee
    };

    formattedValue = new Intl.NumberFormat(localeMap[unit], {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(formattedNumber));
  }

  // value sign: positive = 1, negative = -1
  const sign = Math.sign(value);
  // abs value
  const absValue = Math.abs(value);

  if (Number.isNaN(absValue) || Number.isNaN(sign)) {
    return { value: value, unit: "" };
  }

  // if value is missing use - as a placeholder
  if (isNaN(value) || value === "") {
    return { value: value === "" ? "-" : value, unit: "" };
  }

  switch (unit) {
    case "numbers":
    case "bytes":
    case "seconds":
    case "microseconds":
    case "milliseconds":
    case "nanoseconds":
    case "kilobytes":
    case "bps":
    case "megabytes": {
      // start with last index
      let unitIndex = units[unit].length - 1;
      // while the value is smaller than the divisor
      while (unitIndex > 0 && absValue < units[unit][unitIndex].divisor) {
        unitIndex--;
      }

      // calculate the final value: sign * absValue / divisor
      const finalValue = (
        (sign * absValue) /
        units[unit][unitIndex].divisor
      ).toFixed(decimals);
      const finalUnit = units[unit][unitIndex].unit;

      // console.timeEnd("getUnitValue:");
      return { value: finalValue, unit: finalUnit };
    }
    case "custom": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: `${customUnit ?? ""}`,
      };
    }
    case "percent-1": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${(parseFloat(value) * 100)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
    }
    case "percent": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
    }
    case "currency-pound": {
      return {
        value: `${formattedValue}`,
        unit: "£",
      };
    }
    case "currency-dollar": {
      return {
        value: `${formattedValue}`,
        unit: "$",
      };
    }
    case "currency-euro": {
      return {
        value: `${formattedValue}`,
        unit: "€",
      };
    }
    case "currency-yen": {
      return {
        value: `${formattedValue}`,
        unit: "¥",
      };
    }
    case "currency-rupee": {
      return {
        value: `${formattedValue}`,
        unit: "₹",
      };
    }
    case "default":
    default: {
      return {
        value: isNaN(value)
          ? value
          : value === ""
            ? "-"
            : ((+value)?.toFixed(decimals) ?? 0),
        unit: "",
      };
    }
  }
};

/**
 * Formats a unit value.
 *
 * @param {any} obj - The object containing the value and unit.
 * @return {string} The formatted unit value.
 */
export const formatUnitValue = (obj: any) => {
  const { unit } = obj;

  if (["$", "€", "£", "¥", "₹"].includes(unit)) {
    return `${obj.unit}${obj.value}`;
  }
  return `${obj.value}${obj.unit}`;
};

/**
 * Formats the given date into a string in the format "YY-MM-DD HH:MM:SS".
 *
 * @param {any} date - The date to be formatted.
 * @return {string} The formatted date string.
 */
export const formatDate = (date: any) => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// Check if the sample is time series
export const isTimeSeries = (sample: any) => {
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  return sample.every((value: any) => {
    return iso8601Pattern.test(value);
  });
};

//Check if the sample is timestamp
export const isTimeStamp = (sample: any) => {
  const microsecondsPattern = /^\d{16}$/;
  return sample.every((value: any) =>
    microsecondsPattern.test(value?.toString()),
  );
};

export function convertOffsetToSeconds(
  offset: string,
  endISOTimestamp: number,
) {
  try {
    const periodValue = parseInt(offset.slice(0, -1)); // Extract the numeric part
    const period = offset.slice(-1); // Extract the last character (unit)

    if (isNaN(periodValue)) {
      return {
        seconds: 0,
        periodAsStr: "",
      };
    }

    const subtractObject: any = {};

    let periodAsStr = periodValue.toString();

    switch (period) {
      case "s": // Seconds
        subtractObject.seconds = periodValue;
        periodAsStr += " Seconds ago";
        break;
      case "m": // Minutes
        subtractObject.minutes = periodValue;
        periodAsStr += " Minutes ago";
        break;
      case "h": // Hours
        subtractObject.hours = periodValue;
        periodAsStr += " Hours ago";
        break;
      case "d": // Days
        subtractObject.days = periodValue;
        periodAsStr += " Days ago";
        break;
      case "w": // Weeks
        subtractObject.days = periodValue * 7;
        periodAsStr += " Weeks ago";
        break;
      case "M": // Months (approximate, using 30 days per month)
        subtractObject.months = periodValue;
        periodAsStr += " Months ago";
        break;
      default:
        return {
          seconds: 0,
          periodAsStr: "",
        };
    }

    // subtract period from endISOTimestamp
    const startTimeStamp = date.subtractFromDate(
      endISOTimestamp,
      subtractObject,
    );

    // return difference of seconds between endISOTimestamp and startTimeStamp
    return {
      seconds: endISOTimestamp - startTimeStamp.getTime(),
      periodAsStr: periodAsStr,
    };
  } catch (error) {
    console.log(error);
    return {
      seconds: 0,
      periodAsStr: "",
    };
  }
}

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
 * Calculates the width of a given text.
 * Useful to calculate nameGap for the left axis
 *
 * @param {string} text - The text to calculate the width of.
 * @param {string} fontSize - The font size of the text.
 * @return {number} The width of the text in pixels.
 */
export const calculateWidthText = (
  text: string,
  fontSize: string = "12px",
): number => {
  if (!text) return 0;

  const span = document.createElement("span");
  document.body.appendChild(span);

  span.style.font = "sans-serif";
  span.style.fontSize = fontSize || "12px";
  span.style.height = "auto";
  span.style.width = "auto";
  span.style.top = "0px";
  span.style.position = "absolute";
  span.style.whiteSpace = "no-wrap";
  span.innerHTML = text;

  const width = Math.ceil(span.clientWidth);
  span.remove();
  return width;
};

/**
 * Calculates the optimal font size for a given text that fits the canvas width.
 * @param text - The text to calculate the font size for.
 * @param canvasWidth - canvas width in pixels
 * @returns {number} - The optimal font size in pixels.
 */
export const calculateOptimalFontSize = (text: string, canvasWidth: number) => {
  let minFontSize = 1; // Start with the smallest font size
  let maxFontSize = 90; // Set a maximum possible font size
  let optimalFontSize = minFontSize;

  while (minFontSize <= maxFontSize) {
    const midFontSize = Math.floor((minFontSize + maxFontSize) / 2);
    const textWidth = calculateWidthText(text, `${midFontSize}px`);

    if (textWidth > canvasWidth) {
      maxFontSize = midFontSize - 1; // Text is too wide, reduce font size
    } else {
      optimalFontSize = midFontSize; // Text fits, but we try larger
      minFontSize = midFontSize + 1;
    }
  }

  return optimalFontSize; // Return the largest font size that fits
};

/**
 * Validate the filters in the panel
 * @param conditions the conditions array
 * @param errors the array to push the errors to
 */
function validateConditions(conditions: any, errors: any) {
  conditions.forEach((it: any) => {
    if (it?.filterType === "condition") {
      // If the condition is a list, check if at least 1 item is selected
      if (it?.type == "list" && !it?.values?.length) {
        errors.push(
          `Filter: ${it.column}: Select at least 1 item from the list`,
        );
      }

      if (it?.type == "condition") {
        // Check if condition operator is selected
        if (it?.operator == null) {
          errors.push(`Filter: ${it?.column}: Operator selection required`);
        }

        // Check if condition value is required based on the operator
        if (
          !["Is Null", "Is Not Null"].includes(it?.operator) &&
          (it?.value == null || it?.value == "")
        ) {
          errors.push(`Filter: ${it?.column}: Condition value required`);
        }
      }
    } else if (it?.filterType === "group") {
      // Recursively validate the conditions in the group
      validateConditions(it?.conditions ?? [], errors);
    }
  });
}

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
) => {
  switch (chartType) {
    case "donut":
    case "pie": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        errors.push("Add one value field for donut and pie charts");
      }

      if (fields?.x?.length > 1 || fields?.x?.length === 0) {
        errors.push("Add one label field for donut and pie charts");
      }
      break;
    }
    case "metric": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        errors.push("Add one value field for metric charts");
      }

      if (fields?.x?.length) {
        errors.push(`${xAxisLabel} field is not allowed for Metric chart`);
      }
      break;
    }
    case "gauge": {
      if (fields?.y?.length !== 1) {
        errors.push("Add one value field for gauge chart");
      }
      // gauge can have zero or one label
      if (fields?.x?.length !== 1 && fields?.x?.length !== 0) {
        errors.push("Add one label field for gauge chart");
      }
      break;
    }
    case "h-bar":
    case "area":
    case "line":
    case "scatter":
    case "bar": {
      if (fields?.y?.length < 1) {
        errors.push(`Add at least one field for the ${yAxisLabel}`);
      }

      if (fields?.x?.length > 1 || fields?.x?.length === 0) {
        errors.push(`Add one fields for the ${xAxisLabel}`);
      }
      break;
    }
    case "table": {
      if (fields?.y?.length === 0 && fields?.x?.length === 0) {
        errors.push(`Add at least one field on ${xAxisLabel} or ${yAxisLabel}`);
      }
      break;
    }
    case "heatmap": {
      if (fields?.y?.length === 0) {
        errors.push(`Add at least one field for the ${yAxisLabel}`);
      }

      if (fields?.x?.length === 0) {
        errors.push(`Add one field for the ${xAxisLabel}`);
      }

      if (fields?.z?.length === 0) {
        errors.push("Add one field for the Z-Axis");
      }
      break;
    }
    case "stacked":
    case "h-stacked": {
      if (fields?.y?.length === 0) {
        errors.push(`Add at least one field for the ${yAxisLabel}`);
      }
      if (fields?.x?.length !== 1 || fields?.breakdown?.length !== 1) {
        errors.push(
          `Add exactly one field on the ${xAxisLabel} and breakdown for stacked and h-stacked charts`,
        );
      }
      break;
    }
    case "area-stacked": {
      if (fields?.y?.length > 1 || fields?.y?.length === 0) {
        errors.push(
          `Add exactly one field on ${yAxisLabel} for area-stacked charts`,
        );
      }
      if (fields?.x?.length !== 1 || fields?.breakdown?.length !== 1) {
        errors.push(
          `Add exactly one field on the ${xAxisLabel} and breakdown for area-stacked charts`,
        );
      }
      break;
    }
    case "geomap": {
      if (fields?.latitude == null) {
        errors.push("Add one field for the latitude");
      }
      if (fields?.longitude == null) {
        errors.push("Add one field for the longitude");
      }
      break;
    }
    case "sankey": {
      if (fields?.source == null) {
        errors.push("Add one field for the source");
      }
      if (fields?.target == null) {
        errors.push("Add one field for the target");
      }
      if (fields?.value == null) {
        errors.push("Add one field for the value");
      }
      break;
    }
    case "maps": {
      if (fields?.name == null) {
        errors.push("Add one field for the name");
      }
      if (fields?.value_for_maps == null) {
        errors.push("Add one field for the value");
      }
      break;
    }
    default:
      break;
  }

  // Check filter conditions validity
  if (fields?.filter?.conditions?.length) {
    // Validate the conditions
    validateConditions(fields?.filter?.conditions ?? [], errors);
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
) => {
  if (isFieldsValidationRequired) {
    // Validate fields configuration based on chart type
    validateChartFieldsConfiguration(
      panelData?.type,
      panelData?.queries?.[queryIndex]?.fields ?? {},
      errors,
      currentXLabel,
      currentYLabel,
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

/**
 * Validates panel fields without validating stream field existence
 *
 * @param panel The panel to validate
 * @param errors Array to collect error messages
 */
const validatePanelFields = (panel: any, errors: string[] = []) => {
  // Check if panel has promQL query type
  const isPromQLMode = panel?.queryType === "promql";
  const currentQueryIndex = 0; // Default to first query

  // Validate panel content based on type
  validatePanelContentByType(panel, errors);

  if (!isPromQLMode && panel.queries?.[currentQueryIndex]?.fields) {
    // Validate fields configuration based on chart type
    validateChartFieldsConfiguration(
      panel?.type,
      panel?.queries?.[currentQueryIndex]?.fields ?? {},
      errors,
    );
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
) => {
  // Get current query index
  const currentQueryIndex = panelData?.layout?.currentQueryIndex || 0;

  // Check if panel has promQL query type
  const isPromQLMode = panelData?.data?.queryType === "promql";

  // Validate panel content based on type
  validatePanelContentByType(panelData?.data, errors);

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
    );

    // Validate fields against streams if field validation is required
    if (isFieldsValidationRequired) {
      const isCustomQueryMode =
        panelData?.data?.queries?.[currentQueryIndex]?.customQueryMode;

      if (isCustomQueryMode) {
        validateCustomQueryFields(panelData, currentQueryIndex, errors);
      } else {
        validateStreamFields(
          panelData,
          currentQueryIndex,
          errors,
          allStreamFields,
        );
      }
    }
  }

  return errors;
};

/**
 * Validates fields for custom query mode
 * @param {object} panelData - The panel data object
 * @param {number} queryIndex - The current query index
 * @param {array} errors - Array to collect errors
 */
const validateCustomQueryFields = (
  panelData: any,
  queryIndex: number,
  errors: string[],
) => {
  const customQueryXFieldError = panelData?.data?.queries?.[
    queryIndex
  ]?.fields?.x?.filter(
    (it: any) =>
      ![
        ...panelData?.meta?.stream?.customQueryFields,
        ...panelData?.meta?.stream?.vrlFunctionFieldList,
      ].find((i: any) => i.name === it.column),
  );

  if (customQueryXFieldError.length) {
    errors.push(
      ...customQueryXFieldError.map(
        (it: any) =>
          `Please update X-Axis Selection. Current X-Axis field ${it.column} is invalid`,
      ),
    );
  }

  const customQueryYFieldError = panelData?.data?.queries?.[
    queryIndex
  ]?.fields?.y?.filter(
    (it: any) =>
      ![
        ...panelData?.meta?.stream?.customQueryFields,
        ...panelData?.meta?.stream?.vrlFunctionFieldList,
      ].find((i: any) => i.name === it.column),
  );

  if (customQueryYFieldError.length) {
    errors.push(
      ...customQueryYFieldError.map(
        (it: any) =>
          `Please update Y-Axis Selection. Current Y-Axis field ${it.column} is invalid`,
      ),
    );
  }
};

/**
 * Validates fields for stream selection mode
 * @param {object} panelData - The panel data object
 * @param {number} queryIndex - The current query index
 * @param {array} errors - Array to collect errors
 * @param {array} streamFields - Fields available in the selected stream
 */
const validateStreamFields = (
  panelData: any,
  queryIndex: number,
  errors: string[],
  allStreamFields: any[] = [],
) => {
  const customQueryXFieldError = panelData?.data?.queries?.[
    queryIndex
  ]?.fields?.x?.filter(
    (it: any) => !allStreamFields.find((i: any) => i.name == it.column),
  );

  if (customQueryXFieldError.length) {
    errors.push(
      ...customQueryXFieldError.map(
        (it: any) =>
          `Please update X-Axis Selection. Current X-Axis field ${it.column} is invalid for selected stream`,
      ),
    );
  }

  const customQueryYFieldError = panelData?.data?.queries?.[
    queryIndex
  ]?.fields?.y?.filter(
    (it: any) => !allStreamFields.find((i: any) => i.name == it.column),
  );

  if (customQueryYFieldError.length) {
    errors.push(
      ...customQueryYFieldError.map(
        (it: any) =>
          `Please update Y-Axis Selection. Current Y-Axis field ${it.column} is invalid for selected stream`,
      ),
    );
  }
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

// Modify the getContrastColor function to consider theme
export const getContrastColor = (
  backgroundColor: string,
  isDarkTheme: boolean,
): string => {
  // If no background color, return based on theme
  if (!backgroundColor) {
    return isDarkTheme ? "#FFFFFF" : "#000000";
  }

  // Normalize input (support hex, rgb, rgba)
  const normalizeColor = (
    color: string,
  ): { r: number; g: number; b: number } => {
    // Remove spaces and convert to lowercase
    color = color.replace(/\s/g, "").toLowerCase();

    // Hex color
    if (color.startsWith("#")) {
      const hex = color.replace("#", "");
      return {
        r: parseInt(hex.substr(0, 2), 16),
        g: parseInt(hex.substr(2, 2), 16),
        b: parseInt(hex.substr(4, 2), 16),
      };
    }

    // RGB or RGBA
    if (color.startsWith("rgb")) {
      const matches = color.match(/rgba?\((\d+),(\d+),(\d+)(?:,([.\d]+))?\)/);
      if (matches) {
        return {
          r: parseInt(matches[1], 10),
          g: parseInt(matches[2], 10),
          b: parseInt(matches[3], 10),
        };
      }
    }

    // Fallback
    return { r: 255, g: 255, b: 255 };
  };

  // Normalize the background color
  const { r, g, b } = normalizeColor(backgroundColor);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance and theme
  if (isDarkTheme) {
    // In dark theme, prefer white text unless background is very light
    return luminance > 0.8 ? "#000000" : "#FFFFFF";
  } else {
    // In light theme, prefer black text unless background is very dark
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
  }
};
