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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import PlaylistStrip from "./PlaylistStrip.vue";
import type { SlideRecord } from "@/composables/dashboard/usePlaylistPlayer";

const slide = (over: Partial<SlideRecord> = {}): SlideRecord => ({
  title: null,
  health: null,
  missing: null,
  missingAt: null,
  loadFailed: false,
  ...over,
});

const UPDATED = new Date(2026, 9, 14, 12, 0, 58).getTime();
const PAUSED = new Date(2026, 9, 14, 12, 3, 0).getTime();

/** Width the row needs at each layout step, standing in for a real browser's measurement. */
const fakeWidths = (el: HTMLElement, rowWidth: number, needed: number[]) => {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => rowWidth });
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    get: () => needed[Number(el.dataset.fit ?? 0)] ?? 0,
  });
};

describe("PlaylistStrip", () => {
  let wrapper: VueWrapper<any> | null = null;

  const mountStrip = async (props: Record<string, unknown> = {}) => {
    wrapper = mount(PlaylistStrip, {
      props: {
        title: raw("pt-pl2-bad"),
        position: raw("2 of 3"),
        index: 1,
        slides: [
          slide({ title: "pt-pl2-ok1" }),
          slide({
            title: "pt-pl2-bad",
            health: { level: "warn", failing: 1, outage: false, lastSuccessAt: UPDATED },
          }),
          slide({ title: "pt-pl2-ok2" }),
        ],
        names: ["pt-pl2-ok1", "pt-pl2-bad", "pt-pl2-ok2"],
        timeRangeLabel: raw("Past 7 Days"),
        worstOther: { index: 2, level: "warn", failing: 2 },
        paused: true,
        pausedAt: PAUSED,
        lastSuccessAt: UPDATED,
        controlsVisible: false,
        ...props,
      },
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    return wrapper;
  };

  const row = () => wrapper!.find("[data-fit]");
  const text = (id: string) => wrapper!.find(`[data-test="dashboard-playlist-${id}"]`).text();
  const exists = (id: string) => wrapper!.find(`[data-test="dashboard-playlist-${id}"]`).exists();
  const fitTo = async (rowWidth: number, needed: number[]) => {
    fakeWidths(row().element as HTMLElement, rowWidth, needed);
    await wrapper!.setProps({ position: raw("2 of 3 ") });
    await flushPromises();
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("keeps the full 1080p layout when everything fits", async () => {
    await mountStrip({ held: true });
    expect(row().attributes("data-fit")).toBe("0");
    expect(text("worst-other")).toBe("pt-pl2-ok2: 2 panels failing");
    expect(text("held")).toBe("Backend unreachable · showing data from 12:00");
    expect(text("paused")).toBe("Rotation paused since 12:03");
    expect(text("updated")).toBe("Updated 12:00:58");
    expect(exists("dots")).toBe(true);
    expect(exists("time-range")).toBe(true);
  });

  it("shows the controls in a bar below the strip, leaving the strip exactly as it was", async () => {
    await mountStrip({ held: true });
    await fitTo(1280, [1950, 1880, 1760, 1250]);
    const before = row().html();
    const fitBefore = row().attributes("data-fit");

    await wrapper!.setProps({ controlsVisible: true });
    await flushPromises();

    expect(row().html()).toBe(before);
    expect(row().attributes("data-fit")).toBe(fitBefore);
    expect(row().find('[data-test="dashboard-playlist-controls"]').exists()).toBe(false);
    const bar = wrapper!.find('[data-test="dashboard-playlist-controls"]');
    expect(bar.classes()).toEqual(
      expect.arrayContaining(["absolute", "top-full", "end-page-edge"]),
    );
    expect(bar.classes()).toContain("opacity-100");
    for (const id of ["prev", "pause", "next", "exit"]) expect(exists(id)).toBe(true);
  });

  it("hides the bar without moving anything when the controls time out", async () => {
    await mountStrip({ controlsVisible: true });
    await wrapper!.setProps({ controlsVisible: false });
    const bar = wrapper!.find('[data-test="dashboard-playlist-controls"]');
    expect(bar.classes()).toEqual(expect.arrayContaining(["invisible", "pointer-events-none"]));
    expect(wrapper!.find('[data-test="dashboard-playlist-prev"]').attributes("tabindex")).toBe(
      "-1",
    );
  });

  it("drops the dots and the range before any status text gets shorter", async () => {
    await mountStrip({ held: true });
    await fitTo(1800, [1950, 1880, 1760]);

    expect(row().attributes("data-fit")).toBe("2");
    expect(exists("dots")).toBe(false);
    expect(exists("time-range")).toBe(false);
    expect(text("held")).toBe("Backend unreachable · showing data from 12:00");
    expect(text("paused")).toBe("Rotation paused since 12:03");
  });

  it("at 1280px shortens the status text but keeps it readable", async () => {
    await mountStrip({ held: true });
    await fitTo(1280, [1950, 1880, 1760, 1250]);

    expect(row().attributes("data-fit")).toBe("3");
    expect(text("held")).toBe("Unreachable · 12:00");
    expect(text("worst-other")).toBe("…ok2: 2 failing");
    expect(text("paused")).toBe("Paused · 12:03");
    expect(text("updated")).toBe("Updated 12:00:58");
  });

  it("shows the failing count on the visible slide in short form", async () => {
    await mountStrip();
    await fitTo(1280, [1950, 1880, 1760, 1250]);
    expect(text("failing")).toBe("1 failing");
  });

  it("at about 500px keeps every status visible, whole, and the part of the title that differs", async () => {
    await mountStrip({ held: true });
    await fitTo(500, [1950, 1880, 1760, 1250, 1100, 900, 480]);

    expect(row().attributes("data-fit")).toBe("6");
    expect(exists("held")).toBe(true);
    expect(exists("worst-other")).toBe(true);
    expect(exists("paused")).toBe(true);
    expect(text("worst-other")).toBe("2");
    expect(text("title")).toBe("…bad");
    expect(text("updated")).toBe("12:00:58");
    expect(exists("edit")).toBe(false);
    expect(wrapper!.find('[data-test="dashboard-playlist-exit"]').attributes("aria-label")).toBe(
      "Exit",
    );
  });

  it("shows the failing count at 500px instead of hiding it", async () => {
    await mountStrip({ paused: false, pausedAt: null, worstOther: null });
    await fitTo(500, [1950, 1880, 1760, 1250, 1100, 900, 480]);
    expect(text("failing")).toBe("1");
  });

  it("gives the full text back once a chip goes away and there is room again", async () => {
    await mountStrip({ held: true });
    await fitTo(1280, [1950, 1880, 1760, 1250]);
    expect(row().attributes("data-fit")).toBe("3");

    fakeWidths(row().element as HTMLElement, 1280, [1200]);
    await wrapper!.setProps({ paused: false, pausedAt: null });
    await flushPromises();
    expect(row().attributes("data-fit")).toBe("0");
  });
});
