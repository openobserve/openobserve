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
 * "If I set an absolute time range, switching tab goes back to last 1 hour."
 *
 * The L2 strip carries the reader's scope from tab to tab, and it used to
 * DROP `from` on the way — because the query-detail origin marker was spelled
 * `from` too, and the strip had to strip the marker. `from` is also the
 * absolute window's start bound, so every tab switch handed the next page a
 * `to` with no `from`, which `rangeFromQuery` reads as "no absolute range" and
 * answers with the relative default of 1h.
 *
 * Same root cause as the detail page's back affordance always saying "top
 * queries": one URL key, two owners. What is pinned here is that a tab switch
 * carries the window the reader actually picked.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import { rangeFromQuery, type DbmRange } from "@/composables/dbm/useDbmScope";
import { DBM_ORIGIN_QUERY_KEY } from "@/utils/dbm/queryDetailOrigin";

import DbmSectionTabs from "./DbmSectionTabs.vue";

const push = vi.fn(() => Promise.resolve());

let currentRoute = { name: "dbmQueries", query: {} as Record<string, unknown> };

vi.mock("vue-router", () => ({
  useRoute: () => currentRoute,
  useRouter: () => ({ push }),
}));

const mockConfig = vi.hoisted(() => ({ isEnterprise: "true" }));
vi.mock("@/aws-exports", () => ({ default: mockConfig }));

const absolute: DbmRange = {
  type: "absolute",
  relativeTimePeriod: null,
  startTime: 1_700_000_000_000_000,
  endTime: 1_700_003_600_000_000,
};

/** The URL a page writes after the reader picks an absolute window. */
const absoluteQuery = () => ({
  org_identifier: "acme",
  from: String(absolute.startTime),
  to: String(absolute.endTime),
});

const mountAt = (name: string, query: Record<string, unknown>) => {
  currentRoute = { name, query };
  push.mockClear();
  return mount(DbmSectionTabs, {
    props: { databaseCount: 2, queryCount: 34 },
    global: { plugins: [i18n] },
  });
};

/** Switch tab through the `change` event OTabs really emits. */
const selectTab = async (wrapper: ReturnType<typeof mountAt>, key: string) => {
  wrapper.findComponent({ name: "OTabs" }).vm.$emit("change", key);
  await wrapper.vm.$nextTick();
};

/** The query the strip pushed. */
const pushedQuery = (): Record<string, unknown> =>
  (push.mock.calls[0]?.[0] as { query: Record<string, unknown> })?.query ?? {};

beforeEach(() => {
  mockConfig.isEnterprise = "true";
});

describe("a tab switch carries the reader's absolute window", () => {
  /**
   * THE reported one. Both bounds have to arrive: `rangeFromQuery` needs the
   * pair, and a `to` on its own is indistinguishable from no absolute range
   * at all.
   */
  it("keeps both bounds when switching from one list tab to another", async () => {
    const wrapper = mountAt("dbmQueries", absoluteQuery());
    await selectTab(wrapper, "activity");

    const query = pushedQuery();
    expect(query.from, "the window's start bound must survive the tab switch").toBe(
      String(absolute.startTime),
    );
    expect(query.to).toBe(String(absolute.endTime));
    expect(
      rangeFromQuery(query),
      "the next tab must open on the window the reader picked, not the 1h default",
    ).toEqual(absolute);
  });

  /** And leaving the DETAIL page, which is where the marker actually rides. */
  it("keeps the window when leaving the query detail page", async () => {
    const wrapper = mountAt("dbmQueryDetail", {
      ...absoluteQuery(),
      fingerprint: "abc123",
      stream: "default",
      tab: "plans",
      [DBM_ORIGIN_QUERY_KEY]: "activity",
    });
    await selectTab(wrapper, "samples");

    const query = pushedQuery();
    expect(rangeFromQuery(query)).toEqual(absolute);
  });

  /** A relative window is carried by `period`, and is not disturbed either. */
  it("keeps a relative window", async () => {
    const wrapper = mountAt("dbmQueries", { org_identifier: "acme", period: "6h" });
    await selectTab(wrapper, "activity");

    expect(rangeFromQuery(pushedQuery()).relativeTimePeriod).toBe("6h");
  });
});

describe("a tab switch still drops what belongs only to the detail page", () => {
  /**
   * The keys the strip was right to strip. Carrying them would put one query's
   * identity — and the detail page's own in-page tab — into every list's URL.
   */
  it("drops the fingerprint, the stream, the in-page tab and the origin marker", async () => {
    const wrapper = mountAt("dbmQueryDetail", {
      ...absoluteQuery(),
      fingerprint: "abc123",
      stream: "default",
      tab: "plans",
      [DBM_ORIGIN_QUERY_KEY]: "activity",
    });
    await selectTab(wrapper, "samples");

    const query = pushedQuery();
    for (const key of ["fingerprint", "stream", "tab", DBM_ORIGIN_QUERY_KEY]) {
      expect(query, `${key} means nothing on a list`).not.toHaveProperty(key);
    }
    // The scope the reader set does travel.
    expect(query.org_identifier).toBe("acme");
  });
});
