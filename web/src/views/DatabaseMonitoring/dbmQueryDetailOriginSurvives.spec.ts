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
 * "No matter where I click on query details, it takes me back to top queries."
 *
 * The origin marker and the absolute window's START BOUND both used to live at
 * `?from=`. One key, two owners, and each destroyed the other — so the origin
 * stopped resolving and the back affordance fell through to its `queries`
 * default no matter which list the reader had come from.
 *
 * Pinned here as the two collisions themselves, because they are what the fix
 * removes: an origin must survive the hop under an absolute window, and it must
 * survive a window change made ON the detail page.
 */

import { describe, expect, it } from "vitest";
import { computed, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";

import { useDbmQueryDetailHop } from "@/composables/dbm/useDbmQueryDetailHop";
import { rangeFromQuery, rangeToQuery, type DbmRange } from "@/composables/dbm/useDbmScope";
import { DBM_ORIGIN_QUERY_KEY, readDbmQueryDetailOrigin } from "@/utils/dbm/queryDetailOrigin";

const absolute: DbmRange = {
  type: "absolute",
  relativeTimePeriod: null,
  startTime: 1_700_000_000_000_000,
  endTime: 1_700_003_600_000_000,
};

const relative: DbmRange = {
  type: "relative",
  relativeTimePeriod: "6h",
  startTime: 0,
  endTime: 0,
};

/** The hop, with the page's range and scope wired the way every list page wires them. */
const hopUnder = (range: DbmRange, routeQuery: Record<string, unknown> = {}) => {
  const pushed: { name?: string; query: Record<string, unknown> }[] = [];
  const { openDbmQueryDetail } = useDbmQueryDetailHop({
    router: {
      push: (location: { name?: string; query: Record<string, unknown> }) => {
        pushed.push(location);
        return Promise.resolve();
      },
    } as unknown as Router,
    route: { query: routeQuery } as unknown as RouteLocationNormalizedLoaded,
    org: computed(() => "acme"),
    range: ref(range),
    queryParams: computed(() => rangeToQuery(range)),
  });
  return { openDbmQueryDetail, pushed };
};

describe("the origin survives the hop into query detail", () => {
  /**
   * THE one that loses the reader's window as well as their origin. Under an
   * absolute range the hop's own scope writes `from: "<micros>"`, and the
   * origin marker was spread over it — so the URL arrived with a `to` and no
   * `from`, and the detail page re-read that as the default relative window.
   */
  it("keeps an absolute window intact while still naming the origin", () => {
    const { openDbmQueryDetail, pushed } = hopUnder(absolute);
    openDbmQueryDetail({ target: { fingerprint: "abc123" }, from: "activity" });

    const query = pushed[0]?.query ?? {};
    expect(
      readDbmQueryDetailOrigin(query),
      "the list the reader drilled in from must reach the detail page",
    ).toBe("activity");
    expect(
      rangeFromQuery(query),
      "the reader's absolute window must not be discarded by the origin marker",
    ).toEqual(absolute);
  });

  /** The relative case: the origin travels, and the period is untouched. */
  it("carries the origin under a relative window too", () => {
    const { openDbmQueryDetail, pushed } = hopUnder(relative);
    openDbmQueryDetail({ target: { fingerprint: "abc123" }, from: "samples" });

    const query = pushed[0]?.query ?? {};
    expect(readDbmQueryDetailOrigin(query)).toBe("samples");
    expect(rangeFromQuery(query).relativeTimePeriod).toBe("6h");
  });

  /** No origin claimed means no origin key — never an empty one that reads as a value. */
  it("names no origin when the list gave none", () => {
    const { openDbmQueryDetail, pushed } = hopUnder(relative);
    openDbmQueryDetail({ target: { fingerprint: "abc123" } });

    expect(readDbmQueryDetailOrigin(pushed[0]?.query ?? {})).toBeNull();
  });
});

describe("the origin survives a window change made on the detail page", () => {
  const detailRouter = () =>
    createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div/>" } },
        {
          path: "/infra/databases/query",
          name: "dbmQueryDetail",
          component: { template: "<div/>" },
        },
      ],
    });

  /**
   * `syncUrl` on the detail page spreads `rangeToQuery` over the query. Its
   * relative form is `{ from: undefined }`, which DELETES a key at `from` —
   * so a reader who arrived from Activity and then widened the window was
   * silently re-attributed to Top queries.
   */
  it("survives a relative window change, whose params clear from/to", async () => {
    const router = detailRouter();
    await router.push({
      name: "dbmQueryDetail",
      query: { fingerprint: "abc123", [DBM_ORIGIN_QUERY_KEY]: "activity", period: "1h" },
    });

    await router.replace({
      query: { ...router.currentRoute.value.query, ...rangeToQuery(relative) },
    });

    expect(
      readDbmQueryDetailOrigin(router.currentRoute.value.query),
      "changing the window must not re-attribute where the reader came from",
    ).toBe("activity");
  });

  /**
   * And the absolute form, which writes a TIMESTAMP into `from` — the same
   * key, so the origin was not merely dropped but replaced by a number that
   * names no list at all.
   */
  it("survives an absolute window change, whose params write from/to", async () => {
    const router = detailRouter();
    await router.push({
      name: "dbmQueryDetail",
      query: { fingerprint: "abc123", [DBM_ORIGIN_QUERY_KEY]: "samples", period: "1h" },
    });

    await router.replace({
      query: { ...router.currentRoute.value.query, ...rangeToQuery(absolute) },
    });

    const query = router.currentRoute.value.query;
    expect(readDbmQueryDetailOrigin(query)).toBe("samples");
    expect(rangeFromQuery(query), "and the window it wrote is the one it meant").toEqual(absolute);
  });
});

describe("every list that opens the detail page names its origin", () => {
  /**
   * The client-row click on the queries list — the single most travelled hop
   * into this page — passed no origin at all, so the detail page's only exit
   * was the `queries` fallback. That is the defect the user reported; the
   * other three lists already named theirs.
   */
  const origins: [string, string][] = [
    ["QueriesPage.vue", "queries"],
    ["ActivityPage.vue", "activity"],
    ["SamplesPage.vue", "samples"],
  ];

  it.each(origins)("%s marks its hop with from: %s", async (file, origin) => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, file), "utf8");

    // Every `openDbmQueryDetail({ … })` on the page carries an origin: a hop
    // without one is exactly how a reader ends up back on Top queries.
    const hops = source.split("openDbmQueryDetail({").slice(1);
    expect(hops.length, `${file} must open the detail page`).toBeGreaterThan(0);
    for (const hop of hops) {
      const body = hop.slice(0, hop.indexOf("});"));
      expect(body, `every hop in ${file} must name its origin`).toContain(`from: "${origin}"`);
    }
  });
});
