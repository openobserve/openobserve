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
 * The fleet union — what turns a client-vantage list into an answer to "which
 * of my forty instances is unhealthy".
 *
 * The Databases page enumerates databases that APPLICATIONS talked to, so an
 * instance nobody queried in the window — an idle replica, a batch-only
 * database, a host provisioned an hour ago — does not appear at all. That is
 * not a gap in the data; it is what a client vantage IS, and it makes the
 * fleet question unanswerable by construction. Every instance the collector can
 * reach is therefore unioned in, carrying its health with its query columns
 * empty.
 *
 * Two rules the union must not break:
 *
 *  • A trafficless row states NO query figures. A zero would be a measurement
 *    the client vantage never made, and it would sort to the top of "fastest
 *    database" while claiming an idle replica served traffic instantly.
 *
 *  • `trafficless` records which vantage produced the row, never whether a
 *    figure happens to be present. Deriving it from a missing call count would
 *    label a real database nobody could measure as one nobody uses.
 *
 * Two reads can discover a trafficless instance: the metric streams, and the
 * server-vantage `dbm_server` rows the page already holds (activity samples,
 * blocking samples — each names the instance it was sampled on). The second
 * source is what saves the user who did all the collector setup but has no
 * APM: their instances are known ONLY to the server vantage, and without this
 * union the overview is empty while working data sits one tab away.
 *
 * A server-known instance carries only what its vantage measured — its
 * identity. Its metrics cell goes through the same resolver a client row's
 * does, so it states why the metrics read has nothing (`disabled`, `no-data`,
 * `unmatched`) rather than fabricating a figure. And with the metrics join
 * switched off (`context.enabled === false`) the metric streams contribute no
 * instances — that read never ran — but server-known instances still appear,
 * because their discovery never depended on it; their health column says
 * `disabled`, which is the truth about the read that was never made.
 */

import type { DbTotalsRow } from "@/services/db_monitoring";

import {
  instanceIdentityKey,
  metricsForSet,
  resolveRowMetrics,
  splitIdentityKey,
  type DbmInstanceMetricSet,
  type DbmMergeContext,
  type DbmRowMetrics,
} from "./instanceMetrics";

export interface DbmFleetInstance {
  key: string;
  db_system: string;
  db_instance: string;
  metrics: DbmInstanceMetricSet;
}

/**
 * An instance as a `dbm_server` row names it — identity and nothing else.
 * That is all the shape carries on purpose: the server vantage measured no
 * query figure and no metric series for the union to state, so no field
 * exists for one to be fabricated into.
 */
export interface DbmServerInstanceRef {
  db_system?: string | null;
  db_instance?: string | null;
}

export type DbmFleetRow = Partial<DbTotalsRow> & {
  db_system: string;
  db_instance: string;
  rowKey: string;
  /** The receiver reports it, but no application queried it in this window. */
  trafficless: boolean;
  metrics?: DbmRowMetrics;
};

/**
 * A client row's identity: its own grain, which includes the namespace.
 * NUL separates the parts, matching `totalsKey`: it is the one byte that
 * cannot appear in a host or database name, so no two distinct rows can spell
 * the same key.
 */
const clientRowKey = (row: DbTotalsRow): string =>
  `db\u0000${row.db_system}\u0000${row.db_instance}\u0000${row.db_namespace ?? ""}`;

/**
 * A trafficless row's identity. Prefixed differently from a client row so the
 * two namespaces can never collide, however an instance happens to be named.
 */
const fleetRowKey = (key: string): string => `fleet\u0000${key}`;

/** Every instance the metrics read found, back in row terms. */
export const fleetInstances = (
  metricsByKey: Map<string, DbmInstanceMetricSet>,
): DbmFleetInstance[] => {
  const instances: DbmFleetInstance[] = [];
  for (const [key, metrics] of metricsByKey) {
    const parts = splitIdentityKey(key);
    if (!parts) continue;
    instances.push({ key, db_system: parts.system, db_instance: parts.host, metrics });
  }
  return instances;
};

/**
 * Client-vantage rows first, then every receiver instance none of them
 * matched.
 *
 * The client rows keep their order and their figures: a user arriving at the
 * page sees exactly what they saw before, with the fleet appended rather than
 * interleaved. Under a pooler the same instance legitimately appears twice —
 * the address the client dialled, whose metrics are unmatched, and the real
 * host the receiver scrapes, which has no traffic — because collapsing them
 * would assert a link we cannot prove.
 */
export const unionFleetRows = (
  rows: DbTotalsRow[],
  metricsByKey: Map<string, DbmInstanceMetricSet>,
  context: DbmMergeContext & {
    system?: string | null;
    /** Instances `dbm_server` rows name — the second discovery source. */
    serverInstances?: readonly DbmServerInstanceRef[];
  } = {},
): DbmFleetRow[] => {
  // The engine filter reaches the client rows as a request param, so it has to
  // be applied to the discovered instances here or the page shows MySQL rows
  // under a chip that says Postgres.
  const engine = context.system?.trim().toLowerCase() || null;
  const claimed = new Set<string>();
  const clientRows: DbmFleetRow[] = rows.map((row) => {
    const key = instanceIdentityKey(row.db_system, row.db_instance);
    if (key) claimed.add(key);
    return {
      ...row,
      // The client grain includes the NAMESPACE — one host serving two
      // databases is two rows — while an instance identity does not. Keying a
      // client row on the identity would collapse those two onto one id and
      // render one of them twice.
      rowKey: clientRowKey(row),
      trafficless: false,
      metrics: resolveRowMetrics(row.db_system, row.db_instance, metricsByKey, context),
    };
  });

  // Both non-client vantages, folded onto one identity key so an instance
  // they both report appears exactly once — with the metric set when the
  // metrics read has one, and `null` when only a `dbm_server` row names it.
  const discovered = new Map<string, DbmInstanceMetricSet | null>();
  for (const instance of fleetInstances(metricsByKey)) {
    discovered.set(instance.key, instance.metrics);
  }
  for (const server of context.serverInstances ?? []) {
    const key = instanceIdentityKey(server.db_system, server.db_instance);
    if (key && !discovered.has(key)) discovered.set(key, null);
  }

  const trafficless: DbmFleetRow[] = [];
  for (const key of [...discovered.keys()].sort((a, b) => a.localeCompare(b))) {
    if (claimed.has(key)) continue;
    const parts = splitIdentityKey(key);
    if (!parts) continue;
    if (engine && parts.system !== engine) continue;
    const set = discovered.get(key);
    trafficless.push({
      db_system: parts.system,
      db_instance: parts.host,
      rowKey: fleetRowKey(key),
      trafficless: true,
      // A server-known instance states no metric figure the metrics read never
      // made: it goes through the same resolver a client row does, so its cell
      // says WHY there is nothing — disabled, no-data, or unmatched — instead
      // of carrying a number from a vantage that never measured one.
      metrics: set
        ? metricsForSet(parts.system, set)
        : resolveRowMetrics(parts.system, parts.host, metricsByKey, context),
    });
  }

  return [...clientRows, ...trafficless];
};
