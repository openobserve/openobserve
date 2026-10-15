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

import {
  config,
  enableAutoUnmount,
  mount,
  shallowMount,
  flushPromises,
  type VueWrapper,
} from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { slug: "abc" }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/services/public_dashboards", () => ({
  default: { getConfig: vi.fn(), getData: vi.fn() },
}));

import service from "@/services/public_dashboards";
import PublicDashboard from "@/views/Dashboards/PublicDashboard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

const CONFIG = {
  title: "My Dashboard",
  layout: [
    {
      tabId: "t1",
      name: "Overview",
      panels: [{ id: "p1", title: "Panel 1" }],
    },
  ],
  ranges: [
    { key: "r3600", type: "relative", secs: 3600 },
    { key: "r86400", type: "relative", secs: 86400 },
  ],
  default_key: "r3600",
  refresh_secs: 300,
  dashboard_updated_at: 1,
  link_rev: 1,
  settings_rev: 1,
};

// Shallow mounts stub OEmptyState; this stub keeps its title readable in the page text.
config.global.stubs.OEmptyState = { props: ["title"], template: "<div>{{ title }}</div>" };
// A mounted page keeps polling and listening for visibility, so each test unmounts its own.
enableAutoUnmount(afterEach);
const OTagStub = { name: "OTag", props: ["variant"], template: "<span><slot /></span>" };

const buildWrapper = () =>
  shallowMount(PublicDashboard, { global: { plugins: [i18n], provide: { store } } });

const has = (w: any, id: string) => w.find(`[data-test="${id}"]`).exists();
const find = (w: any, id: string) => w.find(`[data-test="${id}"]`);
const mountWithActions = () =>
  shallowMount(PublicDashboard, {
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: { OPageHeader: { template: "<div><slot name='actions' /></div>" }, OTag: OTagStub },
    },
  });
const grid = (w: any) => w.findComponent(RenderDashboardCharts);
const mountWithPicker = () =>
  shallowMount(PublicDashboard, {
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        OPageHeader: { template: "<div><slot name='actions' /></div>" },
        ODropdown: { template: "<div><slot /></div>" },
      },
    },
  });
const pickRange = (w: VueWrapper, key: string) =>
  w
    .findComponent<typeof ODropdownItem>(`[data-test="dashboards-public-dashboard-preset-${key}"]`)
    .vm.$emit("select");
const okSnapshot = (data: unknown) => ({
  status: 200,
  data: { rev: "a", panels: { p1: { state: { state: "ok" }, data } } },
});
const okBody = (rev: string) => ({
  rev,
  built_at: 1_800_000_000_000_000,
  window: { start: 1_799_999_640_000_000, end: 1_800_000_000_000_000 },
  refresh_secs: 300,
  fresh_until: null,
  stale: false,
  stale_reason: null,
  refreshing: false,
  next_retry_at: null,
  last_error_at: null,
  dashboard_updated_at: 1,
  link_rev: 1,
  settings_rev: 1,
  panels: { p1: { state: { state: "ok" }, data: [] } },
});
const ABSOLUTE = {
  key: "a1000000-86401000000",
  type: "absolute",
  start: 1_000_000,
  end: 86_401_000_000,
};
const mockAbsoluteLink = () => {
  vi.mocked(service.getConfig).mockResolvedValue({
    data: { ...CONFIG, ranges: [ABSOLUTE], default_key: ABSOLUTE.key },
    status: 200,
  } as never);
  vi.mocked(service.getData).mockResolvedValue({
    status: 200,
    data: {
      rev: "abs",
      built_at: 1_800_000_000_000_000,
      window: { start: ABSOLUTE.start, end: ABSOLUTE.end },
      fresh_until: null,
      panels: { p1: { state: { state: "ok" }, data: [] } },
    },
  } as never);
};
const panelsConfig = (panels: Array<Record<string, unknown>>) => ({
  ...CONFIG,
  layout: [{ tabId: "t1", name: "Overview", panels }],
});

describe("PublicDashboard viewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Lifecycle jitter off, so every cadence below is exact.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the loading state before requests resolve", () => {
    (service.getConfig as any).mockReturnValue(new Promise(() => {}));
    const w = buildWrapper();
    expect(has(w, "dashboards-public-dashboard-loading")).toBe(true);
  });

  it("renders the dashboard grid view-only, fed with the snapshot (ready)", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [[{ y: 1 }]] } } },
    });
    const w = buildWrapper();
    await flushPromises();
    expect(grid(w).exists()).toBe(true);
    expect(grid(w).props("viewOnly")).toBe(true);
    expect(grid(w).props("dashboardData").tabs).toEqual(CONFIG.layout);
    expect(grid(w).props("dashboardData").variables).toEqual({ list: [] });
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
  });

  it("polls at the Retry-After hint while refreshing, through a 304 that repeats it", async () => {
    // The server sends Retry-After on every refreshing 304.
    const notModified = { etag: '"a"', "retry-after": "5" };
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    const built = 1_800_000_000_000_000;
    const refreshing = {
      status: 200,
      headers: { "retry-after": "5" },
      data: { ...okBody("a"), built_at: built, stale: true, refreshing: true },
    };
    vi.mocked(service.getData)
      .mockResolvedValueOnce(refreshing as never)
      .mockResolvedValueOnce({ status: 304, headers: notModified, data: "" } as never)
      .mockResolvedValueOnce({ status: 200, data: { ...okBody("b"), built_at: built } } as never);
    const w = mountWithActions();
    await flushPromises();
    const chip = () => w.findComponent<typeof OTag>({ name: "OTag" });
    expect(chip().text()).toMatch(/^Updated .+ · Refreshing…$/);
    expect(chip().props("variant")).toBe("warning-soft");

    await vi.advanceTimersByTimeAsync(4_900);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(service.getData).toHaveBeenCalledTimes(2);
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r3600", "a");
    expect(chip().text()).toContain("Refreshing…");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(service.getData).toHaveBeenCalledTimes(3);
    expect(chip().text()).not.toContain("Refreshing…");
    expect(chip().props("variant")).toBe("default-soft");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.getData).toHaveBeenCalledTimes(3);
  });

  it("reads only on the lifecycle check, not at fresh_until", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { ...okBody("a"), fresh_until: 1_800_000_030_000_000 },
    });
    buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getData).toHaveBeenCalledTimes(2);
  });

  it("keeps the data on screen through a 429 and says when it tries again", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData)
      .mockResolvedValueOnce(okSnapshot([[{ y: 1 }]]) as never)
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "60" } } })
      .mockResolvedValue(okSnapshot([[{ y: 2 }]]) as never);
    const w = buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
    const banner = w.findComponent<typeof OBanner>({ name: "OBanner" });
    expect(banner.props("content")).toBe("Too many requests. Trying again in 1:00.");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 2 }]]);
    expect(w.findComponent({ name: "OBanner" }).exists()).toBe(false);
  });

  it("drops the hold banner once the next answer is not a 429 or a 503", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData)
      .mockResolvedValueOnce(okSnapshot([[{ y: 1 }]]) as never)
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "60" } } })
      .mockResolvedValueOnce({
        status: 202,
        headers: { "retry-after": "5" },
        data: { state: "building" },
      } as never)
      .mockRejectedValueOnce(new Error("Network Error"));
    const w = buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.findComponent({ name: "OBanner" }).exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getData).toHaveBeenCalledTimes(3);
    expect(w.findComponent({ name: "OBanner" }).exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(service.getData).toHaveBeenCalledTimes(4);
    expect(w.findComponent({ name: "OBanner" }).exists()).toBe(false);
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
  });

  it("says Too many requests when the viewer switches range during a 429 hold", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData)
      .mockResolvedValueOnce(okSnapshot([[{ y: 1 }]]) as never)
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "60" } } })
      .mockResolvedValue(okSnapshot([[{ y: 2 }]]) as never);
    const w = mountWithPicker();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    pickRange(w, "r86400");
    await flushPromises();
    expect(w.text()).toContain("Too many requests");
    expect(has(w, "dashboards-public-dashboard-loading")).toBe(false);
    expect(service.getData).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r86400", undefined);
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 2 }]]);
  });

  it("treats a 503 with Retry-After as a temporary hold, not a turned-off link", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    const capacity = { response: { status: 503, headers: { "retry-after": "60" }, data: "" } };
    vi.mocked(service.getData)
      .mockResolvedValueOnce(okSnapshot([[{ y: 1 }]]) as never)
      .mockRejectedValueOnce(capacity);
    const shown = buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(grid(shown).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
    expect(shown.findComponent<typeof OBanner>({ name: "OBanner" }).props("content")).toBe(
      "Can't load this dashboard right now. Trying again in 1:00.",
    );
    expect(shown.text()).not.toContain("turned off");
    shown.unmount();

    vi.mocked(service.getData).mockReset().mockRejectedValueOnce(capacity);
    const cold = mountWithActions();
    await flushPromises();
    expect(find(cold, "dashboards-public-dashboard-cooldown").text()).toBe(
      "Can't load this dashboard right now. Trying again in 1:00.",
    );
  });

  it("shows Loading dashboard on a 202 and reads again after exactly Retry-After", async () => {
    vi.useFakeTimers();
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    vi.mocked(service.getData)
      .mockResolvedValueOnce({
        status: 202,
        headers: { "retry-after": "4" },
        data: { state: "building", estimated_secs: 4, progress: 0.4 },
      } as never)
      .mockResolvedValue({ status: 200, data: okBody("a") } as never);
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-loading")).toBe(true);
    expect(w.text()).toContain("Loading dashboard…");
    expect(w.text()).not.toContain("Preparing");

    await vi.advanceTimersByTimeAsync(3_999);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getData).toHaveBeenCalledTimes(2);
    expect(grid(w).exists()).toBe(true);
  });

  it("counts down a 503 cooldown and reads again after exactly Retry-After", async () => {
    vi.useFakeTimers();
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    vi.mocked(service.getData)
      .mockRejectedValueOnce({
        response: {
          status: 503,
          headers: { "retry-after": "120" },
          data: { state: "cooldown", last_error_at: 1, next_retry_at: 2 },
        },
      })
      .mockResolvedValue({ status: 200, data: okBody("a") } as never);
    const w = mountWithActions();
    await flushPromises();
    expect(find(w, "dashboards-public-dashboard-cooldown").text()).toBe(
      "Can't load this dashboard right now. Trying again in 2:00.",
    );
    await vi.advanceTimersByTimeAsync(119_000);
    expect(find(w, "dashboards-public-dashboard-cooldown").text()).toContain(
      "Trying again in 0:01",
    );
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getData).toHaveBeenCalledTimes(2);
    expect(grid(w).exists()).toBe(true);
  });

  it("offers every range at once, without waiting for a build", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({ status: 200, data: okBody("a") });
    const w = mountWithPicker();
    await flushPromises();
    expect(find(w, "dashboards-public-dashboard-preset-r3600").exists()).toBe(true);
    expect(find(w, "dashboards-public-dashboard-preset-r86400").exists()).toBe(true);
  });

  it("keeps the page out of search indexes and Referer headers while open", () => {
    vi.mocked(service.getConfig).mockReturnValue(new Promise(() => {}));
    const count = (name: string, content: string) =>
      document.head.querySelectorAll(`meta[name="${name}"][content="${content}"]`).length;
    const before = count("robots", "noindex, nofollow");
    const w = buildWrapper();
    expect(count("robots", "noindex, nofollow")).toBe(before + 1);
    expect(count("referrer", "no-referrer")).toBeGreaterThan(0);
    w.unmount();
    expect(count("robots", "noindex, nofollow")).toBe(before);
  });

  it("shows not-found on a 404", async () => {
    (service.getConfig as any).mockRejectedValue({ response: { status: 404 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("doesn't exist or was turned off");
  });

  it("shows the expired message on a 410", async () => {
    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 410 } });
    const w = buildWrapper();
    await flushPromises();
    expect(has(w, "dashboards-public-dashboard-error")).toBe(true);
    expect(w.text()).toContain("Ask the person who shared it to extend it.");
  });

  it("shows a paused link as turned off, and brings it back once it is resumed", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockRejectedValueOnce({ response: { status: 503 } });
    const w = buildWrapper();
    await flushPromises();
    expect(w.text()).toContain("turned off right now");

    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({ status: 200, data: okBody("a") } as never);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
    expect(grid(w).exists()).toBe(true);
  });

  it("asks the viewer to try again later after a rate limit or network error", async () => {
    vi.mocked(service.getConfig).mockRejectedValueOnce({ response: { status: 429 } });
    const limited = buildWrapper();
    await flushPromises();
    expect(limited.text()).toContain("Too many requests. Please try again in a while.");

    vi.mocked(service.getConfig).mockRejectedValueOnce(new Error("Network Error"));
    const offline = buildWrapper();
    await flushPromises();
    expect(offline.text()).toContain("Can't reach the server. Please try again in a while.");
  });

  it("waits exactly Retry-After after a 429, even when the page becomes visible again", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData)
      .mockRejectedValueOnce({ response: { status: 429, headers: { "retry-after": "60" } } })
      .mockResolvedValue({ status: 200, data: okBody("a") } as never);
    const w = buildWrapper();
    await flushPromises();
    expect(w.text()).toContain("Too many requests");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getData).toHaveBeenCalledTimes(2);
    expect(grid(w).exists()).toBe(true);
  });

  it("keeps the dashboard on screen through a network error and retries with backoff", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({ status: 200, data: okBody("a") } as never);
    const w = buildWrapper();
    await flushPromises();
    vi.mocked(service.getData).mockRejectedValue(new Error("Network Error"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getData).toHaveBeenCalledTimes(2);
    expect(grid(w).exists()).toBe(true);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(service.getData).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getData).toHaveBeenCalledTimes(3);
  });

  it("counts down to fresh_until on the server's clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    // The server's clock runs an hour ahead; fresh_until is 10s away on it.
    (service.getData as any).mockResolvedValue({
      status: 200,
      headers: { date: new Date(1_800_003_620_000).toUTCString() },
      data: { ...okBody("a"), fresh_until: 1_800_003_630_000_000 },
    });
    const w = mountWithActions();
    await flushPromises();
    expect(find(w, "dashboards-public-dashboard-next-refresh").text()).toBe("Next refresh in 0:10");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(find(w, "dashboards-public-dashboard-next-refresh").text()).toBe("Next refresh in 0:07");
  });

  it("shows an absolute range's fixed window without a countdown, checking it each minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    mockAbsoluteLink();
    const w = mountWithActions();
    await flushPromises();
    expect(service.getData).toHaveBeenCalledWith("abc", ABSOLUTE.key, undefined);
    expect(grid(w).props("currentTimeObj").__global.start_time.getTime()).toBe(1000);
    expect(grid(w).props("currentTimeObj").__global.end_time.getTime()).toBe(86_401_000);
    expect(has(w, "dashboards-public-dashboard-next-refresh")).toBe(false);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getData).toHaveBeenCalledTimes(2);
    expect(service.getData).toHaveBeenLastCalledWith("abc", ABSOLUTE.key, "abs");
    expect(service.getConfig).toHaveBeenCalledTimes(1);
  });

  it("shows a pause to a viewer on an absolute range within a minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    mockAbsoluteLink();
    const w = buildWrapper();
    await flushPromises();
    expect(grid(w).exists()).toBe(true);

    vi.mocked(service.getData).mockRejectedValue({ response: { status: 503 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.text()).toContain("turned off right now");
  });

  it("shows a revoke to a viewer on a day-long interval within a minute, then stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { ...okBody("a"), refresh_secs: 86_400, fresh_until: 1_800_086_400_000_000 },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    expect(grid(w).exists()).toBe(true);

    vi.mocked(service.getData).mockRejectedValue({ response: { status: 503 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.text()).toContain("turned off right now");

    vi.mocked(service.getData).mockRejectedValue({ response: { status: 404 } });
    vi.mocked(service.getConfig).mockRejectedValue({ response: { status: 404 } });
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(w.text()).toContain("doesn't exist or was turned off");
    const calls = vi.mocked(service.getData).mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(service.getData).toHaveBeenCalledTimes(calls);
    expect(service.getConfig).toHaveBeenCalledTimes(2);
  });

  it("does not re-read nonstop on a 30-day interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { ...okBody("a"), refresh_secs: 2_592_000, fresh_until: 1_802_592_000_000_000 },
    } as never);
    buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(241_000);
    expect(service.getData).toHaveBeenCalledTimes(6);
    expect(service.getConfig).toHaveBeenCalledTimes(1);
  });

  it("pauses while hidden and checks at once when the page is visible again", async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({ status: 200, data: okBody("a") } as never);
    const w = buildWrapper();
    await flushPromises();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(service.getData).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(service.getData).toHaveBeenCalledTimes(2);
    w.unmount();
    hidden.mockRestore();
  });

  it("keeps the body on a 304 and refetches the layout when the body is built from a newer link", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData)
      .mockResolvedValueOnce(okSnapshot([[{ y: 1 }]]) as never)
      .mockResolvedValueOnce({ status: 304, data: "" } as never)
      .mockResolvedValueOnce({
        status: 200,
        data: { ...okBody("c"), link_rev: 2, panels: { p1: { state: { state: "ok" }, data: [] } } },
      } as never);
    const w = buildWrapper();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r3600", "a");
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
    expect(service.getConfig).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getConfig).toHaveBeenCalledTimes(2);
  });

  it("refetches the layout once for a body that is stale because the dashboard changed", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { ...okBody("d"), stale: true, stale_reason: "dashboard" },
    } as never);
    buildWrapper();
    await flushPromises();
    expect(service.getConfig).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getConfig).toHaveBeenCalledTimes(2);
  });

  it("offers the time range picker only when viewers can switch", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    });
    const editable = mountWithActions();
    await flushPromises();
    expect(editable.findComponent(ODropdown).exists()).toBe(true);

    (service.getConfig as any).mockResolvedValue({
      data: { ...CONFIG, ranges: [{ key: "r3600", type: "relative", secs: 3600 }] },
      status: 200,
    });
    const fixed = mountWithActions();
    await flushPromises();
    expect(fixed.findComponent(ODropdown).exists()).toBe(false);
  });

  it("passes frozen values to the grid as read-only constants in their own scope", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: {
        ...CONFIG,
        variables: [
          { label: "env", value: "prod" },
          { label: "svc", value: "api", tab_id: "t1" },
          { label: "pod", value: ["a", "b"], panel_id: "p1" },
          { label: "region", value: null },
        ],
      },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "ok" }, data: [] } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const list = grid(w).props("dashboardData").variables.list;
    expect(list.map((v: { type: string }) => v.type)).toEqual([
      "constant",
      "constant",
      "constant",
      "constant",
    ]);
    expect(new Set(list.map((v: { name: string }) => v.name)).size).toBe(4);
    expect(list.map(({ name: _n, type: _t, ...rest }: Record<string, unknown>) => rest)).toEqual([
      { label: "env", value: "prod", scope: "global" },
      { label: "svc", value: "api", scope: "tabs", tabs: ["t1"] },
      { label: "pod", value: "a, b", scope: "panels", panels: ["p1"] },
      { label: "region", value: "Not set", scope: "global" },
    ]);
  });

  it("shows the values the snapshot was built with over the link's frozen ones", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, variables: [{ label: "env", value: null }] },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: {
        panels: { p1: { state: { state: "ok" }, data: [] } },
        variables: [{ label: "env", value: "default-env" }],
      },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const list = grid(w).props("dashboardData").variables.list;
    expect(list.map((v: { value: string }) => v.value)).toEqual(["default-env"]);
  });

  it("falls back to the default range when the author removes the viewer's range", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([]) as never);
    const w = mountWithPicker();
    await flushPromises();

    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, ranges: [CONFIG.ranges[0]], link_rev: 2 },
      status: 200,
    } as never);
    vi.mocked(service.getData)
      .mockResolvedValueOnce({ status: 200, data: { ...okBody("e"), link_rev: 2 } } as never)
      .mockResolvedValue(okSnapshot([[{ y: 1 }]]) as never);
    pickRange(w, "r86400");
    await flushPromises();
    expect(service.getData).toHaveBeenCalledWith("abc", "r86400", undefined);
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r3600", undefined);
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
  });

  it("moves to the default range when the one on screen was removed and now answers 404", async () => {
    vi.useFakeTimers();
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([]) as never);
    const w = mountWithPicker();
    await flushPromises();
    pickRange(w, "r86400");
    await flushPromises();

    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, ranges: [CONFIG.ranges[0]], link_rev: 2 },
      status: 200,
    } as never);
    vi.mocked(service.getData)
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValue(okSnapshot([[{ y: 1 }]]) as never);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getData).toHaveBeenLastCalledWith("abc", "r3600", undefined);
    expect(has(w, "dashboards-public-dashboard-error")).toBe(false);
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
  });

  it("drops a slower reply for a range the viewer already switched away from", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValueOnce(okSnapshot([]) as never);
    const w = mountWithPicker();
    await flushPromises();

    let resolveSlow: (v: unknown) => void = () => {};
    let resolveFast: (v: unknown) => void = () => {};
    vi.mocked(service.getData)
      .mockReturnValueOnce(new Promise((r) => (resolveSlow = r)) as never)
      .mockReturnValueOnce(new Promise((r) => (resolveFast = r)) as never);
    pickRange(w, "r86400");
    pickRange(w, "r3600");
    resolveFast(okSnapshot([[{ y: 1 }]]));
    await flushPromises();
    resolveSlow(okSnapshot([[{ y: 24 }]]));
    await flushPromises();
    expect(grid(w).props("injectedPanelData").p1.data).toEqual([[{ y: 1 }]]);
  });

  it("keeps the link's timestamp column after the bootstrap config lands", async () => {
    const original = store.state.zoConfig;
    vi.mocked(service.getConfig).mockResolvedValue({
      data: { ...CONFIG, timestamp_column: "event_time" },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([]) as never);
    const w = buildWrapper();
    await flushPromises();
    expect(store.state.zoConfig.timestamp_column).toBe("event_time");

    await store.dispatch("setConfig", { version: "v1" });
    await flushPromises();
    expect(store.state.zoConfig.timestamp_column).toBe("event_time");
    expect(store.state.zoConfig.version).toBe("v1");
    w.unmount();
    await store.dispatch("setConfig", original);
  });

  it("injects a Not-available error for a withheld panel", async () => {
    (service.getConfig as any).mockResolvedValue({ data: CONFIG, status: 200 });
    (service.getData as any).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "not_available", reason: "unauthorized" } } } },
    });
    const w = buildWrapper();
    await flushPromises();
    const p1 = grid(w).props("injectedPanelData").p1;
    expect(p1.data).toEqual([]);
    expect(p1.errorDetail.message).toBe("This panel isn't available on the public view.");
    // The renderer replaces the message of a non-4xx error with "Error Loading Data".
    expect(p1.errorDetail.code).toMatch(/^4/);
  });

  it("renders markdown and HTML panels from the layout without an error", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([
        { id: "md", type: "markdown", markdownContent: "# Hi" },
        { id: "html", type: "html", htmlContent: "<b>Hi</b>" },
      ]),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { md: { state: { state: "not_available", reason: "no_query" } } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    for (const id of ["md", "html"]) {
      expect(injected[id]).toEqual({ data: [], metadata: { queries: [] }, resultMetaData: [] });
    }
  });

  it("shows a custom chart as not available on the public view", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([{ id: "cc", type: "custom_chart" }]),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: {} },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const cc = grid(w).props("injectedPanelData").cc;
    expect(cc.errorDetail.message).toBe("This panel isn't available on the public view.");
    expect(cc.errorDetail.code).toMatch(/^4/);
  });

  it("shows a panel added since the last build as coming with the next update", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([
        { id: "p1", type: "line" },
        { id: "new", type: "line" },
      ]),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue(okSnapshot([[{ y: 1 }]]) as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    expect(injected.p1.data).toEqual([[{ y: 1 }]]);
    expect(injected.p1.errorDetail).toBeUndefined();
    expect(injected.new.errorDetail.message).toBe("This panel will appear after the next update.");
    expect(injected.new.errorDetail.code).toMatch(/^4/);
  });

  it("renders a panel only when its result was built from the layout's intent", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: {
        ...panelsConfig([
          { id: "same", type: "line" },
          { id: "changed", type: "line" },
          { id: "masked", type: "line" },
        ]),
        intents: { same: "i1", changed: "i2-new", masked: "i3" },
      },
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: {
        ...okBody("a"),
        panels: {
          same: { state: { state: "ok" }, intent: "i1", data: [[{ y: 1 }]] },
          changed: { state: { state: "ok" }, intent: "i2-old", data: [[{ y: 2 }]] },
          masked: { state: { state: "not_available", reason: "changed" } },
        },
      },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    expect(injected.same.data).toEqual([[{ y: 1 }]]);
    for (const id of ["changed", "masked"]) {
      expect(injected[id].data).toEqual([]);
      expect(injected[id].errorDetail.message).toBe(
        "This panel will appear after the next update.",
      );
    }
  });

  it("shows retained, partial, truncated and too-large panels as such", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig([
        { id: "kept", type: "line" },
        { id: "part", type: "line" },
        { id: "cut", type: "table" },
        { id: "big", type: "table" },
      ]),
      status: 200,
    } as never);
    const rows = Array.from({ length: 1000 }, (_, i) => ({ i }));
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: {
        ...okBody("a"),
        panels: {
          kept: {
            state: { state: "ok", retained: true, error_since: 1_800_000_000_000_000 },
            built_at: Date.UTC(2027, 0, 15, 12, 4) * 1000,
            data: [[{ y: 1 }]],
          },
          part: { state: { state: "ok", partial: true }, data: [[{ y: 2 }]] },
          cut: { state: { state: "ok", truncated: true }, data: [rows] },
          big: { state: { state: "not_available", reason: "too_large" } },
        },
      },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    expect(injected.kept).toMatchObject({ dimmed: true, data: [[{ y: 1 }]] });
    expect(injected.kept.notice).toMatch(/^from \d{2}:04/);
    expect(injected.part).toMatchObject({ serverPartial: true, dimmed: false });
    expect(injected.cut.notice).toBe("Showing the first 1,000 rows");
    expect(injected.big.errorDetail.message).toBe("This panel isn't available on the public view.");
  });

  it("says when a refresh failed and when it is tried next, keeping the data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: {
        ...okBody("a"),
        stale: true,
        stale_reason: "retry",
        last_error_at: 1_800_000_000_000_000,
        next_retry_at: 1_800_000_080_000_000,
      },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const banner = w.findComponent<typeof OBanner>({ name: "OBanner" });
    expect(banner.props("variant")).toBe("warning");
    expect(banner.props("content")).toMatch(
      /^Some panels could not be refreshed at .+\. They show older data\. Next try in 1:00\.$/,
    );
    expect(grid(w).exists()).toBe(true);
  });

  it("reads the footer interval from the data body", async () => {
    vi.mocked(service.getConfig).mockResolvedValue({ data: CONFIG, status: 200 } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { ...okBody("a"), refresh_secs: 9000 },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    expect((w.vm as unknown as { footerNote: string }).footerNote).toBe(
      "Read-only view, refreshed every 150 minutes. Anyone with the link can see this dashboard.",
    );
  });

  it("gets its messages and markdown content past the real panel renderer", async () => {
    const panels = [
      { id: "p1", type: "line", queryType: "sql", queries: [], config: {} },
      { id: "new", type: "line", queryType: "sql", queries: [], config: {} },
      { id: "cc", type: "custom_chart", queryType: "sql", queries: [], config: {} },
      {
        id: "md",
        type: "markdown",
        queryType: "sql",
        queries: [],
        config: {},
        markdownContent: "# Hi",
      },
    ];
    vi.mocked(service.getConfig).mockResolvedValue({
      data: panelsConfig(panels),
      status: 200,
    } as never);
    vi.mocked(service.getData).mockResolvedValue({
      status: 200,
      data: { panels: { p1: { state: { state: "not_available", reason: "unauthorized" } } } },
    } as never);
    const w = buildWrapper();
    await flushPromises();
    const injected = grid(w).props("injectedPanelData");
    const render = async (panelSchema: (typeof panels)[number]) => {
      const r = mount(PanelSchemaRenderer, {
        props: {
          selectedTimeObj: { start_time: new Date(0), end_time: new Date(1000) },
          panelSchema,
          variablesData: { values: [] },
          injectedPromqlData: injected[panelSchema.id],
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          stubs: {
            ChartRenderer: true,
            MarkdownRenderer: {
              props: ["markdownContent"],
              template: "<div data-test='md'>{{ markdownContent }}</div>",
            },
          },
        },
      });
      await flushPromises();
      return r;
    };
    const error = (r: VueWrapper) => r.find('[data-test="panel-schema-renderer-error-message"]');
    const notAvailable = "This panel isn't available on the public view.";
    expect(error(await render(panels[0])).text()).toBe(notAvailable);
    expect(error(await render(panels[1])).text()).toBe(
      "This panel will appear after the next update.",
    );
    expect(error(await render(panels[2])).text()).toBe(notAvailable);
    const md = await render(panels[3]);
    expect(error(md).exists()).toBe(false);
    expect(md.find('[data-test="md"]').text()).toBe("# Hi");
  });
});
