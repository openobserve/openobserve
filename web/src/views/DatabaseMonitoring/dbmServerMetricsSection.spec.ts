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
 * W6 wiring, asserted by SOURCE READ.
 *
 * The convention in this directory (`dbmFleetDefaultSort`, `dbmLockAlertAction`,
 * `dbmActivityRowNavigation`): there is no `mount()` harness for
 * `views/DatabaseMonitoring/`, and five specs document the decision not to
 * build one. So WIRING is pinned here and VALUES live in a pure function with
 * its own unit test — `utils/dbm/serverMetrics.spec.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

const page = readFileSync(resolve(__dirname, "./QueryDetailPage.vue"), "utf8");
const messages = JSON.parse(
  readFileSync(resolve(__dirname, "../../locales/languages/en-US.json"), "utf8"),
) as { dbm: { detail: { serverMetrics: Record<string, string> } } };

describe("W6 server metrics section wiring", () => {
  it("reads the endpoint through the service layer", () => {
    expect(page).toContain("getQueryServerMetrics");
  });

  /**
   * The join key is (engine, database, fingerprint). All three must reach the
   * request or the backend 400s — and `instance` must NOT, because omitting it
   * is what lets the join survive a connection pooler.
   */
  it("sends every part of the join key", () => {
    const call = page.slice(page.indexOf("getQueryServerMetrics("));
    const args = call.slice(0, call.indexOf("});"));
    expect(args).toContain("fingerprint");
    expect(args).toContain("engine");
    expect(args).toContain("database");
  });

  it("renders the value tiles from the pure read layer, not inline arithmetic", () => {
    expect(page).toContain("serverMetricsTiles");
    expect(page).toContain("readServerMetrics");
  });

  /**
   * Provenance is STRUCTURAL, not a tooltip: the two vantages sit under two
   * separate headings that each say who was measured. A reader must not have
   * to hover to learn that one block excludes uninstrumented clients.
   */
  it("labels both vantages in the markup", () => {
    expect(page).toContain("dbm.detail.serverMetrics.subtitle");
    expect(page).toContain("dbm.detail.serverMetrics.clientSubtitle");
    expect(messages.dbm.detail.serverMetrics.subtitle).toBe("Server-side — all clients");
    expect(messages.dbm.detail.serverMetrics.clientSubtitle).toBe(
      "Client-observed — instrumented callers only",
    );
  });

  /**
   * The three absence states each render their own sentence. Collapsing any
   * two sends the reader after a fix that is not the one they need.
   */
  it("renders all three absence states separately", () => {
    for (const key of ["noMatch", "ambiguous", "off"]) {
      expect(page).toContain(`dbm.detail.serverMetrics.${key}`);
    }
  });

  /** "No server match" is ordinary, so it must not use the error styling. */
  it("does not render the no-match state as an error", () => {
    const idx = page.indexOf("dbm-detail-server-metrics-unmatched");
    expect(idx).toBeGreaterThan(-1);
    const block = page.slice(idx - 400, idx + 400);
    expect(block).not.toContain("text-negative");
    expect(block).not.toContain("text-error");
  });

  /**
   * The honesty contract, across BOTH the rendered section and its copy: no
   * percentile may be claimed for a feed that has none, and no figure may span
   * the two vantages.
   */
  it("claims no percentile and derives no cross-vantage figure", () => {
    const start = page.indexOf("dbm-detail-server-metrics");
    expect(start).toBeGreaterThan(-1);
    const section = page.slice(start, page.indexOf("</section>", start)).toLowerCase();
    for (const banned of ["p95", "p99", "percentile", "network", "overhead"]) {
      expect(section).not.toContain(banned);
    }
    const copy = JSON.stringify(messages.dbm.detail.serverMetrics).toLowerCase();
    for (const banned of ["p95", "p99", "percentile", "network time", "overhead"]) {
      expect(copy).not.toContain(banned);
    }
  });

  /**
   * `exec_time_s` folds Postgres execution time and MySQL wait time into one
   * storage field, so the two engines need two different labels — and the
   * component must resolve the label the read layer chose rather than
   * hardcoding one of them.
   */
  it("keeps the per-engine exec-time labels distinct and resolves them dynamically", () => {
    const sm = messages.dbm.detail.serverMetrics;
    expect(sm.meanExecution).not.toEqual(sm.meanWait);
    expect(sm.meanExecution.toLowerCase()).toContain("mean");
    expect(sm.meanWait.toLowerCase()).toContain("mean");
    // The tile's own labelKey drives the lookup, so a MySQL query cannot be
    // labelled with the Postgres measurement.
    expect(page).toContain("`dbm.detail.serverMetrics.${");
  });

  /** The ambiguity copy must name the candidates, and the page must pass them. */
  it("names the candidate instances in the ambiguity copy and passes them in", () => {
    expect(messages.dbm.detail.serverMetrics.ambiguousHint).toContain("{instances}");
    expect(page).toContain("candidateInstances");
  });
});
