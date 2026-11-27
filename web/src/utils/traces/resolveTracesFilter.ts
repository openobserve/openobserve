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

import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { stripSqlComments } from "@/utils/query/sqlComments";
import { parseSpanKindWhereClause } from "@/utils/traces/constants";

/** Turns Traces editor text into a runnable WHERE fragment: durations in µs, span kinds as numeric keys. */
export const resolveTracesFilter = (
  text: string | undefined,
  parser: unknown,
  streamName: string,
): string => {
  // Callers append the scope, ORDER BY or GROUP BY on the same line, which a trailing -- comment would swallow.
  const trimmed = stripSqlComments(text ?? "").trim();
  const durationResolved = parseDurationWhereClause(trimmed, parser, streamName);
  return parseSpanKindWhereClause(
    typeof durationResolved === "string" ? durationResolved : trimmed,
    parser,
    streamName,
  );
};
