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
import { useI18n } from "vue-i18n";
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
  const { t } = useI18n();
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
    return (sql: string, startMicros: number, endMicros: number) =>
      new Promise((resolve, reject) => {
        const traceId = generateTraceContext().traceId;
        const useBase64 = store.state.zoConfig?.sql_base64_enabled;
        const hits: any[] = [];
        fetchQueryDataWithHttpStream(
          {
            queryReq: {
              query: {
                sql: useBase64 ? b64EncodeUnicode(sql) : sql,
                // The engine scans partitions by these bounds — they MUST be the
                // arm's real window (µs), not 0/0, or the search returns no rows
                // and every latency/cost metric falsely reads "insufficient".
                start_time: startMicros,
                end_time: endMicros,
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

  /**
   * @param manualWindows optional caller-supplied windows for `align ===
   *   "manual"` (the manual-override escape hatch — spec §8). When provided,
   *   the given arm's resolved window is REPLACED with the caller's window
   *   (still passed through `resolveCompareWindows`'s manual branch for the
   *   other arm / overlap bookkeeping); only meaningful in manual align mode.
   */
  async function run(
    stream: string,
    manualWindows?: { a?: { start: number; end: number }; b?: { start: number; end: number } },
    sharedWindow?: { start: number; end: number },
  ): Promise<void> {
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
    // Manual override: replace one or both arm windows with the caller's
    // explicit start/end (the t0-skew escape hatch). Only meaningful in
    // manual mode, but applied unconditionally when supplied — the resolver's
    // manual branch already returns natural windows as the baseline.
    if (manualWindows?.a) resolved.a = manualWindows.a;
    if (manualWindows?.b) resolved.b = manualWindows.b;
    windows.value = resolved;

    // sameWallClock: both arms query the SAME page window (when supplied) so
    // the comparison is a true wall-clock overlay, not each arm's disjoint
    // natural lifetime. The resolver's `resolved` windows are still stored on
    // `windows.value` for display (VersionWindowCard etc.); only the actual
    // fetch/sample calls below are redirected to the shared window.
    const useShared = align.value === "sameWallClock" && !!sharedWindow;
    const queryA = useShared ? (sharedWindow as { start: number; end: number }) : resolved.a;
    const queryB = useShared ? (sharedWindow as { start: number; end: number }) : resolved.b;

    const runner = makeRunner();

    const fetchAPromise = armA
      .fetchAll(stream, queryA.start, queryA.end, va)
      .catch((e: any) => {
        armA.error.value = e?.message || "Failed to fetch version A";
      });
    const fetchBPromise = armB
      .fetchAll(stream, queryB.start, queryB.end, vb)
      .catch((e: any) => {
        armB.error.value = e?.message || "Failed to fetch version B";
      });

    const filterA = buildAgentTraceFilter(va, stream);
    const filterB = buildAgentTraceFilter(vb, stream);

    const sampleAPromise = fetchRawSample(
      stream,
      filterA,
      queryA.start,
      queryA.end,
      runner,
    ).catch((e: any) => {
      armA.error.value = armA.error.value || e?.message || "Failed to fetch sample A";
      return { durations: [], costs: [] };
    });
    const sampleBPromise = fetchRawSample(
      stream,
      filterB,
      queryB.start,
      queryB.end,
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

    // Sample-cap disclosure: latency/cost intervals only ever see up to
    // SAMPLE_CAP randomly-sampled traces per arm, regardless of traceCount —
    // surface that so the numbers aren't mistaken for exhaustive.
    sampledNote.value = t("aiObservability.versionCompare.sampledNote", { cap: SAMPLE_CAP });
  }

  return {
    setPair,
    align,
    run,
    kpiA: armA.kpi,
    kpiB: armB.kpi,
    // Sparklines from each arm's own useLLMInsights instance — additive
    // exposure so consumers (VersionOverlayChart wiring) can rebase the
    // per-arm bucket series onto elapsed-hours/wall-clock without a second
    // fetch. Populated once `run()`'s fetchAll passes resolve.
    sparklinesA: armA.sparklines,
    sparklinesB: armB.sparklines,
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
