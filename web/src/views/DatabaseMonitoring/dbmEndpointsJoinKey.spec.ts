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
 * D5 join-key wiring for the CALLERS read, asserted by SOURCE READ.
 *
 * Same convention as its siblings in this directory: there is no `mount()`
 * harness for `views/DatabaseMonitoring/` (see dbmRequestGuard.spec.ts), so
 * wiring is pinned here and values live in tested pure functions.
 *
 * **What this guards.** A fingerprint hashes statement TEXT ONLY, so it is not
 * a join key — one statement running on two engines is ONE fingerprint. The
 * callers section is the one place a server-vantage row is enriched FROM the
 * trace vantage (D5), so an unscoped read hands another engine's services to a
 * row whose counters came from exactly one engine.
 *
 * Measured live, org `default`, fp `69219a9c7fc5039d` over 7d:
 *
 * | read                    | calls   | names `dbm-sv-workload`? |
 * |-------------------------|---------|--------------------------|
 * | unscoped                | 343,055 | YES                      |
 * | `system=postgresql`     | 125,195 | no                       |
 * | `system=mysql`          | 217,861 | YES                      |
 *
 * `dbm-sv-workload` calls MySQL only. Unscoped, it is named as a caller of the
 * Postgres row. That failure returns 200 with plausible-looking rows — there is
 * no error to notice — which is precisely why it is pinned at the source.
 *
 * The page has TWO endpoint reads that fill the SAME table: the cold load rides
 * `/query/history?include_endpoints=true`, and the stream-pick path refetches
 * via `/query/endpoints`. Both are asserted, because a scope carried on only
 * one of them means picking a stream silently widens what the table shows.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

const page = readFileSync(resolve(__dirname, "./QueryDetailPage.vue"), "utf8");

/** The argument object of `fn(` at its first occurrence in the page source. */
const argsOf = (fn: string): string => {
  const start = page.indexOf(fn);
  expect(start).toBeGreaterThan(-1);
  const call = page.slice(start);
  const end = call.indexOf("});");
  expect(end).toBeGreaterThan(-1);
  const args = call.slice(0, end);
  // Guard: prove the slice really is the call's arguments and not an empty
  // tail, so a `toContain` below cannot pass on a substring of nothing.
  expect(args.length).toBeGreaterThan(60);
  return args;
};

describe("D5 callers read carries the composite join key", () => {
  /**
   * The stream-pick refetch. This is the read that had no scope at all: it
   * asked for one fingerprint on one stream, and got back every engine that
   * shares the statement text.
   */
  it("scopes the standalone endpoints read by engine and database", () => {
    const args = argsOf("getQueryEndpoints(");
    expect(args).toContain("fingerprint");
    expect(args).toContain("system");
    expect(args).toContain("namespace");
  });

  /**
   * The cold-load read, which fills the same table from the same aggregation.
   * Pinned alongside so the two paths cannot drift into disagreeing about what
   * the table is scoped to.
   */
  it("scopes the folded endpoints read the same way", () => {
    const args = argsOf("getQueryHistory(");
    // The flag is what makes this read fill the callers table at all, so the
    // scope assertions below are only meaningful while it is present.
    expect(args).toContain("includeEndpoints: true");
    expect(args).toContain("system");
    expect(args).toContain("namespace");
  });

  /**
   * Both reads must resolve the scope from the SAME source, or the table's
   * contents depend on which path filled it. The page's scope is the route
   * query, read through these two computeds.
   */
  it("resolves both reads' scope from the page's own filters", () => {
    for (const fn of ["getQueryEndpoints(", "getQueryHistory("]) {
      const args = argsOf(fn);
      expect(args).toContain("systemFilter.value");
      expect(args).toContain("namespaceFilter.value");
    }
  });

  /**
   * `instance` is deliberately NOT part of the server-metrics key (it must
   * survive a connection pooler), but the callers read is a RAW SPAN read where
   * the instance is the client's own view and filtering by it is sound — the
   * history read already sends it. This pins that the endpoints read does not
   * accidentally acquire a key the two paths do not share.
   */
  it("keeps the two reads' engine/database scope in agreement", () => {
    const endpoints = argsOf("getQueryEndpoints(");
    const history = argsOf("getQueryHistory(");
    for (const key of ["system:", "namespace:"]) {
      expect(endpoints).toContain(key);
      expect(history).toContain(key);
    }
  });
});

/**
 * The ATTRIBUTION rule has one implementation.
 *
 * `utils/dbm/overlapJoin.ts` owns the composite key — that mysql/mariadb drop
 * `database`, and that a Postgres row without one is REFUSED rather than
 * guessed. The callers fold must ask IT whether a scope is joinable, never
 * re-derive the answer, because the two copies drift silently: the wrong one
 * still returns rows.
 *
 * NOTE this is deliberately not asserted against the VIEW. The view's
 * `databaseless` branch (`engine === "mysql" || engine === "mariadb"`) belongs
 * to a different endpoint — `/query/insights`, whose server-metrics half takes
 * `database` as a REQUIRED key part and must be told to omit it. That is the
 * endpoint's own contract, not a second copy of the join key.
 */
describe("the attribution rule has one implementation", () => {
  const callingServices = readFileSync(
    resolve(__dirname, "../../utils/dbm/callingServices.ts"),
    "utf8",
  );

  it("derives the callers fold's key from overlapJoin, not a local copy", () => {
    expect(callingServices).toContain('import { overlapJoinKey } from "./overlapJoin"');
  });

  it("refuses to attribute rather than guessing when the scope is unjoinable", () => {
    // The pooler-refusal precedent: withhold the numbers and say why. The fold
    // returns no attribution when `overlapJoinKey` returns null — it must not
    // fall back to naming the fingerprint's callers across every engine.
    expect(callingServices).toContain('nothing("unjoinable"');
  });
});
