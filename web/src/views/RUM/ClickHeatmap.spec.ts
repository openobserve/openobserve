import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";

const h = vi.hoisted(() => ({
  run: vi.fn(),
  hold: vi.fn(),
  abortAll: vi.fn(),
  getStream: vi.fn(),
  real: false,
  events: [] as unknown[],
  dom: "",
}));

vi.mock("@/utils/rum/sessionReplayViews", () => ({
  createMultiViewDecoder: () => ({ push: () => ({ events: h.events }) }),
}));
vi.mock("@openobserve/rrweb-player/dist/style.css", () => ({}));
vi.mock("@openobserve/rrweb-player", () => ({
  default: class {
    iframe: HTMLIFrameElement;
    wrapper: HTMLElement;
    constructor(opts: { target: HTMLElement }) {
      this.iframe = document.createElement("iframe");
      opts.target.appendChild(this.iframe);
      this.iframe.contentDocument!.body.innerHTML = h.dom;
      const win = this.iframe.contentWindow as unknown as { Element: typeof Element };
      win.Element.prototype.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 50, height: 20 }) as DOMRect;
      this.wrapper = document.createElement("div");
      opts.target.appendChild(this.wrapper);
    }
    getReplayer() {
      return { iframe: this.iframe, wrapper: this.wrapper };
    }
    goto() {}
  },
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
    pageListSql: (...a: Parameters<typeof actual.pageListSql>) =>
      h.real || a[1] ? actual.pageListSql(...a) : "SELECT pages",
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
import OTable from "@/lib/core/Table/OTable.vue";
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

  const rankedRows = (rows: unknown[], clicks: number) => ({
    totals: () => ok([{ clicks, sessions: 5, frustrated: 3 }]),
    ranking: () => ok(rows),
  });
  const buy = { selector: "#buy", name: "Buy now", clicks: 9, sessions: 3, rage: 2, frustrated: 2 };
  const gone = { selector: "#gone", name: "Gone", clicks: 1, sessions: 1 };

  const snapshotAnswer = (rows = [buy, gone]) => {
    h.events = [
      { type: 4, timestamp: 1, data: { width: 100, height: 100 } },
      { type: 2, timestamp: 2, data: { node: {} } },
    ];
    h.dom = '<button id="buy">Buy now</button><button id="other">Other</button>';
    answer({
      ...rankedRows(rows, 10),
      "replay-views": () => ok([{ view_id: "v1" }]),
      "replay-flags": () => ok([{ view_id: "v1", has_full_snapshot: true }]),
      "replay-segments": () => ok([{ start: 1, segment: "{}" }]),
      "replay-click": () => ok([{ d: 5 }]),
    });
  };
  const mountSnapshot = async () => {
    const wrapper = mount(ClickHeatmap, {
      global: { plugins: [store], stubs: { OTable: true } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 700));
    await flushPromises();
  };
  const count = (w: { find: (s: string) => { text: () => string } }) =>
    w.find('[data-test="rum-heatmap-element-count"]').text();

  describe("with a page snapshot", () => {
    beforeEach(() => {
      h.events = [];
      h.dom = "";
    });

    it("flags no row as Not on snapshot and shows no drawn text while the snapshot mounts", async () => {
      snapshotAnswer();
      const wrapper = await mountSnapshot();

      expect(wrapper.find('[data-test="rum-heatmap-legend"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-placed"]').exists()).toBe(false);
      const rows = wrapper.findComponent(OTable).props("data") as { missing?: boolean }[];
      expect(rows.some((r) => r.missing)).toBe(false);
      await settle();
      wrapper.unmount();
    });

    it("reports drawn elements and filters to Not on snapshot rows once placed", async () => {
      snapshotAnswer();
      const wrapper = await mountSnapshot();
      await settle();

      expect(wrapper.find('[data-test="rum-heatmap-placed"]').text()).toBe("1 of 2 drawn");
      expect(count(wrapper)).toBe("2 elements");
      await wrapper.find('[data-test="rum-heatmap-chip-missing"]').trigger("click");
      const rows = wrapper.findComponent(OTable).props("data") as { selector: string }[];
      expect(rows.map((r) => r.selector)).toEqual(["#gone"]);
      wrapper.unmount();
    });

    it("disables the never-clicked chip with a visible reason while the row chips are on", async () => {
      snapshotAnswer();
      const wrapper = await mountSnapshot();
      await settle();
      const chip = () => wrapper.find('[data-test="rum-heatmap-chip-unused"]');
      expect(chip().attributes("aria-disabled") ?? chip().attributes("disabled")).toBeUndefined();
      expect(wrapper.find('[data-test="rum-heatmap-unused-reason"]').exists()).toBe(false);

      await wrapper.find('[data-test="rum-heatmap-chip-frustrated"]').trigger("click");

      expect(chip().attributes("aria-pressed")).toBe("false");
      expect(wrapper.find('[data-test="rum-heatmap-unused-reason"]').text()).toContain(
        "Turn off Not on snapshot and Frustrated only",
      );
      wrapper.unmount();
    });

    it("adds never-clicked controls to the list once the chip is enabled", async () => {
      snapshotAnswer();
      const wrapper = await mountSnapshot();
      await settle();

      await wrapper.find('[data-test="rum-heatmap-chip-unused"]').trigger("click");

      const rows = wrapper.findComponent(OTable).props("data") as {
        selector: string;
        firstUnused?: boolean;
      }[];
      expect(rows.map((r) => r.selector)).toEqual(["#buy", "#gone", "unused-0"]);
      expect(rows[2].firstUnused).toBe(true);
      wrapper.unmount();
    });
  });

  it("shows an empty state with Clear filters when nothing matches, and clears them", async () => {
    answer(rankedRows([buy, gone], 10));
    const wrapper = await mountPage({ OTable: true });

    await wrapper.find('[data-test="rum-heatmap-element-search"] input').setValue("zzz");
    expect(wrapper.find('[data-test="rum-heatmap-no-match"]').text()).toContain(
      "No elements match the filters",
    );
    await wrapper.find('[data-test="rum-heatmap-no-match"] button').trigger("click");

    expect(wrapper.find('[data-test="rum-heatmap-no-match"]').exists()).toBe(false);
    expect(count(wrapper)).toBe("2 elements");
  });

  it("resets the element filters when the device or page changes", async () => {
    answer({
      ...rankedRows([buy, gone], 10),
      pages: () =>
        ok([
          { view_url: "https://x.test/home", clicks: 5, sessions: 2 },
          { view_url: "https://x.test/pricing", clicks: 3, sessions: 1 },
        ]),
    });
    const wrapper = await mountPage({ OTable: true });
    const search = () => wrapper.find('[data-test="rum-heatmap-element-search"] input');
    const frustrated = () => wrapper.find('[data-test="rum-heatmap-chip-frustrated"]');

    await search().setValue("buy");
    await frustrated().trigger("click");
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "phone");
    await flushPromises();
    expect((search().element as HTMLInputElement).value).toBe("");
    expect(frustrated().attributes("aria-pressed")).toBe("false");

    await search().setValue("buy");
    await frustrated().trigger("click");
    await wrapper.find('[data-test="rum-heatmap-page-select"]').trigger("click");
    await flushPromises();
    (
      document.body.querySelector(
        '[data-test="rum-heatmap-page-option-https://x.test/pricing"]',
      ) as HTMLElement
    ).click();
    await flushPromises();
    expect((search().element as HTMLInputElement).value).toBe("");
    expect(frustrated().attributes("aria-pressed")).toBe("false");
    wrapper.unmount();
  });

  describe("page picker search", () => {
    const home = { view_url: "https://x.test/home", clicks: 5, sessions: 2 };
    const deep = { view_url: "https://x.test/deep/pricing", clicks: 1, sessions: 1 };
    const opened = async (searched: () => unknown = () => ok([deep])) => {
      answer({ pages: () => ok([home]), "page-search": searched });
      const wrapper = await mountPage({ OTable: true });
      await wrapper.find('[data-test="rum-heatmap-page-select"]').trigger("click");
      await flushPromises();
      return wrapper;
    };
    const type = async (v: string) => {
      const input = document.body.querySelector(
        '[data-test="rum-heatmap-page-search"] input',
      ) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event("input"));
      await flushPromises();
    };
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();
    };
    const option = (u: string) =>
      document.body.querySelector(
        `[data-test="rum-heatmap-page-option-${u}"]`,
      ) as HTMLElement | null;
    const searchCalls = () => h.run.mock.calls.filter((c) => c[0] === "page-search");

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("marks the current page and lists the initial pages with no text", async () => {
      const wrapper = await opened();

      expect(option("https://x.test/home")?.getAttribute("aria-current")).toBe("true");
      expect(searchCalls()).toHaveLength(0);
      wrapper.unmount();
    });

    it("queries the server once after the debounce, with the term, and shows its rows", async () => {
      const wrapper = await opened();

      await type("pric");
      expect(searchCalls()).toHaveLength(0);
      expect(
        document.body.querySelector('[data-test="rum-heatmap-page-searching"]'),
      ).not.toBeNull();
      await settle();

      expect(searchCalls()).toHaveLength(1);
      expect(searchCalls()[0][1].sql).toContain("strpos(lower(view_url), 'pric') > 0");
      expect(option("https://x.test/deep/pricing")).not.toBeNull();
      expect(option("https://x.test/home")).toBeNull();
      expect(document.body.querySelector('[data-test="rum-heatmap-page-searching"]')).toBeNull();
      wrapper.unmount();
    });

    it("sends the typed term to the page list query", async () => {
      const wrapper = await opened();

      await type("Pric");
      await settle();

      expect(searchCalls()[0][1].sql).toContain("strpos(lower(view_url), 'pric') > 0");
      wrapper.unmount();
    });

    it("supersedes a pending search when typing again", async () => {
      const wrapper = await opened();

      await type("pr");
      await vi.advanceTimersByTimeAsync(200);
      await type("pri");
      await settle();

      expect(searchCalls()).toHaveLength(1);
      wrapper.unmount();
    });

    it("drops a stale answer when a newer search started", async () => {
      let first: (v: unknown) => void = () => {};
      let calls = 0;
      const wrapper = await opened(() =>
        ++calls === 1 ? new Promise((r) => (first = r)) : ok([deep]),
      );

      await type("pr");
      await settle();
      await type("pri");
      await settle();
      first(ok([{ view_url: "https://x.test/stale", clicks: 1, sessions: 1 }]));
      await flushPromises();

      expect(option("https://x.test/stale")).toBeNull();
      expect(option("https://x.test/deep/pricing")).not.toBeNull();
      wrapper.unmount();
    });

    it("says no pages match only after the server answered empty", async () => {
      const wrapper = await opened(() => ok([]));
      const none = () => document.body.querySelector('[data-test="rum-heatmap-page-none"]');

      await type("nomatch");
      expect(none()).toBeNull();
      await settle();

      expect(none()?.textContent).toContain("No pages match");
      wrapper.unmount();
    });

    it("loads a page picked from the search and keeps it in the trigger", async () => {
      const wrapper = await opened();
      await type("pric");
      await settle();
      h.run.mockClear();

      option("https://x.test/deep/pricing")!.click();
      await flushPromises();

      expect(ids()).toContain("totals");
      expect(wrapper.find('[data-test="rum-heatmap-page-current"]').text()).toBe(
        "https://x.test/deep/pricing",
      );
      await wrapper.find('[data-test="rum-heatmap-page-select"]').trigger("click");
      await flushPromises();
      const input = document.body.querySelector(
        '[data-test="rum-heatmap-page-search"] input',
      ) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(option("https://x.test/home")).not.toBeNull();
      wrapper.unmount();
    });

    it("cancels a pending search on unmount", async () => {
      const wrapper = await opened();
      await type("pric");
      wrapper.unmount();
      await settle();

      expect(searchCalls()).toHaveLength(0);
      expect(h.hold).toHaveBeenCalledWith("page-search", "idle");
    });
  });

  it("shows 50+ pages in the trigger when the list is capped", async () => {
    const pages = Array.from({ length: PAGE_LIST_LIMIT }, (_, i) => ({
      view_url: `https://x.test/p${i}`,
    }));
    answer({ pages: () => ok(pages) });
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-page-count"]').text()).toBe(
      `${PAGE_LIST_LIMIT}+ pages`,
    );
    wrapper.unmount();
  });

  it("shows the exact page count when the list is not capped", async () => {
    answer();
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-page-count"]').text()).toBe("1 page");
    wrapper.unmount();
  });

  it("notes the top-pages cap inside the page picker", async () => {
    const pages = Array.from({ length: PAGE_LIST_LIMIT }, (_, i) => ({
      view_url: `https://x.test/p${i}`,
    }));
    answer({ pages: () => ok(pages) });
    const wrapper = await mountPage({ OTable: true });
    await wrapper.find('[data-test="rum-heatmap-page-select"]').trigger("click");
    await flushPromises();

    expect(
      document.body.querySelector('[data-test="rum-heatmap-page-limited"]')?.textContent,
    ).toContain(`Top ${PAGE_LIST_LIMIT} pages by clicks`);
    wrapper.unmount();
  });

  it("sorts ascending and back to descending when the Clicks header toggles", async () => {
    answer(rankedRows([buy, gone], 10));
    const wrapper = await mountPage({ OTable: true });
    const table = () => wrapper.findComponent(OTable);
    const order = () => (table().props("data") as { selector: string }[]).map((r) => r.selector);
    expect(order()).toEqual(["#buy", "#gone"]);

    table().vm.$emit("sort-change");
    await flushPromises();
    expect(order()).toEqual(["#gone", "#buy"]);
    expect(table().props("sortOrder")).toBe("asc");

    table().vm.$emit("sort-change");
    await flushPromises();
    expect(order()).toEqual(["#buy", "#gone"]);
  });

  it("labels the device group 'Device type', keeps 'All', and reloads when returning to All", async () => {
    answer();
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-device-select"]').attributes("aria-label")).toBe(
      "Device type",
    );
    expect(wrapper.find('[data-test="rum-heatmap-device-all"]').text()).toBe("All");
    const device = wrapper.findComponent(OToggleGroup);
    device.vm.$emit("update:modelValue", "phone");
    await flushPromises();
    h.run.mockClear();
    device.vm.$emit("update:modelValue", "all");
    await flushPromises();

    expect(ids().sort()).toEqual(["ranking", "replay-views", "totals"]);
  });

  it("separates every footer note with the same separator", async () => {
    const full = Array.from({ length: RANKING_LIMIT }, (_, i) => ({
      selector: `#b${i}`,
      clicks: 1,
      sessions: 1,
    }));
    answer({
      ranking: () => ok(full),
      devices: () => ok([{ cls: "unknown", clicks: 3 }]),
    });
    const wrapper = await mountPage({ OTable: true });
    const footer = wrapper.find('[data-test="rum-heatmap-footer"]');

    expect(footer.find('[data-test="rum-heatmap-limited"]').exists()).toBe(true);
    expect(footer.find('[data-test="rum-heatmap-unknown-device"]').text()).toContain("3 clicks");
    expect(footer.findAll('[aria-hidden="true"]').map((el) => el.text())).toEqual(["·"]);
  });

  it("pluralizes the frustration split", async () => {
    answer(
      rankedRows(
        [
          {
            selector: "#buy",
            name: "Buy",
            clicks: 4,
            sessions: 2,
            rage: 1,
            dead: 2,
            frustrated: 3,
          },
        ],
        4,
      ),
    );
    const rows = {
      props: ["data"],
      template:
        '<div v-for="r in data" :key="r.selector"><slot name="cell-feature" :row="r" /></div>',
    };
    const wrapper = await mountPage({ OTable: rows as unknown as boolean });

    expect(wrapper.find('[data-test="rum-heatmap-frustrated-#buy"]').text()).toBe(
      "· 1 rage click · 2 dead clicks",
    );
  });
});
