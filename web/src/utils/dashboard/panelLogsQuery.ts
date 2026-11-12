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

import useParser from "@/composables/useParser";
import {
  maxParenDepth,
  SQL_PARSE_MAX_DEPTH,
  stripWherePredicate,
} from "@/utils/query/sqlComplexity";

interface FromEntry {
  table?: unknown;
  as?: string | null;
}

interface SelectAst {
  type?: string;
  with?: unknown;
  _next?: unknown;
  set_op?: unknown;
  having?: unknown;
  where?: unknown;
  from?: FromEntry[] | null;
}

interface SqlParser {
  astify: (sql: string) => SelectAst | SelectAst[];
}

let parserPromise: Promise<SqlParser> | null = null;

const loadParser = (): Promise<SqlParser> => {
  if (!parserPromise) {
    parserPromise = useParser().sqlParser();
    parserPromise.catch(() => {
      parserPromise = null;
    });
  }
  return parserPromise;
};

const parseSingleSelect = async (sql: string): Promise<SelectAst | null> => {
  // astify() is exponential in WHERE nesting; the WHERE text itself comes from the backend.
  const parseTarget = stripWherePredicate(sql);
  if (maxParenDepth(parseTarget) > SQL_PARSE_MAX_DEPTH) return null;
  try {
    const parsed = (await loadParser()).astify(parseTarget);
    const statements = Array.isArray(parsed) ? parsed : [parsed];
    return statements.length === 1 ? statements[0] : null;
  } catch {
    return null;
  }
};

/** The panel SQL as `SELECT *` over its stream, or null when that would drop or misread a filter. */
export const buildPanelLogsQuery = async (
  sql: string,
  stream: string,
  baseWhere: string,
): Promise<string | null> => {
  if (!sql || !stream) return null;
  const ast = await parseSingleSelect(sql);
  if (ast?.type !== "select" || ast.with || ast._next || ast.set_op || ast.having) return null;

  // One plain table only: a JOIN's filters can't all move onto one stream.
  const from = Array.isArray(ast.from) ? ast.from : [];
  if (from.length !== 1 || from[0].table !== stream) return null;
  // The WHERE would keep the alias prefix, which neither this query nor the Logs histogram has.
  if (from[0].as) return null;

  const whereText = baseWhere.trim();
  if (ast.where && !whereText) return null;

  const table = `"${stream.replace(/"/g, '""')}"`;
  const filter = whereText ? ` WHERE ${whereText}` : "";
  return `SELECT * FROM ${table}${filter} ORDER BY _timestamp DESC`;
};
