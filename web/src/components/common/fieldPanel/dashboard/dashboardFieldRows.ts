// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";
import type { PanelField } from "../fieldPanel.types";
import type { DashboardSchemaField, DashboardStreamGroup } from "./dashboardPanelState";

export const QUERY_FIELDS_GROUP = "query-fields";

export const FUNCTION_FIELDS_GROUP = "function-fields";

/** A panel row; `stream` and `streamAlias` are what the axis, filter and drop writers read. */
export interface DashboardFieldRow extends PanelField {
  _uid: string;
  stream?: string;
  streamAlias?: string;
}

export interface DashboardRowsInput {
  queryFields: DashboardSchemaField[];
  functionFields: DashboardSchemaField[];
  streamGroups: DashboardStreamGroup[];
  timestampColumn: string;
  allFieldsName: string;
  userDefinedSchemasEnabled: boolean;
  labels: { queryFields: I18nText; functionFields: I18nText };
}

const headerRow = (group: string, label: string): DashboardFieldRow => ({
  _uid: `g:${group}`,
  name: group,
  isGroup: true,
  groupName: label,
  group,
  dataType: "",
  ftsKey: false,
  isSchemaField: false,
  showValues: false,
});

// Query and function fields come from the SQL or VRL output, not the stream schema, so they have no values to list.
const derivedRows = (group: string, fields: DashboardSchemaField[]): DashboardFieldRow[] =>
  fields.map((field) => ({
    _uid: `${group}:${field.name}`,
    name: field.name,
    type: field.type,
    dataType: field.type ?? "",
    ftsKey: false,
    isSchemaField: false,
    showValues: false,
    group,
  }));

const streamGroupKey = (group: DashboardStreamGroup) =>
  `stream:${group.stream_alias ?? ""}:${group.name}`;

// A stream with defined fields shows them between the timestamp and the all-fields column, but only with the UDS flag on.
const streamFieldsOf = (group: DashboardStreamGroup, input: DashboardRowsInput) => {
  const defined = group.settings?.defined_schema_fields ?? [];
  if (!defined.length || !input.userDefinedSchemasEnabled) return group.schema;
  return [
    { name: input.timestampColumn, type: "Int64" },
    ...group.schema.filter((field) => defined.includes(field.name)),
    { name: input.allFieldsName, type: "Utf8" },
  ];
};

const streamRows = (group: DashboardStreamGroup, input: DashboardRowsInput) => {
  const key = streamGroupKey(group);
  const ftsKeys = new Set(group.settings?.full_text_search_keys ?? []);
  return streamFieldsOf(group, input).map((field): DashboardFieldRow => {
    const type = field.type ?? "";
    return {
      ...field,
      _uid: `${key}:${field.name}`,
      name: field.name,
      type,
      dataType: type,
      ftsKey: ftsKeys.has(field.name),
      isSchemaField: true,
      showValues: field.name !== input.timestampColumn && field.name !== input.allFieldsName,
      stream: group.name,
      streamAlias: group.stream_alias,
      group: key,
    };
  });
};

/** Query fields, then function fields, then one group per stream of the query (main stream and joins). */
export const buildDashboardFieldRows = (input: DashboardRowsInput): DashboardFieldRow[] => {
  const rows: DashboardFieldRow[] = [];
  if (input.queryFields.length) {
    rows.push(headerRow(QUERY_FIELDS_GROUP, input.labels.queryFields));
    rows.push(...derivedRows(QUERY_FIELDS_GROUP, input.queryFields));
  }
  if (input.functionFields.length) {
    rows.push(headerRow(FUNCTION_FIELDS_GROUP, input.labels.functionFields));
    rows.push(...derivedRows(FUNCTION_FIELDS_GROUP, input.functionFields));
  }
  for (const group of input.streamGroups) {
    rows.push(headerRow(streamGroupKey(group), group.name));
    rows.push(...streamRows(group, input));
  }
  // `_uid` keys the rendered rows, so a name repeated inside one group is listed once.
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._uid)) return false;
    seen.add(row._uid);
    return true;
  });
};
