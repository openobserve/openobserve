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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { KioskHealth } from "@/composables/dashboard/useKioskRefresh";
import KioskStrip from "./KioskStrip.vue";
import KioskCountdownRing from "./KioskCountdownRing.vue";

const NOW = Date.UTC(2026, 9, 13, 14, 7, 9);
const LAST = NOW - 2 * 60_000;

const mountStrip = (health: KioskHealth, extra: Record<string, unknown> = {}) =>
  mount(KioskStrip, {
    props: {
      title: "Kubernetes overview",
      timeRangeLabel: raw("Past 15 Minutes"),
      refreshSeconds: 60,
      health,
      lastSuccessAt: LAST,
      timezone: "UTC",
      countdown: { remainingMs: 18_000, totalMs: 60_000, at: NOW + 18_000, retrying: false },
      ...extra,
    },
    global: { plugins: [i18n] },
  });

const ring = (wrapper: ReturnType<typeof mountStrip>) => wrapper.findComponent(KioskCountdownRing);

describe("KioskStrip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the playlist position only when the screen is a playlist slide", () => {
    expect(
      mountStrip({ level: "ok" }).find('[data-test="dashboard-kiosk-position"]').exists(),
    ).toBe(false);
    const slide = mountStrip({ level: "ok" }, { position: raw("2 of 5") });
    expect(slide.find('[data-test="dashboard-kiosk-position"]').text()).toBe("2 of 5");
  });

  it("shows the name on the left and the range, refresh and relative update time grouped right", () => {
    const wrapper = mountStrip({ level: "ok" });
    expect(wrapper.find('[data-test="dashboard-kiosk-title"]').text()).toBe("Kubernetes overview");
    const meta = wrapper.find('[data-test="dashboard-kiosk-meta"]');
    expect(meta.find('[data-test="dashboard-kiosk-time-range"]').text()).toContain(
      "Past 15 Minutes",
    );
    expect(meta.find('[data-test="dashboard-kiosk-refresh"]').exists()).toBe(true);
    expect(meta.find('[data-test="dashboard-kiosk-updated"]').text()).toBe("Updated 2m ago");
    expect(wrapper.findComponent(OBadge).exists()).toBe(false);
  });

  it("puts the exact update time in the tooltip", () => {
    const wrapper = mountStrip({ level: "ok" });
    const tooltip = wrapper
      .findAllComponents(OTooltip)
      .find((tip) => String(tip.props("content")).startsWith("Last refreshed"));
    expect(tooltip?.props("content")).toBe("Last refreshed: 14:05:09");
  });

  it("counts down to the next load on the ring", () => {
    const wrapper = mountStrip({ level: "ok" });
    expect(ring(wrapper).props("state")).toBe("running");
    expect(ring(wrapper).props("progress")).toBeCloseTo(0.7);
    expect(ring(wrapper).props("tooltip")).toBe("Next refresh at 14:07:27");
    expect(ring(wrapper).attributes("aria-label")).toBe("Next refresh at 14:07:27");
  });

  it("spins only the ring's arc while panels load; the refresh icon stays still", () => {
    const wrapper = mountStrip({ level: "ok" }, { loading: true });
    expect(ring(wrapper).props("state")).toBe("spinning");
    expect(ring(wrapper).find("svg").classes()).toContain("motion-safe:animate-spin");
    const icon = ring(wrapper).findComponent(OIcon);
    expect(icon.classes()).toContain("text-accent");
    expect(icon.classes()).not.toContain("motion-safe:animate-spin");
  });

  it("leaves the range out until it is known, instead of printing an invalid date", () => {
    const wrapper = mountStrip({ level: "ok" }, { timeRangeLabel: raw("") });
    expect(wrapper.find('[data-test="dashboard-kiosk-time-range"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Invalid");
  });

  it("keeps a compact row with the name as the most prominent text", () => {
    const wrapper = mountStrip({ level: "warn", kind: "failing", count: 1 });
    const row = wrapper.find('[data-test="dashboard-kiosk-strip"] > div');
    expect(row.classes()).toContain("h-11");
    expect(row.classes()).toContain("text-sm");
    expect(
      wrapper.find('[data-test="dashboard-kiosk-title"]').element.parentElement?.classList,
    ).toContain("text-xl");
    expect(wrapper.findComponent(OBadge).props("size")).toBe("lg");
    expect(wrapper.find('[data-test="dashboard-kiosk-exit-btn"]').classes()).toContain("h-8");
  });

  it("warns that auto-refresh is off, since that screen will go stale", () => {
    const wrapper = mountStrip({ level: "ok" }, { refreshSeconds: 0, countdown: null });
    const badge = wrapper.findComponent(OBadge);
    expect(badge.attributes("data-health")).toBe("refresh-off");
    expect(badge.props("variant")).toBe("warning-soft");
    expect(badge.text()).toBe("Auto-refresh off");
    expect(ring(wrapper).props("state")).toBe("off");
  });

  it("says Loading before the first update", () => {
    const wrapper = mountStrip({ level: "ok" }, { lastSuccessAt: null });
    expect(wrapper.find('[data-test="dashboard-kiosk-updated"]').text()).toBe("Loading...");
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

  it("names the retry time on the ring during an outage", () => {
    const wrapper = mountStrip(
      { level: "bad", kind: "unreachable", retryInSeconds: 10 },
      { countdown: { remainingMs: 10_000, totalMs: 20_000, at: NOW + 10_000, retrying: true } },
    );
    expect(ring(wrapper).props("tooltip")).toBe("Next retry at 14:07:19");
  });

  it("keeps the loading and off wording on the ring", async () => {
    const wrapper = mountStrip({ level: "ok" }, { loading: true });
    expect(ring(wrapper).props("tooltip")).toBe("Loading...");
    await wrapper.setProps({ loading: false, refreshSeconds: 0, countdown: null });
    expect(ring(wrapper).props("tooltip")).toBe("Auto-refresh off");
  });

  it("explains an outage and the retry countdown", () => {
    const badge = mountStrip({
      level: "bad",
      kind: "unreachable",
      retryInSeconds: 10,
    }).findComponent(OBadge);
    expect(badge.text()).toBe("Backend unreachable, retry in 10s");
  });

  it("always shows the exit icon at the end of the strip", async () => {
    const wrapper = mountStrip({ level: "ok" });
    const exit = wrapper.find('[data-test="dashboard-kiosk-exit-btn"]');
    expect(exit.element.parentElement?.lastElementChild).toBe(exit.element);
    expect(exit.classes()).not.toContain("invisible");
    expect(exit.attributes("aria-label")).toBe("Exit TV mode");

    await exit.trigger("click");
    expect(wrapper.emitted("exit")).toHaveLength(1);
  });
});
