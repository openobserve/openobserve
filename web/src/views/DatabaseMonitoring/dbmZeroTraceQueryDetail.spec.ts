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
 * The query detail page on a fleet with NO traced application traffic.
 *
 * The list pages there already fall back to the database's own statement list,
 * so a reader clicks a row showing a real call count and a real in-database
 * time. The detail page's row lookup read only the TRACE vantage, which is
 * honestly empty — so the page lost every figure the reader had just been
 * looking at, and on a reload (where the one-shot seed cannot survive by
 * design) it painted the bare fingerprint hash over six empty tiles.
 *
 * Worse than empty, the tiles ASSERTED: a hard `0` under "Calls" captioned
 * "new to this list", a "0% of this database" under an absent database time,
 * and "none / no errors" — an all-clear over a vantage that measured nothing,
 * sitting directly above a server section reporting thousands of executions.
 *
 * Two rules are pinned here, and they are the ones a future edit will break:
 *   • the page RESOLVES its row from the server vantage when the client has
 *     none, so no seed and no traces still yields a readable page; and
 *   • absent renders as absent — no fabricated zero, and no caption under a
 *     value that does not exist.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const detail = readFileSync(join(here, "QueryDetailPage.vue"), "utf8");

/** The body of a top-level `const <name> = ...` declaration, to its terminator. */
const declaration = (name: string): string => {
  const after = detail.split(`const ${name} =`)[1] ?? "";
  return after.split("\n};")[0] ?? "";
};

describe("the detail page resolves a row when there are no traces", () => {
  /**
   * The row lookup asks for the server fallback IN THE SAME REQUEST. A second,
   * sequential call would be two round trips on precisely the deployment that
   * can least afford them — and is what the list pages already stopped doing.
   */
  it("asks the row lookup for the server-vantage fallback", () => {
    const loadRow = declaration("loadRow");
    expect(loadRow, "loadRow must exist").not.toBe("");
    expect(loadRow).toContain("includeServerFallback: true");
  });

  /**
   * Narrowed to THIS fingerprint. Without it the fallback answers with the
   * org's most-frequent statements — a ranked list in which the statement the
   * reader opened need not appear at all, making "absent" and "ranked below
   * the cap" indistinguishable.
   */
  it("narrows the fallback to the fingerprint being viewed", () => {
    expect(declaration("loadRow")).toContain("fingerprint: fingerprint.value");
  });

  /**
   * Filtered to the exact fingerprint on the way in, exactly as the client
   * rows are: the section must describe THIS statement or nothing.
   */
  it("keeps only the fallback hit matching this fingerprint", () => {
    const loadRow = declaration("loadRow");
    expect(loadRow).toContain("server_fallback?.hits");
    expect(loadRow).toContain("hit.fingerprint === fingerprint.value");
  });

  /**
   * Held apart from the client row rather than merged into it. `row` is a
   * trace-shaped `QueryStatsRow` — percentiles, error counts, trace ids — and
   * this feed has none of them. Merging would file a server-side call count
   * under a heading that promises traced traffic.
   */
  it("keeps the server row in its own slot, not folded into the client row", () => {
    expect(detail).toContain("const serverRow = ref<ServerQueryRow | null>(null)");
  });

  /**
   * The header paints the STATEMENT. The server row carries the same
   * normalized text, so a reload with no seed shows a query the reader can
   * read instead of a hash they cannot.
   */
  it("falls back to the server row's text before showing the bare fingerprint", () => {
    const queryText = detail.split("const queryText = computed(")[1]?.split(");")[0] ?? "";
    expect(queryText).toContain("row.value?.query_norm");
    expect(queryText).toContain("serverRow.value?.query");
    // The hash stays the LAST resort, never the second.
    expect(queryText.indexOf("serverRow.value?.query")).toBeLessThan(
      queryText.indexOf("fingerprint.value"),
    );
  });

  /**
   * The dead end the screenshots caught — "Open this query from the Top queries
   * tab" — is resolved by ABSENCE now, not by better copy: under Rule A the
   * whole callers section is hidden when this fingerprint has no trace vantage,
   * so no message renders there at all and the zero-trace branch that used to
   * produce one is gone.
   *
   * What is pinned is the negative: the unfollowable instruction must not come
   * back, in any form, anywhere on the page.
   */
  it("never tells a zero-trace reader to open a tab that cannot help them", () => {
    expect(detail).not.toContain("dbm.detail.noTraceVantage");
    const message = declaration("noStreamMessage");
    // What is left is the genuinely reader-fixable ambiguity: which of several
    // trace streams carries this query.
    expect(message).toContain("streamAmbiguous");
  });

  /**
   * RULE A. The sections that can only be filled from traces hide on ONE shared
   * predicate rather than each testing emptiness its own way — the drift that
   * had one page hiding a section while the next showed an empty table with a
   * "no callers" message, which reads as a finding about instrumentation.
   */
  it("gates every trace-only section on the shared trace-vantage predicate", () => {
    expect(detail).toContain("hasDbmTraceVantage");
    expect(detail).toContain("const traceVantage = computed(");
    // The caller list, the sample scatter, the two history charts and the
    // per-location breakdown are all trace-derived and all gated.
    const gated = detail.match(/v-if="traceVantage/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * A failed read must NOT hide a section: a hidden section and "no traces"
   * look identical to a reader, so hiding on an error would state something
   * false. The predicate owns that rule; the page must not re-derive it.
   */
  it("reads the vantage from response signals, not from an ad-hoc emptiness test", () => {
    const vantage = detail.split("const traceVantage = computed(")[1]?.split("\n);")[0] ?? "";
    expect(vantage).toContain("clientRowFound");
    expect(vantage).toContain("history.value?.points");
    expect(vantage).toContain("loading");
  });
});

describe("Rule B — the database server is the source of truth on overlap", () => {
  /**
   * Database time and calls exist in BOTH feeds. The server's figure wins,
   * under the generic label, and the traced one is dropped from the tile
   * rather than shown as a second line.
   */
  it("sources the two overlap tiles through the shared resolver", () => {
    expect(detail).toContain("resolveDatabaseTime");
    expect(detail).toContain("resolveCalls");
    const stats = detail.split("const headlineStats = computed(")[1]?.split("\n});")[0] ?? "";
    expect(stats).toContain("databaseTime.value.value");
    expect(stats).toContain("callCount.value.value");
  });

  /**
   * THE CAVEAT, and it is load-bearing on the reported fingerprint itself:
   * `exec_time_kind` is "wait" on MySQL/MariaDB. Under a generic "Database
   * time" heading with no qualifier, a queueing figure reads as execution work.
   * The qualifier must reach the tile.
   */
  it("keeps the engine qualifier on every server-sourced tile", () => {
    const stats = detail.split("const headlineStats = computed(")[1]?.split("\n});")[0] ?? "";
    expect(stats).toContain("overlapDetail");
    expect(stats).toContain("dbm.detail.overlap.");
    expect(stats).toContain("engine: engineName");
  });

  /**
   * The client-scope captions ("{percent} of this database", "{change} than
   * earlier") are arithmetic over the TRACED population. They may only qualify
   * a client-sourced value; over a server figure they would divide the engine's
   * total by a traced subtotal.
   */
  it("only lets the client-scope captions qualify a client-sourced value", () => {
    const stats = detail.split("const headlineStats = computed(")[1]?.split("\n});")[0] ?? "";
    expect(stats).toContain('databaseTime.value.source === "client"');
    expect(stats).toContain('callCount.value.source === "client"');
  });

  /**
   * The percentile and error tiles have no server equivalent, so under Rule A
   * they are REMOVED rather than rendered as "—" beside the two the database
   * answered.
   */
  it("drops the trace-only tiles when there is no trace vantage", () => {
    const visible =
      detail.split("const visibleHeadlineStats = computed(")[1]?.split("\n);")[0] ?? "";
    expect(visible, "visibleHeadlineStats must exist").not.toBe("");
    expect(visible).toContain("traceVantage");
    expect(visible).toContain('tile.id === "load"');
    expect(visible).toContain('tile.id === "calls"');
  });

  /**
   * STEP 4 — the populated content leads. With no trace vantage the database's
   * own section must not sit under the hidden client tiles.
   */
  it("hoists the database's own section above the tiles when it is carrying the page", () => {
    expect(detail).toContain("order-1");
    expect(detail).toContain("order-2");
  });
});

describe("absent measurements never render as zero", () => {
  /**
   * The headline tiles read a row that may not exist. `?? 0` made "no traced
   * traffic" indistinguishable from "ran zero times, failed zero times" — a
   * false all-clear, printed beside a server section reporting thousands of
   * executions.
   */
  it("does not coerce absent calls or errors to zero", () => {
    const stats = detail.split("const headlineStats = computed(")[1]?.split("\n});")[0] ?? "";
    expect(stats, "headlineStats must exist").not.toBe("");
    expect(stats).toContain("const calls = current?.calls;");
    expect(stats).toContain("const errors = current?.errors;");
    expect(stats).not.toContain("const calls = current?.calls ?? 0");
    expect(stats).not.toContain("const errors = current?.errors ?? 0");
  });

  /**
   * The error-RATE comparison still needs numbers, but they are never
   * displayed — the tile's own value branch checks `undefined` first, so an
   * absent count cannot print as "none".
   */
  it("keeps the rate arithmetic separate from what is displayed", () => {
    const stats = detail.split("const headlineStats = computed(")[1]?.split("\n});")[0] ?? "";
    expect(stats).toContain("callsForRate");
    expect(stats).toContain("errorsForRate");
    expect(stats).toContain("errors === undefined");
  });

  /**
   * A caption may only qualify a number that is on screen. "0% of this
   * database" under a "—", "close, not exact" under an absent p50, and "new to
   * this list" under an absent call count were each read as findings about a
   * query the trace vantage never saw.
   */
  it("suppresses the caption when the value it describes is absent", () => {
    const stats = detail.split("const headlineStats = computed(")[1]?.split("\n});")[0] ?? "";
    expect(stats).toContain("const captionFor =");
    // Every tile whose caption makes a claim routes through the guard.
    for (const value of [
      "current?.total_time_ns",
      "calls",
      "current?.p50_ns",
      "current?.p95_ns",
      "current?.max_ns",
    ]) {
      expect(stats, `the ${value} tile must guard its caption`).toContain(`captionFor(${value},`);
    }
  });
});

/**
 * F5, the empty states the SERVER-VANTAGE pages show a zero-trace org.
 *
 * `databaseCount` on those pages is the TRACE fleet count. Measured live on
 * org `dbm_notraces` (collector recipes wired, no APM): `/badges` returns
 * `databases.hits = []`, so the count is 0 while the server fallback returns 50
 * database-reported statements and the deadlock log is being read normally.
 *
 * Interpolated, that 0 produced "0 databases · most recent line read 3m ago" —
 * a HEALTHY state denying the very reading it exists to confirm. The clause is
 * dropped instead, so the sentence is true in both deployments.
 */
describe("the server-vantage empty states never print a trace-vantage zero", () => {
  const deadlocks = readFileSync(join(here, "DeadlocksPage.vue"), "utf8");

  it("gates the deadlocks healthy copy on a non-zero fleet count", () => {
    const checks =
      deadlocks.split("const healthyChecks = computed<DbmLockCheck[]>(")[1]?.split("\n});")[0] ??
      "";
    expect(checks, "the healthyChecks declaration must be found").not.toBe("");
    // Both branches — the aged one and the unknown-age one — are gated.
    expect(checks).toContain("detailNoFleet");
    expect(checks).toContain("detailUnknownNoFleet");
    // And the un-gated `?? 0` that produced "0 databases" is gone.
    expect(checks).not.toContain('t("dbm.databases.databaseCount", databaseCount.value ?? 0)');
  });

  /**
   * The shared checklist the three lock/activity pages render. The check still
   * PASSES on a server-only org — its databases genuinely are reporting — so
   * what is pinned is the sentence, not the status.
   */
  it("drops the database clause from the shared not-collecting checklist", () => {
    const shared = readFileSync(join(here, "../../utils/dbm/notCollecting.ts"), "utf8");
    expect(shared).toContain("okDetailNoFleet");
    expect(shared).not.toContain('t("dbm.databases.databaseCount", signals.databaseCount ?? 0)');
  });
});
