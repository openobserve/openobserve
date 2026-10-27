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
import { qualitySpansQuery } from "@/services/online-evals.service.queries";
import { extractLLMData } from "@/utils/llmUtils";

// The judge runs after its target ends, so its spans sit before the score write; the margin covers clocks running behind.
const WINDOW_MARGIN_US = 60_000_000;

function asText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The full input and output a score was given, read in one query from the spans its scorer recorded. */
export function useScoreFullText(score: () => QualityScore | null, orgId: Ref<string>) {
  const spanIds = computed(() => {
    const target = score();
    return [...new Set([target?.inputSpanId, target?.outputSpanId])].filter(
      (id): id is string => !!id,
    );
  });
  const enabled = computed(
    () => !!orgId.value && !!score()?.sourceStream && spanIds.value.length > 0,
  );

  const spansQuery = useQuery(() => {
    const target = score();
    return Object.assign(
      qualitySpansQuery(
        orgId.value,
        target?.sourceStreamType || "traces",
        target?.sourceStream ?? "",
        spanIds.value,
        (target?.refTimestamp ?? 0) - WINDOW_MARGIN_US,
        target?.timestamp ?? 0,
      ),
      { enabled: enabled.value },
    );
  });

  const sideText = (spanId: string | null | undefined, side: "input" | "output") => {
    const span = spanId ? spansQuery.data.value?.find((row) => row.span_id === spanId) : undefined;
    return span ? asText(extractLLMData(span)?.[side]) : "";
  };

  const fullText = computed(() => {
    const target = score();
    return {
      input: sideText(target?.inputSpanId, "input"),
      output: sideText(target?.outputSpanId, "output"),
    };
  });

  const loading = computed(() => enabled.value && spansQuery.isPending.value);

  // A side whose full text could not be read shows its short preview instead.
  const unavailable = computed(() => {
    const target = score();
    if (!target || loading.value) return false;
    return (
      (!fullText.value.input && !!target.inputPreview) ||
      (!fullText.value.output && !!target.outputPreview)
    );
  });

  return { fullText, loading, unavailable };
}
