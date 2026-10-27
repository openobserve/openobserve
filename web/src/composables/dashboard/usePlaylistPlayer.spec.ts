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
import {
  BOOT_STALL_MS,
  JUMP_WATCHDOG_MS,
  LOAD_RETRY_MS,
  MISSING_RECHECK_MS,
  PROBE_MS,
  READY_CAP_MS,
  usePlaylistPlayer,
  type PlayerSlot,
} from "./usePlaylistPlayer";
import type { SlideHealthReport } from "@/utils/dashboard/playlist";

const source = "o2-tv-playlist" as const;
const healthy: SlideHealthReport = { level: "ok", failing: 0, outage: false, lastSuccessAt: 1 };
const outage: SlideHealthReport = { level: "bad", failing: 3, outage: true, lastSuccessAt: 1 };

const setup = (
  over: {
    count?: number;
    interval?: number;
    start?: number;
    probe?: () => Promise<boolean>;
  } = {},
) => {
  const shown: number[] = [];
  const fallback = vi.fn();
  const player = usePlaylistPlayer({
    count: over.count ?? 3,
    intervalSeconds: over.interval ?? 60,
    startIndex: over.start ?? 0,
    onSlideShown: (index) => shown.push(index),
    onFallback: fallback,
    probe: over.probe,
  });
  player.start();

  const ready = (slot: PlayerSlot | null, title = `Dash ${slot?.index}`) => {
    if (!slot) throw new Error("no slot");
    player.onMessage(slot.key, { source, type: "ready", title });
  };
  const readyPending = (title?: string) => ready(player.state.pending, title);
  const health = (slot: PlayerSlot | null, report: SlideHealthReport) =>
    player.onMessage(slot!.key, { source, type: "health", health: report });

  return { player, shown, fallback, ready, readyPending, health };
};

describe("usePlaylistPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads the start slide first and shows it once it is ready", () => {
    const { player, shown, readyPending } = setup({ start: 1 });

    expect(player.state.phase).toBe("starting");
    expect(player.state.shown).toBeNull();
    expect(player.state.pending?.index).toBe(1);

    readyPending("Payments");

    expect(player.state.phase).toBe("playing");
    expect(player.state.shown?.index).toBe(1);
    expect(player.state.slides[1].title).toBe("Payments");
    expect(shown).toEqual([1]);
  });

  it("preloads the next slide before the dwell ends and swaps instantly when due", () => {
    const { player, shown, readyPending } = setup({ interval: 60 });
    readyPending();

    vi.advanceTimersByTime(49_000);
    expect(player.state.pending).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(player.state.pending?.index).toBe(1);

    readyPending();
    expect(player.state.shown?.index).toBe(0);

    vi.advanceTimersByTime(10_000);
    expect(player.state.shown?.index).toBe(1);
    expect(shown).toEqual([0, 1]);
  });

  it("keeps at most the shown frame, one preloaded frame and a fading one, and drops the old frame", () => {
    const { player, readyPending } = setup({ interval: 30 });
    readyPending();
    const first = player.state.shown!;
    for (let loop = 0; loop < 20; loop++) {
      vi.advanceTimersByTime(20_000);
      readyPending();
      vi.advanceTimersByTime(10_000);
      const live = [player.state.leaving, player.state.shown, player.state.pending].filter(Boolean);
      expect(live.length).toBeLessThanOrEqual(3);
      vi.advanceTimersByTime(500);
      expect(player.state.leaving).toBeNull();
    }
    expect(player.state.shown?.key).not.toBe(first.key);
    expect(player.state.shown?.index).toBe(20 % 3);
  });

  it("keeps the current slide while the next is still loading and swaps when it is ready", () => {
    const { player, readyPending } = setup({ interval: 30 });
    readyPending();
    vi.advanceTimersByTime(30_000);

    expect(player.state.shown?.index).toBe(0);
    expect(player.waiting.value).toBe(true);

    readyPending();
    expect(player.state.shown?.index).toBe(1);
    expect(player.waiting.value).toBe(false);
  });

  it("shows a booted but slow slide anyway once it has been starting for the ready cap", () => {
    const { player, readyPending } = setup({ interval: 10 });
    readyPending();
    vi.advanceTimersByTime(10_000);
    const slow = player.state.pending!;
    player.onMessage(slow.key, { source, type: "hello" });

    vi.advanceTimersByTime(READY_CAP_MS - 1);
    expect(player.state.shown?.key).not.toBe(slow.key);
    vi.advanceTimersByTime(1);
    expect(player.state.shown?.key).toBe(slow.key);
  });

  it("keeps waiting for a frame that is still downloading on a slow network, without restarting or falling back", () => {
    const { player, readyPending, fallback } = setup({ interval: 10 });
    readyPending();
    vi.advanceTimersByTime(10_000);
    const slow = player.state.pending!;

    vi.advanceTimersByTime(10 * 60_000);

    expect(player.state.pending?.key).toBe(slow.key);
    expect(player.state.shown?.index).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("reloads a loaded frame whose app never starts, backing off each time", () => {
    const { player, readyPending } = setup({ interval: 10 });
    readyPending();
    vi.advanceTimersByTime(10_000);
    const first = player.state.pending!;
    player.onFrameLoaded(first.key);

    vi.advanceTimersByTime(BOOT_STALL_MS);
    const second = player.state.pending!;
    expect(second.key).not.toBe(first.key);
    expect(second.index).toBe(first.index);

    player.onFrameLoaded(second.key);
    vi.advanceTimersByTime(BOOT_STALL_MS);
    expect(player.state.pending?.key).toBe(second.key);
    vi.advanceTimersByTime(BOOT_STALL_MS);
    expect(player.state.pending?.key).not.toBe(second.key);
  });

  it("measures the dwell from the swap, and preloads early enough after a slow load", () => {
    const { player, shown, readyPending } = setup({ interval: 10 });
    vi.advanceTimersByTime(8_000);
    readyPending();
    expect(shown).toEqual([0]);

    // An 8s load makes the lead the whole 10s dwell, so the next slide starts loading at once.
    expect(player.state.pending?.index).toBe(1);
    readyPending();
    vi.advanceTimersByTime(9_999);
    expect(shown).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([0, 1]);
  });

  it("skips a deleted or forbidden dashboard, records it, and does not reload it every loop", () => {
    const { player, readyPending } = setup({ interval: 30 });
    readyPending();
    vi.advanceTimersByTime(30_000);
    const missing = player.state.pending!;
    player.onMessage(missing.key, { source, type: "missing", reason: "forbidden" });

    expect(player.state.slides[1].missing).toBe("forbidden");
    expect(player.state.pending?.index).toBe(2);
    readyPending();
    expect(player.state.shown?.index).toBe(2);

    vi.advanceTimersByTime(30_000);
    expect(player.state.pending?.index).toBe(0);
    readyPending();
    vi.advanceTimersByTime(30_000);
    expect(player.state.pending?.index).toBe(2);

    vi.advanceTimersByTime(MISSING_RECHECK_MS);
    readyPending();
    vi.advanceTimersByTime(30_000);
    readyPending();
    vi.advanceTimersByTime(30_000);
    expect(player.state.pending?.index).toBe(1);
  });

  it("goes to the empty state when every dashboard is missing, then retries", () => {
    const { player } = setup({ count: 2 });
    player.onMessage(player.state.pending!.key, { source, type: "missing", reason: "notFound" });
    player.onMessage(player.state.pending!.key, { source, type: "missing", reason: "notFound" });

    expect(player.state.phase).toBe("empty");
    expect(player.state.pending).toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(player.state.phase).toBe("starting");
    expect(player.state.pending?.index).toBe(0);
  });

  it("retries a slide that failed to load instead of skipping it, at a steady pace", () => {
    const { player, readyPending, health } = setup({ interval: 30 });
    readyPending();
    vi.advanceTimersByTime(30_000);
    const failed = player.state.pending!;
    player.onMessage(failed.key, { source, type: "error" });

    expect(player.state.pending?.status).toBe("failed");
    health(player.state.shown, healthy);
    expect(player.state.pending?.key).toBe(failed.key);
    expect(player.state.shown?.index).toBe(0);

    vi.advanceTimersByTime(LOAD_RETRY_MS);
    expect(player.state.pending?.index).toBe(1);
    expect(player.state.pending?.key).not.toBe(failed.key);
  });

  it("holds rotation during an outage and resumes when the probe sees the backend again", async () => {
    let reachable = false;
    const { player, readyPending, health } = setup({
      interval: 30,
      probe: () => Promise.resolve(reachable),
    });
    readyPending();
    health(player.state.shown, outage);
    vi.advanceTimersByTime(20_000);
    readyPending();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(player.held.value).toBe(true);
    expect(player.state.shown?.index).toBe(0);

    reachable = true;
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(player.state.shown?.index).toBe(1);
  });

  it("recovers by itself after going offline, even if no frame ever posts again", async () => {
    const { player, readyPending, health } = setup({
      interval: 10,
      probe: () => Promise.resolve(true),
    });
    readyPending();
    health(player.state.shown, outage);
    vi.advanceTimersByTime(10_000);
    const dead = player.state.pending!;
    player.onFrameFailed(dead.key);

    player.onOnline();
    await vi.advanceTimersByTimeAsync(0);

    const fresh = player.state.pending!;
    expect(fresh.key).not.toBe(dead.key);
    expect(fresh.index).toBe(1);
    readyPending();
    expect(player.state.shown?.index).toBe(1);
  });

  it("never swaps in, even on a key press, a slide that came up during an outage", () => {
    const { player, readyPending, health } = setup({ interval: 10 });
    readyPending();
    player.next();
    const target = player.state.pending!;
    health(target, outage);
    readyPending();

    expect(player.state.shown?.index).toBe(0);
    health(target, healthy);
    expect(player.state.shown?.index).toBe(1);
  });

  it("holds on an offline event and resumes within a probe of the network coming back", async () => {
    const { player, readyPending } = setup({ interval: 15, probe: () => Promise.resolve(true) });
    readyPending();
    player.onOffline();
    expect(player.held.value).toBe(true);

    vi.advanceTimersByTime(15_000);
    const dead = player.state.pending!;
    player.onFrameFailed(dead.key);
    expect(player.state.shown?.index).toBe(0);

    player.onOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.held.value).toBe(false);
    expect(player.state.pending?.key).not.toBe(dead.key);
    readyPending();
    expect(player.state.shown?.index).toBe(1);
  });

  it("calls the backend down only after two failed pings, and reloads the failed slide as soon as one answers", async () => {
    let reachable = false;
    const { player, readyPending } = setup({
      interval: 15,
      probe: () => Promise.resolve(reachable),
    });
    readyPending();
    vi.advanceTimersByTime(15_000);
    const failed = player.state.pending!;
    player.onMessage(failed.key, { source, type: "error" });

    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(player.state.backendDown).toBe(false);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(player.state.backendDown).toBe(true);
    expect(player.held.value).toBe(true);

    reachable = true;
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(player.state.backendDown).toBe(false);
    expect(player.state.pending?.key).not.toBe(failed.key);
    expect(player.state.pending?.status).toBe("loading");
  });

  it("pauses rotation (not data) and resumes with the remaining dwell", () => {
    const { player, readyPending } = setup({ interval: 60 });
    readyPending();
    vi.advanceTimersByTime(20_000);
    player.togglePause();

    expect(player.state.paused).toBe(true);
    expect(player.state.pausedAt).not.toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(player.state.shown?.index).toBe(0);
    expect(player.progress.value).toBeCloseTo(1 / 3, 1);

    player.togglePause();
    vi.advanceTimersByTime(30_000);
    readyPending();
    vi.advanceTimersByTime(10_000);
    expect(player.state.shown?.index).toBe(1);
  });

  it("says when the next slide comes and names it, skipping one known to be gone", () => {
    vi.setSystemTime(Date.UTC(2026, 9, 14, 12, 0, 0));
    const shownAt = Date.now();
    const { player, readyPending } = setup({ interval: 30 });
    readyPending();
    vi.advanceTimersByTime(10_000);
    expect(player.nextAt.value).toBe(shownAt + 30_000);
    expect(player.nextIndex.value).toBe(1);
    player.state.slides[1].missing = "notFound";
    player.state.slides[1].missingAt = Date.now();
    expect(player.nextIndex.value).toBe(2);

    player.togglePause();
    expect(player.nextAt.value).toBeNull();
    vi.advanceTimersByTime(5_000);
    player.togglePause();
    expect(player.nextAt.value).toBe(shownAt + 30_000 + 5_000);
  });

  it("keeps the next slide loaded while paused, so Next is instant", () => {
    const { player, readyPending } = setup({ interval: 15 });
    readyPending();
    player.togglePause();
    expect(player.state.pending?.index).toBe(1);
    readyPending();
    vi.advanceTimersByTime(10 * 60_000);
    expect(player.state.shown?.index).toBe(0);

    player.next();
    expect(player.state.shown?.index).toBe(1);
    expect(player.state.paused).toBe(true);
    expect(player.state.pending?.index).toBe(2);
  });

  it("next and previous act on the first press, show what they wait for, and work while paused", () => {
    const { player, readyPending } = setup({ count: 4 });
    readyPending();
    player.togglePause();

    player.next();
    expect(player.state.pending?.index).toBe(1);
    expect(player.jumpTarget.value).toBe(1);
    readyPending();
    expect(player.state.shown?.index).toBe(1);
    expect(player.jumpTarget.value).toBeNull();

    player.prev();
    player.prev();
    expect(player.state.pending?.index).toBe(3);
    readyPending();
    expect(player.state.shown?.index).toBe(3);
    expect(player.state.paused).toBe(true);
  });

  it("next then previous before the next slide is ready leaves the shown slide up, with no card or reload", () => {
    const { player, readyPending } = setup({ count: 3 });
    readyPending();
    const shownKey = player.state.shown!.key;

    player.next();
    expect(player.jumpTarget.value).toBe(1);
    player.prev();

    expect(player.jumpTarget.value).toBeNull();
    expect(player.state.jump).toBe(false);
    expect(player.state.pending).toBeNull();
    expect(player.state.shown?.key).toBe(shownKey);
  });

  it("next then previous after the swap loads the previous slide behind its card and clears it when ready", () => {
    const { player, readyPending } = setup({ count: 3, interval: 60 });
    readyPending();
    vi.advanceTimersByTime(50_000);
    readyPending();

    player.next();
    expect(player.state.shown?.index).toBe(1);
    player.prev();
    expect(player.jumpTarget.value).toBe(0);

    const target = player.state.pending!;
    player.onMessage(target.key, { source, type: "hello" });
    readyPending();
    expect(player.state.shown?.key).toBe(target.key);
    expect(player.jumpTarget.value).toBeNull();
  });

  it("previous while that slide is still loading keeps one target and clears the card once it is ready", () => {
    const { player, readyPending } = setup({ count: 4 });
    readyPending();
    player.next();
    player.next();
    player.prev();
    expect(player.state.pending?.index).toBe(1);
    expect(player.jumpTarget.value).toBe(1);

    readyPending();
    expect(player.state.shown?.index).toBe(1);
    expect(player.jumpTarget.value).toBeNull();
  });

  it("reloads a prev/next target that never starts, keeping the card up, and shows a started one at the watchdog", () => {
    const { player } = setup({ count: 3 });
    player.onMessage(player.state.pending!.key, { source, type: "ready", title: "A" });
    player.next();
    const first = player.state.pending!;

    vi.advanceTimersByTime(JUMP_WATCHDOG_MS);
    const second = player.state.pending!;
    expect(second.key).not.toBe(first.key);
    expect(second.index).toBe(1);
    expect(player.jumpTarget.value).toBe(1);

    player.onMessage(second.key, { source, type: "hello" });
    vi.advanceTimersByTime(2 * JUMP_WATCHDOG_MS);
    expect(player.state.shown?.key).toBe(second.key);
    expect(player.jumpTarget.value).toBeNull();
  });

  it("falls back to page mode only when framing is blocked, never for a slow or failed frame", () => {
    const slow = setup({ start: 2 });
    vi.advanceTimersByTime(30 * 60_000);
    slow.player.onFrameFailed(slow.player.state.pending!.key);
    expect(slow.fallback).not.toHaveBeenCalled();

    const blocked = setup({ start: 1 });
    blocked.player.onFrameBlocked(blocked.player.state.pending!.key);
    expect(blocked.fallback).toHaveBeenCalledWith(1);
    expect(blocked.player.state.fallback).toBe(true);
  });

  it("ignores messages from frames it no longer owns", () => {
    const { player, readyPending } = setup();
    readyPending();
    player.onMessage(999, { source, type: "missing", reason: "notFound" });
    expect(player.state.slides.every((slide) => !slide.missing)).toBe(true);
  });

  it("stops every timer", () => {
    const { player, readyPending } = setup();
    readyPending();
    player.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
