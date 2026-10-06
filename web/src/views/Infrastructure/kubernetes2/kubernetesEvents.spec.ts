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

import { describe, expect, it } from "vitest";
import {
  clusterFallbackSql,
  detailEventsSql,
  eventsSql,
  parseEvents,
  parseWarnings,
  warningListRows,
  warningSql,
} from "./kubernetesEvents";
import { buildInventory, type Series, type WarningEvent } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";

const EK =
  "PARTITION BY COALESCE(json_get_str(body_object_metadata,'uid'), k8s_namespace_name || '/' || event_name)";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

describe("kubernetesEvents SQL", () => {
  const scope = { cluster: "prod", namespaces: ["data", "o'brien"] };

  it("builds W: per involved object, Warning only, cluster and namespace scoped, no LIMIT", () => {
    const sql = warningSql(scope, "Pod", true);
    expect(sql).toContain(
      "FROM \"k8s_events\" WHERE body_object_kind = 'Event' AND body_object_type = 'Warning'",
    );
    expect(sql).toContain("AND k8s_cluster = 'prod'");
    expect(sql).toContain(
      "AND json_get_str(body_object_regarding,'namespace') IN ('data', 'o''brien')",
    );
    expect(sql).toContain("AND json_get_str(body_object_regarding,'kind') = 'Pod'");
    expect(sql).toContain(EK);
    expect(sql).toContain("GROUP BY kind, name, namespace, uid ORDER BY last_seen DESC");
    expect(sql).toContain("count(*) AS events, max(last_seen) AS last_seen");
    expect(sql).not.toContain("LIMIT");
  });

  it("omits the namespace term for cluster-scoped kinds and the kind term for the overview", () => {
    const sql = warningSql(scope, null, false);
    expect(sql).not.toContain("IN (");
    expect(sql).not.toContain("body_object_regarding,'kind') =");
  });

  it("builds E: one row per Event identity, newest first, capped", () => {
    const sql = eventsSql(scope, 1000);
    expect(sql).toContain(EK);
    expect(sql).toContain("WHERE rn = 1 ORDER BY _timestamp DESC LIMIT 1000");
    expect(sql).toContain(
      "json_get_str(body_object_regarding,'namespace') IN ('data', 'o''brien')",
    );
    expect(sql).not.toContain("body_object_type = 'Warning'");
  });

  it("drops the cluster term in the unscoped mode", () => {
    expect(eventsSql({ cluster: null, namespaces: [] }, 1000)).not.toContain("k8s_cluster");
  });

  it("builds DE on kind and name, plus namespace for namespaced kinds and uid when known", () => {
    const pod = detailEventsSql("prod", { kind: "pod", namespace: "data", name: "x", uid: "u1" });
    expect(pod).toContain("json_get_str(body_object_regarding,'kind') = 'Pod'");
    expect(pod).toContain("json_get_str(body_object_regarding,'name') = 'x'");
    expect(pod).toContain("json_get_str(body_object_regarding,'namespace') = 'data'");
    expect(pod).toContain("json_get_str(body_object_regarding,'uid') = 'u1'");
    expect(pod).toContain("ORDER BY _timestamp DESC LIMIT 100");
    const node = detailEventsSql("prod", { kind: "node", namespace: "", name: "n1", uid: null });
    expect(node).not.toContain("'namespace') =");
    expect(node).not.toContain("'uid') =");
  });

  it("precedes every LIMIT with ORDER BY … DESC", () => {
    for (const sql of [
      eventsSql(scope, 10),
      detailEventsSql("p", { kind: "pod", namespace: "a", name: "b", uid: null }),
    ]) {
      expect(sql).toMatch(/ORDER BY _timestamp DESC LIMIT \d+$/);
    }
  });

  it("lists clusters from the events stream as the last fallback", () => {
    expect(clusterFallbackSql()).toBe('SELECT DISTINCT k8s_cluster AS c FROM "k8s_events"');
  });
});

describe("parsing", () => {
  it("marks W truncated above 20,000 rows and keeps the first 20,000", () => {
    const hits = Array.from({ length: 20001 }, (_, i) => ({
      kind: "Pod",
      name: `p${i}`,
      events: 1,
      last_seen: i,
    }));
    const parsed = parseWarnings(hits, "prod");
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows).toHaveLength(20000);
    expect(parseWarnings(hits.slice(0, 1200), "prod")).toMatchObject({ truncated: false });
  });

  it("parses an Event: count from series, else deprecatedcount; the involved object's namespace", () => {
    const rows = parseEvents([
      {
        event_name: "x.1",
        k8s_namespace_name: "data",
        body_object_type: "Warning",
        body_object_reason: "BackOff",
        body_object_note: "Back-off",
        body_object_regarding: JSON.stringify({
          kind: "Pod",
          name: "x",
          namespace: "data",
          uid: "u",
        }),
        body_object_series: JSON.stringify({ count: 7, lastObservedTime: "2026-10-06T10:00:00Z" }),
        body_object_deprecatedcount: 1,
        body_object_reportingcontroller: "kubelet",
        body_object_reportinginstance: "ip-1",
        body_object_eventtime: "2026-10-06T09:00:00Z",
        _timestamp: 5,
      },
      {
        event_name: "n.1",
        k8s_namespace_name: "default",
        body_object_type: "Normal",
        body_object_regarding: JSON.stringify({ kind: "Node", name: "n1" }),
        body_object_deprecatedcount: 3,
        _timestamp: 9,
      },
    ]);
    expect(rows[0]).toMatchObject({
      type: "Warning",
      count: 7,
      source: "kubelet ip-1",
      object: { kind: "Pod", name: "x", namespace: "data", uid: "u" },
      firstSeen: Date.parse("2026-10-06T09:00:00Z") * 1000,
      lastSeen: Date.parse("2026-10-06T10:00:00Z") * 1000,
    });
    expect(rows[1]).toMatchObject({ count: 3, lastSeen: 9, object: { namespace: "" } });
  });

  it("keeps two Events with the same name in different namespaces as two rows", () => {
    const rows = parseEvents([
      { event_name: "e", k8s_namespace_name: "a", _timestamp: 1 },
      { event_name: "e", k8s_namespace_name: "b", _timestamp: 1 },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
});

describe("Cluster overview warnings", () => {
  const event = (extra: Partial<WarningEvent>): WarningEvent => ({
    cluster: "prod",
    kind: "Pod",
    name: "crash",
    namespace: "data",
    uid: "c-uid",
    events: 4,
    lastSeen: 100,
    reason: "BackOff",
    note: "Back-off restarting failed container",
    ...extra,
  });
  const crash = { namespace: "data", pod: "crash", uid: "c-uid" };
  const healthy = { namespace: "data", pod: "ok", uid: "ok-uid" };
  const inventory = buildInventory(
    results({
      P1: [ksm({ ...crash, phase: "Running" }), ksm({ ...healthy, phase: "Running" })],
      P11: [ksm({ ...crash, condition: "false" }), ksm({ ...healthy, condition: "true" })],
      P2: [ksm({ ...crash, container: "main", reason: "CrashLoopBackOff" })],
      N1: [
        ksm({ node: "n1", condition: "Ready", status: "true" }),
        ksm({ node: "n1", condition: "MemoryPressure", status: "true" }),
        ksm({ node: "n2", condition: "Ready", status: "false" }),
      ],
    }),
  );

  it("lists node conditions as Node rows, including a not-ready node", () => {
    const rows = warningListRows(inventory, [], "prod");
    expect(rows.map((r) => [r.object.kind, r.object.name, r.message])).toEqual([
      ["Node", "n1", { text: "MemoryPressure" }],
      ["Node", "n2", { key: "infra.k8s2.nodeIsNotReady" }],
    ]);
  });

  it("lists a BackOff on a crash-looping pod as a Pod row, never Event", () => {
    const rows = warningListRows(inventory, [event({})], "prod").filter(
      (r) => r.object.kind === "Pod",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message: { text: "Back-off restarting failed container" },
      lastSeen: 100,
    });
  });

  it("drops a pod event when the pod is Running and Ready, or absent from P1", () => {
    const rows = warningListRows(
      inventory,
      [event({ name: "ok", uid: "ok-uid" }), event({ name: "gone", uid: "g" })],
      "prod",
    );
    expect(rows.filter((r) => r.object.kind === "Pod")).toEqual([]);
  });

  it("merges a uid-bearing and a uid-less event on one pod into one row", () => {
    const rows = warningListRows(
      inventory,
      [event({ lastSeen: 10 }), event({ uid: "", lastSeen: 20, note: "newer" })],
      "prod",
    ).filter((r) => r.object.kind === "Pod");
    expect(rows).toHaveLength(1);
    expect(rows[0].message.text).toBe("newer");
  });

  it("keeps a warning on a kind with no drawer, such as a Service", () => {
    const rows = warningListRows(
      inventory,
      [event({ kind: "Service", name: "svc", uid: "" })],
      "prod",
    );
    expect(rows.some((r) => r.object.kind === "Service")).toBe(true);
  });
});
