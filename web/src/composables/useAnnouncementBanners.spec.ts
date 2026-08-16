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

import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getActive = vi.fn();

vi.mock("@/services/announcements", () => ({
  default: {
    getActive: (...args: unknown[]) => getActive(...args),
  },
}));

// Mutable so a case can flip the build edition.
const mockConfig = vi.hoisted(() => ({ isEnterprise: "true", isCloud: "false" }));

vi.mock("@/aws-exports", () => ({ default: mockConfig }));

const mockStore = {
  state: { selectedOrganization: { identifier: "acme" } },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

import { useAnnouncementBanners } from "./useAnnouncementBanners";

const MINUTE_MICROS = 60 * 1_000_000;
/** Browser clock, fixed so "now" is predictable in every test. */
const BROWSER_NOW_MS = 1_754_985_600_000;
const BROWSER_NOW_MICROS = BROWSER_NOW_MS * 1000;

function banner(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    message: "Scheduled maintenance",
    variant: "warning",
    dismissible: true,
    ...overrides,
  };
}

/** Respond as the API would, with the server clock defaulting to the browser's. */
function respondWith(banners: unknown[], extra: Record<string, unknown> = {}) {
  getActive.mockResolvedValue({
    data: { banners, now: BROWSER_NOW_MICROS, ...extra },
  });
}

/** Run the composable inside a scope so its cleanup can be triggered. */
async function mountComposable() {
  const scope = effectScope();
  const api = scope.run(() => useAnnouncementBanners())!;
  api.start();
  await vi.waitFor(() => expect(getActive).toHaveBeenCalled());
  return { ...api, dispose: () => scope.stop() };
}

describe("useAnnouncementBanners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BROWSER_NOW_MS);
    getActive.mockReset();

    // The shared test setup's localStorage stub has no clear(), and dismissal
    // state has to start empty for each case.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });

    mockConfig.isEnterprise = "true";
    mockConfig.isCloud = "false";
    respondWith([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exposes the banners the server returned", async () => {
    respondWith([banner({ message: "Heads up" })]);

    const { banners, dispose } = await mountComposable();

    expect(banners.value).toHaveLength(1);
    expect(banners.value[0].message).toBe("Heads up");
    expect(getActive).toHaveBeenCalledWith("acme");
    dispose();
  });

  it("stacks every active banner, in the order the server ranked them", async () => {
    respondWith([
      banner({ id: "outage", variant: "critical", message: "Search is down" }),
      banner({ id: "maint", variant: "warning", message: "Maintenance tonight" }),
      banner({ id: "notice", variant: "info", message: "New release" }),
    ]);

    const { banners, dispose } = await mountComposable();

    expect(banners.value).toHaveLength(3);
    expect(banners.value.map((b) => b.id)).toEqual(["outage", "maint", "notice"]);
    dispose();
  });

  it("keeps stacking the rest when one of them is dismissed", async () => {
    respondWith([
      banner({ id: "a", message: "First" }),
      banner({ id: "b", message: "Second" }),
      banner({ id: "c", message: "Third" }),
    ]);

    const { banners, dismiss, dispose } = await mountComposable();
    dismiss("b");

    expect(banners.value.map((b) => b.id)).toEqual(["a", "c"]);
    dispose();
  });

  it("hides a banner whose window has not opened yet", async () => {
    respondWith([banner({ starts_at: BROWSER_NOW_MICROS + 5 * MINUTE_MICROS })]);

    const { banners, dispose } = await mountComposable();

    expect(banners.value).toHaveLength(0);
    dispose();
  });

  it("hides a banner whose window has closed", async () => {
    respondWith([banner({ ends_at: BROWSER_NOW_MICROS - 1 })]);

    const { banners, dispose } = await mountComposable();

    expect(banners.value).toHaveLength(0);
    dispose();
  });

  it("uses the server clock, so a skewed browser still flips at the right instant", async () => {
    // Browser runs 10 minutes fast. Judged by the browser the banner would
    // already be live; judged by the server it is still 5 minutes out.
    const serverNow = BROWSER_NOW_MICROS - 10 * MINUTE_MICROS;
    respondWith([banner({ starts_at: serverNow + 5 * MINUTE_MICROS })], { now: serverNow });

    const { banners, dispose } = await mountComposable();

    expect(banners.value).toHaveLength(0);
    dispose();
  });

  it("refetches on the boundary instead of waiting out the poll", async () => {
    const startsAt = BROWSER_NOW_MICROS + 2 * MINUTE_MICROS;
    respondWith([banner({ starts_at: startsAt })], { next_boundary: startsAt });

    const { dispose } = await mountComposable();
    expect(getActive).toHaveBeenCalledTimes(1);

    // Just before the boundary, nothing has fired...
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 - 1);
    expect(getActive).toHaveBeenCalledTimes(1);

    // ...and just after it (plus the 1s of slack) the refetch lands, well inside
    // the 3-minute poll interval.
    await vi.advanceTimersByTimeAsync(1_100);
    expect(getActive).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("ignores a boundary too far out for a timer and leaves it to the poll", async () => {
    const startsAt = BROWSER_NOW_MICROS + 48 * 60 * MINUTE_MICROS;
    respondWith([banner({ starts_at: startsAt })], { next_boundary: startsAt });

    const { dispose } = await mountComposable();

    // Only the poll should be running — no timer armed two days ahead.
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 100);
    expect(getActive).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("keeps a dismissed banner hidden across a remount", async () => {
    respondWith([banner({ id: "maint-1" })]);

    const first = await mountComposable();
    expect(first.banners.value).toHaveLength(1);
    first.dismiss("maint-1");
    expect(first.banners.value).toHaveLength(0);
    first.dispose();

    const second = await mountComposable();
    expect(second.banners.value).toHaveLength(0);
    second.dispose();
  });

  it("re-shows a banner whose id changed because its text was edited", async () => {
    respondWith([banner({ id: "auto-aaa", message: "v1" })]);
    const first = await mountComposable();
    first.dismiss("auto-aaa");
    first.dispose();

    respondWith([banner({ id: "auto-bbb", message: "v2" })]);
    const second = await mountComposable();

    expect(second.banners.value).toHaveLength(1);
    expect(second.banners.value[0].message).toBe("v2");
    second.dispose();
  });

  it("suppresses a promo while a critical banner is up", async () => {
    respondWith([
      banner({ id: "outage", variant: "critical", message: "Search is down" }),
      banner({ id: "promo", variant: "promo", message: "Join our webinar" }),
    ]);

    const { banners, dispose } = await mountComposable();

    expect(banners.value.map((b) => b.id)).toEqual(["outage"]);
    dispose();
  });

  it("keeps the promo when nothing critical is up", async () => {
    respondWith([
      banner({ id: "notice", variant: "info" }),
      banner({ id: "promo", variant: "promo" }),
    ]);

    const { banners, dispose } = await mountComposable();

    expect(banners.value.map((b) => b.id)).toEqual(["notice", "promo"]);
    dispose();
  });

  it("keeps whatever is on screen when a poll fails", async () => {
    respondWith([banner({ message: "Still here" })]);
    const { banners, dispose } = await mountComposable();
    expect(banners.value).toHaveLength(1);

    getActive.mockRejectedValue(new Error("network down"));
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 100);

    expect(banners.value).toHaveLength(1);
    dispose();
  });

  it("stops polling once the scope is disposed", async () => {
    respondWith([]);
    const { dispose } = await mountComposable();

    dispose();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(getActive).toHaveBeenCalledTimes(1);
  });
});
