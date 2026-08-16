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
 * The query detail page's tabbed layout.
 *
 * The tab RESOLUTION logic is proved for real in
 * `utils/dbm/queryDetailTabs.spec.ts`; what is pinned here is the arrangement,
 * which is where a tabbed redesign actually goes wrong:
 *
 *  • identity stays OUT of the tabs (the statement, the chips) — a plan tree
 *    with the statement hidden one tab away is unreadable;
 *  • every section that existed before still exists, on exactly one panel —
 *    the failure mode of a re-organisation is a section quietly dropped;
 *  • the scope controls stay in the page header, so a window change applies to
 *    all three tabs rather than to whichever one is open.
 *
 * These are source assertions because mounting this page is impractical (it
 * pulls the router, the store, six services and a chart runtime — see
 * `dbmRequestGuard.spec.ts`), and they are the same technique the sibling
 * detail specs in this directory already use.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import messages from "@/locales/languages/en-US.json";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "QueryDetailPage.vue"), "utf8");

/** The template, so a string in a script comment cannot satisfy a placement test. */
const template = page.slice(0, page.indexOf("<script setup"));

/** Offset of a `data-test` marker in the template. */
const at = (dataTest: string): number => {
  const index = template.indexOf(`data-test="${dataTest}"`);
  expect(index, `the template must render ${dataTest}`).toBeGreaterThan(-1);
  return index;
};

/** The body of one `<OTabPanel name="…">`, to its closing tag. */
const panel = (name: string): string => {
  const open = template.indexOf(`<OTabPanel name="${name}"`);
  expect(open, `the ${name} panel must exist`).toBeGreaterThan(-1);
  const close = template.indexOf("</OTabPanel>", open);
  expect(close, `the ${name} panel must be closed`).toBeGreaterThan(open);
  return template.slice(open, close);
};

describe("the tab strip is built from the O2 tab primitives", () => {
  /**
   * The same components the L2 strip (`DbmSectionTabs`) uses, so this reads as
   * one more level of the app's own navigation rather than a bespoke switcher.
   */
  it("uses OTabs / OTab / OTabPanels / OTabPanel", () => {
    for (const component of ["OTabs", "OTab", "OTabPanels", "OTabPanel"]) {
      expect(page, `${component} must be imported`).toContain(
        `import ${component} from "@/lib/navigation/Tabs/${component}.vue"`,
      );
    }
    expect(template).toContain('data-test="dbm-detail-tabs"');
  });

  /** Three tabs, no more — the point was fewer, meaningful views. */
  it("renders exactly the three panels", () => {
    const panels = [...template.matchAll(/<OTabPanel name="([a-z]+)"/g)].map((m) => m[1]);
    expect(panels).toEqual(["overview", "plans", "callers"]);
  });

  /**
   * A locked tab needs the lock GLYPH as well as the dimming — dimmed text
   * alone reads as "broken", not "nothing filled this". Same treatment, same
   * primitives as the gated tabs on the L2 strip.
   */
  it("locks a tab with the lock icon and a tooltip, as the L2 strip does", () => {
    const strip = template.slice(at("dbm-detail-tabs"), template.indexOf("</OTabs>"));
    expect(strip).toContain('name="lock"');
    expect(strip).toContain('aria-hidden="true"');
    expect(strip).toContain("<OTooltip");
    expect(strip).toContain(":disable=");
  });
});

describe("identity and scope stay outside the tabs", () => {
  /**
   * THE load-bearing one. The statement, its chips and the truncation note are
   * what tell a reader which query they are looking at; behind a tab, the
   * plans panel becomes a tree of nodes for an unnamed statement.
   */
  it("keeps the statement and its identity chips above the tab strip", () => {
    const tabs = at("dbm-detail-tabs");
    expect(at("dbm-detail-identity"), "identity must precede the tabs").toBeLessThan(tabs);
    expect(at("dbm-detail-query-text"), "the statement must precede the tabs").toBeLessThan(tabs);
  });

  /**
   * The window picker, the copy-summary button and refresh stay in the page
   * header's `#actions`, so a window change re-scopes all three tabs. Inside a
   * panel they would appear to scope only the open one.
   */
  it("keeps the window, copy and refresh controls in the page header", () => {
    const actions = template.slice(
      template.indexOf("<template #actions>"),
      template.indexOf("</template>", template.indexOf("<template #actions>")),
    );
    for (const control of [
      "dbm-detail-date-time",
      "dbm-detail-copy-summary",
      "dbm-detail-refresh",
    ]) {
      expect(actions, `${control} belongs to the page header`).toContain(control);
    }
    // And none of them leaked into a panel.
    expect(at("dbm-detail-tabs")).toBeGreaterThan(template.indexOf("dbm-detail-date-time"));
  });
});

describe("every section survives the re-organisation, on exactly one panel", () => {
  /**
   * The failure mode of a re-arrangement is a section quietly lost in the
   * move. Each of the page's sections is named here with the panel it belongs
   * to, so a drop or a duplication fails rather than shipping.
   */
  const placement: Record<string, string[]> = {
    overview: [
      "dbm-detail-stats",
      "dbm-detail-plans-drift-top",
      "dbm-detail-server-metrics",
      "dbm-detail-coverage",
      "dbm-detail-below-top-n",
      "dbm-detail-latency-chart",
      "dbm-detail-volume-chart",
      "dbm-detail-where-it-runs",
      "dbm-detail-error-codes",
    ],
    plans: ["dbm-detail-plans"],
    callers: ["dbm-detail-stream-ambiguous", "dbm-detail-endpoints", "dbm-detail-samples"],
  };

  for (const [name, sections] of Object.entries(placement)) {
    for (const section of sections) {
      it(`renders ${section} on the ${name} panel`, () => {
        expect(panel(name)).toContain(`data-test="${section}"`);
      });
    }
  }

  /**
   * Not duplicated ACROSS panels: two copies of a table on two tabs is two
   * reads of one truth that can disagree on screen.
   *
   * Within a panel a marker may legitimately appear twice, and exactly one
   * does: `dbm-detail-server-metrics` labels the two mutually exclusive
   * branches of one section — the quiet "capture is off" line and the section
   * proper — which is a `v-if`/`v-else` pair, not a duplication. So the test
   * counts the PANELS a marker appears on rather than its raw occurrences.
   */
  it("renders each section on exactly one panel", () => {
    for (const section of Object.values(placement).flat()) {
      const panels = Object.keys(placement).filter((name) =>
        panel(name).includes(`data-test="${section}"`),
      );
      expect(panels, `${section} must live on exactly one panel`).toHaveLength(1);
    }
  });

  /**
   * And the one legitimate two-branch marker really is a `v-if`/`v-else` pair,
   * so "twice" can never quietly become "two rendered copies".
   */
  it("keeps the server-metrics off-line and section mutually exclusive", () => {
    const overview = panel("overview");
    const first = overview.indexOf('data-test="dbm-detail-server-metrics"');
    const second = overview.indexOf('data-test="dbm-detail-server-metrics"', first + 1);
    expect(second, "the off-line and the section are the two branches").toBeGreaterThan(first);
    // The second branch opens with v-else, so only one can ever render.
    expect(overview.slice(first, second)).toContain("v-else");
  });

  /**
   * The Rule-A/B hoist survives. On a zero-trace fleet the database's own
   * counters must LEAD the client tiles, and that is expressed as flex
   * `order-*` on the two blocks — which only works while they share one flex
   * parent, i.e. the same panel.
   */
  it("keeps the two overlap vantages on one flex parent so the hoist still works", () => {
    const overview = panel("overview");
    expect(overview).toContain("order-1");
    expect(overview).toContain("order-2");
    expect(overview).toContain('layout="flex-col"');
  });
});

describe("the tab lives in the URL", () => {
  /**
   * This page is pasted into incident channels, so the tab the sender was
   * reading has to survive the paste — the same reason the window and the
   * dimension filters already ride the URL.
   */
  it("reads the active tab from the route, not from local state", () => {
    expect(page).toContain("resolveQueryDetailTab(route.query.tab)");
    expect(page, "the tab must not be a plain ref").not.toMatch(/const activeTab = ref\(/);
  });

  /**
   * `replace`, not `push`: three views of one query is not three navigations,
   * and pushing would make Back walk the reader through every tab they glanced
   * at instead of returning them to the list they came from.
   */
  it("replaces rather than pushes when switching tab", () => {
    const start = page.indexOf("const selectTab =");
    expect(start, "selectTab must exist").toBeGreaterThan(-1);
    const handler = page.slice(start, page.indexOf("\n};", start));
    expect(handler).toContain("router.replace");
    expect(handler).not.toContain("router.push");
    // The rest of the query survives — dropping it would reset the window and
    // the dimension filters on every tab click.
    expect(handler).toContain("...route.query");
  });

  /**
   * `?from=` is the L2 strip's ORIGIN key and `?tab=` is this page's own. They
   * are different questions and the back target must keep reading `from`.
   */
  it("leaves the ?from= origin handling untouched", () => {
    expect(page).toContain("const backTarget = computed(");
    expect(page).toContain("route.query.from as string");
  });

  /**
   * `?tab=` must not ride the L2 strip out to the list pages.
   *
   * That strip spreads the current scope through every tab link so filters and
   * the window survive a tab switch — and it already drops the three keys that
   * mean something only on the detail page. `tab` is a fourth: it names no view
   * on a table, and carrying it puts a stale detail-page key in every list URL
   * a reader then shares.
   */
  it("keeps the in-page tab out of the L2 strip's carried scope", () => {
    const strip = readFileSync(join(here, "../../components/dbm/DbmSectionTabs.vue"), "utf8");
    const start = strip.indexOf("const carriedQuery = computed(");
    expect(start, "carriedQuery must exist").toBeGreaterThan(-1);
    const body = strip.slice(start, strip.indexOf("\n});", start));
    // Destructured out of the spread, alongside the other detail-only keys.
    expect(body).toMatch(/const \{[^}]*\btab\b[^}]*\} = route\.query/);
  });
});

describe("the callers tab locks instead of opening empty", () => {
  /**
   * Both of its sections are trace-gated, so with no trace vantage the panel
   * would be a blank box — which reads as "nothing calls this", the exact
   * false finding Rule A exists to prevent. Locked, with the reason.
   */
  it("disables the callers tab when there is no trace vantage", () => {
    const start = page.indexOf("const detailTabs = computed(");
    expect(start, "detailTabs must exist").toBeGreaterThan(-1);
    const tabs = page.slice(start, page.indexOf("\n]);", start));
    expect(tabs).toContain("disabled: !traceVantage.value");
    expect(tabs).toContain("dbm.detail.tabs.callersLocked");
  });

  /**
   * Plans must NEVER lock: it is server-vantage and is the one populated tab
   * on a fleet with no APM at all — locking it there would leave the reader
   * with nothing.
   */
  it("never locks the plans tab", () => {
    const start = page.indexOf("const detailTabs = computed(");
    const tabs = page.slice(start, page.indexOf("\n]);", start));
    const plansEntry = tabs.slice(tabs.indexOf('key: "plans"'), tabs.indexOf('key: "callers"'));
    expect(plansEntry).toContain("disabled: false");
  });

  /**
   * A reader parked on Callers when the vantage drops out — a window change
   * onto a stretch nothing traced — must not be stranded on a locked tab.
   */
  it("moves a reader off the callers tab when it locks under them", () => {
    expect(page).toContain('if (disabled) selectTab("overview")');
  });
});

describe("the tab copy is beginner-facing", () => {
  const tabs = messages.dbm.detail.tabs;

  it("names all three tabs and explains each", () => {
    for (const key of ["overview", "plans", "callers"] as const) {
      expect(tabs[key], `${key} needs a label`).toBeTruthy();
      expect(tabs[`${key}Hint`], `${key} needs a hint`).toBeTruthy();
    }
  });

  /**
   * The hints are what a reader who does not know the product reads first, so
   * they say what the tab answers in plain words rather than naming the feed
   * it reads from.
   */
  it("explains the tabs in plain language, not in vantage jargon", () => {
    for (const key of ["overviewHint", "plansHint", "callersHint"] as const) {
      const hint = tabs[key];
      expect(hint.length, `${key} must be a sentence`).toBeGreaterThan(30);
      expect(hint.toLowerCase()).not.toContain("vantage");
      expect(hint.toLowerCase()).not.toContain("fingerprint");
      expect(hint.toLowerCase()).not.toContain("rollup");
    }
  });

  /**
   * The locked sentence must say WHY the tab is empty — "nothing traced this"
   * — rather than merely restating that it is unavailable.
   */
  it("says why the callers tab is locked", () => {
    expect(tabs.callersLocked.toLowerCase()).toContain("trac");
  });
});
