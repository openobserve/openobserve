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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";

import {
  HOME_CONTEXT_KEY,
  OVERVIEW_CONTEXT_MAX_BYTES,
  createHomeContextProvider,
  homeContextOf,
  useHomeContextProvider,
} from "./homeContextProvider";
import { contextRegistry } from "./registry";
import type { OverviewNowRow, OverviewNowSnapshot } from "./types";

const NOW_MS = 1_762_300_000_000;

const store = { state: { selectedOrganization: { identifier: "acme" } } };

const incident = (id: string, title = "Checkout errors"): OverviewNowRow => ({
  kind: "incident",
  key: `incident:${id}`,
  id,
  bucket: "critical",
  changedAt: 1_762_299_000_000_000,
  title,
  severity: "P1",
  status: "open",
  alertCount: 3,
});

const service = (name: string): OverviewNowRow => ({
  kind: "service",
  key: `service:${name}`,
  id: name,
  bucket: "critical",
  changedAt: 1_762_299_000_000_000,
  service: name,
  errorRate: 6.1,
  requests: 1200,
  p99Ms: 2900,
  p99Ratio: 2.7,
  baselineErrorRate: 0.4,
  baselineHours: 24,
  signal: "errors",
  coverage: "none",
  partial: false,
});

const alert = (id: string, name = "checkout 5xx"): OverviewNowRow => ({
  kind: "alert",
  key: `alert:${id}`,
  id,
  bucket: "degraded",
  changedAt: 1_762_299_500_000_000,
  alertId: id,
  name,
  state: "firing",
  count: 4,
  lastAt: 1_762_299_500_000_000,
});

const anomalyRow = (id: string, name: string): OverviewNowRow => ({
  kind: "anomaly",
  key: `anomaly:${id}`,
  id,
  bucket: "anomaly",
  changedAt: 1_762_299_000_000_000,
  configId: id,
  name,
  stream: "orders",
  anomalyCount: 2,
  at: 1_762_299_000_000_000,
});

const anomaly: OverviewNowRow = {
  kind: "anomaly",
  key: "anomaly:an-1",
  id: "an-1",
  bucket: "anomaly",
  changedAt: 1_762_299_000_000_000,
  configId: "an-1",
  name: "Order volume",
  stream: "orders",
  anomalyCount: 2,
  at: 1_762_299_000_000_000,
};

// The shape `useHomeNow` produces, so the provider is tested against its real producer contract.
const snapshot = (overrides: Partial<OverviewNowSnapshot> = {}): OverviewNowSnapshot => ({
  rows: [incident("inc-7"), service("checkout-api"), anomaly, alert("al-9")],
  selectedKey: "service:checkout-api",
  window: { start: 1_762_296_400_000_000, end: 1_762_300_000_000_000 },
  services: {
    available: true,
    partial: false,
    dataUntil: 1_762_300_000_000_000,
    window: { start: 1_762_296_400_000_000, end: 1_762_300_000_000_000 },
    allRegions: true,
  },
  noData: false,
  ...overrides,
});

afterEach(() => contextRegistry.cleanup());

describe("homeContextOf", () => {
  it("maps every row kind to its snake_case wire row, with page, route and the window", () => {
    expect(homeContextOf(snapshot(), "acme", NOW_MS)).toEqual({
      currentPage: "home",
      routeName: "home",
      page: "home_overview",
      organization_identifier: "acme",
      request_timestamp: NOW_MS * 1000,
      timeRange: {
        type: "absolute",
        startTime: 1_762_296_400_000_000,
        endTime: 1_762_300_000_000_000,
      },
      overviewIncidents: [
        { id: "inc-7", title: "Checkout errors", severity: "P1", status: "open", alert_count: 3 },
      ],
      overviewServices: [
        {
          service: "checkout-api",
          error_rate: 6.1,
          requests: 1200,
          p99_ms: 2900,
          p99_ratio: 2.7,
          baseline_error_rate: 0.4,
          baseline_hours: 24,
          signal: "errors",
          alert_coverage: "none",
        },
      ],
      overviewServicesMeta: {
        all_regions: true,
        partial: false,
        data_until: 1_762_300_000_000_000,
        window_start: 1_762_296_400_000_000,
        window_end: 1_762_300_000_000_000,
      },
      overviewAnomalies: [
        {
          config_id: "an-1",
          name: "Order volume",
          stream: "orders",
          anomaly_count: 2,
          at: 1_762_299_000_000_000,
        },
      ],
      overviewAlerts: [
        {
          alert_id: "al-9",
          name: "checkout 5xx",
          state: "firing",
          count: 4,
          last_at: 1_762_299_500_000_000,
        },
      ],
      overviewSelected: { kind: "service", id: "checkout-api" },
    });
  });

  it("caps each list (5 incidents, 8 services, 5 anomalies, 8 alerts) in snapshot order", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => incident(`i${i}`)),
      ...Array.from({ length: 10 }, (_, i) => service(`s${i}`)),
      ...Array.from({ length: 10 }, (_, i) => alert(`a${i}`)),
    ];
    const context = homeContextOf(snapshot({ rows, selectedKey: null }), "acme");
    expect(context.overviewIncidents?.map((row) => row.id)).toEqual(["i0", "i1", "i2", "i3", "i4"]);
    expect(context.overviewServices).toHaveLength(8);
    expect(context.overviewAlerts?.map((row) => row.alert_id).at(-1)).toBe("a7");
    expect(context).not.toHaveProperty("overviewSelected");
  });

  it("keeps a selected row that sits past its cap", () => {
    const rows = Array.from({ length: 7 }, (_, i) => incident(`i${i}`));
    const context = homeContextOf(snapshot({ rows, selectedKey: "incident:i6" }), "acme");
    expect(context.overviewIncidents?.map((row) => row.id)).toEqual(["i0", "i1", "i2", "i3", "i6"]);
    expect(context.overviewSelected).toEqual({ kind: "incident", id: "i6" });
  });

  it("trims tail rows until the overview set is at most 8 KB, never the selected row", () => {
    const long = "x".repeat(198);
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => incident(`i${i}`, `${long}${i}`)),
      ...Array.from({ length: 5 }, (_, i) => anomalyRow(`n${i}`, `${long}${i}`)),
      ...Array.from({ length: 8 }, (_, i) => alert(`a${i}`, `${long}${i}`)),
      ...Array.from({ length: 8 }, (_, i) => service(`${long}${i}`)),
    ];
    const selectedKey = `alert:a7`;
    const context = homeContextOf(snapshot({ rows, selectedKey }), "acme");
    const set = Object.fromEntries(
      Object.entries(context).filter(([key]) => key.startsWith("overview")),
    );
    expect(new TextEncoder().encode(JSON.stringify(set)).length).toBeLessThanOrEqual(
      OVERVIEW_CONTEXT_MAX_BYTES,
    );
    expect(context.overviewAlerts?.map((row) => row.alert_id)).toContain("a7");
    expect(context.overviewIncidents?.[0].id).toBe("i0");
    expect(context.overviewServices?.length ?? 0).toBeLessThan(8);
  });

  it("cuts a very long title so one row cannot crowd the others out", () => {
    const context = homeContextOf(snapshot({ rows: [incident("i1", "t".repeat(5000))] }), "acme");
    expect(context.overviewIncidents?.[0].title.length).toBe(200);
  });

  it("sends no service meta without the trend, and no lists for the no-data layout", () => {
    const off = homeContextOf(
      snapshot({ services: { ...snapshot().services, available: false } }),
      "acme",
    );
    expect(off).not.toHaveProperty("overviewServicesMeta");
    const empty = homeContextOf(
      snapshot({ rows: [], noData: true, selectedKey: null, window: { start: 0, end: 0 } }),
      "acme",
    );
    expect(empty).toMatchObject({ currentPage: "home", routeName: "home", homeNoData: true });
    expect(
      Object.keys(empty).filter((key) => key.startsWith("overview") || key === "page"),
    ).toEqual([]);
    expect(empty).not.toHaveProperty("timeRange");
  });
});

describe("createHomeContextProvider", () => {
  it("reads the org from the store and the snapshot at each call", () => {
    const state = reactive(snapshot());
    const provider = createHomeContextProvider(() => state, store);
    expect(provider.getContext()).toMatchObject({ organization_identifier: "acme" });
    state.selectedKey = "incident:inc-7";
    expect(provider.getContext()).toMatchObject({
      overviewSelected: { kind: "incident", id: "inc-7" },
    });
  });
});

describe("useHomeContextProvider", () => {
  it("registers as the active provider, re-registers on change and unregisters on unmount", async () => {
    const state = reactive(snapshot());
    const Host = defineComponent({
      setup() {
        useHomeContextProvider(() => state, store);
        return () => h("div");
      },
    });
    const wrapper = mount(Host);
    expect((await contextRegistry.getActiveContext())?.page).toBe("home_overview");
    const before = contextRegistry.version.value;
    state.selectedKey = "alert:al-9";
    await nextTick();
    expect(contextRegistry.version.value).toBeGreaterThan(before);
    expect((await contextRegistry.getActiveContext())?.overviewSelected).toEqual({
      kind: "alert",
      id: "al-9",
    });
    wrapper.unmount();
    contextRegistry.setActive(HOME_CONTEXT_KEY);
    expect(await contextRegistry.getActiveContext()).toBeNull();
  });
});
