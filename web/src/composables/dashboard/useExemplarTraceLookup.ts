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

import { reactive } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";
import type { TraceVerdict } from "@/ts/interfaces/exemplars";
import type { OrgTraceTimeRangeResponse } from "@/ts/interfaces/traces/traceTimeRange.types";

/** Client cap on one lookup; the server may keep scanning after the abort. */
export const EXEMPLAR_LOOKUP_TIMEOUT_MS = 8000;

export function verdictFromResponse(
  data: OrgTraceTimeRangeResponse | undefined,
  traceId: string,
): TraceVerdict {
  const results = data?.results ?? [];
  const hit = results.find((r) => r?.trace_id === traceId) ?? results[0];
  if (hit?.status === "found" && hit.stream && hit.range) {
    return {
      state: "found",
      stream: hit.stream,
      startUs: hit.range.start_time,
      endUs: hit.range.end_time,
    };
  }
  if (hit?.status === "timeout") return { state: "unverified", reason: "timeout" };
  if (hit?.status === "not_found" && !data?.partial_coverage) return { state: "not_available" };
  if (hit?.status === "not_found") return { state: "unverified", reason: "partial" };
  return { state: "unverified", reason: "error" };
}

export function verdictFromError(err: unknown, aborted: boolean): TraceVerdict {
  if (aborted) return { state: "unverified", reason: "timeout" };
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403) return { state: "unverified", reason: "forbidden" };
  return { state: "unverified", reason: "error" };
}

/** Lazy, per-panel cache of trace availability keyed by trace_id; concurrent callers share one request. */
export function useExemplarTraceLookup(opts: { timeoutMs?: number } = {}) {
  const store = useStore();
  const timeoutMs = opts.timeoutMs ?? EXEMPLAR_LOOKUP_TIMEOUT_MS;
  const inFlight = new Map<string, Promise<TraceVerdict>>();
  const verdicts = reactive(new Map<string, TraceVerdict>());
  const controllers = new Set<AbortController>();

  const run = async (traceId: string, tsMs: number): Promise<TraceVerdict> => {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await searchService.get_trace_time_ranges({
        org_identifier: store.state.selectedOrganization?.identifier,
        trace_ids: [traceId],
        hint_ts: Math.round(tsMs * 1000),
        signal: controller.signal,
      });
      return verdictFromResponse(response?.data, traceId);
    } catch (err: unknown) {
      return verdictFromError(err, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };

  const lookup = (traceId: string, tsMs: number): Promise<TraceVerdict> => {
    const cached = inFlight.get(traceId);
    if (cached) return cached;
    const promise = run(traceId, tsMs).then((verdict) => {
      // A transient failure is not an answer about the trace, so the next hover asks again.
      if (verdict.state === "unverified" && verdict.reason === "error") inFlight.delete(traceId);
      else verdicts.set(traceId, verdict);
      return verdict;
    });
    inFlight.set(traceId, promise);
    return promise;
  };

  const peek = (traceId: string): TraceVerdict | undefined => verdicts.get(traceId);

  const dispose = () => {
    controllers.forEach((c) => c.abort());
    controllers.clear();
  };

  return { lookup, peek, dispose };
}
