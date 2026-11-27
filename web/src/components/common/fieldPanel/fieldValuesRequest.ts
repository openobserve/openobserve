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

import type { FieldValuesRequest } from "@/composables/useFieldValuesStream";
import { b64EncodeUnicode } from "@/utils/zincutils";

const VALUES_TIMEOUT_MS = 30000;

export interface SingleStreamValuesQuery {
  field: string;
  stream: string;
  streamType: string;
  startTime: number;
  endTime: number;
  size: number;
  from?: number;
  /** WHERE body without the keyword; empty asks for the whole stream. */
  where: string;
  /** FROM body when the WHERE names the stream by an alias; the quoted stream otherwise. */
  fromClause?: string;
  keyword?: string;
}

/** One `_values_stream` request for a field of a single stream scoped by a plain WHERE. */
export const buildFieldValuesRequest = (query: SingleStreamValuesQuery): FieldValuesRequest => ({
  fields: [query.field],
  size: query.size,
  ...(query.from === undefined ? {} : { from: query.from }),
  no_count: false,
  start_time: query.startTime,
  end_time: query.endTime,
  stream_name: query.stream,
  stream_type: query.streamType,
  sql:
    b64EncodeUnicode(
      `SELECT * FROM ${query.fromClause || `"${query.stream}"`}${query.where ? ` WHERE ${query.where}` : ""}`,
    ) || "",
  keyword: query.keyword || undefined,
  timeout: VALUES_TIMEOUT_MS,
  use_cache: (globalThis as { use_cache?: boolean }).use_cache ?? true,
});
