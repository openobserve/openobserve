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

import type { I18nKey } from "@/types/i18n";
import type { MeterKey } from "./meteringModel";
import { PRICED_EVENTS, priceCaseSql, type CyclePrice } from "./trendsModel";

/** The org's own self-reporting stream. Matches the backend constant `USAGE_STREAM`. */
export const USAGE_STREAM_NAME = "usage";

export const DRILLDOWN_LIMIT = 10;

export interface DrilldownSection {
  id: string;
  /** Chip label when a meter has more than one breakdown. */
  labelKey: I18nKey;
  /** Header of the grouping column. */
  columnKey: I18nKey;
  /** Fields this query reads beyond `event` and `size`; an absent field would fail the query. */
  requiredFields: string[];
  /** The `usage` event this section counts, which is also the denominator for its share. */
  event: string;
  /** SQL for the entity name; may differ from `groupBy` when the name is derived. */
  expression: string;
  groupBy: string;
  /** Extra filter beyond the event, e.g. excluding searches that came from alerts. */
  where: string;
  /** AI credit and synthetics step events write a count into `size`, not megabytes. */
  unit?: "mb" | "count";
  /** Header of the quantity column when `size` is a count. */
  quantityKey?: I18nKey;
  sql: (orgId: string) => string;
}

type SectionSpec = Omit<DrilldownSection, "sql">;

function escapeLiteral(value: string): string {
  return String(value).replace(/'/g, "''");
}

/** Counts from this moment (microseconds) when a chart's window opens earlier, at a day boundary. */
function sinceClause(since?: number): string {
  return since ? ` AND _timestamp >= ${Math.floor(since)}` : "";
}

function sectionWhere(orgId: string, spec: SectionSpec): string {
  const extra = spec.where ? ` and ${spec.where}` : "";
  return `org_id = '${escapeLiteral(orgId)}' and event = '${escapeLiteral(spec.event)}'${extra}`;
}

/** Every breakdown returns the same two columns, so one table renders all of them. */
function section(spec: SectionSpec): DrilldownSection {
  return {
    ...spec,
    sql: (orgId) =>
      `select ${spec.expression} as name, sum(size) as volume from "${USAGE_STREAM_NAME}" ` +
      `where ${sectionWhere(orgId, spec)} ` +
      `group by ${spec.groupBy} order by volume desc limit ${DRILLDOWN_LIMIT}`,
  };
}

/** AI credit events carry the feature and the incident inside `request_body`. */
const AI_FEATURE = "json_get_str(request_body, 'feature')";

const AI_INCIDENT_ID = "json_get_str(request_body, 'incident_id')";

const byStream = (event: string, where = ""): DrilldownSection =>
  section({
    id: "stream",
    labelKey: "billing.usageV2.byStream",
    columnKey: "billing.usageV2.colStream",
    requiredFields: ["stream_name"],
    event,
    expression: "stream_name",
    groupBy: "stream_name",
    where,
  });

/** Synthetics rows carry the check id in `stream_name`; the table resolves it to the check's name. */
const byCheck = (event: string): DrilldownSection =>
  section({
    id: "check",
    labelKey: "billing.usageV2.byCheck",
    columnKey: "billing.usageV2.colCheck",
    requiredFields: ["stream_name"],
    event,
    expression: "stream_name",
    groupBy: "stream_name",
    where: "",
    unit: "count",
    quantityKey: "billing.usageV2.colSteps",
  });

export const DRILLDOWNS: Partial<Record<MeterKey, DrilldownSection[]>> = {
  ingestion: [byStream("Ingestion")],
  query: [
    byStream("Search", "stream_name is not null and stream_name != ''"),
    section({
      id: "user",
      labelKey: "billing.usageV2.byUser",
      columnKey: "billing.usageV2.colUser",
      requiredFields: ["user_email", "alert_name", "dashboard_name", "derived_stream_key"],
      event: "Search",
      expression: "user_email",
      groupBy: "user_email",
      where: "alert_name is null and dashboard_name is null and derived_stream_key is null",
    }),
    section({
      id: "alert",
      labelKey: "billing.usageV2.byAlert",
      columnKey: "billing.usageV2.colAlert",
      requiredFields: ["alert_name"],
      event: "Search",
      expression: "alert_name",
      groupBy: "alert_name",
      where: "alert_name is not null",
    }),
    section({
      id: "dashboard",
      labelKey: "billing.usageV2.byDashboard",
      columnKey: "billing.usageV2.colDashboard",
      requiredFields: ["dashboard_name"],
      event: "Search",
      expression: "dashboard_name",
      groupBy: "dashboard_name",
      where: "dashboard_name is not null",
    }),
    section({
      id: "scheduled",
      labelKey: "billing.usageV2.byScheduledPipeline",
      columnKey: "billing.usageV2.colScheduledPipeline",
      requiredFields: ["derived_stream_key"],
      event: "Search",
      expression: "string_to_list(derived_stream_key, '/')[3]",
      groupBy: "derived_stream_key",
      where: "derived_stream_key is not null",
    }),
  ],
  pipeline: [
    section({
      id: "pipeline",
      labelKey: "billing.usageV2.byPipeline",
      columnKey: "billing.usageV2.colPipeline",
      requiredFields: ["stream_name"],
      event: "Pipeline",
      expression: "stream_name",
      groupBy: "stream_name",
      where: "",
    }),
  ],
  remote_pipeline: [
    section({
      id: "destination",
      labelKey: "billing.usageV2.byDestination",
      columnKey: "billing.usageV2.colDestination",
      requiredFields: ["stream_name"],
      event: "RemotePipeline",
      expression: "stream_name",
      groupBy: "stream_name",
      where: "",
    }),
  ],
  ai: [
    section({
      id: "user",
      labelKey: "billing.usageV2.byUser",
      columnKey: "billing.usageV2.colUser",
      requiredFields: ["user_email", "request_body"],
      event: "AiCredits",
      expression: "user_email",
      groupBy: "user_email",
      where: `${AI_FEATURE} = 'ai_chat'`,
      unit: "count",
      quantityKey: "billing.usageV2.colCredits",
    }),
    section({
      id: "incident",
      labelKey: "billing.usageV2.byIncident",
      columnKey: "billing.usageV2.colIncident",
      requiredFields: ["request_body"],
      event: "AiCredits",
      expression: AI_INCIDENT_ID,
      groupBy: AI_INCIDENT_ID,
      where: `${AI_FEATURE} = 'new_incident'`,
      unit: "count",
      quantityKey: "billing.usageV2.colCredits",
    }),
  ],
  synthetics_browser: [byCheck("SyntheticsBrowserSteps")],
  synthetics_protocol: [byCheck("SyntheticsProtocolSteps")],
};

const DAILY_ENTITY_ROWS = 100_000;

/** Daily cost per entity; the chart keeps the top few itself, so it need not wait for the table's ranking. */
export function dailyEntitySql(
  orgId: string,
  spec: DrilldownSection,
  rate: number,
  since?: number,
): string {
  return (
    `SELECT histogram(_timestamp, '1 day') as "x_axis_1", ` +
    `sum(size) * ${rate} as "y_axis_1", ${spec.expression} as "breakdown_1" ` +
    `FROM "${USAGE_STREAM_NAME}" WHERE ${sectionWhere(orgId, spec)}${sinceClause(since)} ` +
    `GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC LIMIT ${DAILY_ENTITY_ROWS}`
  );
}

/** Cost per event per bucket, each row priced by the cycle it falls in; SQL multiplies because the panel owns the query. */
/** `orgId` null counts every org in the stream, which is a super org's whole group. */
export function trendsCostSql(
  orgId: string | null,
  prices: CyclePrice[],
  bucket: string,
  events: string[] = PRICED_EVENTS,
  /** Also return each bucket's raw volume, read in the same pass, for the Volume view. */
  withVolume = false,
  since?: number,
): string {
  const inList = events.map((event) => `'${escapeLiteral(event)}'`).join(", ");
  return (
    `SELECT histogram(_timestamp, '${escapeLiteral(bucket)}') as "x_axis_1", ` +
    `sum(size * ${priceCaseSql(prices, events)}) as "y_axis_1", ` +
    (withVolume ? `sum(size) as "volume", ` : "") +
    `event as "breakdown_1" FROM "${USAGE_STREAM_NAME}" ` +
    `WHERE ${orgId === null ? "" : `org_id = '${escapeLiteral(orgId)}' AND `}` +
    `event IN (${inList})${sinceClause(since)} GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`
  );
}

/** Each event's volume over the query window, for an org with usage but no bill. */
export function eventVolumeSql(orgId: string, events: string[] = PRICED_EVENTS): string {
  const inList = events.map((event) => `'${escapeLiteral(event)}'`).join(", ");
  return (
    `select event, sum(size) as volume from "${USAGE_STREAM_NAME}" ` +
    `where org_id = '${escapeLiteral(orgId)}' and event in (${inList}) group by event`
  );
}

/** Each event's volume per day, the Volume chart of an org with usage but no bill. */
export function dailyVolumeSql(orgId: string, events: string[]): string {
  const inList = events.map((event) => `'${escapeLiteral(event)}'`).join(", ");
  return (
    `SELECT histogram(_timestamp, '1 day') as "x_axis_1", sum(size) as "y_axis_1", ` +
    `event as "breakdown_1" FROM "${USAGE_STREAM_NAME}" ` +
    `WHERE org_id = '${escapeLiteral(orgId)}' AND event IN (${inList}) ` +
    `GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`
  );
}

/** Each org's volume per event across the stream; priced in code, since a cycle gives each event one rate. */
export function orgVolumeSql(events: string[] = PRICED_EVENTS): string {
  const inList = events.map((event) => `'${escapeLiteral(event)}'`).join(", ");
  return (
    `select org_id as name, event, sum(size) as volume from "${USAGE_STREAM_NAME}" ` +
    `where event in (${inList}) group by org_id, event`
  );
}

/** Daily cost per org, labelled by org name; an org missing from `orgs` folds into `otherLabel`. */
export function dailyOrgCostSql(
  prices: CyclePrice[],
  orgs: { id: string; name: string }[],
  otherLabel: string,
  events: string[] = PRICED_EVENTS,
  since?: number,
): string {
  const inList = events.map((event) => `'${escapeLiteral(event)}'`).join(", ");
  const names = orgs
    .map((org) => `when '${escapeLiteral(org.id)}' then '${escapeLiteral(org.name)}'`)
    .join(" ");
  const band = names
    ? `case org_id ${names} else '${escapeLiteral(otherLabel)}' end`
    : `'${escapeLiteral(otherLabel)}'`;
  return (
    `SELECT histogram(_timestamp, '1 day') as "x_axis_1", ` +
    `sum(size * ${priceCaseSql(prices, events)}) as "y_axis_1", ${band} as "breakdown_1" ` +
    `FROM "${USAGE_STREAM_NAME}" WHERE event IN (${inList})${sinceClause(since)} ` +
    `GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`
  );
}

/** The whole meter's stream volume, so a row's share is measured against the same source as the row. */
export function meterTotalSql(orgId: string, events: string[]): string {
  const inList = events.map((event) => `'${escapeLiteral(event)}'`).join(", ");
  return (
    `select sum(size) as total from "${USAGE_STREAM_NAME}" ` +
    `where org_id = '${escapeLiteral(orgId)}' and event in (${inList})`
  );
}

/** `null` reads every org in the stream: a super org's whole group, as its bill covers. */
const orgWhere = (orgId: string | null) =>
  orgId === null ? "where " : `where org_id = '${escapeLiteral(orgId)}' and `;

/** Estimator default: mean ingested megabytes per stream. Across a group, two orgs' `default` are two streams. */
export function averageStreamSizeSql(orgId: string | null): string {
  const stream = orgId === null ? "concat(org_id, '/', stream_name)" : "stream_name";
  return (
    `select sum(size) as total, count(distinct ${stream}) as streams ` +
    `from "${USAGE_STREAM_NAME}" ${orgWhere(orgId)}event = 'Ingestion'`
  );
}

export function searchScanSizeSql(orgId: string | null): string {
  return (
    `select sum(size) as total, count(distinct split_part(trace_id, '-', 1)) as searches ` +
    `from "${USAGE_STREAM_NAME}" ${orgWhere(orgId)}event = 'Search'`
  );
}

/** Drops a section whose grouping field is missing from the live schema, which would error. */
export function availableSections(
  sections: DrilldownSection[],
  schemaFields: Set<string>,
): DrilldownSection[] {
  if (!schemaFields.size) return sections;
  return sections.filter((section) =>
    section.requiredFields.every((field) => schemaFields.has(field)),
  );
}
