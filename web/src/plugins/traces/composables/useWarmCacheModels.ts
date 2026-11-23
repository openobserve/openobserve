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

import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { useLLMStreamQuery } from "./useLLMStreamQuery";

const CACHE_COLUMNS = [
  "gen_ai_usage_cache_read_input_tokens",
  "gen_ai_usage_cache_creation_input_tokens",
];
const LOOKBACK_US = 24 * 60 * 60 * 1_000_000;

/**
 * Models that used the prompt cache earlier in the trace's session, within the last day.
 * Lets a single-trace view call a miss what the session view calls a miss.
 */
export function useWarmCacheModels(streamName: Ref<string>, spans: Ref<any[]>) {
  const warmModels = ref<string[]>([]);
  const { executeQuery, cancelAll } = useLLMStreamQuery();

  // Recomputed per span list, so a stale answer for another trace is dropped.
  let requestKey = "";

  watch(
    [streamName, spans],
    async () => {
      const list = spans.value || [];
      const sessionId = String(
        list.find((s) => s?.gen_ai_conversation_id)?.gen_ai_conversation_id || "",
      );
      const traceId = String(list[0]?.trace_id || "");
      // Selecting a column the stream lacks fails, so only ones a span carries are used.
      const columns = CACHE_COLUMNS.filter((c) => list.some((s) => s?.[c] != null));
      const startNs = list.reduce(
        (min, s) => Math.min(min, Number(s?.start_time) || Infinity),
        Infinity,
      );
      const key = `${streamName.value}|${sessionId}|${startNs}|${columns.join()}`;
      if (key === requestKey) return;
      requestKey = key;
      warmModels.value = [];
      if (!streamName.value || !sessionId || !traceId || !columns.length || !isFinite(startNs)) {
        return;
      }

      const startUs = Math.floor(startNs / 1000);
      // Nanosecond start times lose precision as JS numbers, so this trace is excluded by id.
      const sql = `SELECT gen_ai_response_model, gen_ai_request_model FROM "${streamName.value}" WHERE gen_ai_conversation_id = ${sqlLiteral(sessionId)} AND trace_id <> ${sqlLiteral(traceId)} AND (${columns.map((c) => `${c} > 0`).join(" OR ")}) GROUP BY gen_ai_response_model, gen_ai_request_model LIMIT 50`;
      try {
        const rows = await executeQuery(sql, startUs - LOOKBACK_US, startUs);
        if (key !== requestKey) return;
        warmModels.value = rows
          .map((r) => String(r.gen_ai_response_model || r.gen_ai_request_model || ""))
          .filter(Boolean);
      } catch (e: any) {
        console.error("Session cache history fetch error:", e?.raw ?? e);
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(cancelAll);

  return warmModels;
}
