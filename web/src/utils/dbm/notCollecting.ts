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

/**
 * The "not collecting" checklist the three server-vantage pages share.
 *
 * Activity, Blocked queries and Deadlocks all open their not-collecting empty
 * state with the same two diagnostics — is the rest of DBM answering (so the
 * problem is this feed, not the whole pipeline), and is the feature flag even
 * on — differing only in which i18n namespace phrases them. The third-and-on
 * entries genuinely differ per page (which prerequisite is missing: the
 * sampler, the database's own log) and stay with the page, appended after the
 * shared pair.
 */

import type { DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import type { TranslateFn } from "@/types/i18n";

/** The pages that render this checklist, by their i18n namespace. */
export type DbmNotCollectingNamespace = "activity" | "blocked" | "deadlocks";

export interface DbmNotCollectingSignals {
  /** Distinct statements the shared badge fan-out counted. `null` = unknown. */
  queryCount: number | null;
  /**
   * Databases the shared fan-out saw. `null` = unknown.
   *
   * ZERO IS NOT A DATABASE COUNT HERE. The fan-out's `databaseCount` is the
   * TRACE-vantage fleet row count, so a server-only org — collector recipes
   * wired, no APM anywhere — legitimately reports 0 while its databases are
   * reporting statements normally. Interpolating that 0 produced "50 kinds of
   * query from 0 databases", a sentence that contradicts itself and blames the
   * absence of tracing for a healthy deployment. See `detailFor` below.
   */
  databaseCount: number | null;
  /** Whether the org's DBM feature flag is on. */
  dbmEnabled: boolean;
}

/**
 * The shared pair, phrased in the page's namespace, plus the page's own
 * checks. `queryCount`'s unknown (`null`) counts as "no" here — the checklist
 * must not claim other feeds are answering on the strength of a read that
 * never landed.
 */
export const buildDbmNotCollectingChecks = (
  namespace: DbmNotCollectingNamespace,
  signals: DbmNotCollectingSignals,
  t: TranslateFn,
  extraChecks: DbmLockCheck[],
): DbmLockCheck[] => {
  const prefix = `dbm.${namespace}.notCollecting.checks`;
  const hasQueries = (signals.queryCount ?? 0) > 0;
  return [
    {
      id: "queries",
      status: hasQueries ? "ok" : "fail",
      title: hasQueries ? t(`${prefix}.queries.ok`) : t(`${prefix}.queries.no`),
      detail: hasQueries
        ? // The database clause is DROPPED when the trace vantage counted no
          // fleet rows, rather than printed as "from 0 databases". A
          // server-only org is the ordinary case for these three pages, and
          // the queries half of the sentence is true and useful on its own.
          signals.databaseCount
          ? t(`${prefix}.queries.okDetail`, {
              queries: t("dbm.queries.queryCount", signals.queryCount ?? 0),
              databases: t("dbm.databases.databaseCount", signals.databaseCount),
            })
          : t(`${prefix}.queries.okDetailNoFleet`, {
              queries: t("dbm.queries.queryCount", signals.queryCount ?? 0),
            })
        : t(`${prefix}.queries.noDetail`),
    },
    {
      id: "enabled",
      status: signals.dbmEnabled ? "ok" : "fail",
      title: signals.dbmEnabled ? t(`${prefix}.enabled.ok`) : t(`${prefix}.enabled.no`),
      detail: signals.dbmEnabled
        ? t(`${prefix}.enabled.okDetail`)
        : t(`${prefix}.enabled.noDetail`),
    },
    ...extraChecks,
  ];
};
