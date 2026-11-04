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

export interface PanelWhere {
  baseWhere: string;
  whereByStream: Record<string, string>;
}

let parserPromise: Promise<any> | null = null;

const loadParser = (): Promise<any> => {
  if (!parserPromise) {
    parserPromise = useParser().sqlParser();
    parserPromise.catch(() => {
      parserPromise = null;
    });
  }
  return parserPromise;
};

const parseSingleSelect = async (sql: string): Promise<any | null> => {
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
  where: PanelWhere,
): Promise<string | null> => {
  if (!sql || !stream) return null;
  const ast = await parseSingleSelect(sql);
  if (ast?.type !== "select" || ast.with || ast._next || ast.set_op || ast.having) return null;

  const from: any[] = Array.isArray(ast.from) ? ast.from : [];
  // A FROM entry without a plain table name is a subquery or table function.
  if (!from.length || from.some((f) => typeof f?.table !== "string")) return null;
  if (!from.some((f) => f.table === stream)) return null;

  const isJoin = from.length > 1;
  const whereText = (isJoin ? where.whereByStream[stream] : where.baseWhere)?.trim() ?? "";
  // For a JOIN an empty per-stream map means the backend could not split the WHERE.
  const whereRead = isJoin ? Object.keys(where.whereByStream).length > 0 : whereText !== "";
  if (ast.where && !whereRead) return null;

  const table = `"${stream.replace(/"/g, '""')}"`;
  const filter = whereText ? ` WHERE ${whereText}` : "";
  return `SELECT * FROM ${table}${filter} ORDER BY _timestamp DESC`;
};
