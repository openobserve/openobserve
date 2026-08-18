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
 * What opening a query detail page is allowed to COST.
 *
 * Measured live, entering the page fired ~13 XHRs: the shell's badge
 * fan-out (for a route that renders no badges), TWO `queries` reads for one
 * row's stats, a trace-stream listing whose answer was already in the URL, and
 * the page's own per-fingerprint depth. Three seams close that down, and each
 * has a correctness edge worth pinning:
 *
 *  • the clicked row travels as a one-shot seed — but only under the exact
 *    org/fingerprint/window it was fetched for (guards unit-tested in
 *    dbmQueryDetailSeed.spec.ts; the WIRING is pinned here);
 *  • the previous-window read rides the queries endpoint's baseline contract
 *    instead of being a second call;
 *  • the shell's badge fan-out fires only on routes that render the strip.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

const detail = read("QueryDetailPage.vue");
const list = read("QueriesPage.vue");
const shell = read("DbmShell.vue");

/** The body of a top-level `const <name> = ...` declaration, to its terminator. */
const declaration = (name: string): string => {
  const after = detail.split(`const ${name} =`)[1] ?? "";
  return after.split("\n};")[0] ?? "";
};

describe("the queries list hands the clicked row to the detail page", () => {
  /**
   * The seed hand-off and the push live in `useDbmQueryDetailHop` now — four
   * lists make this hop and all four had it copied out. What the LIST must show
   * is that its clicked row is what gets seeded.
   */
  it("sets the seed on the row-click navigation", () => {
    const handler = list.split("const openQueryDetail")[1]?.split("\n};")[0] ?? "";
    expect(handler, "openQueryDetail must exist").not.toBe("");
    expect(handler).toContain("openDbmQueryDetail({");
    expect(handler).toContain("seed: row,");
  });

  /**
   * The range must travel as a COPY: the list page is kept alive, so its scope
   * object lives on and can move under a seed that aliased it — quietly
   * validating a stale row against a window nobody fetched it for.
   */
  it("hands off a copied range, never the live scope object", () => {
    const hop = readFileSync(join(here, "../../composables/dbm/useDbmQueryDetailHop.ts"), "utf8");
    expect(hop).toContain("range: { ...context.range.value }");
  });
});

describe("the detail page claims the seed under its guards", () => {
  /** All three: the org, the fingerprint AND the window must match. */
  it("takes the seed keyed on org, fingerprint and range", () => {
    expect(detail).toMatch(
      /takeDbmQueryDetailSeed\(org\.value, fingerprint\.value, range\.value\)/,
    );
  });

  /** The whole point: the header paints before any request settles. */
  it("paints the seeded row before the fetch lands", () => {
    expect(detail).toMatch(/row\.value = seed;/);
  });

  /**
   * The seed does NOT skip the row fetch. The share of database, the deltas
   * and the freshness line are this page's own scope arithmetic
   * (`stmtClass: "all"`, this instance, the previous window) — the list
   * computed them under DIFFERENT filters, so its numbers cannot stand in.
   * The seed makes the fetch concurrent, never absent.
   */
  it("still refines the seeded row with its own fetch", () => {
    expect(detail).toMatch(/loadRow\(token, seed\)/);
  });

  /**
   * One shot: a window change or a refresh must fetch cold. A seed surviving
   * its first load would answer a later window with the old one's row.
   */
  it("consumes the seed on the first load", () => {
    expect(detail).toMatch(/const seed = seedRow\.value;\s*\n\s*seedRow\.value = null;/);
  });

  /** Deep link / reload: no seed, and the sequential cold path still exists. */
  it("keeps the cold path for a seedless entry", () => {
    expect(detail).toMatch(/await Promise\.all\(\[loadRow\(token\), streamsSettled\]\)/);
  });
});

describe("the detail page's own reads are collapsed", () => {
  /**
   * The previous window rides the endpoint's baseline contract, fetched
   * server-side under the same filters — which is also what makes the delta
   * compare like with like. It is never a second, sequential window read.
   *
   * EVERY `queries` read on this page carries the pair, so no path can
   * reintroduce the sequential fetch this replaced. There are two reads: the
   * scope page, and the targeted re-ask a fingerprint ranked below the page's
   * cap needs (which only a miss issues) — and the re-ask must carry the
   * baseline too, or the deltas would inherit the very ceiling it exists to
   * escape.
   */
  it("reads every window through the baseline contract", () => {
    const calls = detail.match(/dbMonitoringService\.getQueries\(/g) ?? [];
    expect(calls, "the row lookup and its targeted re-ask").toHaveLength(2);
    const baselineStarts = detail.match(/baselineStartTime: previous\.value\.startTime/g) ?? [];
    const baselineEnds = detail.match(/baselineEndTime: previous\.value\.endTime/g) ?? [];
    expect(baselineStarts, "each read carries the baseline pair").toHaveLength(calls.length);
    expect(baselineEnds, "each read carries the baseline pair").toHaveLength(calls.length);
  });

  /**
   * A rank below the scope page's cap is not absence. Without the re-ask, a
   * cold deep link to a query outside the top `ROW_LOOKUP_LIMIT` of its scope
   * painted no row at all — the page's own comment conceded the miss and fell
   * through to the seed, which a deep link does not have.
   *
   * `search` is the narrowing that works: an exact-prefix match over the
   * fingerprint applied server-side BEFORE the sort and the truncation, so
   * rank cannot hide the row.
   */
  it("re-asks by name when the ranked page did not contain the fingerprint", () => {
    const targeted = declaration("loadTargetedRow");
    expect(targeted, "loadTargetedRow must exist").not.toBe("");
    expect(targeted, "the re-ask must narrow server-side").toContain("search: fingerprint.value");
    // Issued only on a miss — a page that already found the row must not pay
    // for a second round trip.
    expect(declaration("loadRow")).toMatch(
      /if \(!fetched\) \{\s*\n\s*targeted = await loadTargetedRow\(token\);/,
    );
  });

  /** A failed baseline degrades the deltas — it must not read as change. */
  it("degrades to no-baseline when the server says the baseline read failed", () => {
    expect(detail).toContain("baseline_read_failed");
  });

  /**
   * The trace-stream listing exists to RESOLVE an unknown stream. When the
   * stream traveled in the URL or on the seed there is nothing to resolve —
   * and the fetch must still happen whenever there is.
   */
  it("lists trace streams only when the stream is not already known", () => {
    expect(detail).toMatch(/streamParam\.value \|\| seed\?\.trace_stream_name/);
    expect(detail).toMatch(/streamKnown \? Promise\.resolve\(\) : loadTraceStreams\(\)/);
  });

  /**
   * Until the fetch lands, the seeded tiles carry VALUES but no scope claims:
   * "0% of database" and "new" are answers, and nothing has answered yet.
   */
  it("holds the share and delta captions until its own fetch answers", () => {
    expect(detail).toMatch(/rowStatsReady\.value\s*\n?\s*\? t\("dbm\.detail\.stats\.loadShare"/);
    expect(detail).toMatch(/rowStatsReady\.value = true;/);
  });
});

describe("the badge fan-out fires only where a strip renders it", () => {
  /**
   * The detail route renders no `DbmSectionTabs`, and opening a row ADDS the
   * row's engine as `?system=` to the URL — which used to re-key the shell's
   * watcher and fire every count read on every detail entry, for badges
   * nobody paints.
   */
  it("the shell guards the fan-out on the strip routes", () => {
    expect(shell).toMatch(/if \(!rendersTabStrip\.value\) return;/);
  });

  it("the guard names every strip route and not the detail route", () => {
    for (const name of [
      "dbmDatabases",
      "dbmQueries",
      "dbmSamples",
      "dbmActivity",
      "dbmDeadlocks",
      "dbmBlocking",
      "dbmTableHealth",
    ]) {
      expect(shell).toContain(`"${name}"`);
    }
    expect(shell).not.toContain('"dbmQueryDetail"');
  });

  /**
   * Leaving the detail page must re-arm the fan-out: the route flag is part of
   * the watcher's key, so returning to a strip route re-fires it — a cache hit
   * when the window did not move, a refetch when it did.
   */
  it("returning to a strip route re-triggers the fetch", () => {
    const watcher = shell.split("watch(")[1] ?? "";
    expect(watcher).toContain("rendersTabStrip.value");
  });
});

describe("the detail page returns the reader to the tab they came from", () => {
  /**
   * Four tabs open this page and each marks the hop with `?from=`. A back
   * affordance hardcoded to Top queries strands an Activity reader on a tab
   * they never stood on — so the target is resolved from the origin, with Top
   * queries only as the fallback for a deep link that carries none.
   */
  it("resolves the back target from the origin marker", () => {
    expect(detail).toMatch(/route\.query\.from/);
    for (const name of ["dbmQueries", "dbmActivity", "dbmSamples", "dbmDeadlocks"]) {
      expect(detail, `back target must be able to name ${name}`).toContain(`name: "${name}"`);
    }
  });

  /**
   * The server-metrics join key must survive a missing client row. A
   * server-vantage entry (Activity, Deadlocks) — or any entry on a fleet with
   * no APM — loads no client row, but the origin passed `system`/`namespace`
   * in the URL. Keying exclusively off the row skips the request and renders
   * "capture is off" over an endpoint that has data.
   */
  it("falls back to the URL scope for the server-metrics join key", () => {
    expect(detail).toMatch(/row\.value\?\.db_system \?\? systemFilter\.value/);
    expect(detail).toMatch(/row\.value\?\.db_namespace \?\? namespaceFilter\.value/);
  });
});

describe("the database-reported fallback list on Top queries", () => {
  /**
   * The server list answers ONLY the page whose client vantage is empty. A
   * populated client table must clear it — server counts under a live client
   * ranking would read as traced traffic that never existed.
   *
   * The rows now ride the page's own response (`include_server_fallback`)
   * rather than a second request fired on the empty branch, so "a page with
   * rows never pays for it" is enforced SERVER-side: the fallback body only
   * runs when the client answer is an exact zero. What the page still owns is
   * the rendering rule, and that is what this pins.
   */
  it("shows the server list only when the client read came back empty", () => {
    expect(list).toMatch(/if \(hits\.length\) \{\s*\n\s*serverRows\.value = \[\];/);
    expect(list).toMatch(/serverRows\.value = \(fallback\?\.hits \?\? \[\]\)/);
    // Asked for on the page's own read, so there is no second round trip.
    expect(list).toContain("includeServerFallback: true");
  });

  /**
   * A server row drills into the same detail page as a client row, keyed by
   * URL params alone — no stream (a server record cannot know one) and the
   * origin marker so back returns here.
   */
  it("navigates server rows to the detail page without inventing a stream", () => {
    const handler = list.split("const openServerQueryDetail")[1]?.split("\n};")[0] ?? "";
    expect(handler).toContain("openDbmQueryDetail({");
    expect(handler).toContain('from: "queries"');
    expect(handler).not.toContain("stream:");
  });

  /**
   * Server rows seed the detail header with the statement they hold — with no
   * client row anywhere, the header would otherwise paint the bare hash. Both
   * fallback lists carry the seed.
   */
  it.each([
    ["QueriesPage.vue server rows", "openServerQueryDetail", list],
    ["SamplesPage.vue server rows", "openServerSampleDetail", read("SamplesPage.vue")],
  ])("%s seed the statement into the detail page", (_name, handlerName, source) => {
    const handler = source.split(`const ${handlerName}`)[1]?.split("\n};")[0] ?? "";
    expect(handler).toContain("seed: row.query");
    expect(handler).toContain("query_norm: row.query");
  });

  /**
   * The client coverage line keys on what the FETCH found, never on `row`
   * alone: a seed painting the header is not client data, and on a
   * server-vantage-only entry the line's "nothing to measure" would sit
   * directly under a section full of measurements.
   *
   * Rule A adds an outer gate — the line describes the coverage of a TRACE
   * read, so it goes with the rest of the trace vantage — but the fetched-row
   * distinction inside it is unchanged and still load-bearing for the
   * partially-instrumented case.
   */
  it("gates the coverage line on the fetched client row, not the seed", () => {
    expect(detail).toMatch(/v-if="traceVantage && \(clientRowFound \|\| !serverAnswering\)"/);
    expect(detail).toMatch(/clientRowFound\.value = fetched !== null;/);
  });

  /**
   * In fallback mode the tab badge counts the database-reported list the page
   * is SHOWING, as a capped claim — a shared-snapshot `0` above rendered rows
   * denies working data, the same false-zero rule the fleet badge follows.
   * Both fallback pages carry the override.
   *
   * The claim also carries the `server` VANTAGE, because this override is the
   * third of the three reads that can feed one badge (F4). Without it the
   * strip would print the trace qualifier over a database-reported count.
   */
  it.each([
    ["QueriesPage.vue", list],
    ["SamplesPage.vue", read("SamplesPage.vue")],
  ])("%s claims its fallback rows on the tab badge, cap disclosed", (_page, source) => {
    expect(source).toMatch(
      /countClaim\(serverRows\.value\.length, serverTruncated\.value, "server"\)/,
    );
  });
});

describe("the database-reported fallback list on Slowest calls", () => {
  const samples = read("SamplesPage.vue");

  /**
   * Same contract as the Top-queries fallback: the server list answers ONLY
   * the page whose client vantage is empty. A populated client table must
   * clear it — in-engine durations under a live client list would read as
   * traced calls that never existed.
   *
   * And, as there, the rows ride the page's own response rather than a second
   * request: the server runs the conditional, so a page with rows never pays
   * for the fallback body at all.
   */
  it("shows the server list only when the client read came back empty", () => {
    expect(samples).toMatch(/if \(hits\.length\) \{\s*\n\s*serverRows\.value = \[\];/);
    expect(samples).toMatch(/serverRows\.value = \(fallback\?\.hits \?\? \[\]\)/);
    expect(samples).toContain("includeServerFallback: true");
  });

  /**
   * A server execution drills into the same detail page as a client sample,
   * keyed by URL params alone — no stream (a server record cannot know one)
   * and `from: "samples"` so the back affordance returns here, not to Top
   * queries.
   */
  it("navigates server rows to the detail page without inventing a stream", () => {
    const handler = samples.split("const openServerSampleDetail")[1]?.split("\n};")[0] ?? "";
    expect(handler, "openServerSampleDetail must exist").not.toBe("");
    expect(handler).toContain("openDbmQueryDetail({");
    expect(handler).toContain('from: "samples"');
    expect(handler).not.toContain("stream:");
  });
});
