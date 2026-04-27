// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import Ajv, { type ErrorObject, type KeywordDefinition } from "ajv";
import dashboardSchema from "@schemas/dashboard-v8.schema.json";
import functionValidationDefs from "@schemas/functions/functionValidation.json";
import errorMessages from "@schemas/errorMessages.json";

import { CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";

// ============================================================
// CUSTOM AJV KEYWORDS
// ============================================================

const uniqueTabIds: KeywordDefinition = {
  keyword: "uniqueTabIds",
  type: "array",
  validate: function _uniqueTabIds(_schema: boolean, data: any[]) {
    if (!_schema || !Array.isArray(data)) return true;
    const ids = data.map((t: any) => t?.tabId).filter(Boolean);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      (_uniqueTabIds as any).errors = dupes.map((id) => ({
        keyword: "uniqueTabIds",
        message: `Duplicate tab ID found: ${id}`,
        params: { keyword: "uniqueTabIds" },
      }));
      return false;
    }
    return true;
  },
  errors: true,
};

const uniquePanelIds: KeywordDefinition = {
  keyword: "uniquePanelIds",
  type: "array",
  validate: function _uniquePanelIds(_schema: boolean, data: any[]) {
    if (!_schema || !Array.isArray(data)) return true;
    const panelIds = new Set<string>();
    const errors: any[] = [];
    for (const tab of data) {
      for (const panel of tab?.panels || []) {
        if (panel?.id && panelIds.has(panel.id)) {
          errors.push({
            keyword: "uniquePanelIds",
            message: `Duplicate panel ID found: ${panel.id}`,
            params: { keyword: "uniquePanelIds" },
          });
        }
        if (panel?.id) panelIds.add(panel.id);
      }
    }
    if (errors.length > 0) {
      (_uniquePanelIds as any).errors = errors;
      return false;
    }
    return true;
  },
  errors: true,
};

const uniqueLayoutI: KeywordDefinition = {
  keyword: "uniqueLayoutI",
  type: "array",
  validate: function _uniqueLayoutI(_schema: boolean, data: any[]) {
    if (!_schema || !Array.isArray(data)) return true;
    const layoutIs = new Set<string>();
    const errors: any[] = [];
    for (const panel of data) {
      const i = panel?.layout?.i?.toString();
      if (i && layoutIs.has(i)) {
        errors.push({
          keyword: "uniqueLayoutI",
          message: `Duplicate layout.i value: ${i}`,
          params: { keyword: "uniqueLayoutI" },
        });
      }
      if (i) layoutIs.add(i);
    }
    if (errors.length > 0) {
      (_uniqueLayoutI as any).errors = errors;
      return false;
    }
    return true;
  },
  errors: true,
};

const validateFunctionArgs: KeywordDefinition = {
  keyword: "validateFunctionArgs",
  validate: function _validateFunctionArgs(_schema: boolean, data: any) {
    if (!_schema || !data || data.isDerived) return true;
    const errors: string[] = [];
    _validateFn(data, data.alias || "Field", errors);
    if (errors.length > 0) {
      (_validateFunctionArgs as any).errors = errors.map((msg) => ({
        keyword: "validateFunctionArgs",
        message: msg,
        params: { keyword: "validateFunctionArgs" },
      }));
      return false;
    }
    return true;
  },
  errors: true,
};

const tableMinFields: KeywordDefinition = {
  keyword: "tableMinFields",
  validate: function _tableMinFields(_schema: boolean, data: any) {
    if (!_schema || data?.type !== "table") return true;
    const query = data?.queries?.[0];
    if (!query || query.customQuery) return true;
    const xLen = query.fields?.x?.length || 0;
    const yLen = query.fields?.y?.length || 0;
    if (xLen + yLen === 0) {
      (_tableMinFields as any).errors = [{
        keyword: "tableMinFields",
        message: "table:minFields",
        params: { keyword: "tableMinFields" },
      }];
      return false;
    }
    return true;
  },
  errors: true,
};

const validateFilterValues: KeywordDefinition = {
  keyword: "validateFilterValues",
  validate: function _validateFilterValues(_schema: boolean, data: any) {
    if (!_schema || !data?.conditions) return true;
    const errors: any[] = [];
    _checkConditions(data.conditions, errors);
    if (errors.length > 0) {
      (_validateFilterValues as any).errors = errors;
      return false;
    }
    return true;
  },
  errors: true,
};

function _checkConditions(conditions: any[], errors: any[]) {
  for (const c of conditions) {
    if (c.filterType === "group") {
      _checkConditions(c.conditions || [], errors);
    } else if (c.filterType === "condition") {
      const col = c.column?.field || (typeof c.column === "string" ? c.column : null) || "unknown";
      if (c.type === "list" && !c.values?.length) {
        errors.push({ keyword: "validateFilterValues", message: `Filter: ${col}: Select at least 1 item from the list`, params: {} });
      }
      if (c.type === "condition") {
        if (c.operator == null) {
          errors.push({ keyword: "validateFilterValues", message: `Filter: ${col}: Operator selection required`, params: {} });
        }
        if (!["Is Null", "Is Not Null"].includes(c.operator) && (c.value == null || c.value === "")) {
          errors.push({ keyword: "validateFilterValues", message: `Filter: ${col}: Condition value required`, params: {} });
        }
      }
    }
  }
}

// ============================================================
// FUNCTION ARGUMENT VALIDATION (used by validateFunctionArgs keyword)
// ============================================================

function _validateFn(funcConfig: any, fieldPath: string, errors: string[]) {
  if (funcConfig.type === "raw") {
    if (!funcConfig.rawQuery || typeof funcConfig.rawQuery !== "string" || funcConfig.rawQuery.trim() === "") {
      errors.push(`${fieldPath}: Raw query cannot be empty`);
    }
    return;
  }

  const selectedFunction: any = functionValidationDefs.find(
    (fn: any) => fn.functionName === (funcConfig.functionName ?? null),
  );
  if (!selectedFunction) {
    errors.push(`${fieldPath}: Invalid aggregation function`);
    return;
  }

  const args = funcConfig.args || [];
  const argsDefinition = selectedFunction.args || [];
  const allowAddArgAtValue = selectedFunction.allowAddArgAt;
  const hasVariableArgs = !!allowAddArgAtValue;

  let variableArgPosition = -1;
  if (hasVariableArgs) {
    if (allowAddArgAtValue === "n") variableArgPosition = 0;
    else if (allowAddArgAtValue.startsWith("n-")) {
      variableArgPosition = argsDefinition.length - parseInt(allowAddArgAtValue.substring(2));
    }
  }

  const minArgDef = argsDefinition.find((def: any) => "min" in def);
  const minPosition = minArgDef ? argsDefinition.indexOf(minArgDef) : -1;
  if (minArgDef && minPosition !== -1) {
    const relevantArgsCount = hasVariableArgs && variableArgPosition <= minPosition
      ? args.length - variableArgPosition + 1 : args.length;
    if (relevantArgsCount < minArgDef.min) {
      errors.push(`${fieldPath}: Requires at least ${minArgDef.min} arguments`);
    }
  }

  args.forEach((arg: any, index: number) => {
    if (!arg) return;
    let argDefIndex = index;
    if (hasVariableArgs && index >= variableArgPosition) argDefIndex = variableArgPosition;
    if (argDefIndex >= argsDefinition.length) {
      if (!hasVariableArgs) { errors.push(`${fieldPath}: Too many arguments provided`); return; }
      argDefIndex = variableArgPosition;
    }
    const allowedTypes = argsDefinition[argDefIndex].type.map((t: any) => t.value);
    if (arg && !allowedTypes.includes(arg.type)) {
      errors.push(`${fieldPath}: Argument ${index + 1} has invalid type (expected: ${allowedTypes.join(" or ")})`);
      return;
    }
    if (arg.type === "field") {
      if (!arg.value || typeof arg.value !== "object" || !("field" in arg.value))
        errors.push(`${fieldPath}: Argument ${index + 1} is a field but haven't selected any field`);
    } else if (arg.type === "function") {
      if (!arg.value || typeof arg.value !== "object")
        errors.push(`${fieldPath}: Argument ${index + 1} is a function but has invalid structure`);
      else _validateFn(arg.value, `${fieldPath} \u2192 Arg ${index + 1}`, errors);
    } else if (arg.type === "number") {
      if (arg.value === null || arg.value === undefined || arg.value === "")
        errors.push(`${fieldPath}: Argument ${index + 1} is a number but no value entered`);
      else if (typeof arg.value !== "number" || isNaN(arg.value))
        errors.push(`${fieldPath}: Argument ${index + 1} must be a valid number`);
    } else if (arg.type === "string") {
      if (arg.value === null || arg.value === undefined)
        errors.push(`${fieldPath}: Argument ${index + 1} is a string but no value entered`);
      else if (typeof arg.value !== "string" || arg.value.trim() === "")
        errors.push(`${fieldPath}: Argument ${index + 1} must be a non-empty string`);
    } else if (arg.type === "histogramInterval") {
      if (!(arg.value === null || !arg.value || typeof arg.value === "string"))
        errors.push(`${fieldPath}: Argument ${index + 1} must be a valid histogram interval`);
    }
  });

  argsDefinition.forEach((argDef: any, index: number) => {
    if (hasVariableArgs && index > variableArgPosition) return;
    if (argDef.required && (index >= args.length || !args[index]))
      errors.push(`${fieldPath}: Missing required argument at position ${index + 1}`);
  });
}

// ============================================================
// AJV SETUP
// ============================================================

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
ajv.addKeyword(uniqueTabIds);
ajv.addKeyword(uniquePanelIds);
ajv.addKeyword(uniqueLayoutI);
ajv.addKeyword(validateFunctionArgs);
ajv.addKeyword(tableMinFields);
ajv.addKeyword(validateFilterValues);

const validate = ajv.compile(dashboardSchema);

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Validate full dashboard JSON via ajv. Used by BE and internal panel validation.
 */
export function validateDashboard(dashboardJson: any, pageKey: string = "dashboard"): string[] {
  const valid = validate(dashboardJson);
  if (valid) return [];
  return mapErrors(validate.errors || [], dashboardJson, pageKey);
}

/**
 * Exact replacement for old validateDashboardJson().
 * Uses old TS logic for dashboard structure + ajv for panel fields.
 * Produces exact same messages as old panelValidation.ts.
 */
export const validateDashboardJson = (dashboardJson: any): string[] => {
  const errors: string[] = [];

  if (!dashboardJson) {
    errors.push("Dashboard JSON is empty or invalid");
    return errors;
  }
  if (!dashboardJson?.dashboardId) errors.push("Dashboard ID is required");
  if (!dashboardJson?.title) errors.push("Dashboard title is required");
  if (!dashboardJson?.version) {
    errors.push("Dashboard version is required");
  } else if (dashboardJson.version !== CURRENT_DASHBOARD_SCHEMA_VERSION) {
    errors.push(`Dashboard version must be ${CURRENT_DASHBOARD_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(dashboardJson?.tabs) || dashboardJson?.tabs?.length === 0) {
    errors.push("Dashboard must have at least one tab");
    return errors;
  }

  const tabIds = new Set<string>();
  for (const tab of dashboardJson?.tabs) {
    if (!tab?.tabId) errors.push("Each tab must have a tabId");
    else if (tabIds.has(tab?.tabId)) errors.push(`Duplicate tab ID found: ${tab?.tabId}`);
    else tabIds.add(tab?.tabId);
    if (!tab?.name) errors.push(`Tab ${tab?.tabId} must have a name`);
  }

  const panelIds = new Set<string>();
  const layoutIValues = new Map<string, Set<string>>();

  for (const tab of dashboardJson.tabs) {
    if (!Array.isArray(tab?.panels)) {
      errors.push(`Tab ${tab?.tabId} must have a panels array`);
      continue;
    }
    layoutIValues.set(tab?.tabId, new Set<string>());
    for (const panel of tab.panels) {
      if (!panel?.id) errors.push(`Panel in tab ${tab?.tabId} is missing an ID`);
      else if (panelIds.has(panel?.id)) errors.push(`Duplicate panel ID found: ${panel?.id}`);
      else panelIds.add(panel?.id);

      if (!panel?.layout || !panel?.layout?.i) {
        errors.push(`Panel ${panel?.id} is missing a layout.i value`);
      } else {
        const tabLayoutValues = layoutIValues.get(tab?.tabId);
        if (tabLayoutValues && tabLayoutValues.has(panel?.layout?.i?.toString())) {
          errors.push(`Duplicate layout.i value found in tab ${tab?.tabId}: ${panel?.layout?.i}`);
        } else if (tabLayoutValues) {
          tabLayoutValues.add(panel?.layout?.i?.toString());
        }
      }

      // Panel structure
      if (!panel?.type) {
        errors.push(`Panel ${panel?.id}: Panel type is required`);
      } else {
        const allowedTypes = [
          "area", "line", "bar", "scatter", "area-stacked", "donut", "pie", "h-bar",
          "stacked", "h-stacked", "heatmap", "metric", "gauge", "geomap", "maps",
          "table", "sankey", "custom_chart", "html", "markdown",
        ];
        if (!allowedTypes.includes(panel?.type))
          errors.push(`Panel ${panel?.id}: Chart type "${panel?.type}" is not supported.`);
      }
      if (!panel?.title) errors.push(`Panel ${panel?.id}: Panel title is required`);
      if (!panel?.layout) {
        errors.push(`Panel ${panel?.id}: Layout is required`);
      } else {
        if (typeof panel?.layout?.x !== "number") errors.push(`Panel ${panel?.id}: Layout x must be a number`);
        if (typeof panel?.layout?.y !== "number") errors.push(`Panel ${panel?.id}: Layout y must be a number`);
        if (typeof panel?.layout?.w !== "number") errors.push(`Panel ${panel?.id}: Layout w must be a number`);
        if (typeof panel?.layout?.h !== "number") errors.push(`Panel ${panel?.id}: Layout h must be a number`);
      }

      // Panel field validation via ajv
      if (panel?.type !== "markdown" && panel?.type !== "html") {
        try {
          const panelDetailErrors: string[] = [];
          _validatePanelFields(panel, panelDetailErrors);
          errors.push(...panelDetailErrors.map((e) => `Panel ${panel?.id || "unknown"}: ${e}`));
        } catch (error) {
          errors.push(`Panel ${panel?.id || "unknown"}: ${error instanceof Error ? error?.message : "Unable to validate panel configuration"}`);
        }
      }
    }
  }
  return errors;
};

/** Internal: validate panel fields for import flow. */
const _validatePanelFields = (panel: any, errors: string[] = []) => {
  const isPromQLMode = panel?.queryType === "promql" || panel?.queryType === "promql-builder";
  const qi = 0;

  // Content checks
  if (panel?.queryType === "promql") {
    (panel?.queries || []).forEach((q: any, i: number) => {
      if (q && q?.query === "") errors.push(`Query-${i + 1} is empty`);
    });
  }
  if (panel?.type === "geomap") {
    (panel?.queries || []).forEach((q: any, i: number) => {
      if (q && q?.query === "") errors.push(`Query-${i + 1} is empty`);
    });
  }
  if (panel?.type === "html" && (!panel?.htmlContent || panel.htmlContent.trim() === "")) {
    errors.push("Please enter your HTML code");
  }
  if (panel?.type === "markdown" && (!panel?.markdownContent || panel.markdownContent.trim() === "")) {
    errors.push("Please enter your markdown code");
  }
  if (panel?.type === "custom_chart" && (!panel?.queries?.[0]?.query || panel.queries[0].query === "")) {
    errors.push("Please enter query for custom chart");
  }

  if (!isPromQLMode && panel?.type && !panel?.queries?.[qi]?.customQuery && panel?.queries?.[qi]?.fields) {
    // Chart fields + function args + joins + filters via ajv
    const minDash = {
      title: "v", version: 8,
      tabs: [{ tabId: "t", name: "t", panels: [{
        id: "p", type: panel.type, title: "p",
        layout: { x: 0, y: 0, w: 1, h: 1, i: 0 },
        queryType: panel.queryType, queries: panel.queries, config: panel.config || {},
      }] }],
    };
    errors.push(...validateDashboard(minDash));

    // Filter conditions (TS — for exact messages)
    if (panel?.queries?.[qi]?.fields?.filter?.conditions?.length) {
      _validateConditionsTS(panel?.queries?.[qi]?.fields?.filter?.conditions ?? [], errors);
    }
  }
  return errors;
};

function _validateConditionsTS(conditions: any, errors: any) {
  conditions.forEach((it: any) => {
    if (it.filterType === "condition") {
      const col = it.column?.field || (typeof it.column === "string" ? it.column : null) || "unknown";
      if (it.type === "list" && !it.values?.length)
        errors.push(`Filter: ${col}: Select at least 1 item from the list`);
      if (it.type === "condition") {
        if (it.operator == null) errors.push(`Filter: ${col}: Operator selection required`);
        if (!["Is Null", "Is Not Null"].includes(it.operator) && (it.value == null || it.value == ""))
          errors.push(`Filter: ${col}: Condition value required`);
      }
    } else if (it.filterType === "group") {
      _validateConditionsTS(it.conditions, errors);
    }
  });
}

/**
 * Validate panel on Apply/Save button click.
 * Content checks + PromQL checks = direct TS (exact messages).
 * Chart field + join + function arg validation = via ajv with pageKey.
 */
export const validatePanel = (
  panelData: any,
  errors: string[] = [],
  isFieldsValidationRequired: boolean = true,
  allStreamFields: any[] = [],
  pageKey: string = "dashboard",
  store?: any,
  checkTimestampAlias?: any,
  checkPanelName: boolean = false,
) => {
  const data = panelData?.data || panelData;
  const currentQueryIndex = panelData?.layout?.currentQueryIndex || 0;
  const isPromQLMode = data?.queryType === "promql" || data?.queryType === "promql-builder";

  if (checkPanelName && (data?.title == null || data?.title?.trim() === "")) {
    errors.push("Name of Panel is required");
  }

  // Content checks
  if (data?.queryType === "promql") {
    (data?.queries || []).forEach((q: any, i: number) => { if (q && q?.query === "") errors.push(`Query-${i + 1} is empty`); });
  }
  if (data?.type === "geomap") {
    (data?.queries || []).forEach((q: any, i: number) => { if (q && q?.query === "") errors.push(`Query-${i + 1} is empty`); });
  }
  if (data?.type === "html" && (!data?.htmlContent || data.htmlContent.trim() === "")) errors.push("Please enter your HTML code");
  if (data?.type === "markdown" && (!data?.markdownContent || data.markdownContent.trim() === "")) errors.push("Please enter your markdown code");
  if (data?.type === "custom_chart" && (!data?.queries?.[0]?.query || data.queries[0].query === "")) errors.push("Please enter query for custom chart");

  // Timestamp alias (FE-only)
  if (data?.queryType === "sql" && store && checkTimestampAlias) {
    const tsCol = store.state.zoConfig.timestamp_column || "_timestamp";
    data?.queries?.forEach((qo: any) => {
      if (qo?.query && qo?.customQuery && !checkTimestampAlias(qo.query))
        errors.push(`Alias '${tsCol}' is not allowed.`);
    });
  }

  if (isPromQLMode) {
    if (data?.queries?.[currentQueryIndex]?.fields?.x?.length > 0)
      errors.push("X-Axis is not supported for PromQL. Remove anything added to the X-Axis.");
    if (data?.queries?.[currentQueryIndex]?.fields?.y?.length > 0)
      errors.push("Y-Axis is not supported for PromQL. Remove anything added to the Y-Axis.");
    if (data?.queries?.[currentQueryIndex]?.fields?.filter?.conditions?.length > 0)
      errors.push("Filters are not supported for PromQL. Remove anything added to the Filters.");
  } else if (
    isFieldsValidationRequired &&
    !data?.queries?.[currentQueryIndex]?.customQuery &&
    !["html", "markdown", "custom_chart"].includes(data?.type)
  ) {
    // Chart field + join + function validation via ajv with pageKey
    // Skip html/markdown/custom_chart — their content checks are done above
    const minDash = {
      title: "v", version: 8,
      tabs: [{ tabId: "t", name: "t", panels: [{
        id: "p", type: data?.type, title: "p",
        layout: { x: 0, y: 0, w: 1, h: 1, i: 0 },
        queryType: data?.queryType, queries: data?.queries, config: data?.config || {},
      }] }],
    };
    errors.push(...validateDashboard(minDash, pageKey));
  }

  return errors;
};

/**
 * Validate SQL panel fields — used by PanelSchemaRenderer.
 * Only chart-type field counts (not function args, joins, filters).
 */
export const validateSQLPanelFields = (
  panelData: any, queryIndex: number, currentXLabel: string, currentYLabel: string,
  errors: string[], isFieldsValidationRequired: boolean = true, pageKey?: string,
) => {
  if (panelData?.queryType === "promql" || !isFieldsValidationRequired) return;
  if (panelData?.queries?.[0]?.customQuery) return;
  // Early return if chartType or fields missing (same as old validateChartFieldsConfiguration)
  if (!panelData?.type || !panelData?.queries?.[queryIndex]?.fields) return;

  const minDash = {
    title: "v", version: 8,
    tabs: [{ tabId: "t", name: "t", panels: [{
      id: "p", type: panelData.type, title: "p",
      layout: { x: 0, y: 0, w: 1, h: 1, i: 0 },
      queryType: panelData.queryType, queries: panelData.queries, config: panelData.config || {},
    }] }],
  };
  const valid = validate(minDash);
  if (valid) return;

  const fieldErrors = (validate.errors || []).filter((e) => {
    if (["uniqueTabIds", "uniquePanelIds", "uniqueLayoutI", "validateFunctionArgs",
         "validateFilterValues", "if", "then", "else", "oneOf", "anyOf", "not"
    ].includes(e.keyword)) return false;
    // Keep tableMinFields (table chart validation) and field-level errors
    if (e.keyword === "tableMinFields") return true;
    return e.instancePath.includes("/fields");
  });
  errors.push(...mapErrors(fieldErrors, minDash, pageKey || "dashboard"));
};

/** FE-only checks. */
export function validateFEOnly(panelData: any, store: any, checkTimestampAlias: (q: string) => boolean): string[] {
  const errors: string[] = [];
  if (panelData?.queryType === "sql") {
    const tsCol = store.state.zoConfig.timestamp_column || "_timestamp";
    panelData?.queries?.forEach((qo: any) => {
      if (qo?.query && qo?.customQuery && !checkTimestampAlias(qo.query))
        errors.push(`Alias '${tsCol}' is not allowed.`);
    });
  }
  return errors;
}

/** Utility: find first valid mapped value. */
export const findFirstValidMappedValue = (value: any, mappings: any[], fieldToCheck: string) => {
  return mappings?.find((v: any) => {
    let isMatch = false;
    if (v?.type == "value") isMatch = v?.value == value;
    else if (v?.type == "range") {
      if (v?.from && v?.to && !Number.isNaN(+v?.from) && !Number.isNaN(+v?.to))
        isMatch = +v?.from <= +value && +v?.to >= +value;
    } else if (v?.type == "regex") isMatch = new RegExp(v?.pattern ?? "").test(value);
    return isMatch && v[fieldToCheck];
  });
};

// ============================================================
// ERROR MAPPING — ajv errors → user-friendly messages
// ============================================================

const CHART_ERRORS: Record<string, Record<string, any>> = errorMessages.chartErrors as any;

function mapErrors(errors: ErrorObject[], dashboard: any, pageKey: string = "dashboard"): string[] {
  const messages: string[] = [];

  for (const error of errors) {
    const path = error.instancePath;

    if (["if", "then", "else", "oneOf", "anyOf", "not"].includes(error.keyword)) continue;

    // Custom keywords
    if (["uniqueTabIds", "uniquePanelIds", "uniqueLayoutI", "validateFunctionArgs", "validateFilterValues"].includes(error.keyword)) {
      messages.push(error.message || "Validation error");
      continue;
    }

    // tableMinFields
    if (error.keyword === "tableMinFields") {
      const pi = extractPanelInfo(path, dashboard);
      const ct = pi?.chartType || "table";
      const msg = CHART_ERRORS?.[ct]?.["table:minFields"];
      messages.push(msg ? (typeof msg === "object" ? (msg[pageKey] || msg.dashboard) : msg) : "Add at least one field");
      continue;
    }

    // Join errors — check BEFORE panel catch-all (joins are within panel path)
    const jm = path.match(/joins\/(\d+)/);
    if (jm) {
      const ji = parseInt(jm[1]);
      const cm = path.match(/conditions\/(\d+)/);
      if (cm) {
        const ci = parseInt(cm[1]);
        const prop = error.params?.missingProperty || path.split("/").pop();
        if (prop === "field" && path.includes("leftField")) messages.push(`Join #${ji + 1}: Clause ${ci + 1}: Left field is required`);
        else if (prop === "field" && path.includes("rightField")) messages.push(`Join #${ji + 1}: Clause ${ci + 1}: Right field is required`);
        else if (prop === "operation") messages.push(`Join #${ji + 1}: Clause ${ci + 1}: Operation is required`);
      } else {
        if (error.keyword === "required" && error.params?.missingProperty === "stream") messages.push(`Join #${ji + 1}: Stream is required`);
        else if (error.keyword === "required" && error.params?.missingProperty === "joinType") messages.push(`Join #${ji + 1}: Join type is required`);
        else if (error.keyword === "minItems" && path.endsWith("/conditions")) messages.push(`Join #${ji + 1}: At least one clause is required`);
        else if (error.keyword === "minLength") messages.push(`Join #${ji + 1}: Stream is required`);
      }
      continue;
    }

    // Chart-type field errors
    const panelInfo = extractPanelInfo(path, dashboard);
    if (panelInfo) {
      const field = path.split("/").pop() || "";
      const key = `${field}:${error.keyword}`;
      const chartMsgs = CHART_ERRORS[panelInfo.chartType];
      if (chartMsgs?.[key]) {
        const msg = chartMsgs[key];
        messages.push(typeof msg === "object" ? (msg[pageKey] || msg.dashboard) : msg);
        continue;
      }
      if (error.keyword === "required" && error.params?.missingProperty) {
        const reqKey = `${error.params.missingProperty}:required`;
        if (chartMsgs?.[reqKey]) {
          const msg = chartMsgs[reqKey];
          messages.push(typeof msg === "object" ? (msg[pageKey] || msg.dashboard) : msg);
          continue;
        }
      }
      // type errors on special fields (latitude: null → type error) — map to required message
      if (error.keyword === "type" && chartMsgs?.[`${field}:required`]) {
        const msg = chartMsgs[`${field}:required`];
        messages.push(typeof msg === "object" ? (msg[pageKey] || msg.dashboard) : msg);
        continue;
      }

      // Panel structure fallback
      const prefix = `Panel ${panelInfo.id}: `;
      if (error.keyword === "enum" && path.endsWith("/type")) { messages.push(`${prefix}Chart type "${error.data}" is not supported.`); continue; }
      if (error.keyword === "type" && path.includes("/layout/")) { messages.push(`${prefix}Layout ${path.split("/").pop()} must be a number`); continue; }
      if (error.keyword === "minLength" && path.endsWith("/title")) { messages.push(`${prefix}Panel title is required`); continue; }
      if (error.keyword === "required") { messages.push(`${prefix}${error.params?.missingProperty || ""} is required`); continue; }
      if (error.keyword === "minLength") { messages.push(`${prefix}${path.split("/").pop()} cannot be empty`); continue; }
    }

    // Dashboard-level
    if (error.keyword === "required" && path === "") {
      const p = error.params?.missingProperty;
      const dm = (errorMessages.dashboardErrors as any)?.[`${p}:required`];
      if (dm) { messages.push(dm); continue; }
    }
    if (error.keyword === "minItems" && path.endsWith("/tabs")) {
      messages.push((errorMessages.dashboardErrors as any)?.["tabs:minItems"] || "Dashboard must have at least one tab");
      continue;
    }
    if (error.keyword === "const" && path.endsWith("/version")) {
      messages.push((errorMessages.dashboardErrors as any)?.["version:const"] || "Dashboard version must be 8.");
      continue;
    }

    // Tab errors
    if (error.keyword === "required" && path.match(/\/tabs\/\d+$/)) {
      const p = error.params?.missingProperty;
      const tm = (errorMessages.tabErrors as any)?.[`${p}:required`];
      if (tm) { messages.push(tm); continue; }
    }

    messages.push(error.message || "Validation error");
  }

  return [...new Set(messages)];
}

function extractPanelInfo(path: string, dashboard: any): { title: string; id: string; chartType: string } | null {
  const match = path.match(/\/tabs\/(\d+)\/panels\/(\d+)/);
  if (!match) return null;
  const panel = dashboard?.tabs?.[parseInt(match[1])]?.panels?.[parseInt(match[2])];
  if (!panel) return null;
  return { title: panel.title || panel.id || "unknown", id: panel.id || "unknown", chartType: panel.type || "" };
}
