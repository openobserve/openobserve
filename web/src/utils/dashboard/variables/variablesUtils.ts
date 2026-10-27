import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

export const VARIABLE_FORMATS = ["csv", "pipe", "doublequote", "singlequote"] as const;

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export type VariableFormat = (typeof VARIABLE_FORMATS)[number];

// Text panels only: queries and drilldown would parse these and fall back to SQL quoting.
const CONTENT_VARIABLE_FORMATS = [...VARIABLE_FORMATS, "percentencode", "queryparam"] as const;

type ContentVariableFormat = (typeof CONTENT_VARIABLE_FORMATS)[number];

const QUERY_VALUE_PREFIX = /(?:[?&]|&amp;)[\w.-]+=$/;

type TimeBound = Date | number | string | null;

interface ContentVariable {
  name?: string;
  [key: string]: unknown;
}

export interface VariablePlaceholder<F extends string = VariableFormat> {
  name: string;
  format?: F;
  /** True when the placeholder sits directly inside single quotes, e.g. `'$name'`. */
  quoted: boolean;
  /** Index of the placeholder in the text. */
  offset: number;
}

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
          const panelValue = panelVarOld.value.find((pv: any) => pv.panelId === context.panelId);
          if (panelValue && panelValue.value !== null && panelValue.value !== undefined) {
            effectiveValue = panelValue.value;
            found = true;
          }
        }
      }
    }

    // 2. Check tab-level next
    if (!found && context.tabId) {
      // New format: variable has tabId property directly
      const tabVar = variables.find((v: any) => v.scope === "tabs" && v.tabId === context.tabId);
      if (tabVar && tabVar.value !== null && tabVar.value !== undefined) {
        effectiveValue = tabVar.value;
        found = true;
      } else {
        // Old format: value is array of {tabId, value}
        const tabVarOld = variables.find((v: any) => v.scope === "tabs");
        if (tabVarOld && Array.isArray(tabVarOld.value)) {
          const tabValue = tabVarOld.value.find((tv: any) => tv.tabId === context.tabId);
          if (tabValue && tabValue.value !== null && tabValue.value !== undefined) {
            effectiveValue = tabValue.value;
            found = true;
          }
        }
      }
    }

    // 3. Fall back to global
    if (!found) {
      const globalVar = variables.find((v: any) => v.scope === "global" || !v.scope);
      if (globalVar && globalVar.value !== null && globalVar.value !== undefined) {
        effectiveValue = globalVar.value;
        found = true;
      }
    }

    resolvedVariables[name] = effectiveValue;
  });

  return resolvedVariables;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPlaceholderRegex = (
  names: Iterable<string>,
  formats: readonly string[] = VARIABLE_FORMATS,
): RegExp | null => {
  const unique = [...new Set(names)].filter((name) => typeof name === "string" && name !== "");
  if (!unique.length) return null;
  // Longest first: alternation takes the first branch that matches, so $traceid_sql never resolves as $traceid + "_sql".
  const alternation = unique
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const format = `(?::\\s*(${formats.join("|")})\\s*)?`;
  return new RegExp(
    `\\{\\{\\s*(${alternation})\\s*${format}\\}\\}` +
      `|\\$\\{\\s*(${alternation})\\s*${format}\\}` +
      `|\\$(${alternation})`,
    "g",
  );
};

/**
 * Normalize variable syntax by stripping whitespace inside {{ }}, ${ }, and around format specifiers.
 * e.g., "{{ hello }}" → "{{hello}}", "${ hello : csv }" → "${hello:csv}"
 */
export const normalizeVariableSyntax = (str: string): string => {
  // Normalize mustache: {{ varName }} or {{ varName : format }}
  str = str.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*([a-zA-Z]+)\s*)?\}\}/g, (_, name, format) =>
    format ? `{{${name}:${format}}}` : `{{${name}}}`,
  );
  // Normalize dollar-brace: ${ varName } or ${ varName : format }
  str = str.replace(/\$\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*([a-zA-Z]+)\s*)?\}/g, (_, name, format) =>
    format ? `\${${name}:${format}}` : `\${${name}}`,
  );
  return str;
};

/**
 * Replaces `{{name}}`, `${name}` and `$name` placeholders of the given variable names in one pass; a `resolve` result of undefined leaves the placeholder untouched.
 */
export const replaceVariablePlaceholders = <F extends string = VariableFormat>(
  text: string,
  names: Iterable<string>,
  resolve: (placeholder: VariablePlaceholder<F>) => string | undefined,
  formats: readonly F[] = VARIABLE_FORMATS as readonly string[] as readonly F[],
): string => {
  const regex = typeof text === "string" ? buildPlaceholderRegex(names, formats) : null;
  if (!regex) return text;

  return text.replace(
    regex,
    (match, mustacheName, mustacheFormat, bracedName, bracedFormat, bareName, offset: number) => {
      const replacement = resolve({
        name: mustacheName ?? bracedName ?? bareName,
        format: mustacheFormat ?? bracedFormat,
        quoted: text[offset - 1] === "'" && text[offset + match.length] === "'",
        offset,
      });
      return replacement ?? match;
    },
  );
};

export const getReferencedVariableNames = (
  texts: (string | null | undefined)[],
  names: Iterable<string>,
): Set<string> => {
  const referenced = new Set<string>();
  const regex = buildPlaceholderRegex(names);
  if (!regex) return referenced;

  texts.forEach((text) => {
    if (typeof text !== "string") return;
    for (const match of text.matchAll(regex)) {
      referenced.add(match[1] ?? match[3] ?? match[5]);
    }
  });
  return referenced;
};

/**
 * Returns the non ad hoc variables whose placeholders appear in any of the panel queries.
 */
export const getVariablesReferencedInQueries = (
  variables: any[] | undefined,
  queries: any[] | undefined,
) => {
  if (!variables) return undefined;
  // ad hoc filters are not considered as dependent filters as they are globally applied
  const candidates = variables.filter((it: any) => it.type != "dynamic_filters");
  const referenced = getReferencedVariableNames(
    (queries ?? []).flatMap((q: any) => [q?.query, q?.config?.formula]),
    candidates.map((it: any) => it.name),
  );
  return candidates.filter((it: any) => referenced.has(it.name));
};

/** Escape a value for HTML text or any attribute; whitespace is encoded too, so an unquoted attribute cannot gain new ones. */
export const escapeHtmlValue = (value: string): string =>
  value.replace(/[&<>"'`=\s]/g, (ch) => HTML_ENTITIES[ch] ?? `&#${ch.charCodeAt(0)};`);

/** Appends `start_time` / `end_time` (the drilldown names and unit) for text panels, unless a dashboard variable already uses the name. */
export const withTimeRangeVariables = <T extends { values?: ContentVariable[] }>(
  variablesData: T,
  timeObj: { start_time?: TimeBound; end_time?: TimeBound } | null | undefined,
): T => {
  const start = timeObj?.start_time ? new Date(timeObj.start_time).getTime() : NaN;
  const end = timeObj?.end_time ? new Date(timeObj.end_time).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return variablesData;
  const values = variablesData?.values ?? [];
  const taken = new Set(values.map((v) => v?.name));
  const builtins = [
    { name: "start_time", value: start },
    { name: "end_time", value: end },
  ].filter((v) => !taken.has(v.name));
  return { ...variablesData, values: [...values, ...builtins] };
};

const formatContentValue = (name: string, value: any, format?: ContentVariableFormat): string => {
  if (format === "percentencode") {
    return encodeURIComponent(Array.isArray(value) ? value.join(",") : String(value));
  }
  if (format === "queryparam") {
    const key = `var-${encodeURIComponent(name)}`;
    return (Array.isArray(value) ? value : [value])
      .map((v) => `${key}=${encodeURIComponent(String(v))}`)
      .join("&");
  }
  if (!Array.isArray(value)) return String(value);

  switch (format) {
    case "pipe":
      return value.join("|");
    case "doublequote":
      return value.map((v) => `"${v}"`).join(",");
    case "singlequote":
      return value.map((v) => `'${v}'`).join(",");
    default:
      return value.join(",");
  }
};

/** Substitutes variables into html/markdown panel content; with `allLabel`, the All sentinel prints that label and a cleared value prints "", except in URL formats and URL query values, which keep the sentinel so links round-trip; `escapeValue` applies to every substituted string. */
export const processVariableContent = (
  content: string,
  variablesData: any,
  context?: { tabId?: string; panelId?: string },
  options?: { allLabel?: string; escapeValue?: (value: string) => string },
) => {
  const processedContent: string = normalizeVariableSyntax(content);

  if (!variablesData || !variablesData.values) {
    return processedContent;
  }

  // Build a map of resolved variable values with scope precedence
  const resolvedVariables = resolveVariablesWithPrecedence(variablesData, context);

  const valuesByName = new Map<string, any>();
  variablesData.values.forEach((variable: any) => {
    if (!variable.name || valuesByName.has(variable.name)) return;
    valuesByName.set(
      variable.name,
      context && Object.prototype.hasOwnProperty.call(resolvedVariables, variable.name)
        ? resolvedVariables[variable.name]
        : variable.value,
    );
  });

  const escapeValue = options?.escapeValue ?? ((value: string) => value);
  return replaceVariablePlaceholders<ContentVariableFormat>(
    processedContent,
    valuesByName.keys(),
    ({ name, format, offset }) => {
      let value = valuesByName.get(name);
      const isUrlFormat = format === "percentencode" || format === "queryparam";
      const inQueryValue = QUERY_VALUE_PREFIX.test(
        processedContent.slice(Math.max(0, offset - 256), offset),
      );
      const allLabel = isUrlFormat || inQueryValue ? undefined : options?.allLabel;
      const isEmpty =
        value === null || value === undefined || (Array.isArray(value) && value.length === 0);
      if (allLabel !== undefined && isEmpty) return escapeValue("");
      if (isEmpty) value = SELECT_ALL_VALUE;
      // Legacy formats never applied to the sentinel, so saved panels keep rendering it unformatted.
      if (value === SELECT_ALL_VALUE && !isUrlFormat) {
        return escapeValue(allLabel ?? SELECT_ALL_VALUE);
      }
      if (allLabel !== undefined && Array.isArray(value)) {
        value = value.map((v) => (v === SELECT_ALL_VALUE ? allLabel : v));
      }
      return escapeValue(formatContentValue(name, value, format));
    },
    CONTENT_VARIABLE_FORMATS,
  );
};
