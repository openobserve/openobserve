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

import { raw } from "@/types/i18n";

// Multi-stream search projects `'<stream>' as _stream_name`, tagging each hit with its stream.
export const STREAM_NAME_FIELD = "_stream_name";

const STREAM_NAME_PATTERN = new RegExp(`\\b${STREAM_NAME_FIELD}\\b`);

export const referencesStreamName = (where: string): boolean => STREAM_NAME_PATTERN.test(where);

const columnName = (node: any): string | null => {
  const col = node.column;
  if (typeof col === "string") return col.replace(/^"|"$/g, "");
  return col?.expr?.value != null ? String(col.expr.value) : null;
};

// A per-stream WHERE cannot use the alias, so stream b's `_stream_name = 'a'` becomes `'b' = 'a'`.
export const replaceStreamNameRefsInWhere = (node: any, stream: string): any => {
  if (Array.isArray(node)) {
    return node.map((child) => replaceStreamNameRefsInWhere(child, stream));
  }
  if (!node || typeof node !== "object") return node;

  if (node.type === "column_ref" && columnName(node) === STREAM_NAME_FIELD) {
    return { type: "single_quote_string", value: stream };
  }

  // `value` holds the list of an IN (...) or of function arguments such as NOT (...).
  for (const key of ["left", "right", "expr", "args", "value"]) {
    if (node[key] && typeof node[key] === "object") {
      node[key] = replaceStreamNameRefsInWhere(node[key], stream);
    }
  }
  return node;
};

// Include/exclude gate: schema fields, plus `_stream_name`, which is in no schema.
export const isFilterableLogField = (
  name: string | number | undefined,
  streamFields: Array<{ name: string; isSchemaField?: boolean }> | undefined,
): boolean =>
  name === STREAM_NAME_FIELD ||
  (streamFields?.find((field) => field.name === name)?.isSchemaField ?? false);

export const shouldShowStreamNameColumn = (
  selectedStreams: string[],
  hits: any[] | undefined,
  selectedFields: string[],
): boolean =>
  selectedStreams.length > 1 &&
  !selectedFields.includes(STREAM_NAME_FIELD) &&
  !!hits?.some((hit: any) => hit?.[STREAM_NAME_FIELD] != null);

export const formatStreamName = (stream: string): string => stream;

// Closable, so the cell gets its actions; include/exclude filter on the raw value.
export const buildStreamNameColumn = () => ({
  name: STREAM_NAME_FIELD,
  id: STREAM_NAME_FIELD,
  accessorFn: (row: any) =>
    row?.[STREAM_NAME_FIELD] == null ? "" : formatStreamName(String(row[STREAM_NAME_FIELD])),
  header: raw(STREAM_NAME_FIELD),
  sortable: false,
  enableResizing: true,
  meta: {
    closable: true,
    showWrap: false,
    wrapContent: false,
  },
  size: 180,
});
