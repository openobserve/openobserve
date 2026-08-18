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
  /**
   * Through the service layer, and through the MERGED endpoint: the counters
   * and the plans list were always co-fired from this page — same logs stream,
   * same schema read, same records, same window — so they ride one request.
   * The section it returns is `/query/server_metrics`'s own envelope, which is
   * why nothing below this line had to change shape.
   */
  it("reads the endpoint through the service layer", () => {
    expect(page).toContain("getQueryInsights");
    // And no longer pays for a second round trip to the endpoint the merged
    // one supersedes.
    expect(page).not.toContain("getQueryServerMetrics");
    expect(page).not.toContain("getQueryPlans");
  });

  /**
   * The join key is (engine, database, fingerprint). All three must reach the
   * request or no counters can be matched — and `instance` must NOT, because
   * omitting it is what lets the join survive a connection pooler.
   */
  it("sends every part of the join key", () => {
    const start = page.indexOf("getQueryInsights(");
    expect(start).toBeGreaterThan(-1);
    const call = page.slice(start);
    const args = call.slice(0, call.indexOf("});"));
    // Guard: prove the slice is the call's arguments and not an empty tail.
    expect(args.length).toBeGreaterThan(60);
    expect(args).toContain("fingerprint");
    expect(args).toContain("engine");
    expect(args).toContain("database");
    // The instance is the one dimension that must stay out of the key.
    expect(args).not.toContain("instance");
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
   * from its result: a failed read lands in `failed` — never in the empty
   * envelope's `off` — and the failed copy must not claim capture is off.
   *
   * The merge did not weaken this; it moved where the distinction is MADE. The
   * server now tells us which of the two happened, because it can: a `null`
   * section with `server_metrics_read_failed` false means "we did not look"
   * (no join key), and with it true means "we looked and could not read". The
   * page reads the flag rather than inferring failure from a thrown request,
   * so a per-section failure inside a 200 is no longer invisible to it.
   */
  it("keeps a failed read distinct from capture-off", () => {
    const sm = messages.dbm.detail.serverMetrics;
    expect(sm.readFailed).toBeTruthy();
    expect(sm.readFailed).not.toEqual(sm.off);
    expect(sm.readFailedHint.toLowerCase()).not.toContain("collector");

    const start = page.indexOf("const loadQueryInsights");
    expect(start).toBeGreaterThan(-1);
    const loader = page.slice(start, page.indexOf("\nconst ", start + 30));
    // Guard: prove the slice is the real loader, not an empty tail.
    expect(loader.length).toBeGreaterThan(400);
    expect(loader).toContain("getQueryInsights(");

    // The section's own flag drives the state — never a synthesised off
    // envelope the response did not send.
    expect(loader).toContain(
      'serverMetricsRead.value = data.server_metrics_read_failed ? "failed" : "done"',
    );
    // A thrown request is still `failed` too: a request that never arrived
    // says nothing about whether capture is running.
    expect(loader).toContain('serverMetricsRead.value = "failed"');
    expect(page).toContain("dbm-detail-server-metrics-failed");
  });

  /**
   * Per-section failure, not per-page: the plans list and the counters ride one
   * request now, and a failure in either must not blank the other. The server
   * returns each section nullable with its own flag for exactly this reason,
   * and the page must branch on them separately rather than treating one 200 as
   * all-or-nothing.
   */
  it("degrades the two merged sections independently", () => {
    const start = page.indexOf("const loadQueryInsights");
    const loader = page.slice(start, page.indexOf("\nconst ", start + 30));
    expect(loader.length).toBeGreaterThan(400);
    // Plans branch on their own section being present…
    expect(loader).toContain("if (data.plans)");
    // …and the counters on their own flag, in the same success path.
    expect(loader).toContain("data.server_metrics_read_failed");
    expect(loader).toContain("readServerMetrics(data.server_metrics)");
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
   * the collector detail demoted to tooltip depth (operator detail, not
   * headline copy).
   */
  it("wires the off state's Set up action to the DBM setup route", () => {
    expect(page).toContain("dbm-detail-server-metrics-setup");
    expect(page).toContain("DBM_SETUP_ROUTE");
    expect(page).toContain("org_identifier");
    // No env var to name any more — the server accepts the feed whenever DBM
    // is enabled, so the tooltip prescribes the collector recipe alone.
    expect(messages.dbm.detail.serverMetrics.offHint).not.toContain("ZO_DB_MONITORING");
    expect(messages.dbm.detail.serverMetrics.offHint.toLowerCase()).toContain(
      "top query collection",
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
    // The card shell is the shared `DbmSection` component now — the section
    // markup was identical across six cards — so the block closes on that tag.
    const end = page.indexOf("</DbmSection>", start);
    expect(end, "the server metrics section must be closed").toBeGreaterThan(start);
    const section = page.slice(start, end).toLowerCase();
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
