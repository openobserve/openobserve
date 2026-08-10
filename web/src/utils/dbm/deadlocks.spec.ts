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

import type { DeadlockEvent } from "@/services/db_monitoring";

import {
  deadlockCadenceSeconds,
  deadlockPairKey,
  deadlockRatePerMinute,
  groupDeadlocks,
  hasOppositeRowOrder,
  isDeadlockStorm,
  normalizeDeadlockQuery,
  parseDeadlockEvent,
  parseDeadlockEvents,
  survivorOf,
  victimOf,
} from "./deadlocks";

const SECOND = 1_000_000;

/** The captured lab deadlock — proof doc §2.1, verbatim pids and statements. */
const event = (
  timestamp: number,
  victimPid: number,
  overrides: Partial<DeadlockEvent> = {},
): DeadlockEvent => ({
  id: `dl-${timestamp}-${victimPid}`,
  timestamp,
  db_system: "postgres",
  db_instance: "dbmlab",
  objects: ["accounts"],
  participants: [
    {
      pid: 1071,
      transaction_id: "1429",
      query: "UPDATE accounts SET balance = balance - 1 WHERE id = 2 /* deadlock-a-step2 */",
      application: "dbm-sv-deadlock-a",
      lock_mode: "ShareLock",
      lock_target: "transaction 1430",
      victim: victimPid === 1071,
    },
    {
      pid: 1072,
      transaction_id: "1430",
      query: "UPDATE accounts SET balance = balance - 1 WHERE id = 1 /* deadlock-b-step2 */",
      application: "dbm-sv-deadlock-b",
      lock_mode: "ShareLock",
      lock_target: "transaction 1429",
      victim: victimPid === 1072,
    },
  ],
  ...overrides,
});

describe("parseDeadlockEvent — the wire event", () => {
  /**
   * Captured verbatim from `GET .../db_monitoring/deadlocks`. The server sends
   * the assembled DTO: `participants` is a real ARRAY, the victim verdict is
   * already applied per side, and MySQL entries are already stitched. There is
   * no `o2_dbm_*` name and no JSON string on the wire.
   */
  const wire: DeadlockEvent = {
    id: "1786200066626000-143",
    timestamp: 1786200066626000,
    db_system: "postgresql",
    db_instance: "pg1",
    db_namespace: "dbmlab",
    victim_pid: 143,
    participant_count: 2,
    partial: false,
    query_shape: "ce76ca7eedfb7cff",
    objects: ["transaction 4051", "transaction 4050"],
    participants: [
      {
        pid: 143,
        application: "dbm-sv-deadlock-a",
        user: "dbm",
        query: "UPDATE accounts SET balance = balance - 1 WHERE id = 2 /* deadlock-a-step2 */",
        fingerprint: "ce76ca7eedfb7cff",
        lock_mode: "ShareLock",
        lock_target: "transaction 4051",
        transaction_id: "4050",
        victim: true,
      },
      {
        pid: 144,
        application: null,
        user: null,
        query: "UPDATE accounts SET balance = balance - 1 WHERE id = 1 /* deadlock-b-step2 */",
        fingerprint: "ce76ca7eedfb7cff",
        lock_mode: "ShareLock",
        lock_target: "transaction 4050",
        transaction_id: null,
        victim: false,
      },
    ],
  };

  it("passes an assembled event straight through", () => {
    const parsed = parseDeadlockEvent(wire);
    expect(parsed?.participants).toHaveLength(2);
    expect(parsed?.participants[0]).toMatchObject({
      pid: 143,
      application: "dbm-sv-deadlock-a",
      lock_mode: "ShareLock",
      lock_target: "transaction 4051",
      fingerprint: "ce76ca7eedfb7cff",
    });
  });

  it("reads the victim the server already decided", () => {
    const parsed = parseDeadlockEvent(wire);
    expect(victimOf(parsed!)?.pid).toBe(143);
    expect(survivorOf(parsed!)?.pid).toBe(144);
  });

  it("drops an event with no sides", () => {
    // A deadlock with no participants is not something the UI can say anything
    // true about, so it is rejected rather than rendered half-formed.
    expect(parseDeadlockEvent({ ...wire, participants: [] })).toBeNull();
    expect(parseDeadlockEvent({ ...wire, participants: undefined as unknown as [] })).toBeNull();
  });

  it("keeps a partial (single-side) event and lets the flag speak", () => {
    // An unmatched MySQL side is real: the deadlock happened, only the partner
    // entry is missing. Dropping it would under-report the incident.
    const partial = parseDeadlockEvent({
      ...wire,
      participants: [wire.participants[0]],
      participant_count: 1,
      partial: true,
    });
    expect(partial).not.toBeNull();
    expect(partial?.partial).toBe(true);
  });

  it("returns events newest first", () => {
    const older = { ...wire, id: "older", timestamp: wire.timestamp - 5 * SECOND };
    const ordered = parseDeadlockEvents([older, wire]);
    expect(ordered.map((e) => e.id)).toEqual([wire.id, "older"]);
  });

  it("does not re-stitch — the server already did", () => {
    // Two MySQL sides arriving as ONE assembled event must stay one event, and
    // two genuinely separate deadlocks must stay two. Client-side merging is
    // gone precisely because it could only see one page of rows.
    const a: DeadlockEvent = { ...wire, id: "a", db_system: "mysql", timestamp: 1_000_000 };
    const b: DeadlockEvent = { ...wire, id: "b", db_system: "mysql", timestamp: 1_100_000 };
    expect(parseDeadlockEvents([a, b])).toHaveLength(2);
  });
});

describe("partial events — one side of a MySQL deadlock", () => {
  const oneSided = (): DeadlockEvent => ({
    id: "dl-partial",
    timestamp: 5 * SECOND,
    db_system: "mysql",
    db_instance: "dbmlab",
    partial: true,
    objects: ["accounts"],
    participants: [
      {
        pid: 88,
        query: "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
        victim: true,
      },
    ],
  });

  it("is kept, not dropped — the deadlock really happened", () => {
    expect(parseDeadlockEvent(oneSided())).not.toBeNull();
    expect(parseDeadlockEvents([oneSided()])).toHaveLength(1);
  });

  it("groups into a pair with a single statement", () => {
    const pair = groupDeadlocks([oneSided()])[0];
    expect(pair.count).toBe(1);
    expect(pair.queries[0]).toContain("id = 11");
    expect(pair.queries[1]).toBe("");
  });

  it("cannot claim opposite row order from one side alone", () => {
    expect(hasOppositeRowOrder(groupDeadlocks([oneSided()])[0])).toBe(false);
  });

  it("still names the cancelled side", () => {
    expect(victimOf(oneSided())?.pid).toBe(88);
    // There is no survivor to name; the UI must not invent one.
    expect(survivorOf(oneSided())).toBeNull();
  });
});

describe("normalizeDeadlockQuery", () => {
  it("strips the trailing comment the lab statements carry", () => {
    expect(
      normalizeDeadlockQuery("UPDATE accounts SET balance = balance - 1 WHERE id = 2 /* step2 */"),
    ).toBe("UPDATE accounts SET balance = balance - 1 WHERE id = 2");
  });

  it("keeps the row predicate — `id = 2` vs `id = 1` IS the finding", () => {
    const a = normalizeDeadlockQuery("UPDATE accounts SET balance = ? WHERE id = 2");
    const b = normalizeDeadlockQuery("UPDATE accounts SET balance = ? WHERE id = 1");
    expect(a).not.toBe(b);
  });

  it("collapses whitespace and drops trailing punctuation", () => {
    expect(normalizeDeadlockQuery("UPDATE   accounts\n  SET x = 1 ;  ")).toBe(
      "UPDATE accounts SET x = 1",
    );
  });

  it("survives a null query — a log line that proved a deadlock but caught no SQL", () => {
    expect(normalizeDeadlockQuery(null)).toBe("");
    expect(normalizeDeadlockQuery(undefined)).toBe("");
  });
});

describe("deadlockPairKey", () => {
  it("gives A⇄B and B⇄A the same key — one bug, not two", () => {
    const forward = event(1, 1071);
    const reversed = event(2, 1072);
    reversed.participants = [...reversed.participants].reverse();
    expect(deadlockPairKey(forward)).toBe(deadlockPairKey(reversed));
  });

  it("keeps the same statement on two engines apart", () => {
    const pg = event(1, 1071);
    const my = event(1, 1071, { db_system: "mysql" });
    expect(deadlockPairKey(pg)).not.toBe(deadlockPairKey(my));
  });

  it("buckets events with no captured SQL together rather than one row each", () => {
    const bare = event(1, 1071, {
      participants: [
        { pid: 1, query: null, victim: true },
        { pid: 2, query: null, victim: false },
      ],
    });
    expect(deadlockPairKey(bare)).toContain("<no-queries>");
  });
});

describe("groupDeadlocks — rows are pairs, the badge is events", () => {
  it("collapses 43 events from two pairs into two rows", () => {
    const pgEvents = Array.from({ length: 39 }, (_, i) =>
      event(1_000 * SECOND + i * 20 * SECOND, i % 2 === 0 ? 1071 : 1072),
    );
    const myEvents = Array.from({ length: 4 }, (_, i) =>
      event(2_000 * SECOND + i * 60 * SECOND, 88, {
        db_system: "mysql",
        participants: [
          {
            pid: 88,
            query: "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
            victim: true,
          },
          {
            pid: 89,
            query: "UPDATE accounts SET balance = balance - 1 WHERE id = 12",
            victim: false,
          },
        ],
      }),
    );

    const pairs = groupDeadlocks([...pgEvents, ...myEvents]);

    // Two ROWS for 43 EVENTS — the decision the tab is built on.
    expect(pairs).toHaveLength(2);
    expect(pairs.reduce((sum, p) => sum + p.count, 0)).toBe(43);
    expect(pairs[0].count).toBe(39);
    expect(pairs[1].count).toBe(4);
  });

  it("ranks by frequency so the bug is row 1", () => {
    const rare = event(500 * SECOND, 1071, {
      participants: [
        { pid: 5, query: "UPDATE ledger SET x = 1 WHERE id = 9", victim: true },
        { pid: 6, query: "UPDATE ledger SET x = 1 WHERE id = 8", victim: false },
      ],
    });
    const common = Array.from({ length: 5 }, (_, i) => event(1_000 * SECOND + i * SECOND, 1071));
    expect(groupDeadlocks([rare, ...common])[0].count).toBe(5);
  });

  it("computes share over the grouped events, so shares total 1", () => {
    const pairs = groupDeadlocks([
      event(1 * SECOND, 1071),
      event(2 * SECOND, 1072),
      event(3 * SECOND, 88, {
        db_system: "mysql",
        participants: [
          { pid: 88, query: "UPDATE accounts SET balance = ? WHERE id = 11", victim: true },
          { pid: 89, query: "UPDATE accounts SET balance = ? WHERE id = 12", victim: false },
        ],
      }),
    ]);
    expect(pairs.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 5);
  });

  it("flags that the victim alternates — the symmetric-bug signature", () => {
    const pairs = groupDeadlocks([
      event(1 * SECOND, 1071),
      event(2 * SECOND, 1072),
      event(3 * SECOND, 1071),
    ]);
    expect(pairs[0].victimAlternates).toBe(true);
    expect(pairs[0].victimCounts).toEqual({ "1071": 2, "1072": 1 });
  });

  it("does not claim alternation when one side always loses", () => {
    const pairs = groupDeadlocks([event(1 * SECOND, 1071), event(2 * SECOND, 1071)]);
    expect(pairs[0].victimAlternates).toBe(false);
  });

  it("orders events newest first and reports the true first/last seen", () => {
    const pairs = groupDeadlocks([
      event(10 * SECOND, 1071),
      event(30 * SECOND, 1072),
      event(20 * SECOND, 1071),
    ]);
    expect(pairs[0].events.map((e) => e.timestamp)).toEqual([
      30 * SECOND,
      20 * SECOND,
      10 * SECOND,
    ]);
    expect(pairs[0].firstSeen).toBe(10 * SECOND);
    expect(pairs[0].lastSeen).toBe(30 * SECOND);
  });

  it("returns nothing for no events — the healthy case, not an error", () => {
    expect(groupDeadlocks([])).toEqual([]);
  });
});

describe("victimOf / survivorOf", () => {
  it("names the cancelled side and the one allowed to finish", () => {
    const e = event(1 * SECOND, 1071);
    expect(victimOf(e)?.pid).toBe(1071);
    expect(survivorOf(e)?.pid).toBe(1072);
  });

  it("returns null when the log did not say who lost", () => {
    const e = event(1 * SECOND, 0, {
      participants: [
        { pid: 1, query: "UPDATE a SET x = 1", victim: false },
        { pid: 2, query: "UPDATE b SET y = 2", victim: false },
      ],
    });
    expect(victimOf(e)).toBeNull();
  });
});

describe("hasOppositeRowOrder", () => {
  it("detects the transposed predicates of the lab bug", () => {
    expect(hasOppositeRowOrder(groupDeadlocks([event(1 * SECOND, 1071)])[0])).toBe(true);
  });

  it("does not flag two unrelated statements", () => {
    const pair = groupDeadlocks([
      event(1 * SECOND, 1071, {
        participants: [
          { pid: 1, query: "UPDATE accounts SET balance = 1 WHERE id = 2", victim: true },
          { pid: 2, query: "DELETE FROM sessions WHERE token = 'abc'", victim: false },
        ],
      }),
    ])[0];
    expect(hasOppositeRowOrder(pair)).toBe(false);
  });

  it("ignores the SET assignment — only the WHERE predicate names the row", () => {
    // Both sides assign `balance = balance - 1`; if that counted as a key the
    // detector would compare the wrong values and miss the real transposition.
    const pair = groupDeadlocks([
      event(1 * SECOND, 1071, {
        participants: [
          { pid: 1, query: "UPDATE accounts SET balance = balance - 9 WHERE id = 2", victim: true },
          {
            pid: 2,
            query: "UPDATE accounts SET balance = balance - 9 WHERE id = 1",
            victim: false,
          },
        ],
      }),
    ])[0];
    expect(hasOppositeRowOrder(pair)).toBe(true);
  });

  it("does not flag two different statements that each filter one column", () => {
    const pair = groupDeadlocks([
      event(1 * SECOND, 1071, {
        participants: [
          { pid: 1, query: "UPDATE accounts SET balance = 1 WHERE id = 2", victim: true },
          { pid: 2, query: "UPDATE ledger SET total = 1 WHERE id = 1", victim: false },
        ],
      }),
    ])[0];
    expect(hasOppositeRowOrder(pair)).toBe(false);
  });

  it("does not flag a statement with no WHERE clause", () => {
    const pair = groupDeadlocks([
      event(1 * SECOND, 1071, {
        participants: [
          { pid: 1, query: "UPDATE accounts SET balance = 1", victim: true },
          { pid: 2, query: "UPDATE accounts SET balance = 2", victim: false },
        ],
      }),
    ])[0];
    expect(hasOppositeRowOrder(pair)).toBe(false);
  });

  it("does not flag two identical statements", () => {
    const pair = groupDeadlocks([
      event(1 * SECOND, 1071, {
        participants: [
          { pid: 1, query: "UPDATE accounts SET balance = 1 WHERE id = 2", victim: true },
          { pid: 2, query: "UPDATE accounts SET balance = 1 WHERE id = 2", victim: false },
        ],
      }),
    ])[0];
    expect(hasOppositeRowOrder(pair)).toBe(false);
  });
});

describe("deadlockCadenceSeconds", () => {
  it("reports the 20-second cadence the lab produced", () => {
    const events = Array.from({ length: 10 }, (_, i) => event(i * 20 * SECOND, 1071));
    expect(deadlockCadenceSeconds(groupDeadlocks(events)[0])).toBe(20);
  });

  it("stays silent on a burst — a mean over bunched events would be a lie", () => {
    const stamps = [0, 1, 2, 3, 400, 800];
    const events = stamps.map((s) => event(s * SECOND, 1071));
    expect(deadlockCadenceSeconds(groupDeadlocks(events)[0])).toBeNull();
  });

  it("stays silent below three events — two points are not a cadence", () => {
    expect(
      deadlockCadenceSeconds(groupDeadlocks([event(0, 1071), event(20 * SECOND, 1072)])[0]),
    ).toBeNull();
  });
});

describe("storm detection", () => {
  it("computes the per-minute rate", () => {
    expect(deadlockRatePerMinute(43, 60)).toBeCloseTo(43 / 60, 6);
    expect(deadlockRatePerMinute(43, 0)).toBeNull();
  });

  it("calls 43-in-an-hour a storm", () => {
    expect(isDeadlockStorm(43, 60)).toBe(true);
  });

  it("does not call a trickle a storm", () => {
    expect(isDeadlockStorm(2, 60)).toBe(false);
  });

  it("does not call a handful in a tiny window a storm", () => {
    // 9 events in 15 minutes clears the rate bar but not the volume floor —
    // a "storm" banner over 9 rows would be shouting about a readable list.
    expect(isDeadlockStorm(9, 15)).toBe(false);
  });
});

/**
 * The read is capped at 100 events, so a genuine storm arrives at the detector
 * already flattened to exactly the cap. Judging "is this a storm" on a number
 * the cap chose understates the rate during precisely the event this exists to
 * catch — a capped count is a FLOOR, and a floor over the bar is still over it.
 */
describe("storm detection under a capped read", () => {
  it("calls a capped count a storm even when the rate alone would not", () => {
    // 100 events in a 24h window is 0.07/min — under the bar. But the read was
    // capped, so the true count is unbounded and the rate unknowable from here.
    expect(isDeadlockStorm(100, 24 * 60, true)).toBe(true);
  });

  it("still refuses to call an uncapped trickle a storm", () => {
    expect(isDeadlockStorm(100, 24 * 60, false)).toBe(false);
  });

  it("does not let a capped read manufacture a storm below the volume floor", () => {
    // A cap that fired at 4 events cannot have fired at all — but if a caller
    // ever passes one, the absolute floor still has to hold.
    expect(isDeadlockStorm(4, 60, true)).toBe(false);
  });

  it("keeps the rate verdict when nothing says the read was capped", () => {
    expect(isDeadlockStorm(43, 60)).toBe(true);
    expect(isDeadlockStorm(2, 60)).toBe(false);
  });
});
