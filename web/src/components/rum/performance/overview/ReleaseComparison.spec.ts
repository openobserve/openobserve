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
import ReleaseComparison from "./ReleaseComparison.vue";

const side = (version: string, over: Record<string, unknown> = {}) => ({
  version,
  predates: false,
  sessions: 100,
  errorFree: 95,
  lcp: 2e9,
  inp: 2e8,
  ...over,
});

const OTableStub = {
  props: ["data", "columns"],
  template: `<div data-test="table"><span data-test="cols">{{ columns.map((c) => c.header).join("|") }}</span>
    <div v-for="row in data" :key="row.key" :data-test="'row-' + row.key"><slot name="cell-cur" :row="row" /><i>{{ row.prev }}</i></div></div>`,
};

const mountRelease = (release: Record<string, unknown>) =>
  mount(ReleaseComparison, {
    props: {
      release,
      errorsLink: (f: string) => ({ name: "ErrorTracking", query: { query: f } }),
    } as never,
    global: {
      stubs: {
        OTable: OTableStub,
        RouterLink: { props: ["to"], template: "<a :data-to='JSON.stringify(to)'><slot /></a>" },
      },
    },
  });

describe("ReleaseComparison", () => {
  it("compares the two versions in the table columns", () => {
    const w = mountRelease({ cur: side("2.0"), prev: side("1.0"), newErrors: null });
    expect(w.find('[data-test="cols"]').text()).toBe("Metric|1.0|2.0");
  });

  it("colours a worse current value and formats real values", () => {
    const w = mountRelease({
      cur: side("2.0", { inp: 3e8 }),
      prev: side("1.0", { inp: 2e8 }),
      newErrors: null,
    });
    expect(w.find('[data-test="row-inp"]').text()).toContain("300 ms");
    expect(w.find('[data-test="rum-overview-release-tone-inp"]').classes()).toContain(
      "text-status-error-text",
    );
  });

  it("says improved or worse in words, never with the band triangles the tables use", () => {
    const w = mountRelease({
      cur: side("2.0", { inp: 3e8, lcp: 1e9 }),
      prev: side("1.0", { inp: 2e8, lcp: 2e9 }),
      newErrors: null,
    });
    expect(w.find('[data-test="rum-overview-release-tone-inp"]').text()).toBe("worse");
    expect(w.find('[data-test="rum-overview-release-tone-lcp"]').text()).toBe("improved");
    expect(w.text()).not.toMatch(/[\u25B2\u25BC\u25A0]/);
    expect(w.find('[data-test="rum-overview-release-tone-sessions"]').exists()).toBe(false);
  });

  it("leaves values equal once formatted, or inside half a percent, unmarked", () => {
    const w = mountRelease({
      cur: side("2.0", { inp: 232.4e6, lcp: 2.001e9 }),
      prev: side("1.0", { inp: 231.6e6, lcp: 2e9 }),
      newErrors: null,
    });
    expect(w.find('[data-test="rum-overview-release-tone-inp"]').exists()).toBe(false);
    expect(w.find('[data-test="rum-overview-release-tone-lcp"]').exists()).toBe(false);
  });

  it("says it ignores the Version filter", () => {
    const w = mountRelease({ cur: side("2.0"), prev: side("1.0"), newErrors: null });
    expect(w.find('[data-test="rum-overview-release-note"]').text()).toContain(
      "whatever the Version filter says",
    );
  });

  it("links to the version's errors and shows the new-error count beside it as plain text", () => {
    const w = mountRelease({ cur: side("2.0"), prev: side("1.0"), newErrors: 3 });
    const link = w.find('[data-test="rum-overview-release-errors-link"]');
    expect(link.text()).toBe("Errors in 2.0");
    expect(JSON.parse(link.attributes("data-to") as string).query.query).toBe("version='2.0'");
    expect(w.find('[data-test="rum-overview-release-new-errors"]').text()).toBe(
      "3 new errors in this release",
    );
  });

  it("omits the new-error text when the count is unknown", () => {
    const w = mountRelease({ cur: side("2.0"), prev: side("1.0"), newErrors: null });
    expect(w.find('[data-test="rum-overview-release-new-errors"]').exists()).toBe(false);
  });

  it("notes a release that predates the range", () => {
    const w = mountRelease({
      cur: side("2.0", { predates: true }),
      prev: side("1.0"),
      newErrors: 0,
    });
    expect(w.find('[data-test="rum-overview-release-before"]').text()).toContain("2.0");
  });
});
