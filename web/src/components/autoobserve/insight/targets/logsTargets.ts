// Copyright 2026 OpenObserve Inc.

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

import type { RouteLocationRaw } from "vue-router";
import store from "@/stores";
import { buildLogsRoute, buildTracesRoute } from "@/utils/metrics/metricDrilldown";
import {
  isAutoObserveBuild,
  sqlField,
  sqlLiteral,
  sqlStream,
} from "@/utils/alerts/prefill/fromAutoObserve";
import { b64EncodeUnicode } from "@/utils/zincutils";

/** "Open in Logs" on an outage starts six hours before the stop, so the last normal rows are on screen. */
export const LEAD_US = 6 * 3_600_000_000;

/** A paged finding opens one hour before it started (CTA-MAP §3b). */
export const PAGED_LEAD_US = 3_600_000_000;

export interface FindingWindow {
  stream_type: string;
  stream_name: string;
  /** Microseconds. */
  signal_at: number;
  /** Microseconds before the signal; six hours when absent. */
  lead_us?: number;
}

export interface SourcesWindow {
  stream_type: string;
  stream_name: string;
  field: string;
  values: string[];
  /** Microseconds. */
  from: number;
  /** Microseconds; null while the outage is still open, which reads up to now. */
  to: number | null;
  now?: number;
}

export interface FieldWindow {
  stream_type: string;
  stream_name: string;
  field: string;
  from: number;
  to: number;
}

const nowUs = (): number => Date.now() * 1000;

const orgOf = (): string => String(store.state.selectedOrganization?.identifier ?? "");

/** A grouped count per value, the view that shows which senders stopped. */
const groupedSql = (stream: string, field: string): string =>
  `SELECT ${sqlField(field)}, count(*) AS row_count FROM ${sqlStream(stream)} GROUP BY ${sqlField(field)} ORDER BY row_count DESC`;

/** Traces open the traces page; metrics have no rows to open, so they get no route. */
const routeFor = (
  streamType: string,
  stream: string,
  window: { from: number; to: number },
  filter: { where?: string; sql?: string },
): RouteLocationRaw | null => {
  if (!stream || streamType === "metrics") return null;
  const args = {
    stream,
    filters: {},
    timeRange: { start_time: window.from, end_time: window.to },
    org: orgOf(),
  };
  if (streamType === "traces") {
    const base = buildTracesRoute(args);
    return { ...base, query: { ...base.query, query: b64EncodeUnicode(filter.where ?? "") } };
  }
  const base = buildLogsRoute(args);
  return {
    ...base,
    query: {
      ...base.query,
      stream_type: streamType || "logs",
      sql_mode: filter.sql ? "true" : "false",
      query: b64EncodeUnicode(filter.sql ?? filter.where ?? ""),
    },
  };
};

const inList = (field: string, values: string[]): string =>
  `${sqlField(field)} IN (${values.map(sqlLiteral).join(", ")})`;

/** The finding's stream from its lead before the signal to now; grouped by sender only when one is known (G24). */
export const logsForFinding = (
  f: FindingWindow,
  now: number = nowUs(),
  senderField?: string | null,
): RouteLocationRaw | null => {
  if (!isAutoObserveBuild()) return null;
  const window = { from: f.signal_at - (f.lead_us ?? LEAD_US), to: now };
  const sql =
    senderField && f.stream_type !== "traces" ? groupedSql(f.stream_name, senderField) : undefined;
  return routeFor(f.stream_type, f.stream_name, window, { sql });
};

/** The outage's sources from six hours before onset to its end, or to now while it is still open. */
export const logsForSources = (o: SourcesWindow): RouteLocationRaw | null => {
  if (!isAutoObserveBuild()) return null;
  const values = [...new Set(o.values.filter(Boolean))];
  if (!values.length || !o.field) return null;
  const window = { from: o.from - LEAD_US, to: o.to ?? o.now ?? nowUs() };
  return routeFor(o.stream_type, o.stream_name, window, { where: inList(o.field, values) });
};

/** A came-back outage's gap, from the stop to the recovery, so the histogram shows the volume over it. */
export const logsForGap = (o: SourcesWindow & { to: number }): RouteLocationRaw | null => {
  if (!isAutoObserveBuild()) return null;
  const values = [...new Set(o.values.filter(Boolean))];
  if (!values.length || !o.field) return null;
  return routeFor(
    o.stream_type,
    o.stream_name,
    { from: o.from, to: o.to },
    {
      where: inList(o.field, values),
    },
  );
};

/** A candidate field's values with their counts, for "Choose a field" when a signal cannot be measured yet. */
export const logsForField = (o: FieldWindow): RouteLocationRaw | null => {
  if (!isAutoObserveBuild() || !o.field || o.stream_type === "traces") return null;
  return routeFor(
    o.stream_type,
    o.stream_name,
    { from: o.from, to: o.to },
    {
      sql: groupedSql(o.stream_name, o.field),
    },
  );
};
