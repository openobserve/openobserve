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

import type { BlockingSample } from "@/services/db_monitoring";

import {
  buildWaitingRows,
  chainsFromSamples,
  DEFAULT_BLOCKING_PERSPECTIVE,
  flattenChains,
  IDLE_BLOCKER_SECONDS,
  isIdleBlocker,
  isNotablyLongestWait,
  resolveRoot,
  parseBlockingSample,
  parseBlockingSamples,
  rootBlockerPids,
  rootIdleSeconds,
  terminateStatement,
  totalWaitSeconds,
  waitEventKey,
} from "./blocking";

/**
 * The captured lab chain — proof doc §2.2. One root (1069) holds the lock;
 * 1070 waits on it and itself blocks three; 1074 blocks one more, making the
 * deepest path 3.
 *
 *   1069  root
 *   └─ 1070  4.8s
 *      ├─ 1074  3.3s
 *      │  └─ 1078  1.7s
 *      ├─ 1075  2.9s
 *      ├─ 1081  1.1s
 *      └─ 1083  0.6s
 */
const sample = (
  blocked: number,
  blocking: number | null,
  waitSeconds: number,
  overrides: Partial<BlockingSample> = {},
): BlockingSample => ({
  blocked_pid: blocked,
  blocking_pid: blocking,
  blocked_query: "UPDATE inventory SET qty = qty - 1 WHERE sku = ?",
  blocking_query: "UPDATE inventory SET qty = qty - 1, updated_at = now() WHERE sku = ?",
  blocked_application: "dbm-sv-lock-waiter",
  blocking_application: "dbm-sv-lock-holder",
  wait_event_type: "Lock",
  wait_event: "transactionid",
  wait_seconds: waitSeconds,
  db_system: "postgres",
  db_instance: "dbmlab",
  object: "inventory",
  ...overrides,
});

const LAB: BlockingSample[] = [
  sample(1070, 1069, 4.818, { blocker_idle_seconds: 31, blocker_is_root: true }),
  sample(1074, 1070, 3.3, { blocked_application: "checkout-service" }),
  sample(1078, 1074, 1.7, {
    blocked_application: "checkout-service",
    blocked_query: "UPDATE order_lines SET status = ? WHERE order_id = ?",
  }),
  sample(1075, 1070, 2.9, {
    blocked_application: "cart-service",
    blocked_query: "SELECT qty FROM inventory WHERE sku = ? FOR UPDATE",
  }),
  sample(1081, 1070, 1.1, { blocked_application: "cart-service" }),
  sample(1083, 1070, 0.6, {
    blocked_application: "reporting-service",
    blocked_query: "SELECT qty FROM inventory WHERE sku = ? FOR UPDATE",
  }),
];

describe("parseBlockingSample — the wire row", () => {
  /**
   * Captured verbatim from `GET .../db_monitoring/blocking`. The server emits
   * this module's own vocabulary — no `o2_dbm_*` prefix — so there is nothing
   * left to rename on arrival.
   */
  const wire: BlockingSample = {
    timestamp: 1786200066626000,
    blocked_application: "dbm-sv-deadlock-b",
    blocked_fingerprint: "ce76ca7eedfb7cff",
    blocked_pid: 144,
    blocked_query: "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    blocking_application: "dbm-sv-deadlock-a",
    blocking_pid: 143,
    blocking_query: "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    db_system: "postgresql",
    db_instance: "pg1",
    db_namespace: "dbmlab",
    wait_event: "transactionid",
    wait_event_type: "Lock",
    wait_seconds: 0.119,
  };

  it("passes the wire row through in the UI vocabulary", () => {
    const parsed = parseBlockingSample(wire);
    expect(parsed).toMatchObject({
      blocked_pid: 144,
      blocking_pid: 143,
      blocked_application: "dbm-sv-deadlock-b",
      blocking_application: "dbm-sv-deadlock-a",
      db_system: "postgresql",
      db_instance: "pg1",
      db_namespace: "dbmlab",
      wait_seconds: 0.119,
    });
  });

  it("drops a row with no waiting pid — it cannot be placed in a chain", () => {
    expect(
      parseBlockingSample({ ...wire, blocked_pid: undefined as unknown as number }),
    ).toBeNull();
    expect(
      parseBlockingSamples([wire, { blocked_pid: null } as unknown as BlockingSample]),
    ).toHaveLength(1);
  });

  it("keeps a root sample whose blocker is unknown", () => {
    const parsed = parseBlockingSample({ ...wire, blocking_pid: null });
    expect(parsed?.blocking_pid).toBeNull();
  });
});

describe("flattenChains against the server's NESTED shape", () => {
  /** The chain the server actually returns — a tree, not a flat waiter list. */
  const serverChain = {
    root: {
      pid: 143,
      app: "dbm-sv-deadlock-a",
      query: "UPDATE accounts SET balance = balance - ? WHERE id = ?",
      wait_seconds: 0.454,
      depth: 0,
      children: [
        {
          pid: 144,
          app: "dbm-sv-deadlock-b",
          query: "UPDATE accounts SET balance = balance - ? WHERE id = ?",
          wait_seconds: 0.455,
          depth: 1,
          children: [],
        },
      ],
    },
    root_pid: 143,
    root_app: "dbm-sv-deadlock-a",
    root_query: "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    blocked_count: 1,
    depth: 1,
    max_wait_seconds: 0.455,
    cyclic: true,
    engine: "postgresql",
    database: "dbmlab",
  };

  it("walks root.children into rows", () => {
    const rows = flattenChains([serverChain]);
    expect(rows.map((r) => r.pid)).toEqual([143, 144]);
    expect(rows[0].kind).toBe("root");
    expect(rows[1].kind).toBe("waiting");
    expect(rows[1].depth).toBe(1);
    expect(rows[1].waitingOnPid).toBe(143);
  });

  it("does not spin on a cyclic chain the sample caught mid-flight", () => {
    const cyclic = {
      ...serverChain,
      root: {
        ...serverChain.root,
        children: [{ ...serverChain.root.children[0], children: [serverChain.root] }],
      },
    };
    const rows = flattenChains([cyclic]);
    const pids = rows.map((r) => r.pid);
    expect(new Set(pids).size).toBe(pids.length);
  });

  it("survives a chain the server sent without a tree", () => {
    const rows = flattenChains([{ ...serverChain, root: undefined }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("root");
  });
});

describe("perspective default", () => {
  it("defaults to the waiting perspective — the incident arrives as 'my query is hanging'", () => {
    expect(DEFAULT_BLOCKING_PERSPECTIVE).toBe("waiting");
  });
});

describe("resolveRoot", () => {
  it("climbs multiple hops to the session that waits for nothing", () => {
    const blockers = new Map<number, number | null>(
      LAB.map((s) => [s.blocked_pid, s.blocking_pid]),
    );
    expect(resolveRoot(1078, blockers)).toEqual({ rootPid: 1069, depth: 3 });
    expect(resolveRoot(1074, blockers)).toEqual({ rootPid: 1069, depth: 2 });
    expect(resolveRoot(1070, blockers)).toEqual({ rootPid: 1069, depth: 1 });
  });

  it("terminates on a cycle rather than spinning", () => {
    // A sample taken mid-flight can capture a cycle the database is about to
    // resolve as a deadlock.
    const blockers = new Map<number, number | null>([
      [1, 2],
      [2, 1],
    ]);
    expect(() => resolveRoot(1, blockers)).not.toThrow();
    expect(resolveRoot(1, blockers).rootPid).toBe(1);
  });

  it("reports no root when the blocker is unknown", () => {
    expect(resolveRoot(1070, new Map([[1070, null]]))).toEqual({ rootPid: null, depth: 0 });
  });
});

describe("buildWaitingRows — the 'who's stuck' perspective", () => {
  it("keeps one row per waiting session, longest wait first", () => {
    const rows = buildWaitingRows(LAB);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.blocked_pid)).toEqual([1070, 1074, 1075, 1078, 1081, 1083]);
    expect(rows[0].wait_seconds).toBeCloseTo(4.818, 3);
  });

  it("resolves every row back to the one root", () => {
    expect(new Set(buildWaitingRows(LAB).map((r) => r.rootPid))).toEqual(new Set([1069]));
  });

  it("marks the rows whose blocker is itself waiting — the `2 deep` chip", () => {
    const byPid = new Map(buildWaitingRows(LAB).map((r) => [r.blocked_pid, r]));
    // 1070 waits on the root, so its blocker is NOT waiting.
    expect(byPid.get(1070)?.blockerIsWaiting).toBe(false);
    expect(byPid.get(1070)?.depth).toBe(1);
    // 1074 waits on 1070, which is itself stuck — the real culprit is further up.
    expect(byPid.get(1074)?.blockerIsWaiting).toBe(true);
    expect(byPid.get(1074)?.depth).toBe(2);
    expect(byPid.get(1078)?.depth).toBe(3);
  });

  it("scales the wait bar against the longest wait", () => {
    const rows = buildWaitingRows(LAB);
    expect(rows[0].waitShare).toBe(1);
    expect(rows[rows.length - 1].waitShare).toBeCloseTo(0.6 / 4.818, 3);
  });

  it("handles an empty sample set", () => {
    expect(buildWaitingRows([])).toEqual([]);
  });
});

describe("chainsFromSamples — the fallback when the server sends no chains[]", () => {
  it("finds the single root and attaches all six waiters", () => {
    const chains = chainsFromSamples(LAB);
    expect(chains).toHaveLength(1);
    expect(chains[0].root_pid).toBe(1069);
    expect(chains[0].blocked_count).toBe(6);
    expect(chains[0].depth).toBe(3);
  });

  it("recovers the root's identity from the blocking side of the samples", () => {
    const chain = chainsFromSamples(LAB)[0];
    expect(chain.root_app).toBe("dbm-sv-lock-holder");
    expect(chain.root_query).toContain("updated_at = now()");
    expect(rootIdleSeconds(chain, LAB)).toBe(31);
  });

  it("separates two independent roots", () => {
    const chains = chainsFromSamples([
      sample(20, 10, 2),
      sample(21, 10, 1),
      sample(30, 40, 5, { blocking_application: "other-holder" }),
    ]);
    expect(chains.map((c) => c.root_pid).sort((a, b) => a - b)).toEqual([10, 40]);
    // Ranked by how many sessions each root is holding up.
    expect(chains[0].root_pid).toBe(10);
    expect(chains[0].blocked_count).toBe(2);
  });
});

describe("flattenChains — the tree as table rows", () => {
  const rows = flattenChains(chainsFromSamples(LAB));

  it("emits one row per session, root first, depth-first", () => {
    expect(rows.map((r) => r.pid)).toEqual([1069, 1070, 1074, 1078, 1075, 1081, 1083]);
  });

  it("indents by chain depth", () => {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    expect(byPid.get(1069)?.depth).toBe(0);
    expect(byPid.get(1070)?.depth).toBe(1);
    expect(byPid.get(1074)?.depth).toBe(2);
    expect(byPid.get(1078)?.depth).toBe(3);
  });

  it("assigns the three pills — root, waiting-and-blocking, waiting", () => {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    expect(byPid.get(1069)?.kind).toBe("root");
    // The middle of the chain: both a victim and a cause.
    expect(byPid.get(1070)?.kind).toBe("waiting-blocking");
    expect(byPid.get(1074)?.kind).toBe("waiting-blocking");
    // Leaves.
    expect(byPid.get(1078)?.kind).toBe("waiting");
    expect(byPid.get(1083)?.kind).toBe("waiting");
  });

  it("counts everything stuck below each row, at every depth", () => {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    expect(byPid.get(1069)?.blockingCount).toBe(6);
    expect(byPid.get(1070)?.blockingCount).toBe(5);
    expect(byPid.get(1074)?.blockingCount).toBe(1);
    expect(byPid.get(1078)?.blockingCount).toBe(0);
  });

  it("names what each row is waiting on, and nothing for the root", () => {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    expect(byPid.get(1069)?.waitingOnPid).toBeNull();
    expect(byPid.get(1069)?.waitSeconds).toBeNull();
    expect(byPid.get(1070)?.waitingOnPid).toBe(1069);
    expect(byPid.get(1078)?.waitingOnPid).toBe(1074);
  });

  it("draws the connector rails — an ancestor with more siblings keeps its rail", () => {
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    // Depth-1 rows have no ancestor rail above them.
    expect(byPid.get(1070)?.rails).toEqual([]);
    // 1074 is not the last child of 1070, so its own rail continues for 1078.
    expect(byPid.get(1074)?.isLast).toBe(false);
    // One flag per ancestor level: 1070 is the root's only child so its rail
    // stops (false), while 1074 still has siblings below it (true).
    expect(byPid.get(1078)?.rails).toEqual([false, true]);
    // 1083 is the last child of 1070 — its rail stops at the elbow.
    expect(byPid.get(1083)?.isLast).toBe(true);
  });

  it("sorts siblings by wait time, so the worst-hit branch reads first", () => {
    const siblings = rows.filter((r) => r.waitingOnPid === 1070).map((r) => r.pid);
    expect(siblings).toEqual([1074, 1075, 1081, 1083]);
  });

  it("does not revisit a session inside a cycle", () => {
    const cyclic = [sample(1, 2, 1), sample(2, 1, 1)];
    const flattened = flattenChains(chainsFromSamples(cyclic));
    const pids = flattened.map((r) => r.pid);
    expect(new Set(pids).size).toBe(pids.length);
  });

  it("returns nothing for no chains", () => {
    expect(flattenChains([])).toEqual([]);
  });
});

describe("chain summary numbers", () => {
  it("totals the time lost across every waiting session", () => {
    expect(totalWaitSeconds(LAB)).toBeCloseTo(14.418, 3);
  });

  it("reports one root behind all six waits", () => {
    expect(rootBlockerPids(LAB)).toEqual([1069]);
  });
});

describe("terminateStatement — copyable, never executed", () => {
  it("builds the Postgres form", () => {
    expect(terminateStatement("postgres", 1069)).toBe("SELECT pg_terminate_backend(1069);");
  });

  it("builds the MySQL form", () => {
    expect(terminateStatement("mysql", 88)).toBe("KILL 88;");
    expect(terminateStatement("mariadb", 88)).toBe("KILL 88;");
  });

  it("is case-insensitive about the engine name", () => {
    expect(terminateStatement("PostgreSQL", 7)).toBe("SELECT pg_terminate_backend(7);");
    expect(terminateStatement("MySQL", 7)).toBe("KILL 7;");
  });

  it("falls back to the Postgres form for PG-compatible engines", () => {
    expect(terminateStatement("cockroachdb", 5)).toBe("SELECT pg_terminate_backend(5);");
  });

  it("returns nothing without a pid, so no half-formed statement can be copied", () => {
    expect(terminateStatement("postgres", null)).toBe("");
    expect(terminateStatement("postgres", undefined)).toBe("");
  });
});

describe("isIdleBlocker", () => {
  it("flags a transaction nobody is going to close", () => {
    expect(isIdleBlocker(90)).toBe(true);
    expect(isIdleBlocker(IDLE_BLOCKER_SECONDS)).toBe(true);
  });

  it("does not flag a blocker that is actively running", () => {
    expect(isIdleBlocker(0.4)).toBe(false);
  });

  // A request waiting on an HTTP call mid-transaction pauses for tens of
  // seconds routinely; the old 10s threshold banner-ed every one of them.
  it("does not flag a normal mid-transaction pause", () => {
    expect(isIdleBlocker(11)).toBe(false);
    expect(isIdleBlocker(31)).toBe(false);
  });

  it("does not guess when the sample carried no idle time", () => {
    expect(isIdleBlocker(null)).toBe(false);
    expect(isIdleBlocker(undefined)).toBe(false);
  });
});

describe("isNotablyLongestWait", () => {
  it("flags a wait that is both long and clearly worse than the next", () => {
    expect(isNotablyLongestWait(20, 4)).toBe(true);
  });

  // The badge used to fire on row 1 unconditionally, which labelled a
  // 0.1-second wait as the worst thing on screen.
  it("stays quiet when every wait is trivially short", () => {
    expect(isNotablyLongestWait(0.1, 0.1)).toBe(false);
    expect(isNotablyLongestWait(4.9, 0)).toBe(false);
  });

  it("stays quiet when the runner-up is nearly as bad — the sort already says it", () => {
    expect(isNotablyLongestWait(20, 19)).toBe(false);
    expect(isNotablyLongestWait(20, 10)).toBe(true);
  });

  it("flags a sole long waiter, which has no runner-up to beat", () => {
    expect(isNotablyLongestWait(30, null)).toBe(true);
    expect(isNotablyLongestWait(30, undefined)).toBe(true);
  });

  it("does not flag a missing wait", () => {
    expect(isNotablyLongestWait(null, null)).toBe(false);
  });
});

/**
 * The "Waiting for" column used to print one constant on every row. These lock
 * it to the row's own wait event: a row lock, a table lock and a buffer read are
 * three different problems with three different fixes.
 */
describe("wait events", () => {
  it("translates the Postgres lock wait events into distinct sentences", () => {
    expect(waitEventKey("transactionid", "Lock")).toBe("dbm.blocked.waitEvent.transaction");
    expect(waitEventKey("tuple", "Lock")).toBe("dbm.blocked.waitEvent.row");
    expect(waitEventKey("relation", "Lock")).toBe("dbm.blocked.waitEvent.table");
  });

  it("gives each event its own key, so no two rows read alike", () => {
    const keys = ["transactionid", "tuple", "relation", "extend", "advisory"].map((event) =>
      waitEventKey(event, "Lock"),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  // A buffer wait is IO contention, not a lock — calling it a lock would send
  // the reader looking for a transaction that does not exist.
  it("does not call a buffer wait a lock", () => {
    expect(waitEventKey("BufferPin", "BufferPin")).toBe("dbm.blocked.waitEvent.buffer");
  });

  it("is case- and whitespace-insensitive, since the engine's casing varies", () => {
    expect(waitEventKey(" TransactionID ", "Lock")).toBe("dbm.blocked.waitEvent.transaction");
  });

  it("falls back to the wait TYPE when only that is known", () => {
    expect(waitEventKey(null, "Lock")).toBe("dbm.blocked.waitEvent.lock");
  });

  it("returns null for an event it has no sentence for, rather than guessing", () => {
    expect(waitEventKey("SomeFutureEvent", "Lock")).toBeNull();
    expect(waitEventKey(null, null)).toBeNull();
  });

  it("carries the wait event through flattenChains onto the waiter rows", () => {
    const samples: BlockingSample[] = [
      {
        blocked_pid: 200,
        blocking_pid: 100,
        db_system: "postgresql",
        wait_event_type: "Lock",
        wait_event: "transactionid",
        wait_seconds: 12,
      },
    ];
    const rows = flattenChains(chainsFromSamples(samples), samples);
    const waiter = rows.find((row) => row.pid === 200);
    expect(waiter?.waitEvent).toBe("transactionid");
    expect(waiter?.waitEventType).toBe("Lock");
  });

  it("leaves the root without a wait event — it holds the lock, it does not wait", () => {
    const samples: BlockingSample[] = [
      {
        blocked_pid: 200,
        blocking_pid: 100,
        db_system: "postgresql",
        wait_event_type: "Lock",
        wait_event: "transactionid",
      },
    ];
    const root = flattenChains(chainsFromSamples(samples), samples).find(
      (row) => row.kind === "root",
    );
    expect(root?.waitEvent).toBeNull();
  });
});
