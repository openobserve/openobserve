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

// Routes for the evidence entries and blind spots of an RCA run (03 VE29, VE37).
// Every link is built here from the entry's stored target; no URL comes from the
// server or the model (VE-D5).

import type { RouteLocationRaw } from "vue-router";
import { buildNavigationRoute } from "@/components/O2AIChat.navigation";
import { raw } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import type { RcaBlindSpotFix, RcaEvidenceTarget } from "@/services/incidents";

/** The page an evidence link opens: the label of "Open in …". */
export type RcaEvidencePage = "logs" | "metrics" | "traces";

export interface RcaEvidenceLink {
  page: RcaEvidencePage;
  route: RouteLocationRaw;
}

/** The relative range a link uses when the entry has no time range (VE29). */
const NO_RANGE_PERIOD = "1h";

/** Signals whose SQL the logs page can run (as its `stream_type`). */
const SQL_STREAM_TYPE: Partial<Record<RcaEvidenceTarget["signal"], true>> = {
  logs: true,
  metrics: true,
  traces: true,
};

const hasRange = (link: RcaEvidenceTarget): boolean =>
  typeof link.start_us === "number" && typeof link.end_us === "number";

/**
 * The route that runs an entry's query again (VE29), or null for entries with no
 * query to run (change, infra, context, unclassified).
 */
export function rcaEvidenceLink(link: RcaEvidenceTarget, org: string): RcaEvidenceLink | null {
  const ranged = hasRange(link);

  // SQL: the logs page with the AI chat's load_query handoff; `stream_type` keeps
  // the signal, so metrics and traces SQL open on the logs page too.
  if (link.sql && SQL_STREAM_TYPE[link.signal]) {
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
    return route ? { page: "logs", route: { path: "/logs", query: route.query } } : null;
  }

  // PromQL: the metrics editor runs a `query` parameter on load; its share link writes ms.
  if (link.promql) {
    return {
      page: "metrics",
      route: {
        name: "metricsEditor",
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

  // Traces: the handoff `filter` is plain text; `from`/`to` are µs.
  if (link.filter !== undefined && link.signal === "traces") {
    return {
      page: "traces",
      route: {
        name: "traces",
        query: {
          org_identifier: org,
          ...(link.streams[0] ? { stream: link.streams[0] } : {}),
          filter: link.filter,
          ...(ranged
            ? { from: String(link.start_us), to: String(link.end_us) }
            : { period: NO_RANGE_PERIOD }),
        },
      },
    };
  }

  return null;
}

/**
 * The query text "Copy query" copies, or null when the entry stored none. A
 * command (change, infra) is copied too, though it has no explorer link.
 */
export const rcaEvidenceQuery = (link: RcaEvidenceTarget): string | null =>
  link.sql || link.promql || link.filter || link.command || null;

/** The page a blind spot's button opens (VE37), or null for no button. */
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
    // Resume is Phase 5: no button until it ships.
    case "resume_run":
    case "none":
      return null;
  }
}
