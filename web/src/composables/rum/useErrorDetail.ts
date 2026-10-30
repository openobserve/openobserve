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

import { ref, type Ref } from "vue";
import { useStore } from "vuex";
import type { TranslateFn } from "@/types/i18n";
import searchService from "@/services/search";
import useQuery from "@/composables/useQuery";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { pivotCounts } from "@/utils/rum/errorIssueQueries";
import { intervalToMicros, type IssueSignature } from "@/utils/rum/errorIssueUtils";
import {
  FACET_GROUPS,
  availableFacets,
  buildFacetSql,
  buildIssueImpactSql,
  buildIssueOccurrencesSql,
  buildSignatureWhere,
  pivotFacet,
  FACET_ROW_LIMIT,
  type ErrorDetailContext,
  type FacetKey,
  type FacetValue,
} from "@/utils/rum/errorDetailQueries";

export interface ErrorImpact {
  events: number;
  usersAffected: number | null;
  sessionsAffected: number | null;
  firstSeen: number;
  lastSeen: number;
}

export interface OccurrenceBucket {
  ts: number;
  events: number;
}

export interface FetchErrorDetailParams {
  signature: IssueSignature;
  /** Stream schema presence map from `getStream()`. */
  schema: Record<string, boolean>;
  /** Analysis window, microseconds. */
  startTime: number;
  endTime: number;
}

const emptyFacets = (): Record<FacetKey, FacetValue[]> => ({
  browser: [],
  os: [],
  release: [],
  page: [],
});

/**
 * Issue-scoped aggregates for the error detail page: how often this exact
 * error signature fires, how many people it reaches, and which browser / OS /
 * release / page it concentrates in.
 *
 * The single error event the page opens with cannot answer any of that — it is
 * one row. These searches are what turn the page from "an error happened" into
 * "this is how bad it is and where to look".
 */
const useErrorDetail = (t: TranslateFn) => {
  const store = useStore();
  const { getTimeInterval, buildQueryPayload } = useQuery();

  const impact: Ref<ErrorImpact | null> = ref(null);
  const occurrences: Ref<OccurrenceBucket[]> = ref([]);
  const facets: Ref<Record<FacetKey, FacetValue[]>> = ref(emptyFacets());
  const isLoadingImpact = ref(false);
  const isLoadingInsights = ref(false);
  /** False when the error carries no signature strong enough to aggregate on. */
  const hasSignature = ref(true);

  // Only the latest run may commit; superseded runs are aborted outright so they
  // stop holding slots in the server's per-user work-group queue.
  let runId = 0;
  let runController = new AbortController();

  const runSearch = (
    sql: string,
    range: { startTime: number; endTime: number },
    size: number,
    signal: AbortSignal,
  ): Promise<any[]> => {
    const req = buildQueryPayload(
      {
        sqlMode: false,
        streamName: "_rumdata",
        timestamp_column: store.state.zoConfig.timestamp_column,
        timestamps: { startTime: range.startTime, endTime: range.endTime },
        size,
      } as any,
      t,
    );
    // buildQueryPayload encodes its template SQL before we override it, so the
    // replacement must be re-encoded when base64 mode is active.
    req.query.sql = req.encoding === "base64" ? b64EncodeUnicode(sql) : sql;
    req.query.from = 0;
    req.query.size = size;
    delete req.aggs;
    return searchService
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
          signal,
        },
        "RUM",
      )
      .then((res) => res.data.hits ?? []);
  };

  const reset = () => {
    impact.value = null;
    occurrences.value = [];
    facets.value = emptyFacets();
    isLoadingImpact.value = false;
    isLoadingInsights.value = false;
  };

  const fetchDetail = async (params: FetchErrorDetailParams): Promise<void> => {
    const currentRun = ++runId;
    runController.abort();
    runController = new AbortController();
    const signal = runController.signal;

    const ctx: ErrorDetailContext = {
      streamName: "_rumdata",
      timestampColumn: store.state.zoConfig.timestamp_column || "_timestamp",
      schema: params.schema,
      signature: params.signature,
    };
    const where = buildSignatureWhere(ctx);
    hasSignature.value = where !== null;
    if (!where) {
      reset();
      return;
    }

    const range = { startTime: params.startTime, endTime: params.endTime };
    reset();
    isLoadingImpact.value = true;
    isLoadingInsights.value = true;

    // Stage 1 — impact alone. It is the number the page leads with, and every
    // panel below is a breakdown OF it, so nothing else is worth spending a
    // work-group slot on until we know this issue has events at all.
    let impactHit: any = null;
    try {
      const hits = await runSearch(buildIssueImpactSql(ctx, where), range, 10, signal);
      if (currentRun !== runId) return;
      impactHit = hits[0] ?? null;
    } catch {
      if (currentRun !== runId) return;
      isLoadingImpact.value = false;
      isLoadingInsights.value = false;
      return;
    }

    const events = Number(impactHit?.events) || 0;
    impact.value = {
      events,
      usersAffected:
        impactHit?.users_affected != null ? Number(impactHit.users_affected) || 0 : null,
      sessionsAffected:
        impactHit?.sessions_affected != null ? Number(impactHit.sessions_affected) || 0 : null,
      firstSeen: Number(impactHit?.first_seen) || 0,
      lastSeen: Number(impactHit?.last_seen) || 0,
    };
    isLoadingImpact.value = false;

    if (!events) {
      isLoadingInsights.value = false;
      return;
    }

    // Stage 2 — the breakdowns. Three concurrent searches, inside the cap.
    const interval = getTimeInterval(params.startTime, params.endTime).interval;
    const facetGroups = FACET_GROUPS.map((group) => availableFacets(ctx, group));
    const [occurrencesR, ...facetResults] = await Promise.allSettled([
      runSearch(buildIssueOccurrencesSql(ctx, where, interval), range, 2000, signal),
      ...facetGroups.map((group) => {
        const sql = buildFacetSql(ctx, where, group);
        return sql ? runSearch(sql, range, FACET_ROW_LIMIT, signal) : Promise.resolve([]);
      }),
    ]);
    if (currentRun !== runId) return;

    occurrences.value =
      occurrencesR.status === "fulfilled"
        ? pivotCounts(
            occurrencesR.value,
            params.startTime,
            params.endTime,
            intervalToMicros(interval),
          )
        : [];

    // Each facet group degrades on its own — a failed group shows no rows
    // rather than blanking the whole breakdown panel.
    const unknownLabel = t("rum.unknown");
    const next = emptyFacets();
    facetResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      for (const facet of facetGroups[index]) {
        next[facet.key] = pivotFacet(result.value, facet.column, unknownLabel);
      }
    });
    facets.value = next;
    isLoadingInsights.value = false;
  };

  return {
    impact,
    occurrences,
    facets,
    hasSignature,
    isLoadingImpact,
    isLoadingInsights,
    fetchDetail,
    /** Abort every search in flight. Call when the view is left. */
    cancelAll: () => {
      runController.abort();
      runController = new AbortController();
      isLoadingImpact.value = false;
      isLoadingInsights.value = false;
    },
  };
};

export default useErrorDetail;
