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
 * The loading skeleton covers the database-reported fallback list.
 *
 * On an org with no trace streams the client read short-circuits in
 * single-digit milliseconds, so a fallback fetched SEPARATELY produced this
 * sequence: the empty state pops with no visible loading at all, then the
 * database-reported table appears beneath it ~half a second later. Next to
 * tabs whose reads are slow enough to draw the skeleton, the jump reads as
 * broken — and the page repaints twice for one question.
 *
 * That used to be held by `await`ing a second request inside `load()`, which
 * kept `loading` true for its duration. The fallback rides the PRIMARY
 * response now (`include_server_fallback`): the server runs the same
 * conditional and returns the rows in the response that decides they are
 * needed. So the property is no longer maintained by an `await` that could be
 * dropped — there is no second read for the skeleton to race, which is the
 * stronger form of the same guarantee, and it also removes the round trip the
 * old shape spent on the deployment least able to spare it.
 *
 * What this pins is that structural property: the flag is asked for, the rows
 * are read off the response, and NO page fires a separate fallback request
 * — awaited or otherwise.
 *
 * Source-read like dbmRequestGuard.spec.ts, and for the same reason: these
 * views need a router, a store and a dozen O2 children to mount, and a
 * harness that heavy fails for unrelated reasons and gets deleted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/** The two trace-derived pages, paired with the service call they fall back on. */
const PAGES: Array<[page: string, primary: string, fallbackCall: string]> = [
  ["QueriesPage.vue", "getQueries(", "getServerQueries("],
  ["SamplesPage.vue", "getSamples(", "getServerSamples("],
];

describe("DBM fallback lists ride the primary response", () => {
  it.each(PAGES)("%s asks for the fallback section on its own read", (page, primary) => {
    const source = read(page);
    const start = source.indexOf(primary);
    expect(start, `${page} must call ${primary}`).toBeGreaterThan(-1);
    const call = source.slice(start, source.indexOf("});", start));
    // Guard: prove the slice is the call's arguments, not an empty tail.
    expect(call.length).toBeGreaterThan(60);
    expect(call).toContain("includeServerFallback: true");
  });

  it.each(PAGES)("%s reads the fallback rows off that response", (page) => {
    const source = read(page);
    expect(source).toContain("data.server_fallback");
  });

  /**
   * The old failure mode, closed by construction: the FALLBACK LIST is never
   * a separate request, so there is nothing to fire unawaited and nothing that
   * can land after the skeleton has cleared.
   *
   * Scoped to the fallback path specifically. A page may legitimately read
   * `/server_queries` for a DIFFERENT question — QueriesPage joins the
   * database's own counters onto a POPULATED client table, which is the case
   * the fallback deliberately skips — and that read is a separate request by
   * necessity: it is needed exactly when the fallback is not. What keeps it
   * safe is the property below, not its absence.
   */
  it.each(PAGES)("%s never reads its fallback list from a separate request", (page) => {
    const source = read(page);
    // The fallback rows come off the primary response, never a second call
    // whose result is assigned to the fallback list.
    expect(source).not.toMatch(/serverRows\.value = \(?await/);
    expect(source).not.toMatch(/void loadServer(Queries|Samples)\(/);
  });

  /**
   * Any auxiliary server read a page does make is AWAITED inside the page's
   * own `load`, so the skeleton covers it too. An unawaited one would land
   * after `loading` cleared and repaint the table a second time — the exact
   * two-paint sequence this file exists to prevent, arriving by a new route.
   */
  it("QueriesPage awaits its server-counter read inside the tracked load", () => {
    const source = read("QueriesPage.vue");
    const start = source.indexOf("const loadQueries =");
    expect(start, "loadQueries must exist").toBeGreaterThan(-1);
    const body = source.slice(start);
    expect(body).toContain("await loadServerCounters(");
  });

  /**
   * The counter read must not be able to fail the page. It improves two
   * columns; a logs-stream permission the reader lacks has to leave the table
   * exactly as it was rather than erroring a load that otherwise succeeded.
   */
  it("QueriesPage swallows a failed server-counter read", () => {
    const source = read("QueriesPage.vue");
    const start = source.indexOf("const loadServerCounters =");
    expect(start, "loadServerCounters must exist").toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("const loadQueries =", start));
    expect(body).toContain("catch");
    // No rethrow, and no assignment to the page's error state.
    expect(body).not.toContain("throw");
    expect(body).not.toMatch(/error\.value\s*=/);
  });
});
