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

import { raw } from "@/types/i18n";
import type { BulkReviewRequest, BulkRow } from "./useBulkReview";
import type { NotifyPick, TeamPick } from "./bulkTargets";

export type FolderIds = Record<string, string>;

// The fields callers pass from the analysis; the seeded harness streams carry these names.
const SCHEMAS: Record<string, string[]> = {
  logs: ["_timestamp", "service_name", "k8s_cluster", "k8s_namespace_name", "message"],
  traces: [
    "_timestamp",
    "service_name",
    "service_k8s_cluster_name",
    "service_k8s_namespace_name",
    "span_status",
    "duration",
  ],
};

const team = (name: string, ids: FolderIds): TeamPick =>
  ids[name]
    ? {
        name,
        folderId: ids[name],
        folderName: name,
        source: "folder",
        reason: raw(`Where ${name}'s alerts live.`),
      }
    : {
        name: "",
        folderId: "default",
        folderName: "default",
        source: "default",
        reason: raw("No team yet"),
      };

const notify = (...destinations: string[]): NotifyPick =>
  destinations.length
    ? { destinations, reason: raw(`${destinations[0]} gets these alerts.`) }
    : { destinations: [], reason: "none" };

const service = (
  key: string,
  svc: string,
  stream: { type: string; name: string },
  extra: Partial<BulkRow> & {
    cluster?: string | null;
    namespace?: string | null;
    schema?: string[] | null;
  },
): BulkRow => ({
  key,
  scope: {
    service: svc,
    cluster: extra.cluster ?? null,
    namespace: extra.namespace ?? null,
    stream,
    ...(extra.schema === null ? {} : { schema: extra.schema ?? SCHEMAS[stream.type] }),
  },
  usually: extra.usually ?? null,
  unsure: extra.unsure,
  minutes: extra.minutes,
  team: extra.team,
  notify: extra.notify,
});

const logs = (name: string) => ({ type: "logs", name });
const traces = (name: string) => ({ type: "traces", name });

/** The twelve services of the approved review mockup: five in ingest, four with no team, three in payments. */
export const m12Rows = (ids: FolderIds): BulkRow[] => {
  const ingest = { team: team("ingest", ids), notify: notify("ingest-oncall") };
  const none = { notify: notify("ops-webhook") };
  const payments = { team: team("payments", ids), notify: notify("payments-oncall") };
  return [
    service("ingest-b", "svc-ingest-b", logs("ingest_b"), { ...ingest, usually: 2400 }),
    service("ingest-c", "svc-ingest-c", logs("ingest_c"), { ...ingest, usually: 8100 }),
    service("ingest-d", "svc-ingest-d", logs("ingest_d"), { ...ingest, usually: 5600 }),
    service("ingest-e", "svc-ingest-e", logs("ingest_e"), { ...ingest, usually: 3900 }),
    service("ingest-f", "svc-ingest-f", logs("ingest_f"), { ...ingest, usually: 1200 }),
    service("a-none", "svc-a", logs("app_logs"), {
      ...none,
      usually: 40,
      minutes: 180,
      unsure: {
        reason: "Sends in bursts, often quiet for 2 hours, so the wait is longer.",
      },
    }),
    service("a-b", "svc-a", logs("app_logs"), { ...none, namespace: "ns-b", usually: 900 }),
    service("a-j", "svc-a", logs("app_logs"), { ...none, namespace: "ns-j", usually: 650 }),
    service("a-s", "svc-a", logs("app_logs"), { ...none, namespace: "ns-s", usually: 720 }),
    service("j", "svc-j", traces("app_traces"), { ...payments, usually: 3300 }),
    service("e-b", "svc-e", traces("app_traces"), {
      ...payments,
      cluster: "cluster-k",
      namespace: "ns-b",
      usually: 2700,
    }),
    service("e-c", "svc-e", traces("app_traces"), {
      ...payments,
      cluster: "cluster-k",
      namespace: "ns-c",
      usually: 1900,
    }),
  ];
};

/** Many rows across many teams, for the collapsed-groups state. */
export const manyRows = (ids: FolderIds, count = 400): BulkRow[] =>
  Array.from({ length: count }, (_, i) => {
    const teamName = `team-${String(i % 12).padStart(2, "0")}`;
    return service(`many-${i}`, `svc-${i}`, logs("app_logs"), {
      team: team(teamName, { ...ids, [teamName]: ids[teamName] ?? `${teamName}-folder` }),
      notify: notify(`${teamName}-oncall`),
      cluster: `cluster-${i % 5}`,
      namespace: `ns-${i % 7}`,
      usually: 100 + i,
    });
  });

/** Rows whose stream fields decide whether they can be created: read, missing or unreadable. */
export const fieldRows = (ids: FolderIds): BulkRow[] => {
  const ingest = { team: team("ingest", ids), notify: notify("ingest-oncall") };
  return [
    service("read-b", "svc-ingest-b", logs("ingest_b"), {
      ...ingest,
      namespace: "ns-b",
      schema: null,
      usually: 2400,
    }),
    service("no-cluster", "svc-ingest-c", logs("ingest_c"), {
      ...ingest,
      cluster: "cluster-k",
      schema: ["_timestamp", "service_name", "message"],
      usually: 8100,
    }),
    service("no-service", "svc-ingest-d", logs("ingest_d"), {
      ...ingest,
      schema: ["_timestamp", "message"],
      usually: 5600,
    }),
    service("unreadable", "svc-gone", logs("gone_logs"), {
      ...ingest,
      schema: null,
      usually: 300,
    }),
  ];
};

/** The members of one outage, as source no-data rows. */
export const sourceRows = (count = 7): BulkRow[] =>
  Array.from({ length: count }, (_, i) => ({
    key: `src-${i}`,
    scope: {
      stream: logs("k8s_events"),
      field: "k8s_cluster",
      value: i === 0 ? "cluster-d" : `host-${String.fromCharCode(98 + i)}`,
      cohortSize: count,
    },
    usually: 1000 * (count - i),
  }));

export const harnessRequest = (scenario: string, ids: FolderIds): BulkReviewRequest => {
  if (scenario === "one") return { kind: "no_data", rows: m12Rows(ids).slice(0, 1) };
  if (scenario === "many") return { kind: "no_data", rows: manyRows(ids) };
  if (scenario === "source") return { kind: "source", rows: sourceRows() };
  if (scenario === "fields") return { kind: "no_data", rows: fieldRows(ids) };
  return { kind: "no_data", rows: m12Rows(ids) };
};
