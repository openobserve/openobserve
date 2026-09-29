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
import MobileSessionPlayer from "@/components/rum/MobileSessionPlayer.vue";
import i18n from "@/locales";

const T = 1_700_000_000_000;

const wireframe = (id: number, text: string) => ({
  id,
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  type: "text",
  text,
});

// Segment A: 0–5 s with a full screen showing "first"; segment B: 10–20 s with one showing "second".
const segmentA = {
  records: [
    { type: 4, timestamp: T, data: { width: 400, height: 800 } },
    { type: 10, timestamp: T, data: { wireframes: [wireframe(1, "first")] } },
    { type: 11, timestamp: T + 5_000, data: {} },
  ],
};
const segmentB = {
  records: [
    { type: 10, timestamp: T + 10_000, data: { wireframes: [wireframe(2, "second")] } },
    { type: 11, timestamp: T + 20_000, data: {} },
  ],
};

function mountPlayer(props: Record<string, any> = {}) {
  return mount(MobileSessionPlayer, {
    props: { segments: [segmentA], sessionStartMs: T, loadState: "loading", speed: 1, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        OIcon: {
          template: '<i data-test="OIcon" :data-name="name" @click="$emit(\'click\')"></i>',
          props: ["name", "size"],
          emits: ["click"],
        },
      },
    },
  });
}

const playIcon = (wrapper: ReturnType<typeof mountPlayer>) =>
  wrapper.find('[data-test="rum-mobile-replay-play-btn"]');

describe("MobileSessionPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps playing from the same position when a later batch arrives", async () => {
    const wrapper = mountPlayer();
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(2_000);
    await wrapper.vm.$nextTick();
    const before = wrapper.find('[data-test="rum-mobile-replay-time"]').text();
    expect(before).toBe("0:01 / 0:05");

    await wrapper.setProps({ segments: [segmentA, segmentB] });

    expect(wrapper.find('[data-test="rum-mobile-replay-time"]').text()).toBe("0:01 / 0:20");
    expect(playIcon(wrapper).attributes("data-name")).toBe("pause-circle-filled");
    wrapper.unmount();
  });

  it("holds at the loaded edge while loading, then resumes when more arrives", async () => {
    const wrapper = mountPlayer();
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.playbackState).toBe("buffering");
    expect(wrapper.find('[data-test="replay-overlay-buffering"]').exists()).toBe(true);

    await wrapper.setProps({ segments: [segmentA, segmentB] });
    expect(wrapper.vm.playbackState).toBe("playing");
    wrapper.unmount();
  });

  it("ends at the run's last segment instead of buffering while earlier holes load", async () => {
    const wrapper = mountPlayer({ runComplete: true });
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.playbackState).toBe("ended");
    wrapper.unmount();
  });

  it("plays a seek the parent makes in the tick it clears the pending target", async () => {
    const wrapper = mountPlayer({ segments: [segmentA, segmentB], pendingSeekMs: 12_000 });
    expect(wrapper.vm.playbackState).toBe("waiting");

    wrapper.vm.seekTo(12_000, true);
    expect(wrapper.vm.playbackState).toBe("playing");
    await wrapper.setProps({ pendingSeekMs: null });
    expect(wrapper.vm.playbackState).toBe("playing");
    wrapper.unmount();
  });

  it("uses the fixed session length from the parent for the total", () => {
    const wrapper = mountPlayer({ sessionEndMs: T + 600_000 });
    expect(wrapper.find('[data-test="rum-mobile-replay-time"]').text()).toBe("0:00 / 10:00");
    wrapper.unmount();
  });

  it("lands seekTo on the right frame for a covered target", async () => {
    const wrapper = mountPlayer({ segments: [segmentA, segmentB], loadState: "complete" });
    expect(wrapper.text()).toContain("first");

    wrapper.vm.seekTo(12_000, false);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("second");
    expect(wrapper.find('[data-test="rum-mobile-replay-time"]').text()).toBe("0:12 / 0:20");
    wrapper.unmount();
  });

  it("shows Waiting for a pending target until the parent seeks there", async () => {
    const wrapper = mountPlayer();
    await wrapper.setProps({ pendingSeekMs: 15_000 });
    expect(wrapper.vm.playbackState).toBe("waiting");
    expect(wrapper.find('[data-test="replay-overlay-waiting"]').text()).toContain(
      "Loading up to 00:15",
    );

    await wrapper.setProps({ segments: [segmentA, segmentB], pendingSeekMs: null });
    wrapper.vm.seekTo(15_000, false);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.playbackState).toBe("paused");
    expect(wrapper.text()).toContain("second");
    wrapper.unmount();
  });

  it("ends at the session end and sends Play as a seek to 0", async () => {
    const wrapper = mountPlayer({ loadState: "complete" });
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.playbackState).toBe("ended");

    await playIcon(wrapper).trigger("click");
    expect(wrapper.emitted("seek-request")?.at(-1)).toEqual([0]);
    wrapper.unmount();
  });

  it("turns a bar click into a seek request in session ms", async () => {
    const wrapper = mountPlayer({ sessionEndMs: T + 100_000 });
    const bar = wrapper.find('[data-test="rum-mobile-replay-playback-bar"]');
    (bar.element as HTMLElement).getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
    await bar.trigger("click", { clientX: 50 });
    expect(wrapper.emitted("seek-request")?.at(-1)).toEqual([25_000]);
    wrapper.unmount();
  });

  it("shows a failed load as an error with Retry, not as a missing replay", async () => {
    const wrapper = mountPlayer({ segments: [], loadState: "error" });
    expect(wrapper.find('[data-test="rum-mobile-replay-empty"]').exists()).toBe(false);
    await wrapper.find('[data-test="replay-overlay-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    wrapper.unmount();
  });

  it("in a live session, ends at the loaded end, then resumes in place on new activity", async () => {
    const wrapper = mountPlayer({ loadState: "live", runComplete: true });
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.playbackState).toBe("ended");
    expect(wrapper.find('[data-test="replay-status-chip"]').text()).toBe("Live");
    expect(wrapper.emitted("seek-request")).toBeUndefined();

    await wrapper.setProps({ segments: [segmentA, segmentB] });
    expect(wrapper.vm.playbackState).toBe("playing");
    expect(wrapper.find('[data-test="rum-mobile-replay-time"]').text()).toBe("0:05 / 0:20");
    expect(wrapper.emitted("seek-request")).toBeUndefined();
    wrapper.unmount();
  });

  it("in a live session, stays put on new activity once the user moved the playhead", async () => {
    const wrapper = mountPlayer({ loadState: "live", runComplete: true });
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();
    wrapper.vm.seekTo(2_000, false);

    await wrapper.setProps({ segments: [segmentA, segmentB] });
    expect(wrapper.vm.playbackState).toBe("paused");
    wrapper.unmount();
  });

  it("in a live session, buffers at the edge while a batch is still in flight", async () => {
    const wrapper = mountPlayer({ loadState: "live", runComplete: false });
    await playIcon(wrapper).trigger("click");
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.playbackState).toBe("buffering");

    await wrapper.setProps({ segments: [segmentA, segmentB] });
    expect(wrapper.vm.playbackState).toBe("playing");
    wrapper.unmount();
  });

  it("announces ready once the first records are there", async () => {
    const wrapper = mountPlayer({ segments: [] });
    expect(wrapper.emitted("ready")).toBeUndefined();
    await wrapper.setProps({ segments: [segmentA] });
    await wrapper.setProps({ segments: [segmentA, segmentB] });
    expect(wrapper.emitted("ready")).toHaveLength(1);
    wrapper.unmount();
  });
});
