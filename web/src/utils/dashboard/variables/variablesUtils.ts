import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

export const formatInterval = (interval: any) => {
  switch (true) {
    // 0.01s
    case interval <= 10:
      return { value: 1, unit: "ms" }; // 0.001s
    // 0.015s
    case interval <= 15:
      return { value: 10, unit: "ms" }; // 0.01s
    // 0.035s
    case interval <= 35:
      return { value: 20, unit: "ms" }; // 0.02s
    // 0.075s
    case interval <= 75:
      return { value: 50, unit: "ms" }; // 0.05s
    // 0.15s
    case interval <= 150:
      return { value: 100, unit: "ms" }; // 0.1s
    // 0.35s
    case interval <= 350:
      return { value: 200, unit: "ms" }; // 0.2s
    // 0.75s
    case interval <= 750:
      return { value: 500, unit: "ms" }; // 0.5s
    // 1.5s
    case interval <= 1500:
      return { value: 1, unit: "s" }; // 1s
    // 3.5s
    case interval <= 3500:
      return { value: 2, unit: "s" }; // 2s
    // 7.5s
    case interval <= 7500:
      return { value: 5, unit: "s" }; // 5s
    // 12.5s
    case interval <= 12500:
      return { value: 10, unit: "s" }; // 10s
    // 17.5s
    case interval <= 17500:
      return { value: 15, unit: "s" }; // 15s
    // 25s
    case interval <= 25000:
      return { value: 20, unit: "s" }; // 20s
    // 45s
    case interval <= 45000:
      return { value: 30, unit: "s" }; // 30s
    // 1.5m
    case interval <= 90000:
      return { value: 1, unit: "m" }; // 1m
    // 3.5m
    case interval <= 210000:
      return { value: 2, unit: "m" }; // 2m
    // 7.5m
    case interval <= 450000:
      return { value: 5, unit: "m" }; // 5m
    // 12.5m
    case interval <= 750000:
      return { value: 10, unit: "m" }; // 10m
    // 17.5m
    case interval <= 1050000:
      return { value: 15, unit: "m" }; // 15m
    // 25m
    case interval <= 1500000:
      return { value: 20, unit: "m" }; // 20m
    // 45m
    case interval <= 2700000:
      return { value: 30, unit: "m" }; // 30m
    // 1.5h
    case interval <= 5400000:
      return { value: 1, unit: "h" }; // 1h
    // 2.5h
    case interval <= 9000000:
      return { value: 2, unit: "h" }; // 2h
    // 4.5h
    case interval <= 16200000:
      return { value: 3, unit: "h" }; // 3h
    // 9h
    case interval <= 32400000:
      return { value: 6, unit: "h" }; // 6h
    // 24h
    case interval <= 86400000:
      return { value: 12, unit: "h" }; // 12h
    // 48h
    case interval <= 172800000:
      return { value: 24, unit: "h" }; // 24h
    // 1w
    case interval <= 604800000:
      return { value: 24, unit: "h" }; // 24h
    // 3w
    case interval <= 1814400000:
      return { value: 1, unit: "w" }; // 1w
    // 2y
    case interval < 3628800000:
      return { value: 30, unit: "d" }; // 30d
    default:
      return { value: 1, unit: "y" }; // 1y
  }
};

export const getTimeInSecondsBasedOnUnit = (seconds: any, unit: any) => {
  switch (true) {
    case unit === "ms":
      return seconds / 1000;
    case unit === "s":
      return seconds;
    case unit === "m":
      return seconds * 60;
    case unit === "h":
      return seconds * 60 * 60;
    case unit === "d":
      return seconds * 60 * 60 * 24;
    case unit === "w":
      return seconds * 60 * 60 * 24 * 7;
    case unit === "y":
      return seconds * 60 * 60 * 24 * 7 * 12;
    default:
      return seconds;
  }
};

export const formatRateInterval = (interval: any) => {
  let formattedStr = "";
  const days = Math.floor(interval / (3600 * 24));
  if (days > 0) formattedStr += days.toString() + "d";

  const hours = Math.floor((interval % (3600 * 24)) / 3600);
  if (hours > 0) formattedStr += hours.toString() + "h";

  const minutes = Math.floor((interval % 3600) / 60);
  if (minutes > 0) formattedStr += minutes.toString() + "m";

  const remainingSeconds = interval % 60;
  if (remainingSeconds > 0) formattedStr += remainingSeconds.toString() + "s";

  return formattedStr;
};

/**
 * Resolves variables with scope precedence: panel > tab > global
 * Extracted to avoid code duplication
 */
const resolveVariablesWithPrecedence = (
  variablesData: any,
  context?: { tabId?: string; panelId?: string },
): Record<string, any> => {
  const resolvedVariables: Record<string, any> = {};

  if (!context || !variablesData?.values) {
    return resolvedVariables;
  }

  // Group variables by name to handle multiple scopes
  const variablesByName: Record<string, any[]> = {};
  variablesData.values.forEach((variable: any) => {
    if (variable.name) {
      if (!variablesByName[variable.name]) {
        variablesByName[variable.name] = [];
      }
      variablesByName[variable.name].push(variable);
    }
  });

  // Resolve each variable with precedence: panel > tab > global
  Object.keys(variablesByName).forEach((name) => {
    const variables = variablesByName[name];
    let effectiveValue = null;
    let found = false;

    // 1. Check panel-level first
    if (context.panelId) {
      // New format: variable has panelId property directly
      const panelVar = variables.find(
        (v: any) => v.scope === "panels" && v.panelId === context.panelId,
      );
      if (panelVar && panelVar.value !== null && panelVar.value !== undefined) {
        effectiveValue = panelVar.value;
        found = true;
      } else {
        // Old format: value is array of {panelId, value}
        const panelVarOld = variables.find((v: any) => v.scope === "panels");
        if (panelVarOld && Array.isArray(panelVarOld.value)) {
          const panelValue = panelVarOld.value.find(
            (pv: any) => pv.panelId === context.panelId,
          );
          if (
            panelValue &&
            panelValue.value !== null &&
            panelValue.value !== undefined
          ) {
            effectiveValue = panelValue.value;
            found = true;
          }
        }
      }
    }

    // 2. Check tab-level next
    if (!found && context.tabId) {
      // New format: variable has tabId property directly
      const tabVar = variables.find(
        (v: any) => v.scope === "tabs" && v.tabId === context.tabId,
      );
      if (tabVar && tabVar.value !== null && tabVar.value !== undefined) {
        effectiveValue = tabVar.value;
        found = true;
      } else {
        // Old format: value is array of {tabId, value}
        const tabVarOld = variables.find((v: any) => v.scope === "tabs");
        if (tabVarOld && Array.isArray(tabVarOld.value)) {
          const tabValue = tabVarOld.value.find(
            (tv: any) => tv.tabId === context.tabId,
          );
          if (
            tabValue &&
            tabValue.value !== null &&
            tabValue.value !== undefined
          ) {
            effectiveValue = tabValue.value;
            found = true;
          }
        }
      }
    }

    // 3. Fall back to global
    if (!found) {
      const globalVar = variables.find(
        (v: any) => v.scope === "global" || !v.scope,
      );
      if (
        globalVar &&
        globalVar.value !== null &&
        globalVar.value !== undefined
      ) {
        effectiveValue = globalVar.value;
        found = true;
      }
    }

    resolvedVariables[name] = effectiveValue;
  });

  return resolvedVariables;
};

export const processVariableContent = (
  content: string,
  variablesData: any,
  context?: { tabId?: string; panelId?: string },
) => {
  let processedContent: string = content;

  if (!variablesData || !variablesData.values) {
    return processedContent;
  }

  // Build a map of resolved variable values with scope precedence
  const resolvedVariables = resolveVariablesWithPrecedence(
    variablesData,
    context,
  );

  // Process each variable for replacement
  variablesData.values.forEach((variable: any) => {
    if (!variable.name) return;

    // Get effective value based on context or use direct value
    let effectiveValue =
      context && resolvedVariables.hasOwnProperty(variable.name)
        ? resolvedVariables[variable.name]
        : variable.value;

    const placeholders = [
      "${" + variable.name + "}",
      "${" + variable.name + ":csv}",
      "${" + variable.name + ":pipe}",
      "${" + variable.name + ":doublequote}",
      "${" + variable.name + ":singlequote}",
      "$" + variable.name,
    ];

    placeholders.forEach((placeholder) => {
      // Check if value is null or empty array (use sentinel value)
      const isNullValue =
        effectiveValue === null ||
        effectiveValue === undefined ||
        (Array.isArray(effectiveValue) && effectiveValue.length === 0);

      let value = isNullValue ? SELECT_ALL_VALUE : effectiveValue;

      // Handle array formatting (only if not null)
      if (!isNullValue && Array.isArray(value)) {
        if (placeholder.includes(":csv")) {
          value = value.join(",");
        } else if (placeholder.includes(":pipe")) {
          value = value.join("|");
        } else if (placeholder.includes(":doublequote")) {
          value = value.map((v) => `"${v}"`).join(",");
        } else if (placeholder.includes(":singlequote")) {
          value = value.map((v) => `'${v}'`).join(",");
        } else {
          value = value.join(",");
        }
      }

      processedContent = processedContent.replace(
        new RegExp(
          placeholder
            .replace(/\\/g, "\\\\")
            .replace(/\$/g, "\\$")
            .replace(/\{/g, "\\{")
            .replace(/\}/g, "\\}")
            .replace(/\|/g, "\\|"),
          "g",
        ),
        String(value),
      );
    });
  });

  return processedContent;
};
