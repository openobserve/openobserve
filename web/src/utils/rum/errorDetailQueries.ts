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

import { escapeSqlString, type IssueSignature } from "@/utils/rum/errorIssueUtils";
import { pickUserField } from "@/utils/rum/errorIssueQueries";

/** Messages longer than this are dropped from the signature predicate. */
export const MAX_SIGNATURE_MESSAGE_LEN = 4096;
/** Distinct values shown per breakdown facet. */
export const FACET_TOP_N = 5;
/** Row cap for the facet group-by searches. */
export const FACET_ROW_LIMIT = 1000;

export interface ErrorDetailContext {
  streamName: string;
  timestampColumn: string;
  /** Stream schema presence map — optional columns are guarded through it. */
  schema: Record<string, boolean>;
  /** The signature of the error being viewed (type + message + handling). */
  signature: IssueSignature;
}

const SIGNATURE_FIELDS = ["error_type", "error_message", "error_handling"] as const;

/**
 * WHERE fragment pinning rows to this error's signature, or `null` when the
 * signature is too weak to identify an issue — `error_handling` alone matches
 * every error in the stream, so aggregates built on it would be nonsense and
 * the caller should skip them instead.
 */
export const buildSignatureWhere = (ctx: ErrorDetailContext): string | null => {
  const clauses = ["type='error'"];
  let identifying = 0;
  for (const field of SIGNATURE_FIELDS) {
    const value = ctx.signature[field];
    if (!ctx.schema[field] || value == null || value === "") continue;
    if (field === "error_message" && String(value).length > MAX_SIGNATURE_MESSAGE_LEN) continue;
    clauses.push(`${field}='${escapeSqlString(String(value))}'`);
    if (field !== "error_handling") identifying++;
  }
  return identifying ? clauses.join(" AND ") : null;
};

/** Impact aggregates for this one issue: volume, reach, and its lifespan. */
export const buildIssueImpactSql = (ctx: ErrorDetailContext, where: string): string => {
  const ts = ctx.timestampColumn;
  const userField = pickUserField(ctx.schema);
  const select = ["COUNT(*) AS events", `MIN(${ts}) AS first_seen`, `MAX(${ts}) AS last_seen`];
  if (ctx.schema["session_id"]) select.push("COUNT(DISTINCT session_id) AS sessions_affected");
  if (userField) select.push(`COUNT(DISTINCT ${userField}) AS users_affected`);
  return `SELECT ${select.join(", ")} FROM "${ctx.streamName}" WHERE ${where}`;
};

/** Occurrences of this one issue over time. */
export const buildIssueOccurrencesSql = (
  ctx: ErrorDetailContext,
  where: string,
  interval: string,
): string =>
  `SELECT histogram(${ctx.timestampColumn}, '${interval}') AS ts, COUNT(*) AS events` +
  ` FROM "${ctx.streamName}" WHERE ${where} GROUP BY ts ORDER BY ts`;

export type FacetKey = "browser" | "os" | "release" | "page";

export interface FacetSpec {
  key: FacetKey;
  column: string;
}

/**
 * The breakdown dimensions, split into two group-by searches. Splitting is
 * deliberate: one query grouping all four columns returns their CROSS PRODUCT,
 * which for a busy issue blows past any sane row cap. Grouping the two
 * low-cardinality environment columns separately from the two
 * higher-cardinality deployment columns keeps both result sets small.
 */
export const FACET_GROUPS: FacetSpec[][] = [
  [
    { key: "browser", column: "user_agent_user_agent_family" },
    { key: "os", column: "user_agent_os_family" },
  ],
  [
    { key: "release", column: "version" },
    { key: "page", column: "view_url" },
  ],
];

/** Facets whose column is actually present in the stream schema. */
export const availableFacets = (ctx: ErrorDetailContext, group: FacetSpec[]): FacetSpec[] =>
  group.filter((facet) => ctx.schema[facet.column]);

export const buildFacetSql = (
  ctx: ErrorDetailContext,
  where: string,
  facets: FacetSpec[],
): string | null => {
  if (!facets.length) return null;
  const columns = facets.map((facet) => facet.column).join(", ");
  return (
    `SELECT ${columns}, COUNT(*) AS events FROM "${ctx.streamName}"` +
    ` WHERE ${where} GROUP BY ${columns} ORDER BY events DESC`
  );
};

/**
 * Events from the SAME session around the failure — the breadcrumb trail.
 * Scoping to the session is what makes the trail trustworthy: without it the
 * list is whatever the stream happened to receive, i.e. other people's clicks.
 */
export const buildBreadcrumbsSql = (ctx: ErrorDetailContext, sessionId: string): string => {
  const types = ["'error'", "'action'", "'view'", "'resource'"].join(", ");
  return (
    `SELECT * FROM "${ctx.streamName}"` +
    ` WHERE session_id='${escapeSqlString(sessionId)}' AND type IN (${types})` +
    ` ORDER BY ${ctx.timestampColumn}`
  );
};

export interface FacetValue {
  value: string;
  events: number;
  /** Share of this issue's events, 0–1. */
  share: number;
}

/**
 * Collapse a group-by result down to one dimension. Rows missing the column
 * are folded into a single bucket keyed by `unknownLabel`, so the shares always
 * add up to 100% rather than silently dropping traffic.
 */
export const pivotFacet = (
  hits: any[],
  column: string,
  unknownLabel: string,
  topN = FACET_TOP_N,
): FacetValue[] => {
  const totals = new Map<string, number>();
  let grandTotal = 0;
  for (const hit of hits) {
    const value = hit?.[column];
    const key = value == null || value === "" ? unknownLabel : String(value);
    const events = Number(hit?.events) || 0;
    totals.set(key, (totals.get(key) ?? 0) + events);
    grandTotal += events;
  }
  if (!grandTotal) return [];
  return [...totals.entries()]
    .map(([value, events]) => ({ value, events, share: events / grandTotal }))
    .sort((a, b) => b.events - a.events)
    .slice(0, topN);
};
