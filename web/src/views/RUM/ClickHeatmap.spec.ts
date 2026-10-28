import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";

const h = vi.hoisted(() => ({
  run: vi.fn(),
  hold: vi.fn(),
  abortAll: vi.fn(),
  getStream: vi.fn(),
  real: false,
}));

vi.mock("@/composables/rum/useAnalyticsSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/rum/useAnalyticsSearch")>();
  return {
    default: () => (h.real ? actual.default() : { run: h.run, hold: h.hold, abortAll: h.abortAll }),
  };
});
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: h.getStream }) }));
vi.mock("@/services/rumProductAnalytics", () => ({
  default: { getAppSettings: vi.fn().mockResolvedValue({ data: undefined }) },
}));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/utils/rum/clickHeatmapQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/rum/clickHeatmapQueries")>();
  const stub =
    <A extends unknown[]>(real: (...a: A) => string, text: string) =>
    (...a: A) =>
      h.real ? real(...a) : text;
  return {
    ...actual,
    rankingSql: stub(actual.rankingSql, "SELECT ranking"),
    totalsSql: stub(actual.totalsSql, "SELECT totals"),
    deviceSplitSql: stub(actual.deviceSplitSql, "SELECT devices"),
    pageListSql: stub(actual.pageListSql, "SELECT pages"),
  };
});
vi.mock("@/utils/rum/productAnalyticsQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/rum/productAnalyticsQueries")>();
  return {
    ...actual,
    appProbeSql: (...a: Parameters<typeof actual.appProbeSql>) =>
      h.real ? actual.appProbeSql(...a) : "SELECT apps",
  };
});

import ClickHeatmap from "./ClickHeatmap.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import rumProductAnalytics from "@/services/rumProductAnalytics";
import searchService from "@/services/search";
import { PAGE_LIST_LIMIT, RANKING_LIMIT } from "@/utils/rum/clickHeatmapQueries";

const store = createStore({
  state: {
    zoConfig: { timestamp_column: "_timestamp" },
    selectedOrganization: { identifier: "default" },
  },
});

const ok = (rows: unknown[]) => ({ status: "ok", rows });

const answer = (overrides: Record<string, () => unknown> = {}) =>
  h.run.mockImplementation(async (id: string) => {
    if (overrides[id]) return overrides[id]();
    const byId: Record<string, unknown[]> = {
      apps: [{ app: "web" }],
      pages: [{ view_url: "https://x.test/home" }],
      devices: [{ cls: "desktop", clicks: 4 }],
      totals: [{ clicks: 4, sessions: 2, frustrated: 0 }],
      ranking: [{ selector: "#buy", clicks: 4, sessions: 2 }],
    };
    return ok(byId[id] ?? []);
  });

const ids = () => h.run.mock.calls.map((c) => c[0] as string);

const mountPage = async (stubs: Record<string, boolean> = {}) => {
  const wrapper = mount(ClickHeatmap, { global: { plugins: [store], stubs } });
  await flushPromises();
  return wrapper;
};

describe("ClickHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.real = false;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    h.getStream.mockImplementation(async (name: string) => ({
      schema: name === "_sessionreplay" ? [{ name: "has_full_snapshot" }] : [],
    }));
  });

  it("shows the load error banner and not the empty state when the app list fails", async () => {
    answer({ apps: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').text()).toContain(
      "Couldn't load the click data.",
    );
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-empty"]').exists()).toBe(false);
  });

  it("shows the empty state when there are no pages", async () => {
    answer({ apps: () => ok([]) });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-empty"]').text()).toContain(
      "No clicks recorded in this period",
    );
    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(false);
  });

  it("aborts in-flight searches on unmount", async () => {
    answer();
    const wrapper = await mountPage();
    h.abortAll.mockClear();

    wrapper.unmount();

    expect(h.abortAll).toHaveBeenCalledTimes(1);
  });

  it("re-runs only totals and ranking and rebuilds the snapshot on device change", async () => {
    answer();
    const wrapper = await mountPage();
    expect(ids()).toEqual(
      expect.arrayContaining(["apps", "pages", "devices", "totals", "ranking", "replay-views"]),
    );
    h.run.mockClear();

    const device = wrapper.findComponent(OToggleGroup);
    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();

    expect(ids().sort()).toEqual(["ranking", "replay-views", "totals"]);
  });

  it("shows only the error banner with a retry when the clicks fail to load", async () => {
    answer({ totals: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').text()).toContain(
      "Couldn't load the click data.",
    );
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-no-position"]').exists()).toBe(false);
  });

  it("supersedes the earlier panel request when the device changes again", async () => {
    answer();
    const wrapper = await mountPage();
    let release: (v: unknown) => void = () => {};
    answer({
      totals: () => new Promise((r) => (release = r)),
    });
    h.run.mockClear();
    const device = wrapper.findComponent(OToggleGroup);

    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();
    const firstRelease = release;
    answer();
    device?.vm.$emit("update:modelValue", "tablet");
    await flushPromises();
    firstRelease(ok([{ clicks: 99, sessions: 9, frustrated: 0 }]));
    await flushPromises();

    expect(ids().filter((id) => id === "totals")).toHaveLength(2);
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("4");
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).not.toContain("99");
  });

  it("shows the settings notice and still loads when the app settings fail", async () => {
    answer();
    vi.mocked(rumProductAnalytics.getAppSettings).mockRejectedValueOnce(new Error("nope"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-settings-failed"]').text()).toContain(
      "counts may include bot sessions",
    );
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("4");
  });

  it("clears the ranking note when the next page load fails", async () => {
    const full = Array.from({ length: RANKING_LIMIT }, (_, i) => ({
      selector: `#b${i}`,
      clicks: 1,
      sessions: 1,
    }));
    answer({ ranking: () => ok(full) });
    const wrapper = await mountPage({ OTable: true });
    expect(wrapper.find('[data-test="rum-heatmap-limited"]').text()).toBe(
      `Top ${RANKING_LIMIT} elements by clicks`,
    );

    answer({ totals: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const device = wrapper.findComponent(OToggleGroup);
    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();

    expect(wrapper.find('[data-test="rum-heatmap-limited"]').exists()).toBe(false);
  });

  it("keeps the page-list note across a page reload", async () => {
    const pages = Array.from({ length: PAGE_LIST_LIMIT }, (_, i) => ({
      view_url: `https://x.test/p${i}`,
    }));
    answer({ pages: () => ok(pages) });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-limited"]').text()).toBe(
      `Top ${PAGE_LIST_LIMIT} pages by clicks`,
    );
  });

  it("explains a missing replay inside the left pane", async () => {
    answer();
    const wrapper = await mountPage();

    const notice = wrapper.find('[data-test="rum-heatmap-snapshot-error"]');
    expect(notice.text()).toContain("No session replay was recorded");
    expect(wrapper.findAll('[data-test="rum-heatmap-snapshot-error"]')).toHaveLength(1);
  });

  it("retries only the clicks and keeps the page after a clicks failure", async () => {
    answer({ totals: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();
    answer();
    h.run.mockClear();

    await wrapper.find('[data-test="rum-heatmap-retry-btn"]').trigger("click");
    await flushPromises();

    expect(ids()).not.toContain("apps");
    expect(ids()).not.toContain("pages");
    expect(ids()).toContain("totals");
    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rum-heatmap-page-current"]').text()).toBe(
      "https://x.test/home",
    );
  });

  it("shows device counts including zero once the split returns", async () => {
    answer();
    const wrapper = await mountPage();
    const labels = wrapper
      .findAll('[data-test^="rum-heatmap-device-"]')
      .map((el) => el.text())
      .filter(Boolean);

    expect(labels).toContain("Tablet (0)");
    expect(labels).toContain("Desktop (4)");
  });

  it("stops a superseded snapshot chain before it queries the segments", async () => {
    let release: (v: unknown) => void = () => {};
    answer({
      "replay-views": () => ok([{ view_id: "v1" }]),
      "replay-flags": () => new Promise((r) => (release = r)),
    });
    const wrapper = await mountPage();
    const firstRelease = release;
    answer();
    const device = wrapper.findComponent(OToggleGroup);
    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();
    h.run.mockClear();

    firstRelease(ok([{ view_id: "v1", has_full_snapshot: true }]));
    await flushPromises();

    expect(ids()).not.toContain("replay-segments");
  });

  it("keeps totals and ranking and shows a notice when only the device split fails", async () => {
    answer({ devices: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-device-split-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("4");
  });

  it("shows the load error when the ranking fails even if totals succeed", async () => {
    answer({ ranking: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-device-split-failed"]').exists()).toBe(false);
  });

  it("looks up replay snapshots with one grouped row per view", async () => {
    answer({ "replay-views": () => ok([{ view_id: "v1" }]) });
    await mountPage();

    const flags = h.run.mock.calls.find((c) => c[0] === "replay-flags");
    expect(flags?.[1].sql).toContain("GROUP BY view_id");
    expect(flags?.[1].sql).toContain("bool_or(has_full_snapshot)");
  });

  it("skips the snapshot flag query when _sessionreplay has no has_full_snapshot column", async () => {
    h.getStream.mockResolvedValue({ schema: [] });
    answer({ "replay-views": () => ok([{ view_id: "v1" }, { view_id: "v2" }]) });
    await mountPage();

    expect(ids()).not.toContain("replay-flags");
    const segments = h.run.mock.calls.find((c) => c[0] === "replay-segments");
    expect(segments?.[1].sql).toContain("v1");
  });

  it("runs the snapshot lookups through the real search helper without a stream rejection", async () => {
    h.real = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hits = (sql: string) => {
      if (sql.includes('FROM "_sessionreplay" WHERE view_id IN'))
        return [{ view_id: "v1", has_full_snapshot: true }];
      if (sql.includes('FROM "_sessionreplay"')) return [];
      if (sql.includes("view_id, max(")) return [{ view_id: "v1" }];
      if (sql.includes("AS sessions FROM") && sql.includes("GROUP BY application_id"))
        return [{ app: "web" }];
      if (sql.includes("view_url")) return [{ view_url: "https://x.test/home" }];
      return [];
    };
    vi.mocked(searchService.search).mockImplementation((async (req: any) => ({
      data: { hits: hits(String(req.query.query.sql)) },
    })) as never);
    const wrapper = await mountPage();

    const sqls = vi
      .mocked(searchService.search)
      .mock.calls.map((c) => String((c[0].query as any).query.sql));
    expect(sqls.some((q) => q.includes('FROM "_sessionreplay" WHERE view_id IN'))).toBe(true);
    expect(sqls.some((q) => q.includes('FROM "_sessionreplay" WHERE view_id = '))).toBe(true);
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("replay"),
      expect.anything(),
    );
    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(false);
  });

  it("drops the not-clicked tile from the stats and shows the top element with its share", async () => {
    answer({
      totals: () => ok([{ clicks: 10, sessions: 5, frustrated: 0 }]),
      ranking: () => ok([{ selector: "#buy", name: "Buy now", clicks: 4, sessions: 2 }]),
    });
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-stat-unused"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("10");
    expect(wrapper.find('[data-test="rum-heatmap-stat-sessions"]').text()).toContain("5");
    expect(wrapper.find('[data-test="rum-heatmap-stat-frustrated"]').text()).toContain("0");
    expect(wrapper.find('[data-test="rum-heatmap-stat-top"]').text()).toBe(
      "Top elementBuy now · 40% of clicks",
    );
  });

  it("filters the element list by text and by the frustrated chip, with a count", async () => {
    answer({
      totals: () => ok([{ clicks: 10, sessions: 5, frustrated: 3 }]),
      ranking: () =>
        ok([
          {
            selector: "#buy",
            name: "Buy now",
            clicks: 6,
            sessions: 3,
            rage: 2,
            dead: 1,
            frustrated: 3,
          },
          { selector: "#help", name: "Help", clicks: 4, sessions: 2 },
        ]),
    });
    const wrapper = await mountPage({ OTable: true });
    const count = () => wrapper.find('[data-test="rum-heatmap-element-count"]').text();
    expect(count()).toBe("2 elements");

    await wrapper.find('[data-test="rum-heatmap-chip-frustrated"]').trigger("click");
    expect(count()).toBe("1 element");

    await wrapper.find('[data-test="rum-heatmap-chip-frustrated"]').trigger("click");
    await wrapper.find('[data-test="rum-heatmap-element-search"] input').setValue("hel");
    expect(count()).toBe("1 element");
  });

  it("disables the never-clicked chip until the snapshot is mostly placed", async () => {
    answer();
    const wrapper = await mountPage({ OTable: true });
    const chip = wrapper.find('[data-test="rum-heatmap-chip-unused"]');

    expect(chip.attributes("title")).toContain("90%");
    expect(chip.attributes("aria-pressed")).toBe("false");
  });

  it("lists pages by clicks and sessions in the picker", async () => {
    answer({
      pages: () =>
        ok([
          { view_url: "https://x.test/home", clicks: 1240, sessions: 310 },
          { view_url: "https://x.test/pricing", clicks: 812, sessions: 201 },
        ]),
    });
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-page-count"]').text()).toBe("2 pages");
    await wrapper.find('[data-test="rum-heatmap-page-select"]').trigger("click");
    await flushPromises();
    const list = document.body.querySelector('[data-test="rum-heatmap-page-list"]');
    expect(list?.textContent).toContain("1,240");
    expect(list?.textContent).toContain("201");
    wrapper.unmount();
  });
});
