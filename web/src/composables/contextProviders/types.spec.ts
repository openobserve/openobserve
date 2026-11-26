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

import { describe, expect, it, expectTypeOf } from "vitest";
import type { ContextProvider, OverviewNowRow, OverviewNowSnapshot, PageContext } from "./types";

describe("contextProviders types", () => {
  it("accepts valid PageContext shape at runtime", () => {
    const context: PageContext = {
      currentPage: "logs",
      query: "level:error",
    };

    expect(context.currentPage).toBe("logs");
    expect(context.query).toBe("level:error");
  });

  it("enforces ContextProvider return type", () => {
    const provider: ContextProvider = {
      getContext: () => ({ currentPage: "dashboards" }),
    };

    const result = provider.getContext();
    expectTypeOf(result).toMatchTypeOf<PageContext | Promise<PageContext>>();
  });
  it("types the whitelist fields and keeps extras as unknown", () => {
    const context: PageContext = {
      currentPage: "logs",
      selectedStreams: ["default"],
      streamType: "logs",
      timeRange: { type: "relative", relativeTimePeriod: "15m", startTime: 1, endTime: 2 },
      quickMode: true,
    };

    expectTypeOf(context.selectedStreams).toEqualTypeOf<string[] | undefined>();
    expectTypeOf(context.timeRange?.startTime).toEqualTypeOf<number | undefined>();
    expectTypeOf(context.quickMode).toEqualTypeOf<unknown>();
    expect(context.quickMode).toBe(true);
  });

  it("types the Home overview fields of PageContext", () => {
    const context: PageContext = {
      currentPage: "home",
      routeName: "home",
      page: "home_overview",
      overviewServices: [
        {
          service: "checkout-api",
          error_rate: 6.1,
          requests: 1200,
          p99_ms: null,
          p99_ratio: null,
          baseline_error_rate: 0.4,
          baseline_hours: 24,
          signal: "errors",
          alert_coverage: "none",
        },
      ],
      overviewServicesMeta: {
        all_regions: true,
        partial: false,
        data_until: 2,
        window_start: 1,
        window_end: 2,
      },
      overviewSelected: { kind: "service", id: "checkout-api" },
    };
    expectTypeOf(context.page).toEqualTypeOf<"home_overview" | undefined>();
    expectTypeOf(context.overviewSelected).toEqualTypeOf<
      { kind: "incident" | "service" | "anomaly" | "alert"; id: string } | undefined
    >();
    expect(context.overviewServices?.[0].alert_coverage).toBe("none");
  });

  it("narrows an Overview row by kind and keeps the shared base fields", () => {
    const row: OverviewNowRow = {
      key: "incident:i1",
      id: "i1",
      bucket: "critical",
      changedAt: 1,
      kind: "incident",
      title: "Checkout down",
      severity: "P1",
      status: "open",
      alertCount: 3,
    };
    if (row.kind === "incident") expectTypeOf(row.alertCount).toEqualTypeOf<number>();
    expectTypeOf<OverviewNowRow["bucket"]>().toEqualTypeOf<
      "critical" | "degraded" | "anomaly" | "recovered"
    >();
    // @ts-expect-error -- a service row needs its signal and coverage
    const bad: OverviewNowRow = {
      key: "service:s",
      id: "s",
      bucket: "degraded",
      changedAt: 1,
      kind: "service",
      service: "s",
    };
    expect([row.key, bad.kind]).toEqual(["incident:i1", "service"]);
  });

  it("carries the trend's effective window separately from the page window", () => {
    const snapshot: OverviewNowSnapshot = {
      rows: [],
      selectedKey: null,
      window: { start: 0, end: 10 },
      services: {
        available: true,
        partial: false,
        dataUntil: 8,
        window: { start: -2, end: 8 },
        allRegions: true,
      },
      noData: false,
    };
    expectTypeOf(snapshot.services.window).toEqualTypeOf<{ start: number; end: number } | null>();
    expect(snapshot.services.window?.end).toBe(snapshot.services.dataUntil);
  });
});
