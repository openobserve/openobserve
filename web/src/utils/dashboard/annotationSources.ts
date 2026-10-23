// Copyright 2026 OpenObserve Inc.
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

import type {
  AnnotationConditionGroup,
  AnnotationConditionLeaf,
  AnnotationSource,
  QueryAnnotationMarker,
} from "@/ts/interfaces/dashboard";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  normalizeVariableSyntax,
  replaceVariablePlaceholders,
} from "@/utils/dashboard/variables/variablesUtils";
import { buildConditionsString, isUnaryOperator } from "@/utils/alerts/conditionsFormatter";
import { SINGLE_CLOSED_TOKEN_RE } from "@/lib/forms/TemplateInput/useTemplateSuggest";
import { TEXT_SWATCHES } from "@/composables/dashboard/useColumnFormatting";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";

export { MAX_ANNOTATION_SOURCES, validateAnnotationSources } from "./validateAnnotationSources";

/** Panel types that draw annotation markers; every other type ignores them. */
export const ANNOTATION_PANEL_TYPES = [
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "line",
  "scatter",
  "stacked",
  "h-stacked",
];

/** Rows fetched per source per dashboard load. */
export const ANNOTATION_SOURCE_ROW_LIMIT = 500;

/** Rows fetched by the form's Run preview. */
export const ANNOTATION_PREVIEW_ROW_LIMIT = 10;

/** A new source defaults onto a curated swatch, not "custom"; reuses ColorSwatchPicker's palette. */
export const annotationSourceColors = (): string[] => TEXT_SWATCHES;

const TIMESTAMP_COLUMN = "_timestamp";

// `{field}` but not `${var}` or the `{{var}}` variable syntax — the same rule TemplateInput's own suggest list reads by.
const FIELD_PLACEHOLDER_RE = SINGLE_CLOSED_TOKEN_RE;

export interface RenderedTemplate {
  text: string;
  missing: string[];
}

export type AnnotationRow = Record<string, unknown>;

export interface AnnotationVariable {
  name: string;
  value: unknown;
}

export const defaultAnnotationSourceColor = (index: number): string =>
  annotationSourceColors()[index % annotationSourceColors().length];

export const resolveAnnotationSourceColor = (source: Pick<AnnotationSource, "color">): string =>
  source.color || annotationSourceColors()[0];

/** Field names referenced as `{field}` in a template, in order of first use. */
export const extractTemplateFields = (template: string | null | undefined): string[] => {
  if (!template) return [];
  const fields: string[] = [];
  for (const found of template.matchAll(FIELD_PLACEHOLDER_RE)) {
    if (!fields.includes(found[1])) fields.push(found[1]);
  }
  return fields;
};

const variableDisplayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === SELECT_ALL_VALUE) return "";
  if (Array.isArray(value)) return value.filter((it) => it !== SELECT_ALL_VALUE).join(", ");
  return String(value);
};

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Renders `{field}` placeholders from the row, then `$variables` with their current values. */
export const renderAnnotationTemplate = (
  template: string | null | undefined,
  row: AnnotationRow,
  variables: AnnotationVariable[] = [],
): RenderedTemplate => {
  if (!template) return { text: "", missing: [] };
  const byName = new Map<string, unknown>();
  variables.forEach((variable) => {
    if (variable?.name && !byName.has(variable.name)) byName.set(variable.name, variable.value);
  });
  const missing: string[] = [];
  // {field} is resolved against the template itself so a variable's value can't be mistaken for one.
  const withFields = normalizeVariableSyntax(template).replace(
    FIELD_PLACEHOLDER_RE,
    (_match, field: string) => {
      if (Object.prototype.hasOwnProperty.call(row, field)) return cellText(row[field]);
      if (!missing.includes(field)) missing.push(field);
      return "";
    },
  );
  const text = replaceVariablePlaceholders(withFields, byName.keys(), ({ name }) =>
    variableDisplayValue(byName.get(name)),
  );
  return { text: text.trim(), missing };
};

const sqlColumn = (name: string): string =>
  name === TIMESTAMP_COLUMN ? TIMESTAMP_COLUMN : quoteSqlIdentifierIfNeeded(name);

/** A leaf condition blank where it needs a value; such leaves are ignored and never saved. */
export const isBlankAnnotationCondition = (
  leaf: Pick<AnnotationConditionLeaf, "column" | "operator" | "value">,
): boolean =>
  !leaf?.column?.trim() || (!isUnaryOperator(leaf.operator) && !(leaf.value ?? "").trim());

type AnnotationConditionNode = AnnotationConditionGroup | AnnotationConditionLeaf;

/** Whether any leaf condition in the tree is blank (and so will be dropped before saving/running). */
export const annotationFiltersHaveBlankCondition = (
  node: AnnotationConditionNode | null | undefined,
): boolean => {
  if (!node) return false;
  if (node.filterType === "condition") return isBlankAnnotationCondition(node);
  return (node.conditions ?? []).some(annotationFiltersHaveBlankCondition);
};

/** Drops blank leaf conditions; a group left with none renders as no predicate. */
const stripBlankAnnotationConditions = (node: AnnotationConditionNode): AnnotationConditionNode => {
  if (node.filterType === "condition") return node;
  return {
    ...node,
    conditions: (node.conditions ?? [])
      .filter((item) => item.filterType !== "condition" || !isBlankAnnotationCondition(item))
      .map(stripBlankAnnotationConditions),
  };
};

/** The saved tree, with blank leaf conditions dropped so they can never be persisted. */
export const pruneBlankAnnotationConditions = (
  filters: AnnotationConditionGroup,
): AnnotationConditionGroup => stripBlankAnnotationConditions(filters) as AnnotationConditionGroup;

/** A `$variable` column/value resolves to its current string value; anything else passes through. */
const resolveAnnotationVariable = (value: string, variables: AnnotationVariable[]): string => {
  if (!value.startsWith("$")) return value;
  const match = variables.find((variable) => variable.name === value.slice(1));
  const resolved = Array.isArray(match?.value) ? match.value[0] : match?.value;
  return typeof resolved === "string" ? resolved : value;
};

// Resolving before quoting (not after substitution) so a malicious variable VALUE gets escaped, not just its `$name` token.
const resolveAnnotationFilterColumns = (
  node: AnnotationConditionNode,
  variables: AnnotationVariable[],
): AnnotationConditionNode => {
  if (node.filterType === "condition") {
    return node.column.startsWith("$")
      ? { ...node, column: resolveAnnotationVariable(node.column, variables) }
      : node;
  }
  return {
    ...node,
    conditions: (node.conditions ?? []).map((child) =>
      resolveAnnotationFilterColumns(child, variables),
    ),
  };
};

/** The filter tree's WHERE predicate, honouring AND/OR and nested groups (same builder as alerts). */
export const buildAnnotationFiltersSql = (
  filters: AnnotationConditionGroup | null | undefined,
  variables: AnnotationVariable[] = [],
): string => {
  if (!filters || filters.filterType !== "group") return "";
  const resolved = resolveAnnotationFilterColumns(
    stripBlankAnnotationConditions(filters),
    variables,
  ) as AnnotationConditionGroup;
  return buildConditionsString(resolved, {
    sqlMode: true,
    formatValues: true,
    // Must be an empty map, not absent: an absent map pre-quotes values, double-quoting sqlLike's own wrap.
    streamFieldsMap: {},
    quoteColumn: quoteSqlIdentifierIfNeeded,
  });
};

/** Columns the builder selects: `_timestamp`, then each template and end-time field the schema has. */
export const annotationSourceColumns = (
  source: Pick<AnnotationSource, "title" | "description" | "endTimeField">,
  schemaFields: string[] | null = [],
): string[] => {
  const columns = [TIMESTAMP_COLUMN];
  [
    ...extractTemplateFields(source.title),
    ...extractTemplateFields(source.description),
    source.endTimeField?.trim() ?? "",
  ].forEach((field) => {
    // A field the schema lacks renders empty instead of failing the query; `null` excludes every field.
    const known =
      schemaFields === null ? false : !schemaFields.length || schemaFields.includes(field);
    if (field && known && !columns.includes(field)) columns.push(field);
  });
  return columns;
};

export const buildAnnotationBuilderSql = (
  source: Pick<AnnotationSource, "stream" | "filters" | "title" | "description" | "endTimeField">,
  schemaFields: string[] | null = [],
  variables: AnnotationVariable[] = [],
): string => {
  const columns = annotationSourceColumns(source, schemaFields).map(sqlColumn).join(", ");
  const where = buildAnnotationFiltersSql(source.filters, variables);
  const lines = [`SELECT ${columns}`, `FROM ${quoteSqlIdentifierIfNeeded(source.stream ?? "")}`];
  if (where) lines.push(`WHERE ${where}`);
  // Without an explicit order, which 500 rows the engine keeps at the cap is implementation-defined.
  lines.push(`ORDER BY ${TIMESTAMP_COLUMN} DESC`);
  return lines.join("\n");
};

/** The SQL a source runs; `schemaFields` (the builder stream's schema) trims unknown columns. */
export const getAnnotationSourceSql = (
  source: AnnotationSource,
  schemaFields: string[] | null = [],
  variables: AnnotationVariable[] = [],
): string =>
  source.mode === "sql"
    ? (source.query ?? "").trim()
    : buildAnnotationBuilderSql(source, schemaFields, variables);

/** Whether a source draws on a panel: enabled, a time-series type, and listed; no list means every panel, an empty one none. */
export const annotationSourceTargetsPanel = (
  source: Pick<AnnotationSource, "enabled" | "panels">,
  panelId: string,
  panelType: string,
): boolean => {
  if (source.enabled === false) return false;
  if (!ANNOTATION_PANEL_TYPES.includes(panelType)) return false;
  if (source.panels === undefined || source.panels === null) return true;
  return source.panels.includes(panelId);
};

/** The stream a custom query reads, from its first FROM clause. */
export const sqlFromStream = (sql: string | null | undefined): string => {
  const found = /\bfrom\s+(?:"((?:[^"]|"")+)"|'([^']+)'|`([^`]+)`|([\w.$-]+))/i.exec(sql ?? "");
  if (!found) return "";
  return (found[1]?.replace(/""/g, '"') ?? found[2] ?? found[3] ?? found[4] ?? "").trim();
};

/** Column aliases (`AS name`) a custom query introduces. */
export const sqlSelectAliases = (sql: string | null | undefined): string[] => {
  const aliases: string[] = [];
  for (const found of (sql ?? "").matchAll(/\bas\s+(?:"([^"]+)"|([A-Za-z_]\w*))/gi)) {
    const alias = found[1] ?? found[2];
    if (alias && !aliases.includes(alias)) aliases.push(alias);
  }
  return aliases;
};

/** Normalises a row time (micro/milli/seconds epoch or an ISO string) to microseconds. */
export const toMicroseconds = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    const magnitude = Math.abs(numeric);
    if (magnitude >= 1e14) return Math.round(numeric);
    if (magnitude >= 1e11) return Math.round(numeric * 1000);
    return Math.round(numeric * 1e6);
  }
  if (typeof value !== "string") return null;
  // A zone-less ISO string parses as local time otherwise; same fix as convertSQLMetricChart's bucketMicros.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed * 1000;
};

export const annotationRowsToMarkers = (
  source: AnnotationSource,
  rows: AnnotationRow[],
  variables: AnnotationVariable[] = [],
): QueryAnnotationMarker[] => {
  const color = resolveAnnotationSourceColor(source);
  const endField = source.endTimeField?.trim();
  return rows.flatMap((row) => {
    const start = toMicroseconds(row[TIMESTAMP_COLUMN]);
    if (start === null) return [];
    const end = endField ? toMicroseconds(row[endField]) : null;
    return [
      {
        start_time: start,
        end_time: end !== null && end > start ? end : null,
        title: renderAnnotationTemplate(source.title, row, variables).text,
        text: renderAnnotationTemplate(source.description, row, variables).text,
        source: { id: source.id, name: source.name, color },
      },
    ];
  });
};

export interface AnnotationPreviewRow {
  time: number;
  end: number | null;
  title: string;
  description: string;
}

export interface AnnotationPreviewSummary {
  rows: AnnotationPreviewRow[];
  /** `{field}` placeholders the source cannot fill. */
  missingFields: string[];
  /** The end-time field is set but the source cannot fill it. */
  endFieldMissing: boolean;
  /** The query cannot give markers a time: it never names `_timestamp`, or its rows lack one. */
  timestampMissing: boolean;
  /** The query returned exactly `ANNOTATION_PREVIEW_ROW_LIMIT` rows, so more may exist beyond it. */
  truncated: boolean;
}

/** What Run and the Save check show; without `knownFields` (the schema) a field is missing only if rows came back without it. */
export const summarizeAnnotationPreview = (
  source: AnnotationSource,
  rows: AnnotationRow[],
  variables: AnnotationVariable[] = [],
  knownFields: string[] = [],
  resultColumns: string[] | null = null,
): AnnotationPreviewSummary => {
  const markers = annotationRowsToMarkers(source, rows, variables);
  const inRows = (field: string) =>
    rows.some((row) => Object.prototype.hasOwnProperty.call(row, field));
  const isMissing = (field: string) =>
    knownFields.length
      ? !knownFields.includes(field) && !inRows(field)
      : rows.length > 0 && !inRows(field);
  const fields = [
    ...extractTemplateFields(source.title),
    ...extractTemplateFields(source.description),
  ].filter((field, index, all) => all.indexOf(field) === index);
  const endField = source.endTimeField?.trim();
  // The actual result decides this, never the SQL text; with no rows, fall back to the response's own columns, when the server sent any.
  const timestampMissing =
    rows.length > 0
      ? markers.length === 0
      : resultColumns !== null && !resultColumns.includes(TIMESTAMP_COLUMN);
  return {
    rows: markers.map((marker) => ({
      time: marker.start_time,
      end: marker.end_time,
      title: marker.title,
      description: marker.text,
    })),
    missingFields: fields.filter(isMissing),
    endFieldMissing: !!endField && isMissing(endField),
    timestampMissing,
    truncated: rows.length === ANNOTATION_PREVIEW_ROW_LIMIT,
  };
};

/** Whether a preview found something the user should see before saving; no rows in range is not one. */
export const annotationPreviewHasProblems = (summary: AnnotationPreviewSummary): boolean =>
  summary.timestampMissing || summary.endFieldMissing || summary.missingFields.length > 0;
