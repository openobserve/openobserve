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
 * Why Slowest calls can be empty while Top queries lists 50 statements.
 *
 * Reported from a no-traces org: the tab strip read `Top queries 50+ server
 * counted` beside a `Slowest calls` tab with no badge and an empty table, and
 * the reasonable reading was "this tab is broken".
 *
 * It is not. The two zero-trace fallbacks read DIFFERENT database features and
 * only one of them is on by default:
 *
 *   • `/server_queries` reads the cumulative counter tables
 *     (`pg_stat_statements`), populated on any instance with the extension
 *     loaded. This is why Top queries degrades gracefully.
 *   • `/server_samples` reads the SLOW-QUERY LOG, which ships OFF —
 *     `log_min_duration_statement = -1` on PostgreSQL, `long_query_time = 10`
 *     on MySQL. An untouched install logs nothing, so the feed is legitimately
 *     empty.
 *
 * So the page-level fallback was never missing: SamplesPage already requests
 * `include_server_fallback`, holds `serverRows`, swaps its subtitle and renders
 * a database-reported table, exactly mirroring QueriesPage. What was missing
 * was the DISCLOSURE — the API returns `server_samples_capture` ("on"/"off")
 * and nothing in the UI read it, so the one state with an action attached
 * ("switch the log on") was indistinguishable from "nothing was slow".
 *
 * Source-read, like its siblings: these views need a router, a store and a
 * dozen O2 children to mount, and the claims below are structural.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

const templateOf = (source: string): string => {
  const end = source.indexOf("<script setup");
  expect(end).toBeGreaterThan(-1);
  return source.slice(0, end);
};

describe("Slowest calls degrades like Top queries", () => {
  /**
   * The page-level fallback, pinned so it cannot be lost. This is the half
   * that was already correct, and the half a fix aimed at the wrong layer
   * would have duplicated.
   */
  it("asks for the database-reported fallback in the same request", () => {
    expect(read("SamplesPage.vue")).toContain("includeServerFallback: true");
  });

  it("mirrors the Top-queries fallback: same flag, same one round trip", () => {
    // Both pages ask the same way, so neither can silently stop degrading.
    expect(read("QueriesPage.vue")).toContain("includeServerFallback: true");
  });

  it("renders the database-reported list when no traced calls landed", () => {
    const template = templateOf(read("SamplesPage.vue"));

    expect(template).toContain('data-test="dbm-server-samples-table"');
    expect(template).toContain("serverListShown");
  });

  /**
   * The badge counts what the tab SHOWS. Without this override the shared
   * client-vantage zero would blank the badge over a visible list of rows.
   *
   * PUBLISHED to the shared snapshot rather than substituted into this page's
   * own copy, so the number is on the strip from every tab and not only while
   * standing here. See dbmTabCountsResilience.spec.ts.
   */
  it("counts the reported list on the badge, carrying the server vantage", () => {
    const source = read("SamplesPage.vue");
    const start = source.indexOf("ownCounts:");
    expect(start, "SamplesPage must publish its own badge").toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("\n  ],", start));

    expect(block).toContain("sampleCallsCount");
    expect(block).toContain('"server"');
  });
});

describe("the slow-query-log-off state names itself", () => {
  /**
   * The flag the API was already returning and nothing read. This is the whole
   * fix: the distinction between "the log is off" and "nothing was slow"
   * exists on the wire and now reaches the reader.
   */
  it("captures server_samples_capture off the fallback envelope", () => {
    const source = read("SamplesPage.vue");

    expect(source).toContain("serverSamplesCapture");
    expect(source).toContain("fallback?.server_samples_capture ?? null");
  });

  /**
   * Only when the databases actually ANSWERED. A failed fallback read is
   * `null` — unknown — and unknown must not print as a diagnosis, the same
   * null-is-a-failed-read rule the rest of DBM keeps.
   */
  it("claims the log is off only on an explicit off, with no rows either way", () => {
    const source = read("SamplesPage.vue");
    const start = source.indexOf("const serverLogOff");
    const block = source.slice(start, source.indexOf("\n);", start));

    expect(block).toContain('serverSamplesCapture.value === "off"');
    expect(block).toContain("!allRows.value.length");
    expect(block).toContain("!serverRows.value.length");
    expect(block).toContain("!loading.value");
  });

  it("renders the disclosure instead of the generic trace empty state", () => {
    const template = templateOf(read("SamplesPage.vue"));
    const noteAt = template.indexOf('data-test="dbm-samples-log-off"');
    const genericAt = template.indexOf("<DbmEmptyState");

    expect(noteAt).toBeGreaterThan(-1);
    // Before the generic state, and on a `v-else-if` chain — the generic one
    // reasons about TRACES, and this is a database setting it cannot diagnose.
    expect(noteAt).toBeLessThan(genericAt);
    expect(template).toContain('v-else-if="serverLogOff"');
  });

  /** A claim from a previous window must not survive onto a list it does not describe. */
  it.each([
    ["a traced answer", "serverSamplesCapture.value = null;"],
    ["a failed request", "serverSamplesCapture.value = null;"],
  ])("withdraws the claim on %s", (_case, expected) => {
    const source = read("SamplesPage.vue");
    const occurrences = source.match(/serverSamplesCapture\.value = null;/g) ?? [];
    // Both reset paths: the traced branch and the failure `reset`.
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain(expected);
  });

  /**
   * The copy has to name the SETTING, or the reader cannot act on it — and it
   * has to say why the sibling tab still works, which is the actual question
   * the empty page raises.
   */
  it("names the setting and explains the sibling tab", () => {
    const en = JSON.parse(
      readFileSync(join(here, "../../locales/languages/en-US.json"), "utf8"),
    ) as Record<string, never>;
    const samples = (en as unknown as { dbm: { samples: Record<string, string> } }).dbm.samples;

    expect(samples.logOffDescription).toContain("log_min_duration_statement");
    expect(samples.logOffDescription).toContain("long_query_time");
    expect(samples.logOffDescription).toContain("Top queries");
  });
});
