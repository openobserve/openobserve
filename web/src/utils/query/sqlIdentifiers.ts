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

import store from "@/stores";

const SIMPLE_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
let cachedKeywordSource: unknown = null;
let cachedKeywordSet = new Set<string>();

const getIdentifierKeywordSet = () => {
  const keywords = store?.state?.zoConfig?.sql_reserved_keywords;
  if (keywords === cachedKeywordSource) {
    return cachedKeywordSet;
  }

  cachedKeywordSource = keywords;
  cachedKeywordSet = new Set(
    (Array.isArray(keywords) ? keywords : [])
      .filter((keyword) => typeof keyword === "string" && keyword.trim() !== "")
      .map((keyword) => keyword.toUpperCase()),
  );

  return cachedKeywordSet;
};

export const stripSqlIdentifierQuotes = (identifier: string) => {
  if (typeof identifier !== "string") {
    return "";
  }

  const trimmedIdentifier = identifier.trim();
  if (
    trimmedIdentifier.startsWith('"') &&
    trimmedIdentifier.endsWith('"') &&
    trimmedIdentifier.length >= 2
  ) {
    return trimmedIdentifier.slice(1, -1).replace(/""/g, '"');
  }

  return trimmedIdentifier;
};

export const needsSqlIdentifierQuoting = (identifier: string) => {
  const rawIdentifier = stripSqlIdentifierQuotes(identifier);

  if (!rawIdentifier || rawIdentifier === "*") {
    return false;
  }

  if (!SIMPLE_IDENTIFIER_REGEX.test(rawIdentifier)) {
    return true;
  }

  return getIdentifierKeywordSet().has(rawIdentifier.toUpperCase());
};

export const quoteSqlIdentifierIfNeeded = (identifier: string) => {
  const rawIdentifier = stripSqlIdentifierQuotes(identifier);

  if (!needsSqlIdentifierQuoting(rawIdentifier)) {
    return rawIdentifier;
  }

  return `"${rawIdentifier.replace(/"/g, '""')}"`;
};

export const buildColumnIdentifierAst = (identifier: string) => {
  const rawIdentifier = stripSqlIdentifierQuotes(identifier);

  if (rawIdentifier === "*") return "*";

  const type = needsSqlIdentifierQuoting(rawIdentifier)
    ? "double_quote_string"
    : "default";

  return { expr: { type, value: rawIdentifier } };
};
