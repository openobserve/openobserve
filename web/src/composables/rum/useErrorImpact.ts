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

import { computed } from "vue";
import useErrorIssuesData from "@/composables/rum/useErrorIssuesData";
import { escapeSqlString } from "@/utils/rum/errorIssueUtils";

/**
 * Impact metrics for a SINGLE error issue on the detail page.
 *
 * Rather than duplicate query/pivot logic, this scopes the existing
 * `useErrorIssuesData` aggregation to one issue by passing the issue's
 * signature (type + message + handling) as the `userQuery` WHERE-fragment.
 * The list page already builds occurrences, users-affected, crash-free %,
 * the stacked histogram and deploy detection from that same call — here it
 * simply returns for one signature instead of all of them.
 */

/** Fields that together identify an issue (must match errorIssueQueries). */
const SIGNATURE_FIELDS = [
  "error_type",
  "error_message",
  "error_handling",
] as const;

/** Fields the scoped queries reference; presence gates optional SELECTs. */
const SCHEMA_FIELDS = [
  "error_type",
  "error_message",
  "error_handling",
  "error_stack",
  "error_handling_stack",
  "error_id",
  "service",
  "view_url",
  "session_id",
  "usr_id",
  "usr_email",
  "version",
];

/** Trailing window for the trend/first-seen lookups, in microseconds (7d). */
const IMPACT_WINDOW_US = 7 * 24 * 60 * 60 * 1_000_000;

/**
 * WHERE-fragment pinning the query to this one issue signature. A field
 * absent from the record is omitted (it is not part of the grouping); an
 * explicitly null field matches with IS NULL.
 */
const buildSignatureClause = (error: Record<string, any>): string => {
  const parts: string[] = [];
  for (const field of SIGNATURE_FIELDS) {
    const value = error?.[field];
    if (value === undefined) continue;
    if (value === null) parts.push(`${field} IS NULL`);
    else parts.push(`${field} = '${escapeSqlString(String(value))}'`);
  }
  return parts.join(" AND ");
};

/** Schema presence map derived from the fields carried on the record. */
const buildSchema = (error: Record<string, any>): Record<string, boolean> => {
  const schema: Record<string, boolean> = {};
  for (const field of SCHEMA_FIELDS) {
    if (error?.[field] !== undefined) schema[field] = true;
  }
  return schema;
};

const useErrorImpact = () => {
  const {
    issues,
    chartSeries,
    latestDeploy,
    deploySpikeFactor,
    kpis,
    isLoadingIssues,
    isLoadingChart,
    isLoadingKpis,
    fetchAll,
  } = useErrorIssuesData();

  /** The single grouped issue row for this signature (undefined until loaded). */
  const issue = computed(() => issues.value[0]);

  const isLoading = computed(
    () =>
      isLoadingIssues.value || isLoadingChart.value || isLoadingKpis.value,
  );

  const metrics = computed(() => {
    const row = issue.value;
    return {
      occurrences: row?.events ?? 0,
      usersAffected: row?.users_affected ?? kpis.value.usersAffected,
      totalUsers: kpis.value.totalUsers,
      sessionsAffected: row?.sessions_affected ?? kpis.value.errorSessions,
      crashFreePct: kpis.value.crashFreePct,
      firstSeen: row?.first_seen ?? 0,
      lastSeen: row?.zo_sql_timestamp ?? 0,
      status: row?.status ?? "ongoing",
    };
  });

  /**
   * Load impact metrics for the given error record. The window trails the
   * more recent of "now" and the error's own timestamp so both historical
   * fixtures and live errors surface a meaningful trend.
   */
  const loadForError = (
    error: Record<string, any>,
    service = "",
  ): Promise<void> => {
    const signature = buildSignatureClause(error);
    if (!signature) return Promise.resolve();

    const errorTs = Number(error?._timestamp) || 0;
    const endTime = Math.max(errorTs, Date.now() * 1000);
    const startTime = endTime - IMPACT_WINDOW_US;

    return fetchAll({
      startTime,
      endTime,
      schema: buildSchema(error),
      userQuery: signature,
      service,
    });
  };

  return {
    issue,
    metrics,
    chartBuckets: chartSeries,
    latestDeploy,
    deploySpikeFactor,
    isLoading,
    loadForError,
  };
};

export default useErrorImpact;
