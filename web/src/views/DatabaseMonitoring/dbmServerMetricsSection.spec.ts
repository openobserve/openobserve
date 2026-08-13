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
 * The convention in this directory: there is no `mount()` harness for
 * `views/DatabaseMonitoring/` — see dbmRequestGuard.spec.ts for the reason.
 * So WIRING is pinned here and VALUES live in a pure function with its own
 * unit test — `utils/dbm/serverMetrics.spec.ts`.
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
    // The client label carries the NFR-5 STANDING disclosure: client-vantage
    // figures cover completed calls only. It used to be a conditional insight
    // card, which meant the one bias that is always true was only ever stated
    // when a heuristic happened to fire.
    expect(messages.dbm.detail.serverMetrics.clientSubtitle).toBe(
      "Client-observed — instrumented callers only, finished calls only. " +
        "A query still running, or one that hung, isn't in these numbers.",
    );
  });

  /**
   * The four non-data states each render their own sentence. Collapsing any
   * two sends the reader after a fix that is not the one they need — the worst
   * case being a FAILED read rendered as `off`, which prescribes reconfiguring
   * a collector that may be fine.
   */
  it("renders all four non-data states separately", () => {
    for (const key of ["noMatch", "ambiguous", "off", "readFailed"]) {
      expect(page).toContain(`dbm.detail.serverMetrics.${key}`);
    }
  });

  /**
   * Failed ≠ off, in copy and in data. The read's lifecycle is tracked apart
   * from its result: a thrown request lands in `failed` — never in the empty
   * envelope's `off` — and the failed copy must not claim capture is off.
   */
  it("keeps a failed read distinct from capture-off", () => {
    const sm = messages.dbm.detail.serverMetrics;
    expect(sm.readFailed).toBeTruthy();
    expect(sm.readFailed).not.toEqual(sm.off);
    expect(sm.readFailedHint.toLowerCase()).not.toContain("collector");
    // The catch path marks the READ failed rather than synthesising an off
    // envelope the response never sent.
    const catchBlock = page.slice(page.indexOf("const loadServerMetrics"));
    expect(catchBlock).toContain('serverMetricsRead.value = "failed"');
    expect(page).toContain("dbm-detail-server-metrics-failed");
  });

  /**
   * `off` may only render once a read has ANSWERED. While it is in flight the
   * section makes no claim — which sentence applies is exactly what is still
   * unknown — so the off line is gated on the lifecycle, not just the state.
   */
  it("never shows the off copy while the read is loading", () => {
    const offIdx = page.indexOf('dbm-detail-server-metrics"');
    const offBranch = page.slice(page.lastIndexOf("v-if=", offIdx), offIdx);
    expect(offBranch).toContain("serverMetricsRead === 'done'");
    expect(offBranch).toContain("serverMetrics.state === 'off'");
  });

  /**
   * The off line carries the fix, not just the diagnosis: a "Set up" button
   * routed to the same setup destination as the list pages' empty states, with
   * the env-var detail demoted to tooltip depth (operator detail, not headline
   * copy).
   */
  it("wires the off state's Set up action to the DBM setup route", () => {
    expect(page).toContain("dbm-detail-server-metrics-setup");
    expect(page).toContain("DBM_SETUP_ROUTE");
    expect(page).toContain("org_identifier");
    // The env var survives, but as tooltip content on the one-liner.
    expect(messages.dbm.detail.serverMetrics.offHint).toContain(
      "ZO_DB_MONITORING_TOP_QUERY_ENABLED",
    );
    const offIdx = page.indexOf("dbm-detail-server-metrics-off");
    const offBlock = page.slice(offIdx, page.indexOf("</span>", offIdx));
    expect(offBlock).toContain("OTooltip");
    expect(offBlock).toContain("offHint");
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
