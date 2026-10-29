// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { escapeSingleQuotes } from "@/utils/queryUtils";

export type LikePosition = "start" | "end" | "contains";

// The backend parses these filter strings with sqlparser-rs's PostgreSqlDialect,
// which does not support backslash string-literal escapes — doubling an embedded
// single quote is the only escaping a '...' literal needs or accepts.
export const sqlLiteral = (value: unknown): string =>
  `'${escapeSingleQuotes(String(value ?? ""))}'`;

export const sqlEquals = (fieldName: string, value: unknown, negate = false): string =>
  `${fieldName}${negate ? "!=" : "="}${sqlLiteral(value)}`;

// "field IN ()" is invalid SQL — an empty list can never match, so it
// degrades to a constant-false predicate instead.
export const sqlIn = (fieldName: string, values: unknown[]): string =>
  values.length ? `${fieldName} IN (${values.map(sqlLiteral).join(",")})` : "1=0";

/** Backslash-escapes the backslash and LIKE wildcards as the backend does (DataFusion's default escape, no ESCAPE clause). */
export const escapeLikeWildcards = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const likePattern = (value: unknown, position: LikePosition, escapeWildcards: boolean): string => {
  const text = String(value ?? "");
  const escaped = escapeSingleQuotes(escapeWildcards ? escapeLikeWildcards(text) : text);
  switch (position) {
    case "start":
      return `${escaped}%`;
    case "end":
      return `%${escaped}`;
    default:
      return `%${escaped}%`;
  }
};

export const sqlLike = (
  fieldName: string,
  value: unknown,
  position: LikePosition = "contains",
  negate = false,
  escapeWildcards = false,
): string =>
  `${fieldName} ${negate ? "NOT LIKE" : "LIKE"} '${likePattern(value, position, escapeWildcards)}'`;

export const sqlIsNull = (fieldName: string, negate = false): string =>
  `${fieldName} ${negate ? "IS NOT" : "IS"} NULL`;
