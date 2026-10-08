//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import searchService from "@/services/search";
import {
  LOG_LINK_I18N,
  RESOLVE_SIZE,
  buildResolveRequest,
  isResolveComplete,
  parsePermalinkQuery,
  permalinkOutcome,
  type LineLink,
  type LogRow,
  type PermalinkOutcome,
  type ResolveResult,
} from "@/utils/logs/logPermalink";
import { sharedPage } from "@/composables/useLogs/useLogsUrl";
import {
  activePermalink,
  mintInitOrigin,
  permalinkBanner,
  permalinkResolving,
  replaceResolveController,
  resetPermalinkState,
  sharedLineRecord,
  type ActivePermalink,
} from "@/composables/useLogs/useLogPermalink";

export const PERMALINK_TIE_HEAVY_KEY = "search.linePermalink.bannerAmbiguousTieHeavy";

export interface ResolveContext {
  regions?: string[];
  clusters?: string[];
  multiStream?: boolean;
  allFieldsName?: string;
  retentionDays?: (stream: string) => number | null;
}

/** Initial load only (C5 step 2): parses `log_*` and mints the init origin; null when the URL carries no line or page. */
export function beginPermalinkFromUrl(query: Record<string, unknown>, org: string): string | null {
  resetPermalinkState();
  const parsed = parsePermalinkQuery(query);
  if (parsed.kind === "none" && sharedPage.value === null) return null;
  const { token, generation } = mintInitOrigin();
  if (parsed.kind === "invalid") {
    const outcome = permalinkOutcome({ parsed, result: null });
    permalinkBanner.value = { ...outcome, generation, stream: "", ts: 0 };
  } else if (parsed.kind === "valid") {
    activePermalink.value = {
      org,
      link: parsed.link,
      generation,
      multiStream: false,
      regions: [],
      clusters: [],
      outcome: null,
    };
  }
  return token;
}

/** Runs the 1 µs resolve (C4) for the active permalink and applies its outcome; stale or aborted runs change nothing. */
export async function resolveActivePermalink(context: ResolveContext = {}): Promise<void> {
  const active = activePermalink.value;
  if (!active) return;
  const own = new AbortController();
  replaceResolveController(own);
  const generation = active.generation;
  const prepared: ActivePermalink = {
    ...active,
    multiStream: !!context.multiStream,
    regions: [...(context.regions ?? [])],
    clusters: [...(context.clusters ?? [])],
  };
  activePermalink.value = prepared;
  permalinkResolving.value = true;
  const request = buildResolveRequest({
    orgIdentifier: active.org,
    stream: active.link.stream,
    ts: active.link.ts,
    id: active.link.id,
    regions: prepared.regions,
    clusters: prepared.clusters,
  });
  let result: ResolveResult;
  try {
    const response = await searchService.search(
      { ...request.options, signal: own.signal },
      request.searchType,
      false,
      request.useCache,
    );
    result = { status: response.status, data: response.data };
  } catch (error) {
    if (own.signal.aborted) return;
    result = errorResult(error);
  }
  if (own.signal.aborted || activePermalink.value?.generation !== generation) return;
  replaceResolveController(null);
  permalinkResolving.value = false;
  const outcome = adaptTieHeavy(
    permalinkOutcome({
      parsed: { kind: "valid", link: active.link },
      result,
      allFieldsName: context.allFieldsName,
      retentionDays: context.retentionDays?.(active.link.stream) ?? null,
    }),
    active.link,
    result,
  );
  activePermalink.value = { ...prepared, outcome };
  permalinkBanner.value = {
    ...outcome,
    record: null,
    generation,
    stream: active.link.stream,
    ts: active.link.ts,
  };
  sharedLineRecord.value =
    outcome.state === "found" && outcome.record ? drawerRecord(outcome.record, prepared) : null;
}

/** Banner Retry (J-C14): re-runs the resolve once for the same link. */
export function retryPermalinkResolve(context: ResolveContext = {}): Promise<void> {
  const active = activePermalink.value;
  if (!active) return Promise.resolve();
  activePermalink.value = { ...active, outcome: null };
  return resolveActivePermalink({
    ...context,
    regions: context.regions ?? active.regions,
    clusters: context.clusters ?? active.clusters,
    multiStream: context.multiStream ?? active.multiStream,
  });
}

/** The record as the drawer shows it: `_stream_name` set on a multi-stream page so Search-around routes to the line's stream. */
function drawerRecord(record: LogRow, active: ActivePermalink): LogRow {
  return active.multiStream ? { ...record, _stream_name: active.link.stream } : { ...record };
}

// A timestamp link that only hit the size cap is the S-C3 tie-heavy case: ambiguous with the rows highlighted.
function adaptTieHeavy(
  outcome: PermalinkOutcome,
  link: LineLink,
  result: ResolveResult,
): PermalinkOutcome {
  if (outcome.state !== "incomplete" || link.id !== undefined || link.fp !== undefined) {
    return outcome;
  }
  if (!isResolveComplete(result, Number.MAX_SAFE_INTEGER)) return outcome;
  const hits = ((result.data as { hits?: LogRow[] }).hits ?? []) as LogRow[];
  const hasId = hits.some((hit) => hit?._o2_id !== undefined && hit?._o2_id !== null);
  return {
    ...outcome,
    state: "ambiguous",
    severity: "info",
    messageKey: hasId ? LOG_LINK_I18N.bannerAmbiguous : PERMALINK_TIE_HEAVY_KEY,
    messageParams: { count: `${RESOLVE_SIZE.toLocaleString()}+` },
    actionKey: LOG_LINK_I18N.actionShowLines,
  };
}

function errorResult(error: unknown): ResolveResult {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  return { status: response?.status ?? null, data: response?.data };
}
