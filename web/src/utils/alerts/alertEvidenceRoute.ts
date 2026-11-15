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

import type { RouteLocationRaw } from "vue-router";
import type { I18nKey } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/formatters";
import { extractWhereClause } from "@/utils/query/sqlUtils";

/** The explorer an alert's evidence opens in. */
export type AlertEvidencePage = "logs" | "traces" | "metrics";

/** An absolute window in microseconds, or a relative period such as "10m". */
export type AlertEvidenceWindow = { fromUs: number; toUs: number } | { period: string };

/** What the explorer filters on: the rows the condition reads, or the alert's own query when no filter can be taken out of it. */
export type AlertEvidenceFilter =
  | { kind: "where"; where: string }
  | { kind: "sql"; sql: string }
  | { kind: "promql"; promql: string };

/** The button label for each explorer: "Open in logs", "Open in traces", "Open in metrics". */
export const ALERT_EVIDENCE_LABELS: Record<AlertEvidencePage, I18nKey> = {
  logs: "alerts.detail.openInLogs",
  traces: "alerts.detail.openInTraces",
  metrics: "alerts.detail.openInMetrics",
};

const MINUTE_US = 60_000_000;

const EVIDENCE_PAGES = new Set<string>(["logs", "traces", "metrics"]);

const queryConditionOf = (alert: any) => alert?.query_condition ?? alert?.condition;

/** The explorer an alert opens in, or null for families with no single stream query (composite, anomaly, SLO). */
export function alertEvidencePage(alert: any): AlertEvidencePage | null {
  if (!alert?.stream_name || !EVIDENCE_PAGES.has(alert.stream_type)) return null;
  const type = String(alert.alert_type ?? "").toLowerCase();
  if (type === "composite" || type === "anomaly_detection") return null;
  const qc = queryConditionOf(alert);
  if (!qc || qc.type === "slo") return null;
  return alert.stream_type as AlertEvidencePage;
}

/** A firing opens from one look-back before it started to now; otherwise the look-back that ends now. */
export function alertEvidenceWindow(
  periodMinutes: number | null | undefined,
  firingSinceUs: number | null | undefined,
  nowUs: number,
): AlertEvidenceWindow {
  const minutes = Number(periodMinutes) > 0 ? Number(periodMinutes) : 15;
  if (firingSinceUs && firingSinceUs > 0) {
    return { fromUs: firingSinceUs - minutes * MINUTE_US, toUs: nowUs };
  }
  return { period: `${minutes}m` };
}

/** The alert's own SQL, when it stores one; a Builder alert's SQL comes from generate_sql instead. */
export function alertStoredSql(alert: any): string {
  const qc = queryConditionOf(alert);
  return qc?.type === "sql" ? String(qc.sql ?? "").trim() : "";
}

/** The rows an alert reads: its WHERE clause, or the whole SQL when the parser cannot take one out. */
export async function alertEvidenceFilter(
  alert: any,
  sql: string,
): Promise<AlertEvidenceFilter | null> {
  const qc = queryConditionOf(alert);
  if (qc?.type === "promql") {
    const promql = String(qc.promql ?? "").trim();
    return promql ? { kind: "promql", promql } : null;
  }
  const text = sql.trim();
  if (!text) return null;
  const where = await extractWhereClause(text);
  if (where) return { kind: "where", where };
  // An empty answer for SQL that has a WHERE means the parser failed, so the query goes as written.
  return /\bwhere\b/i.test(text) ? { kind: "sql", sql: text } : { kind: "where", where: "" };
}

const timeQuery = (window: AlertEvidenceWindow, unit: "us" | "ms"): Record<string, string> => {
  if ("period" in window) return { period: window.period };
  const scale = unit === "ms" ? 1000 : 1;
  return {
    from: String(Math.floor(window.fromUs / scale)),
    to: String(Math.floor(window.toUs / scale)),
  };
};

/** The explorer route that shows the alert's evidence: its stream, the rows it reads and the window. */
export function alertEvidenceRoute(args: {
  page: AlertEvidencePage;
  stream: string;
  filter: AlertEvidenceFilter | null;
  window: AlertEvidenceWindow;
  org: string;
}): RouteLocationRaw {
  const { page, stream, filter, window, org } = args;
  if (page === "metrics") {
    if (filter?.kind === "promql") {
      // The /metrics guard opens a `query` parameter in Visualize; its picker reads milliseconds.
      return {
        name: "metrics",
        query: {
          org_identifier: org,
          query: b64EncodeUnicode(filter.promql) ?? "",
          query_type: "promql",
          ...timeQuery(window, "ms"),
        },
      };
    }
    return {
      name: "metrics",
      query: { org_identifier: org, metric: stream, ...timeQuery(window, "ms") },
    };
  }
  const where = filter?.kind === "where" ? filter.where : "";
  if (page === "traces") {
    return {
      name: "traces",
      query: {
        stream,
        ...timeQuery(window, "us"),
        query: b64EncodeUnicode(where) ?? "",
        // Same key order as the traces page's own URL: vue-router compares query strings by order.
        org_identifier: org,
        tab: "traces",
      },
    };
  }
  const sqlMode = filter?.kind === "sql";
  return {
    path: "/logs",
    query: {
      stream_type: "logs",
      stream,
      ...timeQuery(window, "us"),
      sql_mode: String(sqlMode),
      query: b64EncodeUnicode(sqlMode ? filter.sql : where) ?? "",
      // Logs reads an absent quick_mode as on, which drops every field but the trace ids.
      quick_mode: "false",
      show_histogram: "true",
      defined_schemas: "user_defined_schema",
      org_identifier: org,
    },
  };
}
