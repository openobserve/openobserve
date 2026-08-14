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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";

import { takeDbmQueryDetailSeed } from "@/composables/dbm/dbmQueryDetailSeed";
import type { DbmRange } from "@/composables/dbm/useDbmScope";
import type { QueryStatsRow } from "@/services/db_monitoring";

import { useDbmQueryDetailHop } from "./useDbmQueryDetailHop";

const range = (): DbmRange => ({
  type: "relative",
  relativeTimePeriod: "1h",
  startTime: 1_000,
  endTime: 2_000,
});

const seedRow = (): QueryStatsRow =>
  ({
    fingerprint: "abc123",
    query_norm: "SELECT * FROM orders",
    db_system: "postgresql",
    db_instance: "orders-primary",
  }) as QueryStatsRow;

const push = vi.fn(() => Promise.resolve());

const setup = (routeQuery: Record<string, unknown> = {}) => {
  push.mockClear();
  const rangeRef = ref(range());
  return {
    rangeRef,
    ...useDbmQueryDetailHop({
      router: { push } as unknown as Router,
      route: { query: routeQuery } as unknown as RouteLocationNormalizedLoaded,
      org: computed(() => "acme"),
      range: rangeRef,
      queryParams: computed(() => ({ period: "1h" })),
    }),
  };
};

describe("useDbmQueryDetailHop", () => {
  beforeEach(() => {
    // The seed slot is module-scoped and one-shot; drain it between cases.
    takeDbmQueryDetailSeed("acme", "abc123", range());
  });

  /**
   * The order of the spread is the contract. `...route.query` first so the
   * section's existing params survive the hop, then the page's scope, then the
   * row's identity — a target field must be able to override a stale query one.
   */
  it("carries the route's query, the page's scope and the row's identity", () => {
    const { openDbmQueryDetail } = setup({ org_identifier: "acme", tab: "plans" });
    openDbmQueryDetail({ target: { fingerprint: "abc123", system: "postgresql" } });

    expect(push).toHaveBeenCalledWith({
      name: "dbmQueryDetail",
      query: {
        org_identifier: "acme",
        tab: "plans",
        period: "1h",
        fingerprint: "abc123",
        system: "postgresql",
      },
    });
  });

  /** A deep link that arrived without an org must not lose one on the way through. */
  it("defends the org identifier when the route carries none", () => {
    const { openDbmQueryDetail } = setup();
    openDbmQueryDetail({ target: { fingerprint: "abc123" } });

    expect(push.mock.calls[0]?.[0]).toMatchObject({ query: { org_identifier: "acme" } });
  });

  /**
   * The origin is what the detail page's back affordance reads. An activity
   * reader handed back to Top queries lands on a tab they never stood on.
   */
  it("marks the hop with its origin, and omits the marker when there is none", () => {
    const { openDbmQueryDetail } = setup();
    openDbmQueryDetail({ target: { fingerprint: "abc123" }, from: "activity" });
    expect(push.mock.calls[0]?.[0]).toMatchObject({ query: { from: "activity" } });

    push.mockClear();
    openDbmQueryDetail({ target: { fingerprint: "abc123" } });
    expect(push.mock.calls[0]?.[0]).not.toMatchObject({ query: { from: expect.anything() } });
  });

  /** The whole point of the seed: the detail header paints before any fetch settles. */
  it("hands the clicked row over as a one-shot seed", () => {
    const { openDbmQueryDetail } = setup();
    openDbmQueryDetail({ seed: seedRow(), target: { fingerprint: "abc123" } });

    expect(takeDbmQueryDetailSeed("acme", "abc123", range())?.query_norm).toBe(
      "SELECT * FROM orders",
    );
  });

  /**
   * A list that knows no statement seeds NOTHING. A seed carrying a blank
   * statement would paint the bare fingerprint hash as if it were the query,
   * and the detail page's own fetch would never get the chance to fill it in.
   */
  it("seeds nothing when the row has no statement to give", () => {
    const { openDbmQueryDetail } = setup();
    openDbmQueryDetail({ seed: null, target: { fingerprint: "abc123" } });

    expect(takeDbmQueryDetailSeed("acme", "abc123", range())).toBeNull();
  });

  /**
   * The range travels as a COPY. These pages are kept alive, so the live scope
   * object can move under a seed that aliased it — quietly validating a stale
   * row against a window nobody fetched it for.
   */
  it("copies the range so a later scope change cannot rewrite the seed", () => {
    const { openDbmQueryDetail, rangeRef } = setup();
    openDbmQueryDetail({ seed: seedRow(), target: { fingerprint: "abc123" } });

    rangeRef.value = { ...rangeRef.value, relativeTimePeriod: "24h" };

    expect(takeDbmQueryDetailSeed("acme", "abc123", range())).not.toBeNull();
  });

  /** A router rejection (a redirect guard, a duplicate push) must not surface as an unhandled rejection. */
  it("swallows a rejected navigation", () => {
    push.mockImplementationOnce(() => Promise.reject(new Error("redirected")));
    const { openDbmQueryDetail } = setup();

    expect(() => openDbmQueryDetail({ target: { fingerprint: "abc123" } })).not.toThrow();
  });
});
