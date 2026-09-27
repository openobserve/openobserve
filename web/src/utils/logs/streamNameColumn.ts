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

// A multi-stream logs search projects `'<stream>' as _stream_name` in every
// per-stream query, so each merged hit says which stream it came from.
export const STREAM_NAME_FIELD = "_stream_name";

const STREAM_NAME_PATTERN = new RegExp(`\\b${STREAM_NAME_FIELD}\\b`);

export const referencesStreamName = (where: string): boolean => STREAM_NAME_PATTERN.test(where);

const columnName = (node: any): string | null => {
  const col = node.column;
  if (typeof col === "string") return col.replace(/^"|"$/g, "");
  return col?.expr?.value != null ? String(col.expr.value) : null;
};

// `_stream_name` is a SELECT alias, so a per-stream WHERE cannot reference it.
// Each per-stream query knows its own stream, so the column becomes that
// stream's name as a literal: `_stream_name = 'a'` turns into `'b' = 'a'` in
// stream b's query and matches nothing there.
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

export const shouldShowStreamNameColumn = (
  selectedStreams: string[],
  hits: any[] | undefined,
  selectedFields: string[],
): boolean =>
  selectedStreams.length > 1 &&
  !selectedFields.includes(STREAM_NAME_FIELD) &&
  !!hits?.some((hit: any) => hit?.[STREAM_NAME_FIELD] != null);

export const formatStreamName = (stream: string): string => stream;

// Closable, so the cell offers include/exclude; those filter on the raw value.
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
