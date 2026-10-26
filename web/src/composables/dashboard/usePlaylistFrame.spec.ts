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
import { computed, nextTick, ref } from "vue";
import type { KioskHealth } from "./useKioskRefresh";
import { toSlideHealth, usePlaylistFrame, usePlaylistPage } from "./usePlaylistFrame";
import type { PlaylistConfig } from "@/utils/dashboard/playlist";

const signals = () => {
  const health = ref<KioskHealth>({ level: "ok" });
  const failing = ref(0);
  return {
    health,
    failing,
    input: {
      title: ref<string | undefined>("Overview"),
      health: computed(() => health.value),
      failingCount: computed(() => failing.value),
      lastSuccessAt: ref<number | null>(null),
    },
  };
};

describe("usePlaylistFrame", () => {
  const postMessage = vi.fn();
  const realParent = window.parent;

  beforeEach(() => {
    postMessage.mockClear();
    Object.defineProperty(window, "parent", { value: { postMessage }, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", { value: realParent, configurable: true });
  });

  const sent = () => postMessage.mock.calls.map(([data]) => data.type);

  it("says hello, then ready once the first refresh lands, then health changes, all same-origin", async () => {
    const s = signals();
    usePlaylistFrame(true, s.input);
    expect(postMessage).toHaveBeenCalledWith(
      { source: "o2-tv-playlist", type: "hello" },
      window.location.origin,
    );

    s.input.lastSuccessAt.value = 1000;
    await nextTick();
    expect(postMessage.mock.calls[1][0]).toEqual({
      source: "o2-tv-playlist",
      type: "ready",
      title: "Overview",
    });
    expect(postMessage.mock.calls[2][0].health).toEqual({
      level: "ok",
      failing: 0,
      outage: false,
      lastSuccessAt: 1000,
    });

    s.health.value = { level: "warn", kind: "failing", count: 2 };
    s.failing.value = 2;
    await nextTick();
    expect(postMessage.mock.calls.at(-1)![0].health).toMatchObject({ level: "warn", failing: 2 });
    expect(postMessage.mock.calls.every(([, origin]) => origin === window.location.origin)).toBe(
      true,
    );
  });

  it("counts a known outage as ready so the player can hold on it", async () => {
    const s = signals();
    usePlaylistFrame(true, s.input);
    s.health.value = { level: "bad", kind: "unreachable", retryInSeconds: 5 };
    await nextTick();
    expect(sent()).toEqual(["hello", "ready", "health"]);
    expect(postMessage.mock.calls[2][0].health.outage).toBe(true);
  });

  it("reports a missing dashboard and a failed load", () => {
    const frame = usePlaylistFrame(true, signals().input);
    frame.reportMissing("forbidden");
    frame.reportError();
    expect(postMessage.mock.calls.slice(1).map(([data]) => data)).toEqual([
      { source: "o2-tv-playlist", type: "missing", reason: "forbidden" },
      { source: "o2-tv-playlist", type: "error" },
    ]);
  });

  it("posts nothing outside a playlist frame", () => {
    const frame = usePlaylistFrame(false, signals().input);
    frame.reportMissing("notFound");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("maps kiosk health to a slide report", () => {
    expect(toSlideHealth({ level: "paused" }, 0, null).level).toBe("ok");
    expect(toSlideHealth({ level: "warn", kind: "hung" }, 0, 5)).toEqual({
      level: "warn",
      failing: 0,
      outage: false,
      lastSuccessAt: 5,
    });
  });
});

describe("usePlaylistPage (framing blocked)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const config: PlaylistConfig = {
    org: "acme",
    entries: [
      { dashboardId: "d1", folderId: "default" },
      { dashboardId: "d2", folderId: "ops" },
    ],
    intervalSeconds: 30,
    slideIndex: 0,
    period: null,
    theme: "current",
    fit: false,
    timezone: null,
  };

  const setup = (misses = 0) => {
    const ready = ref(false);
    const outage = ref(false);
    const navigate = vi.fn();
    const page = usePlaylistPage({
      enabled: true,
      config,
      misses,
      ready: computed(() => ready.value),
      outage: computed(() => outage.value),
      resolveHref: (query) => `/view?${new URLSearchParams(query).toString()}`,
      navigate,
    });
    const target = () => new URLSearchParams(navigate.mock.calls.at(-1)![0].split("?")[1]);
    return { page, ready, outage, navigate, target };
  };

  it("moves to the next slide's page one interval after this one is ready", async () => {
    const { ready, navigate, target } = setup();
    vi.advanceTimersByTime(60_000);
    expect(navigate).not.toHaveBeenCalled();

    ready.value = true;
    await nextTick();
    vi.advanceTimersByTime(30_000);

    expect(target().get("dashboard")).toBe("d2");
    expect(target().get("slide")).toBe("2");
    expect(target().get("tvpage")).toBe("1");
  });

  it("holds during an outage and moves on after recovery", async () => {
    const { ready, outage, navigate } = setup();
    ready.value = true;
    outage.value = true;
    await nextTick();
    vi.advanceTimersByTime(30_000);
    expect(navigate).not.toHaveBeenCalled();

    outage.value = false;
    await nextTick();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("skips a missing dashboard and waits a full interval once every slide was missing", () => {
    const first = setup();
    expect(first.page.reportMissing("notFound")).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(first.target().get("miss")).toBe("1");

    const last = setup(1);
    last.page.reportMissing("notFound");
    vi.advanceTimersByTime(3_000);
    expect(last.navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(last.target().get("miss")).toBeNull();
  });

  it("does nothing on a normal kiosk page", () => {
    const navigate = vi.fn();
    const page = usePlaylistPage({
      enabled: false,
      config: null,
      misses: 0,
      ready: computed(() => true),
      outage: computed(() => false),
      resolveHref: () => "",
      navigate,
    });
    expect(page.reportMissing("notFound")).toBe(false);
    expect(page.reportError()).toBe(false);
  });
});
