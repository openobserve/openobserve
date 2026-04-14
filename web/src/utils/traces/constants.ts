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

/**
 * Maps OTEL numeric span kind IDs to human-readable display names.
 * Reference: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
export const SPAN_KIND_MAP: Record<string, string> = {
  "0": "Unspecified",
  "1": "Internal",
  "2": "Server",
  "3": "Client",
  "4": "Producer",
  "5": "Consumer",
};

/**
 * Reverse of SPAN_KIND_MAP — maps lowercase display labels back to numeric keys.
 * Keys are stored lowercased so lookups can be done case-insensitively.
 */
export const SPAN_KIND_LABEL_TO_KEY: Record<string, string> =
  Object.fromEntries(
    Object.entries(SPAN_KIND_MAP).map(([key, label]) => [
      label.toLowerCase(),
      key,
    ]),
  );

/**
 * Replaces human-readable span_kind labels (e.g. `'Server'`, `'Client'`) in a
 * WHERE clause with their numeric OTEL key equivalents (e.g. `'2'`, `'3'`).
 *
 * This mirrors the duration-suffix replacement done by `parseDurationWhereClause`
 * and must be called before sending a filter to the backend.
 *
 * Examples:
 *   `span_kind='Server'`              →  `span_kind='2'`
 *   `span_kind!='client'`             →  `span_kind!='3'`
 *   `(span_kind='SERVER' or span_kind='internal')`  →  `(span_kind='2' or span_kind='1')`
 */
export const parseSpanKindWhereClause = (
  whereClause: string,
  parser?: any,
  streamName: string = "x",
): string => {
  if (!whereClause.trim()) return whereClause;

  if (parser) {
    try {
      const fullSql = `SELECT * FROM "${streamName}" WHERE ${whereClause}`;
      const ast = parser.astify(fullSql);

      const replaceSpanKindStringNode = (strNode: any) => {
        if (
          strNode?.type === "single_quote_string" ||
          strNode?.type === "string"
        ) {
          const label = String(strNode.value).trim().toLowerCase();
          const key = SPAN_KIND_LABEL_TO_KEY[label];
          if (key !== undefined) {
            strNode.value = key;
          }
        }
      };

      const processNode = (node: any) => {
        if (!node || node.type !== "binary_expr") return;

        const isSpanKind =
          node.left?.column === "span_kind" ||
          node.left?.column?.expr?.value === "span_kind";

        if (isSpanKind) {
          if (
            node.right?.type === "single_quote_string" ||
            node.right?.type === "string"
          ) {
            replaceSpanKindStringNode(node.right);
          } else if (
            node.right?.type === "expr_list" &&
            Array.isArray(node.right.value)
          ) {
            node.right.value.forEach(replaceSpanKindStringNode);
          }
        }

        processNode(node.left);
        processNode(node.right);
      };

      processNode(ast.where);

      const resultSql: string = parser.sqlify(ast);
      const whereMatch = resultSql.match(/\bWHERE\b\s+([\s\S]+)$/i);
      return whereMatch ? whereMatch[1].trim() : whereClause;
    } catch {
      // fall through to regex fallback
    }
  }

  // Regex fallback when no parser is available or parsing failed.
  return whereClause
    .replace(
      /\bspan_kind\s*(!?=)\s*'([^']*)'/gi,
      (match, op: string, label: string) => {
        const key = SPAN_KIND_LABEL_TO_KEY[label.toLowerCase()];
        return key !== undefined ? `span_kind${op}'${key}'` : match;
      },
    )
    .replace(
      /\bspan_kind\s+IN\s*\(([^)]*)\)/gi,
      (_match, items: string) => {
        const converted = items.replace(/'([^']*)'/g, (_m, lbl: string) => {
          const k = SPAN_KIND_LABEL_TO_KEY[lbl.toLowerCase()];
          return k !== undefined ? `'${k}'` : `'${lbl}'`;
        });
        return `span_kind IN (${converted})`;
      },
    );
};

/** OTEL span kind ID for UNSPECIFIED (0) */
export const SPAN_KIND_UNSPECIFIED = "0";

/** OTEL span kind ID for CLIENT (3) */
export const SPAN_KIND_CLIENT = "3";
