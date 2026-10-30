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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import PlaylistStrip from "./PlaylistStrip.vue";
import KioskCountdownRing from "./KioskCountdownRing.vue";

const NOW = Date.UTC(2026, 9, 14, 12, 5, 0);
const UPDATED = NOW - 2 * 60_000;

const mountStrip = (props: Record<string, unknown> = {}) =>
  mount(PlaylistStrip, {
    props: {
      title: raw("Kubernetes overview"),
      current: 2,
      total: 5,
      nextName: raw("Ingest pipeline"),
      progress: 0.25,
      nextAt: NOW + 8_000,
      timeRangeLabel: raw("Past 1 Hour"),
      lastSuccessAt: UPDATED,
      timezone: "UTC",
      ...props,
    },
    global: { plugins: [i18n] },
  });

const byTest = (wrapper: ReturnType<typeof mountStrip>, id: string) =>
  wrapper.find(`[data-test="dashboard-playlist-${id}"]`);

const tooltips = (wrapper: ReturnType<typeof mountStrip>) =>
  wrapper.findAllComponents(OTooltip).map((tip) => String(tip.props("content")));

describe("PlaylistStrip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the name, then the rotation, range and relative update time grouped right", () => {
    const wrapper = mountStrip();
    expect(byTest(wrapper, "title").text()).toBe("Kubernetes overview");
    const meta = byTest(wrapper, "meta");
    expect(meta.find('[data-test="dashboard-playlist-current"]').text()).toBe("2");
    expect(meta.find('[data-test="dashboard-playlist-position"]').text()).toBe("of 5");
    expect(meta.find('[data-test="dashboard-playlist-time-range"]').text()).toContain(
      "Past 1 Hour",
    );
    expect(meta.find('[data-test="dashboard-playlist-updated"]').text()).toBe("Updated 2m ago");
    expect(tooltips(wrapper)).toContain("Last refreshed: 12:03:00");
  });

  it("fills the rotation ring toward the next slide and names it in the tooltip", () => {
    const ring = mountStrip().findComponent(KioskCountdownRing);
    expect(ring.props("state")).toBe("running");
    expect(ring.props("progress")).toBe(0.25);
    expect(String(ring.props("tooltip"))).toBe("Next: Ingest pipeline at 12:05:08");
    expect(ring.attributes("aria-label")).toBe("Next: Ingest pipeline at 12:05:08");
  });

  it("shows a static pause glyph on the ring while paused, and the time it was paused", () => {
    const wrapper = mountStrip({ paused: true, pausedAt: NOW - 60_000 });
    const ring = wrapper.findComponent(KioskCountdownRing);
    expect(ring.props("state")).toBe("paused");
    expect(String(ring.props("tooltip"))).toBe("Rotation paused since 12:04");
    expect(byTest(wrapper, "current").exists()).toBe(false);
    expect(byTest(wrapper, "pause").attributes("aria-label")).toBe("Resume rotation");
  });

  it("spins the ring while the next slide is still loading", () => {
    const ring = mountStrip({ waiting: true }).findComponent(KioskCountdownRing);
    expect(ring.props("state")).toBe("spinning");
    expect(String(ring.props("tooltip"))).toBe("Loading the next dashboard");
  });

  it("shows only an unreachable backend as status, and holds the ring", () => {
    expect(mountStrip().findComponent(OBadge).exists()).toBe(false);
    const wrapper = mountStrip({ held: true });
    expect(byTest(wrapper, "held").text()).toBe("Backend unreachable");
    const ring = wrapper.findComponent(KioskCountdownRing);
    expect(ring.props("state")).toBe("paused");
    expect(String(ring.props("tooltip"))).toBe("Rotation held: backend unreachable");
  });

  it("lists skipped dashboards in the position tooltip only when there are any", () => {
    expect(tooltips(mountStrip()).some((tip) => tip.startsWith("Skipped"))).toBe(false);
    const wrapper = mountStrip({ skipped: [raw("Skipped Old: dashboard not found")] });
    expect(tooltips(wrapper)).toContain("Skipped Old: dashboard not found");
  });

  it("keeps prev, pause, next and exit in the header, always visible", async () => {
    const wrapper = mountStrip();
    for (const id of ["prev", "pause", "next", "exit"]) {
      expect(byTest(wrapper, id).isVisible()).toBe(true);
    }
    expect(byTest(wrapper, "edit").exists()).toBe(false);
    await byTest(wrapper, "prev").trigger("click");
    await byTest(wrapper, "pause").trigger("click");
    await byTest(wrapper, "next").trigger("click");
    await byTest(wrapper, "exit").trigger("click");
    expect(Object.keys(wrapper.emitted())).toEqual(
      expect.arrayContaining(["prev", "toggle-pause", "next", "exit"]),
    );
  });

  it("is one compact row the same height as the TV mode strip, with small controls", () => {
    const wrapper = mountStrip();
    expect(wrapper.find('[data-test="dashboard-playlist-strip"] > div').classes()).toContain(
      "h-11",
    );
    for (const id of ["prev", "pause", "next", "exit"]) {
      expect(byTest(wrapper, id).classes()).toEqual(expect.arrayContaining(["h-8", "w-8"]));
    }
  });

  it("carries no tab or variable chips: those stay in the bar above the panels", () => {
    const wrapper = mountStrip();
    expect(wrapper.findAllComponents(OBadge)).toHaveLength(0);
    expect(wrapper.find('[data-test^="dashboard-playlist-context"]').exists()).toBe(false);
  });

  it("drops the time range when no shared range is set", () => {
    expect(byTest(mountStrip({ timeRangeLabel: null }), "time-range").exists()).toBe(false);
  });
});
