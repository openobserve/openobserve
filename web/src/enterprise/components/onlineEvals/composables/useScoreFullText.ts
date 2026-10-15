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

import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { QualityScore } from "@/services/online-evals.service";
import {
  sessionTurnsQuery,
  traceDetailsQuery,
  traceTimeRangeQuery,
} from "@/services/search.queries";
import { extractLLMData } from "@/utils/llmUtils";
import { traceQueryWindow } from "@/utils/rum/traceWindow";
import { contentSpan, targetTraceId, targetWindow } from "../utils/qualityFormat";

function asText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The full input and output a score was given, read back from its trace or session.
 * The trace time index says where and when the target ran, so the read uses its real range.
 * A trace or span the index cannot answer for is still read from an hour either side of
 * the target time. A session needs its real range, because a guessed window can miss turns.
 */
export function useScoreFullText(score: () => QualityScore | null, orgId: Ref<string>) {
  const lookup = computed(() => {
    const target = score();
    if (!target) return null;
    if (target.targetScope === "session") {
      return target.sessionId ? { kind: "session" as const, id: target.sessionId } : null;
    }
    const traceId = targetTraceId(target);
    return traceId ? { kind: "trace" as const, id: traceId } : null;
  });

  const rangeQuery = useQuery(() =>
    Object.assign(
      traceTimeRangeQuery(
        orgId.value,
        lookup.value?.kind ?? "trace",
        lookup.value?.id ?? "",
        score()?.refTimestamp ?? 0,
      ),
      { enabled: !!lookup.value },
    ),
  );

  // Null while the range loads, and when nothing can be read: a definite "not found", or no stream to read from.
  const source = computed(() => {
    const target = score();
    if (!target || !lookup.value || rangeQuery.isPending.value) return null;
    const result = rangeQuery.data.value?.result;
    if (result?.status === "found" && result.range) {
      const stream = result.stream ?? target.sourceStream;
      return stream ? { stream, ...traceQueryWindow(result.range, 0, 0) } : null;
    }
    const definite = result?.status === "not_found" && !rangeQuery.data.value?.partialCoverage;
    if (definite || lookup.value.kind === "session" || !target.sourceStream) return null;
    return { stream: target.sourceStream, ...targetWindow(target) };
  });

  const turnsQuery = useQuery(() => {
    const where = lookup.value?.kind === "session" ? source.value : null;
    return Object.assign(
      sessionTurnsQuery(
        orgId.value,
        where?.stream ?? "",
        lookup.value?.id ?? "",
        where?.startTime ?? 0,
        where?.endTime ?? 0,
      ),
      { enabled: !!where },
    );
  });

  // A session's question is its first turn and its answer its last, as the backend judge reads them.
  // ponytail: the judge skips turns without a chat span; reading every turn to match that costs one fetch per turn.
  const traceIds = computed<[string, string] | null>(() => {
    if (!source.value) return null;
    if (lookup.value?.kind === "trace") return [lookup.value.id, lookup.value.id];
    const turns = [...(turnsQuery.data.value ?? [])].sort((a, b) => a.start_time - b.start_time);
    if (!turns.length) return null;
    return [turns[0].trace_id, turns[turns.length - 1].trace_id];
  });

  const spansQuery = (index: 0 | 1) =>
    useQuery(() => {
      const where = source.value;
      const traceId = traceIds.value?.[index] ?? "";
      return Object.assign(
        traceDetailsQuery(
          orgId.value,
          where?.stream ?? "",
          traceId,
          where?.startTime ?? 0,
          where?.endTime ?? 0,
        ),
        { enabled: !!where && !!traceId },
      );
    });
  const firstSpans = spansQuery(0);
  const lastSpans = spansQuery(1);

  const fullText = computed(() => {
    const target = score();
    const first = firstSpans.data.value;
    const last = lastSpans.data.value;
    if (!target || !traceIds.value || !first || !last) return null;
    const input = asText(extractLLMData(contentSpan(target, first))?.input);
    const output = asText(extractLLMData(contentSpan(target, last))?.output);
    return input || output ? { input, output } : null;
  });

  const loading = computed(() => {
    if (!lookup.value) return false;
    if (rangeQuery.isPending.value) return true;
    if (!source.value) return false;
    if (lookup.value.kind === "session" && turnsQuery.isPending.value) return true;
    if (!traceIds.value) return false;
    return firstSpans.isPending.value || lastSpans.isPending.value;
  });

  // The score points at a trace or session, but its full text could not be read.
  const unavailable = computed(() => !!lookup.value && !loading.value && !fullText.value);

  return { fullText, loading, unavailable };
}
