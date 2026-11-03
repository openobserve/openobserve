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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PagesToFix from "./PagesToFix.vue";
import { pageFilter } from "@/utils/rum/performanceOverview";

const page = (path: string, over: Record<string, unknown> = {}) => ({
  path,
  views: 1920,
  lcp: 3.1e9,
  inp: 2.4e8,
  cls: 0.05,
  errors: 142,
  bad: 100,
  impact: 92,
  ...over,
});

const SCHEMA = new Set(["view_url", "view_name"]);

const OTableStub = {
  props: ["data", "columns"],
  template: `<div data-test="table"><div v-for="(row, index) in data" :key="row.path" :data-test="'row-' + index">
    <slot name="cell-path" :row="row" :index="index" /><slot name="cell-views" :row="row" /><slot name="cell-lcp" :row="row" />
    <slot name="cell-inp" :row="row" /><slot name="cell-cls" :row="row" /><slot name="cell-errors" :row="row" :index="index" /><slot name="cell-impact" :row="row" />
  </div></div>`,
};

const mountPages = (pages: ReturnType<typeof page>[]) =>
  mount(PagesToFix, {
    props: {
      pages,
      sessionsLink: (f: string) => ({ name: "Sessions", query: { query: f } }),
      errorsLink: (f: string) => ({ name: "ErrorTracking", query: { query: f } }),
      allPagesLink: { name: "productAnalyticsOverview", query: { period: "1d" } },
      schema: SCHEMA,
    },
    global: {
      stubs: {
        OTable: OTableStub,
        ODataBarCell: {
          props: ["value", "display"],
          template: "<b data-test='impact'>{{ display }}</b>",
        },
        RouterLink: { props: ["to"], template: "<a :data-to='JSON.stringify(to)'><slot /></a>" },
        OPopover: { template: "<div><slot name='trigger' /><slot /></div>" },
        OButton: { template: "<button><slot /></button>" },
      },
    },
  });

describe("PagesToFix", () => {
  it("labels the table region for assistive tech", () => {
    const w = mountPages([page("/checkout")]);
    expect(w.find('[role="region"]').attributes("aria-label")).toBe("Pages ranked by impact");
  });

  it("links every page to Product Analytics, besides the in-place expander", () => {
    const w = mountPages([page("/checkout")]);
    const link = w.find('[data-test="rum-overview-pages-all-link"]');
    expect(link.text()).toBe("All pages →");
    expect(link.attributes("aria-label")).toBe("All pages in Product Analytics");
    expect(JSON.parse(link.attributes("data-to") as string)).toEqual({
      name: "productAnalyticsOverview",
      query: { period: "1d" },
    });
  });

  it("puts the explanation in an About popover, not under the title", () => {
    const w = mountPages([page("/checkout")]);
    expect(w.find('[data-test="rum-overview-pages-about"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-overview-pages-hint"]').text()).toContain("Ranked by impact");
  });

  it("links the path to Sessions and the error count to Error Tracking, filtered to the page", () => {
    const w = mountPages([page("/checkout")]);
    const sessions = JSON.parse(
      w.find('[data-test="rum-overview-pages-link-0"]').attributes("data-to") as string,
    );
    const errors = JSON.parse(
      w.find('[data-test="rum-overview-pages-errors-link-0"]').attributes("data-to") as string,
    );
    expect(sessions).toEqual({
      name: "Sessions",
      query: { query: pageFilter("/checkout", SCHEMA) },
    });
    expect(errors).toEqual({
      name: "ErrorTracking",
      query: { query: pageFilter("/checkout", SCHEMA) },
    });
  });

  it("shows real values, needs-improvement markers and the impact score", () => {
    const row = mountPages([page("/checkout")]).find('[data-test="row-0"]');
    expect(row.text()).toContain((1920).toLocaleString());
    expect(row.text()).toContain("\u25B2 3.10 s");
    expect(row.text()).toContain("\u25B2 240 ms");
    expect(row.text()).toContain("142");
    expect(row.find('[data-test="impact"]').text()).toBe("92");
  });

  it("shows CLS with the same markers, since it counts toward impact", () => {
    const w = mountPages([page("/checkout", { cls: 0.18 }), page("/home", { cls: 0.3 })]);
    expect(w.find('[data-test="row-0"]').text()).toContain("\u25B2 0.18");
    expect(w.find('[data-test="row-1"]').text()).toContain("\u25A0 0.30");
  });

  it("exposes the impact bar as an image with its score", () => {
    const row = mountPages([page("/checkout")]).find('[data-test="row-0"]');
    const img = row.find('[role="img"]');
    expect(img.attributes("aria-label")).toBe("Impact 92 out of 100");
    expect(img.find('[data-test="impact"]').exists()).toBe(true);
  });

  it("marks a poor value with a square and leaves a good one unmarked", () => {
    const row = mountPages([page("/a", { lcp: 5e9, inp: 1e8 })]).find('[data-test="row-0"]');
    expect(row.text()).toContain("\u25A0 5.00 s");
    expect(row.text()).not.toContain("\u25B2");
  });

  it("shows ten rows and expands to all", async () => {
    const many = Array.from({ length: 12 }, (_, i) => page(`/p${i}`));
    const w = mountPages(many);
    expect(w.findAll('[data-test^="row-"]')).toHaveLength(10);
    await w.find('[data-test="rum-overview-pages-toggle"]').trigger("click");
    expect(w.findAll('[data-test^="row-"]')).toHaveLength(12);
  });
});
