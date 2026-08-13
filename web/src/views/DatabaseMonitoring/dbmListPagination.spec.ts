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
 * The DBM list pages paginate, and a capped page says so.
 *
 * Every one of them shipped `pagination="none"`, which is defensible only while
 * the row count is small: with a 500-row activity sample the reader gets one
 * unbounded scroll and no way to say "page 3". Turning pagination on is a
 * one-prop change, so the regression worth pinning is not that the prop flipped
 * — it is the HONESTY consequence of flipping it.
 *
 * The capped endpoints (`/activity`, `/deadlocks`, `/blocking`, `/samples`)
 * cap their reads and disclose it with `truncated`. `OTablePagination` prints
 * `Showing 1 - 25 of {totalCount}`, and on a capped read that sentence is a lie:
 * the server returned 100 because it stopped at 100, not because there are 100.
 * The library already has the answer — `totalCountExact: false` appends the same
 * `+` that `badgeCount` puts on a capped tab badge, and hides the Last-page
 * button, because there is no knowable last page of an unknown total. So the
 * spec is: a page with a cap must bind that prop to its cap flag, and a page
 * without one must not fake a cap it never has.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/**
 * The list pages, and the `data-test` of the OTable each one owns.
 *
 * QueryDetailPage is absent deliberately: its two tables already paginate and
 * were never opted out, so pinning them here would pin a change nobody made.
 */
const PAGES: [string, string][] = [
  ["ActivityPage.vue", "dbm-activity-table"],
  ["BlockedQueriesPage.vue", "dbm-blocked-table"],
  ["DatabasesPage.vue", "dbm-databases-table"],
  ["DeadlocksPage.vue", "dbm-deadlocks-table"],
  ["QueriesPage.vue", "dbm-queries-table"],
  ["SamplesPage.vue", "dbm-samples-table"],
  ["TableHealthPage.vue", "dbm-table-health-table"],
];

/**
 * The pages whose LIST read is capped by the server, and the ref each one
 * assigns `Boolean(data.truncated)` to.
 *
 * Membership is a claim about the endpoint, not about the file, so it is
 * cross-checked below against the presence of a `truncated` ref — a page that
 * gained or lost a cap without this table being updated fails there rather than
 * silently skipping its honesty assertion.
 *
 * Databases, Queries and Table health are absent because their list reads are
 * aggregations, not row-limited event reads: they carry no `truncated` in the
 * payload that feeds the table.
 */
const CAPPED = new Set([
  "ActivityPage.vue",
  "BlockedQueriesPage.vue",
  "DeadlocksPage.vue",
  "SamplesPage.vue",
]);

/**
 * The opening `<OTable …>` tag of the page's main list table.
 *
 * Sliced to the tag rather than searched across the file so that an attribute
 * belonging to some OTHER element — or to a second table on the page — can
 * never satisfy an assertion about this one.
 */
const tableTag = (source: string, dataTest: string): string => {
  const at = source.indexOf("<OTable");
  expect(at, "page must render an OTable").toBeGreaterThan(-1);
  const tag = source.slice(at, source.indexOf(">", at) + 1);
  expect(tag, `the first OTable must be the list table (${dataTest})`).toContain(
    `data-test="${dataTest}"`,
  );
  return tag;
};

describe("the DBM list pages paginate", () => {
  /**
   * `pagination="none"` is the defect. Its absence is what matters, not the
   * presence of `pagination="client"`: "client" is OTable's default, so a page
   * that simply drops the prop is correct and must not be failed for it.
   */
  it.each(PAGES)("%s does not disable pagination", (page, dataTest) => {
    const tag = tableTag(read(page), dataTest);
    expect(tag, `${page} still opts out of pagination`).not.toMatch(/pagination="none"/);
  });

  /**
   * The reader has to be able to reach the controls. OTable renders its bar
   * only when `customPaginationBar` is unset — with it set, the caller's
   * `#bottom` owns the footer and the built-in controls are suppressed
   * entirely. Every one of these pages set it in order to paint a status strip,
   * which is exactly how they ended up with no controls.
   *
   * OTable puts `#bottom` inside the pagination bar's `#actions` slot, so
   * dropping this prop keeps each page's footer AND gains the controls; nothing
   * has to move. A page that keeps the prop must therefore render the controls
   * itself, which none of them do — so this is asserted as a flat prohibition.
   */
  it.each(PAGES)("%s lets OTable render the pagination controls", (page, dataTest) => {
    const tag = tableTag(read(page), dataTest);
    expect(
      tag,
      `${page} keeps custom-pagination-bar, which suppresses the controls it just enabled`,
    ).not.toMatch(/custom-pagination-bar/);
  });
});

describe("pagination never claims a capped read is complete", () => {
  /**
   * The requirement. `Showing 1 - 25 of 100` on a read the server stopped at
   * 100 states a population that was never measured — and states it STABLY, so
   * it reads as a number that is not moving rather than one that is not being
   * taken. `totalCountExact` is the library's existing disclosure for exactly
   * this, and it must be driven by the live flag, not by a constant: hardcoding
   * `false` would brand every honest count a floor.
   */
  it.each([...CAPPED])("%s tells the footer its count may be a floor", (page) => {
    const [, dataTest] = PAGES.find(([p]) => p === page)!;
    const tag = tableTag(read(page), dataTest);

    const bound = /:total-count-exact="([^"]+)"/.exec(tag);
    expect(
      bound,
      `${page} reads a capped endpoint but never sets total-count-exact, so its ` +
        `footer prints "of 100" for a read that stopped at 100`,
    ).not.toBeNull();
    expect(
      bound![1],
      `${page} hardcodes total-count-exact instead of deriving it from the ` +
        `server's cap, so the footer's claim no longer tracks the data`,
    ).toContain("truncated");
  });

  /**
   * The polarity, which is the half a source scan is most likely to get wrong.
   * `truncated` means "capped"; `totalCountExact` means "complete". They are
   * opposites, so the binding has to negate — passing `truncated` straight
   * through inverts the disclosure and puts the `+` on precisely the counts
   * that do not need one.
   */
  it.each([...CAPPED])("%s negates the cap flag rather than passing it through", (page) => {
    const [, dataTest] = PAGES.find(([p]) => p === page)!;
    const tag = tableTag(read(page), dataTest);
    const bound = /:total-count-exact="([^"]+)"/.exec(tag)![1].trim();
    expect(
      bound,
      `${page} binds total-count-exact to "${bound}", which is true exactly when ` +
        `the read WAS capped — the "+" lands on every complete count and is ` +
        `dropped from every capped one`,
    ).toMatch(/^!/);
  });
});

/**
 * Behaviour the pages ALREADY have, which pagination must not quietly take
 * away. Regression guards, kept in their own block so a failure in the
 * pagination suites above stays legible on its own.
 */
describe("paginating the lists does not cost them their existing honesty", () => {
  /**
   * The footer content that predates pagination must survive the move into the
   * `#actions` slot. Losing it would be a silent downgrade: Blocked's footer
   * carries the conclusion the table cannot state, and Activity's and Table
   * health's carry the only count line on the page.
   */
  const KEEPS_FOOTER: [string, string][] = [
    ["ActivityPage.vue", "countLine"],
    ["TableHealthPage.vue", "countLine"],
    ["BlockedQueriesPage.vue", "footerLine"],
  ];

  it.each(KEEPS_FOOTER)("%s keeps its existing footer content", (page, marker) => {
    const source = read(page);
    expect(source, `${page} must still render #bottom`).toContain("<template #bottom>");
    const slot = source.slice(source.indexOf("<template #bottom>"));
    expect(
      slot.slice(0, slot.indexOf("</template>")),
      `${page} dropped ${marker} when pagination took over the footer`,
    ).toContain(marker);
  });

  /**
   * `CAPPED` is a claim about the ENDPOINT. If a page's cap were removed — or
   * added — and this spec not updated, the honesty assertions would target the
   * wrong pages and quietly pass. Anchoring membership to the `truncated` ref
   * each page actually keeps makes that drift fail loudly instead.
   */
  it.each(PAGES)("%s is classified according to whether it tracks a cap", (page) => {
    const tracksCap = /const truncated = ref\(/.test(read(page));
    expect(
      tracksCap,
      tracksCap
        ? `${page} tracks a server cap but is not listed as capped, so its ` +
            `pagination footer is free to print a truncated count as a total`
        : `${page} is listed as capped but tracks no cap, so its footer would ` +
            `mark a complete count as a floor`,
    ).toBe(CAPPED.has(page));
  });

  /**
   * The other side of the rule: a page with no cap must not wear one. An
   * unconditional `+` is the same defect pointed the other way — it tells the
   * reader a complete count is a floor, and there is no flag that will ever
   * clear it.
   */
  it.each(PAGES.filter(([p]) => !CAPPED.has(p)))("%s does not fake a cap", (page, dataTest) => {
    const tag = tableTag(read(page), dataTest);
    expect(
      tag,
      `${page} reads no capped endpoint, so marking its count inexact would ` +
        `print "+" on a number that is already the whole truth`,
    ).not.toMatch(/total-count-exact/);
  });
});
