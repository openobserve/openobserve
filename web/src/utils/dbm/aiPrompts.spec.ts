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

import { buildBlockingFixPrompt, buildDeadlockFixPrompt, buildQueryFixPrompt } from "./aiPrompts";

const MS = 1_000_000;

describe("buildQueryFixPrompt", () => {
  const input = {
    queryNorm: "SELECT * FROM orders WHERE customer_id = ?",
    dbSystem: "postgresql",
    dbInstance: "orders-db",
    p50Ns: 12 * MS,
    p95Ns: 250 * MS,
    p99Ns: 900 * MS,
    calls: 1200,
  };

  it("names the engine and fences the statement as SQL", () => {
    const prompt = buildQueryFixPrompt(input);
    expect(prompt).toContain("postgresql");
    expect(prompt).toContain("```sql");
    expect(prompt).toContain("SELECT * FROM orders WHERE customer_id = ?");
  });

  /** Without this, the model reasons about literal values it was never shown. */
  it("says the statement is normalized", () => {
    expect(buildQueryFixPrompt(input)).toContain("normalized");
    expect(buildQueryFixPrompt(input)).toContain("replaced with `?`");
  });

  it("carries the percentiles with their units", () => {
    const prompt = buildQueryFixPrompt(input);
    expect(prompt).toContain("p50: 12.00ms");
    expect(prompt).toContain("p95: 250.00ms");
    expect(prompt).toContain("p99: 900.00ms");
  });

  /** A missing number must never become a zero the model treats as measured. */
  it("omits a metric that was not measured rather than defaulting it", () => {
    const prompt = buildQueryFixPrompt({ ...input, p99Ns: undefined, maxNs: null });
    expect(prompt).not.toContain("p99");
    expect(prompt).not.toContain("Slowest execution");
  });

  it("omits the error line when nothing failed", () => {
    expect(buildQueryFixPrompt({ ...input, errors: 0 })).not.toContain("Failed executions");
    expect(buildQueryFixPrompt({ ...input, errors: 7 })).toContain("Failed executions: 7");
  });

  /** The multiplier is what separates "needs an index" from "called too often". */
  it("states the per-request multiplier when it is known", () => {
    const prompt = buildQueryFixPrompt({ ...input, callsPerTrace: 42 });
    expect(prompt).toContain("Executions per request");
    expect(prompt).toContain("42");
  });

  it("names the top callers and stops at three", () => {
    const prompt = buildQueryFixPrompt({
      ...input,
      endpoints: [
        { service: "checkout", endpoint: "POST /orders", calls: 800 },
        { service: "billing", endpoint: "GET /invoice", calls: 300 },
        { service: "search", endpoint: null, calls: 90 },
        { service: "reports", endpoint: "GET /daily", calls: 10 },
      ],
    });
    expect(prompt).toContain("checkout POST /orders");
    expect(prompt).toContain("search");
    expect(prompt).not.toContain("reports");
  });

  it("drops an unattributed caller instead of printing a blank entry", () => {
    const prompt = buildQueryFixPrompt({
      ...input,
      endpoints: [{ service: null, endpoint: null, calls: 5 }],
    });
    expect(prompt).not.toContain("Called from");
  });

  it("collapses a multi-line statement onto one line", () => {
    const prompt = buildQueryFixPrompt({
      ...input,
      queryNorm: "SELECT *\n  FROM orders\n  WHERE id = ?",
    });
    expect(prompt).toContain("SELECT * FROM orders WHERE id = ?");
  });

  it("still names an engine when db_system is missing", () => {
    expect(buildQueryFixPrompt({ ...input, dbSystem: "" })).toContain("unspecified SQL engine");
  });

  it("asks a specific question rather than an open one", () => {
    const prompt = buildQueryFixPrompt(input);
    expect(prompt).toContain("Rank your suggestions by expected impact");
  });

  /** The chat input is not a document — an overlong prompt gets truncated. */
  it("stays under a chat-sized budget", () => {
    const prompt = buildQueryFixPrompt({
      ...input,
      endpoints: [
        { service: "checkout", endpoint: "POST /orders", calls: 800 },
        { service: "billing", endpoint: "GET /invoice", calls: 300 },
        { service: "search", endpoint: "GET /q", calls: 90 },
      ],
      errors: 12,
      maxNs: 4000 * MS,
      totalTimeNs: 90_000 * MS,
      callsPerTrace: 40,
    });
    expect(prompt.split(/\s+/).length).toBeLessThan(200);
  });
});

describe("buildDeadlockFixPrompt", () => {
  const input = {
    queries: [
      "UPDATE accounts SET balance = ? WHERE id = ?",
      "UPDATE accounts SET flag = ? WHERE id = ?",
    ],
    dbSystem: "mysql",
    dbInstance: "ledger",
    objects: ["accounts"],
    oppositeRowOrder: true,
    count: 14,
  };

  it("carries BOTH statements, each in its own labelled block", () => {
    const prompt = buildDeadlockFixPrompt(input);
    expect(prompt).toContain("-- session 1");
    expect(prompt).toContain("-- session 2");
    expect(prompt).toContain("SET balance = ?");
    expect(prompt).toContain("SET flag = ?");
  });

  it("states the engine, the contested object and the recurrence", () => {
    const prompt = buildDeadlockFixPrompt(input);
    expect(prompt).toContain("mysql");
    expect(prompt).toContain("Contested objects: accounts");
    expect(prompt).toContain("Deadlocks in the window: 14");
  });

  /** The row-order finding is what makes lock-ordering advice sound or unsound. */
  it("reports opposite row order affirmatively when detected", () => {
    expect(buildDeadlockFixPrompt(input)).toContain("yes — the two statements touch");
  });

  it("reports the absence of that evidence rather than staying silent", () => {
    const prompt = buildDeadlockFixPrompt({ ...input, oppositeRowOrder: false });
    expect(prompt).toContain("no — the row ordering evidence is inconclusive");
  });

  it("says the statements are normalized", () => {
    expect(buildDeadlockFixPrompt(input)).toContain("normalized");
  });

  it("asks about lock ordering specifically", () => {
    expect(buildDeadlockFixPrompt(input)).toContain("consistent lock ordering");
  });

  it("handles a one-sided event without emitting an empty block", () => {
    const prompt = buildDeadlockFixPrompt({
      ...input,
      queries: ["UPDATE a SET x = ? WHERE id = ?"],
    });
    expect(prompt).toContain("-- session 1");
    expect(prompt).not.toContain("-- session 2");
  });

  it("omits cadence when the pair did not recur predictably", () => {
    expect(buildDeadlockFixPrompt(input)).not.toContain("Recurring roughly every");
    expect(buildDeadlockFixPrompt({ ...input, cadenceSeconds: 30 })).toContain(
      "Recurring roughly every: 30s",
    );
  });

  it("stays under a chat-sized budget", () => {
    const prompt = buildDeadlockFixPrompt({
      ...input,
      applications: ["checkout-svc", "ledger-worker"],
      cadenceSeconds: 30,
    });
    expect(prompt.split(/\s+/).length).toBeLessThan(200);
  });
});

describe("buildBlockingFixPrompt", () => {
  const input = {
    query: "UPDATE inventory SET qty = ? WHERE sku = ?",
    dbSystem: "postgresql",
    dbInstance: "shop-db",
    pid: 4711,
    application: "batch-import",
    idleSeconds: 930.4,
    blockingCount: 12,
    longestWaitSeconds: 88.6,
  };

  it("frames the session as the root of the chain", () => {
    const prompt = buildBlockingFixPrompt(input);
    expect(prompt).toContain("root of a lock-wait chain");
    expect(prompt).toContain("nothing is blocking it");
  });

  it("carries the session identity and the blast radius", () => {
    const prompt = buildBlockingFixPrompt(input);
    expect(prompt).toContain("Session: pid 4711");
    expect(prompt).toContain("Application: batch-import");
    expect(prompt).toContain("Sessions stuck behind it: 12");
  });

  /** Seconds are rounded — a fractional idle time reads as false precision. */
  it("rounds the idle and wait times and says what idle means", () => {
    const prompt = buildBlockingFixPrompt(input);
    expect(prompt).toContain("Idle in transaction for: 930s");
    expect(prompt).toContain("holds locks but is running nothing");
    expect(prompt).toContain("Longest wait behind it: 89s");
  });

  it("omits idle time when the session is not idle-tracked", () => {
    expect(buildBlockingFixPrompt({ ...input, idleSeconds: null })).not.toContain(
      "Idle in transaction",
    );
  });

  /** No statement means no normalization note — the note would describe nothing. */
  it("drops the SQL block and the normalization note when no statement is known", () => {
    const prompt = buildBlockingFixPrompt({ ...input, query: null });
    expect(prompt).not.toContain("```sql");
    expect(prompt).not.toContain("normalized");
  });

  it("asks both the now question and the permanent question", () => {
    const prompt = buildBlockingFixPrompt(input);
    expect(prompt).toContain("right now versus permanently");
    expect(prompt).toContain("terminating it is safe");
  });

  it("stays under a chat-sized budget", () => {
    expect(buildBlockingFixPrompt(input).split(/\s+/).length).toBeLessThan(200);
  });
});
