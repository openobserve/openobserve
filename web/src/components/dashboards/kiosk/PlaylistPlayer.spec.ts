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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import i18n from "@/locales";
import PlaylistPlayer from "./PlaylistPlayer.vue";
import type { PlaylistConfig, PlaylistFrameMessage } from "@/utils/dashboard/playlist";

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("@/services/dashboards", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { ...actual.default, list: listMock } };
});

vi.mock("@/services/health", () => ({ pingBackend: vi.fn().mockResolvedValue(true) }));

vi.mock("vue-router", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useRouter: () => ({
      resolve: ({ path, query }: { path: string; query: Record<string, string> }) => ({
        href: `/web${path}?${new URLSearchParams(query).toString()}`,
      }),
    }),
  };
});

const config: PlaylistConfig = {
  org: "acme",
  entries: [
    { dashboardId: "d1", folderId: "default" },
    { dashboardId: "d2", folderId: "ops" },
    { dashboardId: "d3", folderId: "ops" },
  ],
  intervalSeconds: 60,
  slideIndex: 0,
  period: "1h",
  theme: "dark",
  fit: true,
  timezone: null,
};

const rows: Record<string, any[]> = {
  default: [
    { dashboard_id: "d1", title: "Overview", folder_id: "default", folder_name: "Default" },
  ],
  ops: [
    { dashboard_id: "d2", title: "Payments", folder_id: "ops", folder_name: "Ops" },
    { dashboard_id: "d3", title: "Checkout", folder_id: "ops", folder_name: "Ops" },
  ],
};

const source = "o2-tv-playlist" as const;
type Body = PlaylistFrameMessage extends infer M
  ? M extends PlaylistFrameMessage
    ? Omit<M, "source">
    : never
  : never;

const frames = () => [...document.body.querySelectorAll<HTMLIFrameElement>("iframe")];
const frameFor = (index: number) =>
  document.body.querySelector<HTMLIFrameElement>(
    `[data-test="dashboard-playlist-frame-${index}"]`,
  )!;
const q = (testId: string) => document.body.querySelector<HTMLElement>(`[data-test="${testId}"]`);
const text = (testId: string) => q(testId)?.textContent?.replace(/\s+/g, " ").trim();

const post = async (frame: HTMLIFrameElement, body: Body, origin = window.location.origin) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { source, ...body },
      origin,
      source: frame.contentWindow,
    }),
  );
  await flushPromises();
};

describe("PlaylistPlayer", () => {
  let wrapper: VueWrapper<any> | null = null;

  const mountPlayer = async (props: Record<string, unknown> = {}) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(PlaylistPlayer, {
      props: { config, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, [VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    listMock.mockReset();
    listMock.mockImplementation(async (...args: any[]) => ({
      data: { dashboards: rows[args[6]] ?? [] },
    }));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("loads the first slide in an inert hidden frame and names it while it starts", async () => {
    await mountPlayer();

    expect(frames()).toHaveLength(1);
    const url = new URL(frameFor(0).src, window.location.origin);
    expect(url.pathname).toBe("/web/dashboards/view");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      dashboard: "d1",
      folder: "default",
      kiosk: "true",
      embed: "true",
      period: "1h",
      theme: "dark",
      fit: "true",
      refresh: "5m",
    });
    expect(frameFor(0).dataset.role).toBe("pending");
    expect(frameFor(0).hasAttribute("inert")).toBe(true);
    expect(text("dashboard-playlist-holding-eyebrow")).toBe("Starting");
    expect(text("dashboard-playlist-holding-title")).toBe("Overview");
    expect(text("dashboard-playlist-holding-label")).toBe("1 of 3");
    expect(text("dashboard-playlist-title")).toBe("Overview");
  });

  it("shows the slide once its frame reports ready", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "ready", title: "Overview" });

    expect(frameFor(0).dataset.role).toBe("shown");
    expect(q("dashboard-playlist-holding")).toBeNull();
    expect(text("dashboard-playlist-current")).toBe("1");
    expect(text("dashboard-playlist-position")).toBe("of 3");
    expect(wrapper!.emitted("slide")).toEqual([[0]]);
  });

  it("ignores messages from another origin or from a window that is not one of its frames", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "ready", title: "Evil" }, "https://evil.example");
    expect(frameFor(0).dataset.role).toBe("pending");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source, type: "ready", title: "Self" },
        origin: window.location.origin,
        source: window,
      }),
    );
    await flushPromises();
    expect(frameFor(0).dataset.role).toBe("pending");
  });

  it("next acts at once: the target loads behind a named holding card, then swaps in", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "ready", title: "Overview" });

    q("dashboard-playlist-next")!.click();
    await flushPromises();
    expect(frameFor(1).dataset.role).toBe("pending");
    expect(text("dashboard-playlist-holding-eyebrow")).toBe("Loading");
    expect(text("dashboard-playlist-holding-title")).toBe("Payments");
    expect(text("dashboard-playlist-holding-label")).toBe("2 of 3");

    await post(frameFor(1), { type: "ready", title: "Payments" });
    expect(frameFor(1).dataset.role).toBe("shown");
    expect(q("dashboard-playlist-holding")).toBeNull();
    expect(wrapper!.emitted("slide")).toEqual([[0], [1]]);
  });

  it("keeps failing panels and slide chips out of the strip", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "ready", title: "Overview" });
    await post(frameFor(0), {
      type: "health",
      health: { level: "warn", failing: 2, outage: false, lastSuccessAt: Date.now() },
    });
    expect(q("dashboard-playlist-strip")!.textContent).not.toContain("failing");
    expect(q("dashboard-playlist-context")).toBeNull();
  });

  it("skips a missing dashboard under its real name and counts only playable slides", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "missing", reason: "notFound" });

    expect(frameFor(1).dataset.role).toBe("pending");

    await post(frameFor(1), { type: "ready", title: "Payments" });
    expect(text("dashboard-playlist-current")).toBe("1");
    expect(text("dashboard-playlist-position")).toBe("of 2");
    expect(q("dashboard-playlist-position")!.getAttribute("tabindex")).toBe("0");
  });

  it("says when the link's interval was adjusted", async () => {
    await mountPlayer({ intervalAdjusted: true });
    expect(text("dashboard-playlist-interval-notice")).toContain("Interval adjusted to 1 min");
  });

  it("falls back to page mode only when the response forbids framing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: new Headers({ "X-Frame-Options": "DENY" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountPlayer();
    const frame = frameFor(0);
    Object.defineProperty(frame, "contentDocument", { get: () => null });

    frame.dispatchEvent(new Event("load"));
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(frame.src, expect.anything());
    expect(wrapper!.emitted("fallback")).toEqual([[0]]);
  });

  it("treats an unreadable frame without framing headers as a load failure, not a block", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await mountPlayer();
    const frame = frameFor(0);
    Object.defineProperty(frame, "contentDocument", { get: () => null });

    frame.dispatchEvent(new Event("load"));
    await flushPromises();

    expect(wrapper!.emitted("fallback")).toBeUndefined();
    expect(wrapper!.vm.player.state.slides[0].loadFailed).toBe(true);
  });

  it("says the backend is unreachable on the visible slide, with the age of what it shows", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "ready", title: "Overview" });
    const updated = new Date(2026, 9, 14, 9, 41, 0).getTime();
    await post(frameFor(0), {
      type: "health",
      health: { level: "ok", failing: 0, outage: false, lastSuccessAt: updated },
    });

    window.dispatchEvent(new Event("offline"));
    await flushPromises();

    expect(text("dashboard-playlist-held")).toBe("Backend unreachable");
    // vue-query's online manager is global; leave it online for the next test.
    window.dispatchEvent(new Event("online"));
  });

  it("holds on an outage, and pauses and exits from the strip, with no edit on the TV", async () => {
    await mountPlayer();
    await post(frameFor(0), { type: "ready", title: "Overview" });
    await post(frameFor(0), {
      type: "health",
      health: { level: "bad", failing: 3, outage: true, lastSuccessAt: 1 },
    });
    expect(q("dashboard-playlist-held")).not.toBeNull();

    q("dashboard-playlist-pause")!.click();
    await flushPromises();
    expect(wrapper!.vm.player.state.paused).toBe(true);
    expect(q("dashboard-playlist-pause")!.getAttribute("aria-label")).toBe("Resume rotation");

    q("dashboard-playlist-exit")!.click();
    expect(wrapper!.emitted("exit")).toHaveLength(1);
    expect(q("dashboard-playlist-edit")).toBeNull();
  });
});
