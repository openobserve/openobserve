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
import { describe, expect, it } from "vitest";

import type {
  OverviewNowRow as Row,
  OverviewNowSnapshot,
} from "@/composables/contextProviders/types";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import OverviewNowRow from "./OverviewNowRow.vue";

const CHANGED = Date.UTC(2026, 10, 5, 9, 41) * 1000;

const service: Row = {
  kind: "service",
  key: "service:checkout-api",
  id: "checkout-api",
  bucket: "critical",
  changedAt: CHANGED,
  service: "checkout-api",
  errorRate: 6.1,
  requests: 1000,
  p99Ms: 900,
  p99Ratio: 1.1,
  baselineErrorRate: 0.4,
  baselineHours: 24,
  signal: "errors",
  coverage: "none",
  partial: true,
};

const alert: Row = {
  kind: "alert",
  key: "alert:al-1",
  id: "al-1",
  bucket: "degraded",
  changedAt: CHANGED,
  alertId: "al-1",
  name: "High CPU",
  state: "firing",
  count: 3,
  lastAt: CHANGED,
};

const snapshot: OverviewNowSnapshot = {
  rows: [service, alert],
  selectedKey: null,
  window: { start: 0, end: 1 },
  services: { available: true, partial: true, dataUntil: 1, window: null, allRegions: false },
  noData: false,
};

const mountRow = (props: Record<string, unknown>) =>
  mount(OverviewNowRow, {
    props: { snapshot, timezone: "UTC", ...props } as never,
    global: { plugins: [i18n] },
  });

describe("OverviewNowRow", () => {
  it("reads as the sentence with the figure vs its baseline, the marks and the change time", () => {
    const wrapper = mountRow({
      row: service,
      points: { points: [{ value: 1 }, { value: 2 }], baseline: 0.4 },
    });
    expect(wrapper.get('[data-test="overview-now-row-service"]').text()).toBe(
      "checkout-api errors at 6.1%",
    );
    expect(wrapper.get('[data-test="overview-now-row-figure"]').text()).toBe(
      "6.1% vs 0.4% (previous 24 h)",
    );
    expect(wrapper.find('[data-test="overview-now-row-no-alert"]').text()).toBe("no alert");
    expect(wrapper.find('[data-test="overview-now-row-partial"]').text()).toBe("partial");
    expect(wrapper.get('[data-test="overview-now-row-changed"]').text()).toBe("Changed 09:41");
    expect(wrapper.get('[data-test="overview-now-row-changed"]').attributes("title")).toBe(
      "2026-11-05 09:41 (UTC)",
    );
    expect(wrapper.find('[data-test="overview-now-row-sparkline"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="overview-state-mark"]').attributes("data-bucket")).toBe(
      "critical",
    );
  });

  it("keeps the figure monospace while it is a number vs its baseline", () => {
    const wrapper = mountRow({ row: service });
    for (const test of ["overview-now-row-figure", "overview-now-row-figure-narrow"])
      expect(wrapper.get(`[data-test="${test}"]`).classes()).toContain("font-mono");
  });

  it("writes a missing baseline as plain body text with no trend stub beside it", () => {
    const wrapper = mountRow({
      row: { ...service, baselineErrorRate: null, baselineHours: null },
      points: { points: [{ value: null }, { value: 2 }, { value: null }], baseline: null },
    });
    for (const test of ["overview-now-row-figure", "overview-now-row-figure-narrow"]) {
      const figure = wrapper.get(`[data-test="${test}"]`);
      expect(figure.text()).toBe("Not enough history for a baseline");
      expect(figure.classes()).not.toContain("font-mono");
      expect(figure.classes()).toContain("text-text-secondary");
    }
    expect(wrapper.find('[data-test="overview-now-row-sparkline"]').exists()).toBe(false);
  });

  it("says alert coverage unknown instead of no alert when the rule cannot tell", () => {
    const wrapper = mountRow({ row: { ...service, coverage: "unknown" } });
    expect(wrapper.find('[data-test="overview-now-row-no-alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("alert coverage unknown");
  });

  it("names the row in Investigate and emits it, plus the one direct link", async () => {
    const wrapper = mountRow({ row: alert });
    const investigate = wrapper.get('[data-test="overview-now-row-investigate"]');
    expect(investigate.attributes("aria-label")).toBe("Investigate High CPU firing");
    await investigate.trigger("click");
    await wrapper.get('[data-test="overview-now-row-open"]').trigger("click");
    expect(wrapper.emitted("investigate")).toEqual([[alert]]);
    expect(wrapper.emitted("open")).toEqual([[alert]]);
    expect(wrapper.get('[data-test="overview-now-row-count"]').text()).toBe("×3");
  });

  it("opens the RED panel from the service name", async () => {
    const wrapper = mountRow({ row: service });
    await wrapper.get('[data-test="overview-now-row-service"]').trigger("click");
    expect(wrapper.emitted("service")).toEqual([[service]]);
  });

  it("marks the selected row as current", () => {
    expect(mountRow({ row: service, selected: true }).attributes("aria-current")).toBe("true");
    expect(mountRow({ row: service }).attributes("aria-current")).toBeUndefined();
  });

  it("shows a not-sent note with Show running chats", async () => {
    const wrapper = mountRow({
      row: service,
      note: { text: raw("Not sent: 3 chats running"), showRuns: true },
    });
    expect(wrapper.get('[data-test="overview-now-row-note"]').text()).toContain(
      "Not sent: 3 chats running",
    );
    await wrapper.get('[data-test="overview-now-row-show-runs"]').trigger("click");
    expect(wrapper.emitted("showRuns")).toHaveLength(1);
  });

  it("describes the credits fallback on Investigate", () => {
    const text = raw("Assistant credits are used up. Investigate opens checkout-api");
    const wrapper = mountRow({ row: service, fallbackText: text });
    const id = wrapper
      .get('[data-test="overview-now-row-investigate"]')
      .attributes("aria-describedby");
    expect(wrapper.get(`#${id}`).text()).toBe(text);
  });
});
