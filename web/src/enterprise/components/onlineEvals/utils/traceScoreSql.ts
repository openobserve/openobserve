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

import { escapeSqlString } from "./scoreThreshold";
import { latestScoresFromSql } from "./latestScoreSql";

export type TraceScoreScope = "span" | "trace";

/** The same `_llm_scores` records Quality aggregates, narrowed to one span or trace. */
export function buildTargetScoresSql(scope: TraceScoreScope, targetId: string): string {
  const column = scope === "span" ? "span_id" : "trace_id";
  const where = `CAST(${column} AS VARCHAR) = '${escapeSqlString(targetId)}'`;
  return [
    "SELECT",
    "  scorer_id, score_config_id, value_numeric, value_categorical, value_boolean,",
    "  reasoning, _timestamp",
    `FROM ${latestScoresFromSql(where)}`,
    "ORDER BY _timestamp DESC",
    "LIMIT 20",
  ].join("\n");
}
