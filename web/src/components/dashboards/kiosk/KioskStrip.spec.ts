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
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { KioskHealth } from "@/composables/dashboard/useKioskRefresh";
import KioskStrip from "./KioskStrip.vue";

const LAST = Date.UTC(2026, 9, 13, 14, 5, 9);

const mountStrip = (health: KioskHealth, extra: Record<string, unknown> = {}) =>
  mount(KioskStrip, {
    props: {
      title: "Kubernetes overview",
      timeRangeLabel: raw("Past 15 Minutes"),
      refreshSeconds: 60,
      health,
      lastSuccessAt: LAST,
      timezone: "UTC",
      ...extra,
    },
    global: { plugins: [i18n] },
  });

describe("KioskStrip", () => {
  it("shows the dashboard name, time range, refresh and last update", () => {
    const wrapper = mountStrip({ level: "ok" });
    expect(wrapper.find('[data-test="dashboard-kiosk-title"]').text()).toBe("Kubernetes overview");
    expect(wrapper.find('[data-test="dashboard-kiosk-time-range"]').text()).toContain(
      "Past 15 Minutes",
    );
    expect(wrapper.find('[data-test="dashboard-kiosk-refresh"]').text()).toBe("Refresh 1 min");
    expect(wrapper.find('[data-test="dashboard-kiosk-updated"]').text()).toBe("Updated 14:05:09");
    expect(wrapper.findComponent(OBadge).exists()).toBe(false);
  });

  it("leaves the range out until it is known, instead of printing an invalid date", () => {
    const wrapper = mountStrip({ level: "ok" }, { timeRangeLabel: raw("") });
    expect(wrapper.find('[data-test="dashboard-kiosk-time-range"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Invalid");
  });

  it("uses TV-sized type for the status chips and the update time", () => {
    const wrapper = mountStrip({ level: "warn", kind: "failing", count: 1 }, { refreshSeconds: 0 });
    const badges = wrapper.findAllComponents(OBadge);
    expect(badges).toHaveLength(2);
    badges.forEach((badge) => expect(badge.props("size")).toBe("lg"));
    expect(wrapper.find('[data-test="dashboard-kiosk-strip"] > div').classes()).toContain(
      "text-lg",
    );
    expect(
      wrapper.find('[data-test="dashboard-kiosk-title"]').element.parentElement?.classList,
    ).toContain("text-2xl");
  });

  it("warns that auto-refresh is off, since that screen will go stale", () => {
    const wrapper = mountStrip({ level: "ok" }, { refreshSeconds: 0 });
    const badge = wrapper.findComponent(OBadge);
    expect(badge.attributes("data-test")).toBe("dashboard-kiosk-refresh");
    expect(badge.props("variant")).toBe("warning-soft");
    expect(badge.text()).toBe("Auto-refresh off");
  });

  it("says Loading without a success tick before the first update", () => {
    const wrapper = mountStrip({ level: "ok" }, { lastSuccessAt: null });
    const updated = wrapper.find('[data-test="dashboard-kiosk-updated"]');
    expect(updated.text()).toBe("Loading...");
    expect(updated.find(".text-status-success-text").exists()).toBe(false);
  });

  it("flags failing panels as a warning", () => {
    const badge = mountStrip({ level: "warn", kind: "failing", count: 2 }).findComponent(OBadge);
    expect(badge.props("variant")).toBe("warning-soft");
    expect(badge.text()).toBe("2 panels failing");
  });

  it("flags a stale screen as an error with the time it stopped", () => {
    const badge = mountStrip({ level: "bad", kind: "stale", since: LAST }).findComponent(OBadge);
    expect(badge.props("variant")).toBe("error-soft");
    expect(badge.text()).toBe("Not updating since 14:05:09");
  });

  it("explains an outage and the retry countdown", () => {
    const badge = mountStrip({
      level: "bad",
      kind: "unreachable",
      retryInSeconds: 10,
    }).findComponent(OBadge);
    expect(badge.text()).toBe("Backend unreachable, retry in 10s");
  });

  it("keeps the exit button inside the strip and shows it only while revealed", async () => {
    const wrapper = mountStrip({ level: "ok" });
    const exit = () => wrapper.find('[data-test="dashboard-kiosk-exit-btn"]');
    expect(exit().element.parentElement?.classList).toContain("h-14");
    expect(exit().classes()).toContain("invisible");

    await wrapper.setProps({ exitVisible: true });
    expect(exit().classes()).toContain("opacity-100");
    expect(exit().classes()).not.toContain("invisible");

    await exit().trigger("click");
    expect(wrapper.emitted("exit")).toHaveLength(1);
  });
});
