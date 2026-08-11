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

import type { DbTotalsRow } from "@/services/db_monitoring";

import type { DbmInstanceMetricSet } from "./instanceMetrics";
import { fleetInstances, unionFleetRows } from "./fleetRows";

const totalsRow = (overrides: Partial<DbTotalsRow> = {}): DbTotalsRow =>
  ({
    db_system: "postgresql",
    db_instance: "pgprod-1",
    calls: 10,
    total_time_ns: 1000,
    ...overrides,
  }) as DbTotalsRow;

const metrics = (over: Partial<DbmInstanceMetricSet> = {}): DbmInstanceMetricSet => ({
  connections: {
    latest: 20,
    series: [18, 20],
    points: [
      { timestamp: 1, value: 18 },
      { timestamp: 2, value: 20 },
    ],
  },
  connectionLimit: { latest: 100, series: [100], points: [{ timestamp: 1, value: 100 }] },
  ...over,
});

// ── which instances the receiver knows about ─────────────────────────────────

describe("fleetInstances", () => {
  it("lists every instance identity the metrics read produced", () => {
    const found = fleetInstances(
      new Map([
        ["postgresql|pgprod-1", metrics()],
        ["mysql|myprod-1", metrics()],
      ]),
    );
    expect(found.map((i) => i.key).sort()).toEqual(["mysql|myprod-1", "postgresql|pgprod-1"]);
  });

  it("recovers the system and host from the identity key so a row can be rendered", () => {
    const [instance] = fleetInstances(new Map([["postgresql|pgprod-1.example.com", metrics()]]));
    expect(instance).toMatchObject({
      db_system: "postgresql",
      db_instance: "pgprod-1.example.com",
    });
  });

  // An IPv6 host contains colons, and the key's separator must not be one of
  // them or the host comes back truncated at its first colon.
  it("recovers an IPv6 host whole", () => {
    const [instance] = fleetInstances(new Map([["postgresql|2001:db8::1", metrics()]]));
    expect(instance.db_instance).toBe("2001:db8::1");
  });

  it("is empty when the metrics read produced nothing", () => {
    expect(fleetInstances(new Map())).toEqual([]);
  });
});

// ── the union that closes the "40 instances" question ────────────────────────
//
// The Databases page enumerates databases APPLICATIONS talked to. An idle
// replica or a batch-only host never appears, so "which of my instances is
// unhealthy" is unanswerable by construction. The union adds every instance the
// collector can reach.

describe("unionFleetRows", () => {
  it("keeps a client-vantage row that the receiver also reports, without duplicating it", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_instance: "pgprod-1" })],
      new Map([["postgresql|pgprod-1", metrics()]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].trafficless).toBe(false);
  });

  it("adds an instance the receiver reports that no application queried", () => {
    const rows = unionFleetRows([], new Map([["postgresql|idle-replica", metrics()]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      db_system: "postgresql",
      db_instance: "idle-replica",
      trafficless: true,
    });
  });

  // A trafficless row has no calls to report. A `0` would be a measurement the
  // client vantage never made — it would rank the row as the fastest database
  // in the fleet and put it top of a p95 sort.
  it("states no query figures on a trafficless row rather than zeroes", () => {
    const [row] = unionFleetRows([], new Map([["postgresql|idle-replica", metrics()]]));
    expect(row.calls).toBeUndefined();
    expect(row.total_time_ns).toBeUndefined();
    expect(row.p95_ns).toBeUndefined();
    expect(row.errors).toBeUndefined();
  });

  // `trafficless` must record PROVENANCE — which vantage produced the row —
  // not be derived from whether a figure happens to be present. A real client
  // row whose call count is missing is not an idle replica, and labelling it
  // one tells the reader nobody is using a database their apps depend on.
  it("keeps a client-vantage row with no call count out of the trafficless bucket", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_instance: "busy-1", calls: undefined, total_time_ns: undefined })],
      new Map(),
    );
    expect(rows[0].trafficless).toBe(false);
  });

  // The fleet is mixed-engine, and MySQL publishes no connection limit, so its
  // saturation can only ever be `no-limit`. A union that renders only the
  // engine with a ratio answers "which of my 40 instances is unhealthy" for
  // half the fleet and silently drops the rest.
  it("adds trafficless instances of both engines, MySQL's without a ratio", () => {
    const rows = unionFleetRows(
      [],
      new Map([
        ["postgresql|pgprod-1", metrics()],
        [
          "mysql|myprod-1",
          { connections: { latest: 20, series: [20], points: [{ timestamp: 1, value: 20 }] } },
        ],
      ]),
    );
    expect(rows).toHaveLength(2);
    const my = rows.find((r) => r.db_system === "mysql");
    expect(my?.trafficless).toBe(true);
    expect(my?.metrics?.saturation).toEqual({
      state: "no-limit",
      used: 20,
      limit: null,
      ratio: null,
    });
  });

  it("carries the receiver's metrics onto the trafficless row — that is its whole value", () => {
    const [row] = unionFleetRows([], new Map([["postgresql|idle-replica", metrics()]]));
    expect(row.metrics?.state).toBe("matched");
    expect(row.metrics?.saturation.ratio).toBeCloseTo(0.2, 10);
  });

  it("puts the client-vantage rows first, so the page a user knows is unchanged on arrival", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_instance: "busy-1" })],
      new Map([
        ["postgresql|idle-replica", metrics()],
        ["postgresql|busy-1", metrics()],
      ]),
    );
    expect(rows.map((r) => r.db_instance)).toEqual(["busy-1", "idle-replica"]);
  });

  it("matches through the port and case difference the two vantages disagree on", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_instance: "PGProd-1" })],
      new Map([["postgresql|pgprod-1", metrics()]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].trafficless).toBe(false);
  });

  it("does not fold a MySQL instance into a Postgres one of the same host", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_system: "mysql", db_instance: "shared-host" })],
      new Map([["postgresql|shared-host", metrics()]]),
    );
    expect(rows).toHaveLength(2);
  });

  // The client grain is (system, instance, NAMESPACE) — one host serving two
  // databases is two rows — while an instance identity has no namespace in it.
  // Keying the client rows on identity alone therefore collapses two real rows
  // onto one id, and the table renders one of them twice.
  it("gives two databases on one host distinct keys", () => {
    const rows = unionFleetRows(
      [
        totalsRow({ db_instance: "pgprod-1", db_namespace: "app" }),
        totalsRow({ db_instance: "pgprod-1", db_namespace: "jobs" }),
      ],
      new Map([["postgresql|pgprod-1", metrics()]]),
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
    // Both are the same instance, so both legitimately carry its metrics.
    expect(rows.every((r) => r.metrics?.state === "matched")).toBe(true);
  });

  // Keyed on the host alone, the two same-host rows from the line above
  // collide and the table renders one of them twice. The engine has to be in
  // the key.
  it("gives every row a distinct key even when two engines share a host", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_system: "mysql", db_instance: "shared-host" })],
      new Map([["postgresql|shared-host", metrics()]]),
    );
    const keys = rows.map((r) => r.rowKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(Boolean)).toBe(true);
  });

  // The PgBouncer topology, end to end: the client talked to the pooler, the
  // receiver scrapes the real host, and neither knows about the other. Both
  // must appear — the pooler row saying its metrics are unmatched, the real
  // host as a trafficless instance — because collapsing them would assert a
  // link we cannot prove, and dropping either loses half the picture.
  it("shows the pooler row and the real host as two rows under pooler indirection", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_instance: "pgbouncer.internal" })],
      new Map([["postgresql|pgprod-1", metrics()]]),
    );
    expect(rows).toHaveLength(2);
    const pooler = rows.find((r) => r.db_instance === "pgbouncer.internal");
    const real = rows.find((r) => r.db_instance === "pgprod-1");
    expect(pooler?.trafficless).toBe(false);
    expect(pooler?.metrics?.state).toBe("unmatched");
    expect(pooler?.metrics?.unmatchedReason).toBe("pooler");
    expect(real?.trafficless).toBe(true);
    expect(real?.metrics?.state).toBe("matched");
  });

  it("returns the client rows untouched when the metrics read produced nothing", () => {
    const rows = unionFleetRows([totalsRow({ db_instance: "busy-1" })], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].trafficless).toBe(false);
    expect(rows[0].metrics?.state).toBe("no-data");
  });

  it("returns nothing when neither vantage saw anything", () => {
    expect(unionFleetRows([], new Map())).toEqual([]);
  });

  // The engine filter is a request param, so the server applies it to the
  // client rows only. Appending every discovered instance regardless would put
  // MySQL rows on screen under a chip that says "postgresql" — a filter that
  // lies is worse than no filter.
  it("honours an engine filter for the instances it discovers", () => {
    const rows = unionFleetRows(
      [],
      new Map([
        ["postgresql|pgprod-1", metrics()],
        ["mysql|myprod-1", metrics()],
      ]),
      { system: "postgresql" },
    );
    expect(rows.map((r) => r.db_instance)).toEqual(["pgprod-1"]);
  });

  it("adds every engine when no filter is set", () => {
    const rows = unionFleetRows(
      [],
      new Map([
        ["postgresql|pgprod-1", metrics()],
        ["mysql|myprod-1", metrics()],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("keeps a client row whose host cannot be resolved rather than dropping it", () => {
    const rows = unionFleetRows(
      [totalsRow({ db_instance: "" })],
      new Map([["postgresql|idle-replica", metrics()]]),
    );
    expect(rows).toHaveLength(2);
  });

  it("adds several trafficless instances in a stable order", () => {
    const rows = unionFleetRows(
      [],
      new Map([
        ["postgresql|c", metrics()],
        ["postgresql|a", metrics()],
        ["postgresql|b", metrics()],
      ]),
    );
    expect(rows.map((r) => r.db_instance)).toEqual(["a", "b", "c"]);
  });
});

// ── the join switched off ────────────────────────────────────────────────────
//
// The metrics read is the ONLY thing that discovers a trafficless instance:
// the query vantage cannot see an instance nobody queried, by construction. So
// with the join off the union is honestly the client rows and nothing else,
// and the health column has to SAY that rather than leaving a blank cell that
// reads as "this feature is broken".

describe("unionFleetRows when the join is switched off", () => {
  it("marks the client rows disabled rather than accusing the receiver", () => {
    const rows = unionFleetRows([totalsRow({ db_instance: "busy-1" })], new Map(), {
      enabled: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metrics?.state).toBe("disabled");
    expect(rows[0].metrics?.unmatchedReason).toBeNull();
  });

  // The honest consequence of the knob being off: discovery is exactly what
  // was switched off, so no trafficless row can exist. Inventing one from any
  // other source would be a discovery mechanism nobody built.
  it("discovers no trafficless instance, because the read that finds them never ran", () => {
    const rows = unionFleetRows([totalsRow({ db_instance: "busy-1" })], new Map(), {
      enabled: false,
    });
    expect(rows.every((row) => !row.trafficless)).toBe(true);
  });

  it("leaves the union unchanged when the join is on", () => {
    const rows = unionFleetRows([], new Map([["postgresql|idle-replica", metrics()]]), {
      enabled: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].trafficless).toBe(true);
  });
});
