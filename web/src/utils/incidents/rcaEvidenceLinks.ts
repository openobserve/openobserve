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

// Build evidence links from stored query targets, never server- or model-provided URLs.

import type { RouteLocationRaw } from "vue-router";
import { buildNavigationRoute } from "@/components/O2AIChat.navigation";
import { raw } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import type { RcaBlindSpotFix, RcaEvidenceTarget } from "@/services/incidents";

/** The signal an evidence link opens: the label of "Open in …". */
export type RcaEvidencePage = "logs" | "metrics" | "traces";

export interface RcaEvidenceLink {
  page: RcaEvidencePage;
  route: RouteLocationRaw;
}

/** The relative range a link uses when the entry has no time range. */
const NO_RANGE_PERIOD = "1h";

/** Signals whose SQL the logs page can run (as its `stream_type`). */
const isSqlSignal = (signal: RcaEvidenceTarget["signal"]): signal is RcaEvidencePage =>
  signal === "logs" || signal === "metrics" || signal === "traces";

const hasRange = (link: RcaEvidenceTarget): boolean =>
  typeof link.start_us === "number" && typeof link.end_us === "number";

/** The logs handoff type that runs the query on arrival (`plugins/logs/Index.vue`). */
const RCA_LOGS_TYPE = "rca_evidence_query";

export function rcaEvidenceLink(link: RcaEvidenceTarget, org: string): RcaEvidenceLink | null {
  const ranged = hasRange(link);

  // Logs handles SQL for all three signals; preserve the source stream type. The
  // `rca_evidence_query` type makes Logs run the query on arrival; the AI chat's
  // `ai_chat_query` only re-applies it. The label names the signal, not the page.
  if (link.sql && isSqlSignal(link.signal)) {
    const route = buildNavigationRoute(
      {
        resource_type: link.signal,
        action: "load_query",
        label: raw(""),
        target: {
          query: link.sql,
          sql_mode: true,
          stream: link.streams,
          ...(ranged
            ? { from: link.start_us as number, to: link.end_us as number }
            : { period: NO_RANGE_PERIOD }),
        },
      },
      org,
    );
    return route
      ? {
          page: link.signal,
          route: { path: "/logs", query: { ...route.query, type: RCA_LOGS_TYPE } },
        }
      : null;
  }

  // PromQL: the `/metrics` guard opens a `query` parameter in Visualize; from/to are ms.
  if (link.promql) {
    return {
      page: "metrics",
      route: {
        name: "metrics",
        query: {
          org_identifier: org,
          query: b64EncodeUnicode(link.promql) ?? "",
          query_type: "promql",
          ...(ranged
            ? {
                from: String(Math.floor((link.start_us as number) / 1000)),
                to: String(Math.floor((link.end_us as number) / 1000)),
              }
            : { period: NO_RANGE_PERIOD }),
        },
      },
    };
  }

  // Traces: the handoff `filter` is plain text; `from`/`to` are µs. An unfiltered
  // call (stream + range only) hands off an empty filter: all spans in the range.
  if (link.signal === "traces" && (link.filter !== undefined || link.streams[0])) {
    return {
      page: "traces",
      route: {
        name: "traces",
        query: {
          org_identifier: org,
          ...(link.streams[0] ? { stream: link.streams[0] } : {}),
          filter: link.filter ?? "",
          ...(ranged
            ? { from: String(link.start_us), to: String(link.end_us) }
            : { period: NO_RANGE_PERIOD }),
        },
      },
    };
  }

  return null;
}

/** The query text "Copy query" copies, or null when the entry stored none. */
export const rcaEvidenceQuery = (link: RcaEvidenceTarget): string | null =>
  link.sql || link.promql || link.filter || link.command || null;

/** The page a blind spot's button opens, or null for no button. */
export function rcaBlindSpotRoute(fix: RcaBlindSpotFix, org: string): RouteLocationRaw | null {
  const query = { org_identifier: org };
  switch (fix) {
    case "connect_toolset":
      return { name: "aiToolsets", query };
    case "ingest_data":
      return { name: "ingestion", query };
    case "open_pipeline":
    case "sampling_rules":
      return { name: "pipelines", query };
    // Resume run is an action, not a page: the blind spot's button emits it (J9).
    case "resume_run":
    case "none":
      return null;
  }
}
