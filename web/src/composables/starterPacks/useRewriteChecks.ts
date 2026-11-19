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

import { useStore } from "vuex";

import search from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";

import type { RewriteChecks } from "./streamRewriter";

const CHECK_WINDOW_US = 15 * 60 * 1_000_000;
const VARIABLE = /\$\{?\w+(?::\w+)?\}?/g;
const QUOTED_OR_VARIABLE = /'(?:[^']|'')*'|"[^"]*"|\$\{?\w+(?::\w+)?\}?/g;

/** The server only plans a query, so a variable needs a value that is valid where it stands. */
export const withVariableStandIns = (sql: string) =>
  sql.replace(QUOTED_OR_VARIABLE, (token) =>
    token.startsWith("$") ? "'o2var'" : token.replace(VARIABLE, "o2var"),
  );

/** `result_schema` plans SQL without running it, and `parse_tree` parses PromQL on the server. */
export function useRewriteChecks(org: string): RewriteChecks {
  const store = useStore();
  return {
    sql: async (text, streamType) => {
      const sql = withVariableStandIns(text);
      const encoded = !!store.state.zoConfig?.sql_base64_enabled;
      const end = Date.now() * 1000;
      await search.result_schema({
        org_identifier: org,
        page_type: streamType,
        query: {
          query: {
            sql: encoded ? b64EncodeUnicode(sql) : sql,
            query_fn: null,
            start_time: end - CHECK_WINDOW_US,
            end_time: end,
            size: -1,
            streaming_output: false,
          },
          ...(encoded ? { encoding: "base64" } : {}),
        },
      });
    },
    promql: async (query) => (await search.promql_parse_tree(org, query)).data?.data ?? {},
  };
}
