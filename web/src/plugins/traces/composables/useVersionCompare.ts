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

// useVersionCompare.ts — orchestrator composable for the "compare two agent
// versions" mode on LLM Insights. Wraps TWO independent useLLMInsights()
// scopes (armA/armB) so each arm's kpi/loading/error stay isolated (no
// shared-ref race), resolves the per-arm time windows via
// resolveCompareWindows, fires both fetchAll passes + both raw-sample pulls
// concurrently, then assembles a CompareResult via buildCompareResult.

import { ref, computed, type Ref } from "vue";
import { useStore } from "vuex";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { useLLMInsights } from "./useLLMInsights";
import { resolveCompareWindows, type AlignMode, type CompareWindows } from "../versionCompare/windows";
import { buildCompareResult, type CompareResult } from "../versionCompare/compareResult";
import { fetchRawSample, type RawSampleQueryRunner } from "../versionCompare/rawSample";
import { buildAgentTraceFilter } from "../llmAgentFilter";
import { SAMPLE_CAP } from "../versionCompare/constants";

const UNSET_ERROR = "Cannot compare an UNSET (no version) slot";

function isUnset(agent: GenAiAgentListItem | null | undefined): boolean {
  return !agent || agent.version === null || agent.version === undefined;
}

function isSameVariant(
  a: GenAiAgentListItem | null | undefined,
  b: GenAiAgentListItem | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (a.env ?? null) === (b.env ?? null) && (a.version ?? null) === (b.version ?? null);
}

/**
 * useVersionCompare — two-scope orchestrator for agent version comparison.
 *
 * @example
 *   const vc = useVersionCompare();
 *   vc.setPair(versionA, versionB);
 *   await vc.run("my_traces_stream");
 *   console.log(vc.result.value?.metrics);
 */
export function useVersionCompare() {
  const store = useStore();
  const { fetchQueryDataWithHttpStream } = useHttpStreaming();

  const armA = useLLMInsights();
  const armB = useLLMInsights();

  const a = ref<GenAiAgentListItem | null>(null) as Ref<GenAiAgentListItem | null>;
  const b = ref<GenAiAgentListItem | null>(null) as Ref<GenAiAgentListItem | null>;
  const align = ref<AlignMode>("sinceRollout");
  const windows = ref<CompareWindows | null>(null);
  const result = ref<CompareResult | null>(null);
  const sampledNote = ref<string | null>(null);

  const sameVariant = computed(() => isSameVariant(a.value, b.value));

  function setPair(variantA: GenAiAgentListItem, variantB: GenAiAgentListItem) {
    a.value = variantA;
    b.value = variantB;
    windows.value = null;
    result.value = null;
    armA.error.value = null;
    armB.error.value = null;
  }

  /**
   * Runner for `fetchRawSample`, mirroring `useLLMInsights.executeQuery`'s
   * transport conventions (base64-encode when configured, trace-id per
   * request) but collecting rows instead of driving incremental callbacks —
   * the bootstrap needs the whole sample at once.
   */
  function makeRunner(): RawSampleQueryRunner {
    return (sql: string) =>
      new Promise((resolve, reject) => {
        const traceId = generateTraceContext().traceId;
        const useBase64 = store.state.zoConfig?.sql_base64_enabled;
        const hits: any[] = [];
        fetchQueryDataWithHttpStream(
          {
            queryReq: {
              query: {
                sql: useBase64 ? b64EncodeUnicode(sql) : sql,
                start_time: 0,
                end_time: 0,
                from: 0,
                size: SAMPLE_CAP,
              },
              ...(useBase64 ? { encoding: "base64" } : {}),
            },
            type: "search",
            pageType: "traces",
            searchType: "ui",
            traceId,
            org_id: store.state.selectedOrganization.identifier,
          },
          {
            data: (_payload: any, response: any) => {
              const rows: any[] = response.content?.results?.hits || [];
              if (rows.length > 0) hits.push(...rows);
            },
            error: (response: any) => {
              const message =
                response?.message ||
                response?.error ||
                response?.error_detail ||
                "Failed to fetch raw sample";
              reject(new Error(message));
            },
            complete: () => resolve(hits),
            reset: () => {},
          },
        );
      });
  }

  async function run(stream: string): Promise<void> {
    if (!a.value || !b.value) return;

    if (isUnset(a.value) || isUnset(b.value)) {
      if (isUnset(a.value)) armA.error.value = UNSET_ERROR;
      if (isUnset(b.value)) armB.error.value = UNSET_ERROR;
      return;
    }

    if (sameVariant.value) {
      return;
    }

    const nowMicros = Date.now() * 1000;
    const va = a.value;
    const vb = b.value;
    if (
      va.first_seen == null ||
      va.last_seen == null ||
      vb.first_seen == null ||
      vb.last_seen == null
    ) {
      armA.error.value = va.first_seen == null || va.last_seen == null ? "Missing first/last seen" : armA.error.value;
      armB.error.value = vb.first_seen == null || vb.last_seen == null ? "Missing first/last seen" : armB.error.value;
      return;
    }

    const resolved = resolveCompareWindows(
      { firstSeen: va.first_seen, lastSeen: va.last_seen },
      { firstSeen: vb.first_seen, lastSeen: vb.last_seen },
      nowMicros,
      align.value,
    );
    windows.value = resolved;

    const runner = makeRunner();

    const fetchAPromise = armA
      .fetchAll(stream, resolved.a.start, resolved.a.end, va)
      .catch((e: any) => {
        armA.error.value = e?.message || "Failed to fetch version A";
      });
    const fetchBPromise = armB
      .fetchAll(stream, resolved.b.start, resolved.b.end, vb)
      .catch((e: any) => {
        armB.error.value = e?.message || "Failed to fetch version B";
      });

    const filterA = buildAgentTraceFilter(va, stream);
    const filterB = buildAgentTraceFilter(vb, stream);

    const sampleAPromise = fetchRawSample(
      stream,
      filterA,
      resolved.a.start,
      resolved.a.end,
      runner,
    ).catch((e: any) => {
      armA.error.value = armA.error.value || e?.message || "Failed to fetch sample A";
      return { durations: [], costs: [] };
    });
    const sampleBPromise = fetchRawSample(
      stream,
      filterB,
      resolved.b.start,
      resolved.b.end,
      runner,
    ).catch((e: any) => {
      armB.error.value = armB.error.value || e?.message || "Failed to fetch sample B";
      return { durations: [], costs: [] };
    });

    const [, , samplesA, samplesB] = await Promise.all([
      fetchAPromise,
      fetchBPromise,
      sampleAPromise,
      sampleBPromise,
    ]);

    result.value = buildCompareResult(
      armA.kpi.value,
      armB.kpi.value,
      samplesA,
      samplesB,
      resolved,
      1,
    );
  }

  return {
    setPair,
    align,
    run,
    kpiA: armA.kpi,
    kpiB: armB.kpi,
    loadingA: armA.loading,
    loadingB: armB.loading,
    errorA: armA.error,
    errorB: armB.error,
    windows,
    result,
    sampledNote,
    sameVariant,
  };
}
