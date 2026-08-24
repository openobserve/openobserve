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
 * The Metrics tab's wiring, pinned structurally.
 *
 * The tab is reachable through five files that know nothing of each other —
 * the route table, the shell's keep-alive list, the tab strip, the nav rail
 * and the page itself — and dropping any ONE of them fails silently: the page
 * still compiles, the others still render, and only a user notices the tab
 * refetching on every return or the rail unlighting. Source-read like its
 * siblings (see dbmEventTabScope.spec.ts) because mounting these views needs a
 * router, a store and a dozen O2 children, and a harness that heavy fails for
 * unrelated reasons and gets deleted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const page = read("MetricsPage.vue");
const shell = read("DbmShell.vue");
const router = read("../../composables/shared/router.ts");
const tabs = read("../../components/dbm/DbmSectionTabs.vue");
const nav = read("../../lib/core/Navbar/navGroups.ts");
const panel = read("../../components/dbm/DbmMetricPanel.vue");

describe("dbm metrics tab wiring", () => {
  it("registers the route with keep-alive under the DBM shell", () => {
    expect(router).toMatch(/name:\s*"dbmMetrics"/);
    const block = router.slice(router.indexOf('name: "dbmMetrics"'));
    expect(block.slice(0, 200)).toMatch(/keepAlive:\s*true/);
  });

  it("names the page so the shell's keep-alive include matches it", () => {
    expect(page).toContain('defineOptions({ name: "DbmMetricsPage" })');
    expect(shell).toContain('"DbmMetricsPage"');
  });

  it("fans the badge counts out on the metrics route too", () => {
    expect(shell).toMatch(/DBM_TAB_STRIP_ROUTES = new Set\(\[[^\]]*"dbmMetrics"/s);
  });

  it("adds the tab to the strip and maps the route back to it", () => {
    expect(tabs).toMatch(/dbmMetrics:\s*"metrics"/);
    expect(tabs).toMatch(/key:\s*"metrics"/);
    // Scope must carry across tabs like every sibling.
    expect(tabs).toMatch(/name:\s*"dbmMetrics",\s*query:\s*carriedQuery\.value/);
  });

  it("keeps the nav rail lit while standing on the metrics tab", () => {
    expect(nav).toMatch(/activeOnRoutes:\s*\[[^\]]*"dbmMetrics"/s);
  });

  it("renders a clearable control for every dimension the panels scope by", () => {
    // The applied-but-invisible rule (dbmEventTabScope.spec.ts): scope that
    // narrows the charts must be visible and clearable on the same page.
    expect(page).toContain("DbmScopeFilters");
    expect(page).toMatch(/@clear="clearScope"/);
    expect(page).toContain("useDbmScopeFilters");
  });

  it("hands the dashboards engine microseconds, not milliseconds", () => {
    // `new Date(µs)` round-trips the microsecond count through .getTime();
    // dividing by 1000 renders a 1970 window. See LLMSchemaPanel.
    expect(page).toContain("new Date(current.value.startTime)");
    expect(page).not.toContain("startTime / 1000");
    expect(panel).toContain("new Date(props.startTime)");
  });

  it("remounts every chart when the scope or window moves", () => {
    // The dashboards engine fetches on mount, so the key must carry both.
    expect(page).toMatch(/:key="`\$\{entry\.key\}::\$\{chartEpoch\}`"/);
    expect(page).toMatch(/current\.value\.startTime,\s*current\.value\.endTime/s);
  });

  it("defers the dashboards engine off the DBM shell's initial chunk", () => {
    expect(panel).toMatch(
      /defineAsyncComponent\(\s*\(\) => import\("@\/components\/dashboards\/PanelSchemaRenderer\.vue"\)/,
    );
  });
});
