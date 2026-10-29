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
  pageWidth: 0,
  pageHeight: 0,
  rectFor: undefined as undefined | ((el: Element) => Record<string, number> | undefined),
  gotos: [] as number[],
  added: [] as unknown[],
  pa: undefined as any,
  makePa: undefined as any,
  range: { startUs: 1_000_000_000_000, endUs: 1_000_000_000_000 + 24 * 3_600_000_000 },
  route: { name: "productAnalyticsHeatmaps", query: {} } as {
    name: string;
    query: Record<string, string>;
  },
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
      if (h.pageWidth) this.iframe.setAttribute("width", String(h.pageWidth));
      if (h.pageHeight) this.iframe.setAttribute("height", String(h.pageHeight));
      win.Element.prototype.getBoundingClientRect = function (this: Element) {
        return (h.rectFor?.(this) ?? { left: 0, top: 0, width: 50, height: 20 }) as DOMRect;
      };
      this.wrapper = document.createElement("div");
      opts.target.appendChild(this.wrapper);
    }
    getReplayer() {
      return {
        iframe: this.iframe,
        wrapper: this.wrapper,
        addEvent: (e: unknown) => h.added.push(e),
      };
    }
    goto(ms: number) {
      h.gotos.push(ms);
    }
  },
}));

vi.mock("@/composables/rum/useAnalyticsSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/rum/useAnalyticsSearch")>();
  return {
    default: () => (h.real ? actual.default() : { run: h.run, hold: h.hold, abortAll: h.abortAll }),
  };
});
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: h.getStream }) }));
vi.mock("@/composables/rum/useProductAnalytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/rum/useProductAnalytics")>();
  const { ref, reactive } = await import("vue");
  h.makePa = () => {
    const state = reactive({ app: "web" });
    const heatmap = reactive({ pageUrl: "", device: "all" });
    const scopeStatus = ref("ok");
    const scopeKey = ref("k1");
    const refreshTick = ref(0);
    const rulesReady = ref(true);
    const scope = ref({ app: "web", env: [], version: [], schema: {} });
    const pa = {
      state,
      heatmap,
      scope,
      scopeStatus,
      scopeKey,
      refreshTick,
      rulesReady,
      resolveRange: () => ({ startUs: h.range.startUs, endUs: h.range.endUs }),
      toQuery: () => ({
        org_identifier: "default",
        app: state.app,
        ...(heatmap.pageUrl ? { page_url: heatmap.pageUrl } : {}),
        ...(heatmap.device !== "all" ? { device: heatmap.device } : {}),
      }),
      syncUrl: vi.fn().mockResolvedValue(undefined),
    };
    return pa;
  };
  h.pa = h.makePa();
  return { ...actual, default: () => h.pa };
});
vi.mock("vue-router", () => ({
  useRoute: () => h.route,
  useRouter: () => ({ replace: vi.fn() }),
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
import ClickHeatmap from "./ClickHeatmap.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
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
    h.pa = h.makePa();
    h.gotos = [];
    h.added = [];
    h.range = { startUs: 1_000_000_000_000, endUs: 1_000_000_000_000 + 24 * 3_600_000_000 };
    h.route = { name: "productAnalyticsHeatmaps", query: {} };
    h.getStream.mockImplementation(async (name: string) => ({
      schema: name === "_sessionreplay" ? [{ name: "has_full_snapshot" }] : [],
    }));
  });

  it("shows the load error banner and not the empty state when the page list fails", async () => {
    answer({ pages: () => ({ status: "error", error: { message: "boom" } }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').text()).toContain(
      "Couldn't load the click data.",
    );
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="rum-heatmap-empty"]').exists()).toBe(false);
  });

  it("shows the empty state when there are no pages", async () => {
    answer({ pages: () => ok([]) });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-empty"]').text()).toContain(
      "No clicks recorded in this period",
    );
    expect(wrapper.find('[data-test="rum-heatmap-empty"]').text()).toContain(
      "session replay and click tracking",
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
      expect.arrayContaining(["pages", "devices", "totals", "ranking", "replay-views"]),
    );
    h.run.mockClear();

    const device = wrapper.findComponent(OToggleGroup);
    device?.vm.$emit("update:modelValue", "phone");
    await flushPromises();

    expect(ids().sort()).toEqual(["ranking", "replay-views", "replay-views", "totals"]);
  });

  it("says the element is missing, not the clicks, when clicks exist without targets", async () => {
    answer({ ranking: () => ok([]) });
    const wrapper = await mountPage();

    expect(wrapper.find('[data-test="rum-heatmap-no-position"]').text()).toContain(
      "not which element was clicked",
    );
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

  it("waits for the shell scope before querying, then loads once it is ready", async () => {
    answer();
    h.pa.scopeStatus.value = "loading";
    const wrapper = await mountPage();
    expect(h.run).not.toHaveBeenCalled();

    h.pa.scopeStatus.value = "ok";
    await flushPromises();

    expect(ids()).toContain("pages");
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("4");
  });

  it("drops the page from the old app when the shell switches app", async () => {
    answer();
    h.pa.heatmap.pageUrl = "https://a.test/old";
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="rum-heatmap-page-current"]').text()).toBe(
      "https://a.test/old",
    );

    h.pa.state.app = "mobile";
    h.pa.scopeKey.value = "k2";
    await flushPromises();

    expect(h.pa.heatmap.pageUrl).not.toBe("https://a.test/old");
    expect(wrapper.find('[data-test="rum-heatmap-page-current"]').text()).not.toBe(
      "https://a.test/old",
    );
  });

  it("waits for the app's bot rules before querying", async () => {
    answer();
    h.pa.rulesReady.value = false;
    await mountPage();

    expect(h.run).not.toHaveBeenCalled();
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

  it("shows clicks, sessions and frustrated clicks in one row with the overlay controls and no top element", async () => {
    answer({
      totals: () => ok([{ clicks: 10, sessions: 5, frustrated: 0 }]),
      ranking: () => ok([{ selector: "#buy", name: "Buy now", clicks: 4, sessions: 2 }]),
    });
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-stat-unused"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("10");
    expect(wrapper.find('[data-test="rum-heatmap-stat-sessions"]').text()).toContain("5");
    expect(wrapper.find('[data-test="rum-heatmap-stat-frustrated"]').text()).toContain("0");
    expect(wrapper.find('[data-test="rum-heatmap-stat-top"]').exists()).toBe(false);
    const row = wrapper.find('[data-test="rum-heatmap-stage-toolbar"]');
    expect(row.find('[data-test="rum-heatmap-stats"]').exists()).toBe(true);
    expect(row.find('[data-test="rum-heatmap-mode"]').exists()).toBe(true);
    expect(row.find('[data-test="rum-heatmap-panel-toggle"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="rum-heatmap-stage-toolbar"]')).toHaveLength(1);
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

  it("gives no never-clicked reason before a snapshot is measured", async () => {
    answer();
    const wrapper = await mountPage({ OTable: true });
    const chip = wrapper.find('[data-test="rum-heatmap-chip-unused"]');

    expect(chip.attributes("title")).toBeUndefined();
    expect(wrapper.find('[data-test="rum-heatmap-unused-reason"]').exists()).toBe(false);
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

    it("flags no row as Off snapshot and shows no drawn text while the snapshot mounts", async () => {
      snapshotAnswer();
      const wrapper = await mountSnapshot();

      expect(wrapper.find('[data-test="rum-heatmap-legend"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-placed"]').exists()).toBe(false);
      const rows = wrapper.findComponent(OTable).props("data") as { missing?: boolean }[];
      expect(rows.some((r) => r.missing)).toBe(false);
      await settle();
      wrapper.unmount();
    });

    it("reports drawn elements and filters to Off snapshot rows once placed", async () => {
      snapshotAnswer();
      const wrapper = await mountSnapshot();
      await settle();

      expect(wrapper.find('[data-test="rum-heatmap-placed"]').text()).toBe("1 of 2 elements drawn");
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
        "Turn off Off snapshot and Frustrated only",
      );
      wrapper.unmount();
    });

    it("explains the never-clicked threshold once a snapshot is measured with too few clicks placed", async () => {
      snapshotAnswer([
        { ...buy, clicks: 1 },
        { ...gone, clicks: 9 },
      ]);
      const wrapper = await mountSnapshot();
      await settle();

      expect(wrapper.find('[data-test="rum-heatmap-chip-unused"]').attributes("title")).toBe(
        "Needs at least 90% of clicks placed on the snapshot",
      );
      expect(wrapper.find('[data-test="rum-heatmap-unused-reason"]').text()).toContain("90%");
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

  describe("toolbar and shell scope", () => {
    const mountToolbar = async () => {
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true } },
      });
      await flushPromises();
      return wrapper;
    };

    it("has no app select, probe or date picker of its own, only page and device", async () => {
      answer();
      const wrapper = await mountToolbar();
      const html = wrapper.find('[data-test="rum-heatmap-toolbar"]').html();
      const at = (id: string) => html.indexOf(`data-test="${id}"`);

      expect(at("rum-heatmap-app-select")).toBe(-1);
      expect(at("rum-heatmap-date-picker")).toBe(-1);
      expect(at("rum-heatmap-page-select")).toBeGreaterThan(-1);
      expect(at("rum-heatmap-device-select")).toBeGreaterThan(at("rum-heatmap-page-select"));
      expect(ids()).not.toContain("apps");
    });

    it("queries the shell's date range and app scope", async () => {
      answer();
      await mountToolbar();
      const spec = h.run.mock.calls.find((c) => c[0] === "pages")![1];

      expect([spec.startUs, spec.endUs]).toEqual([h.range.startUs, h.range.endUs]);
    });

    it("reloads with the new window when the shell scope changes", async () => {
      answer();
      await mountToolbar();
      h.run.mockClear();
      h.range = { startUs: 5, endUs: 9 };

      h.pa.scopeKey.value = "k2";
      await flushPromises();
      const spec = h.run.mock.calls.find((c) => c[0] === "totals")![1];

      expect([spec.startUs, spec.endUs]).toEqual([5, 9]);
    });

    it("reloads when the shell refresh button ticks", async () => {
      answer();
      await mountToolbar();
      h.run.mockClear();

      h.pa.refreshTick.value++;
      await flushPromises();

      expect(ids()).toContain("pages");
    });

    it("opens the page and device named in the link", async () => {
      h.pa.heatmap.pageUrl = "https://x.test/pricing";
      h.pa.heatmap.device = "phone";
      answer();
      const wrapper = await mountToolbar();

      expect(wrapper.find('[data-test="rum-heatmap-page-current"]').text()).toBe(
        "https://x.test/pricing",
      );
      expect(wrapper.findComponent(OToggleGroup).props("modelValue")).toBe("phone");
    });

    it("starts the clicks and snapshot for a linked page while the page list is still loading", async () => {
      h.pa.heatmap.pageUrl = "https://x.test/home";
      let release: (v: unknown) => void = () => {};
      answer({ pages: () => new Promise((r) => (release = r)) });
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true } },
      });
      await flushPromises();

      expect(ids()).toEqual(expect.arrayContaining(["pages", "totals", "ranking"]));
      expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("4");

      release(ok([{ view_url: "https://x.test/home", clicks: 4, sessions: 2 }]));
      await flushPromises();
      expect(ids().filter((id) => id === "totals")).toHaveLength(1);
      wrapper.unmount();
    });

    it("writes the picked page and device into the shared URL state", async () => {
      answer({
        pages: () =>
          ok([
            { view_url: "https://x.test/home", clicks: 5, sessions: 2 },
            { view_url: "https://x.test/pricing", clicks: 3, sessions: 1 },
          ]),
      });
      const wrapper = await mountToolbar();
      h.pa.syncUrl.mockClear();

      wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "tablet");
      await flushPromises();

      expect(h.pa.heatmap.device).toBe("tablet");
      expect(h.pa.heatmap.pageUrl).toBe("https://x.test/home");
      expect(h.pa.syncUrl).toHaveBeenCalled();
    });
  });

  describe("phased snapshot load", () => {
    const hookRest = (impl: () => unknown) => {
      const base = h.run.getMockImplementation()!;
      h.run.mockImplementation(async (id: string, ...rest: unknown[]) =>
        id === "replay-rest" ? impl() : base(id, ...rest),
      );
    };
    const mountPhased = async () => {
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true } },
        attachTo: document.body,
      });
      await flushPromises();
      for (let i = 0; i < 40 && !ids().includes("replay-rest"); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await flushPromises();
      return wrapper;
    };
    const stageVisible = (w: { find: (s: string) => any }) =>
      w.find('[data-test="rum-heatmap-stage"]').isVisible();

    beforeEach(() => {
      h.events = [
        { type: 4, timestamp: 1, data: { width: 100, height: 100 } },
        { type: 2, timestamp: 2, data: { node: {} } },
      ];
      h.dom = '<button id="buy">Buy now</button>';
      h.pageWidth = 100;
      h.pageHeight = 100;
    });

    afterEach(() => {
      h.pageWidth = 0;
      h.pageHeight = 0;
    });

    it("shows the first frame before the remaining segments arrive, then advances to the last click", async () => {
      snapshotAnswer();
      let release: (v: unknown) => void = () => {};
      hookRest(() => new Promise((r) => (release = r)));
      const wrapper = await mountPhased();

      expect(stageVisible(wrapper)).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-snapshot-loading"]').exists()).toBe(false);
      expect(h.gotos).toEqual([0]);
      expect(ids()).toContain("replay-rest");

      release(ok([{ start: 1, segment: "{}" }]));
      await new Promise((r) => setTimeout(r, 50));
      await flushPromises();
      expect(h.gotos[h.gotos.length - 1]).toBe(1);
      wrapper.unmount();
    });

    it("asks for only the earliest segments first", async () => {
      snapshotAnswer();
      hookRest(() => ok([]));
      const wrapper = await mountPhased();
      const first = h.run.mock.calls.find((c) => c[0] === "replay-segments")![1];

      expect(first.sql).toContain("ORDER BY start ASC LIMIT 3");
      wrapper.unmount();
    });

    it("keeps the first frame and shows no error when the refinement fails", async () => {
      snapshotAnswer();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      hookRest(() => ({ status: "error", error: { message: "boom" } }));
      const wrapper = await mountPhased();
      await new Promise((r) => setTimeout(r, 50));

      expect(stageVisible(wrapper)).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-snapshot-error"]').exists()).toBe(false);
      expect(h.gotos).toEqual([0]);
      wrapper.unmount();
    });

    it("looks for a view in the active range first and widens to 720 hours only when it finds none", async () => {
      snapshotAnswer();
      const base = h.run.getMockImplementation()!;
      let views = 0;
      h.run.mockImplementation(async (id: string, ...rest: unknown[]) =>
        id === "replay-views" && ++views === 1 ? ok([]) : base(id, ...rest),
      );
      const wrapper = await mountPhased();
      const calls = h.run.mock.calls.filter((c) => c[0] === "replay-views").map((c) => c[1]);

      expect(calls).toHaveLength(2);
      expect(calls[0].endUs - calls[0].startUs).toBe(h.range.endUs - h.range.startUs);
      expect(calls[1].startUs).toBe(h.range.startUs);
      wrapper.unmount();
    });

    it("widens the lookup back only 720 hours when the active range is recent", async () => {
      const nowUs = Date.now() * 1000;
      h.range = { startUs: nowUs - 3_600_000_000, endUs: nowUs };
      snapshotAnswer();
      const base = h.run.getMockImplementation()!;
      let views = 0;
      h.run.mockImplementation(async (id: string, ...rest: unknown[]) =>
        id === "replay-views" && ++views === 1 ? ok([]) : base(id, ...rest),
      );
      const wrapper = await mountPhased();
      const calls = h.run.mock.calls.filter((c) => c[0] === "replay-views").map((c) => c[1]);

      expect(calls[1].endUs - calls[1].startUs).toBe(720 * 3_600_000_000);
      wrapper.unmount();
    });

    it("searches every replay lookup from the start of an absolute range 60 days back", async () => {
      const nowUs = Date.now() * 1000;
      const dayUs = 24 * 3_600_000_000;
      h.range = { startUs: nowUs - 60 * dayUs, endUs: nowUs - 59 * dayUs };
      snapshotAnswer();
      const wrapper = await mountPhased();
      const replay = h.run.mock.calls.filter((c) => String(c[0]).startsWith("replay-"));

      expect(replay.map((c) => c[0])).toEqual(
        expect.arrayContaining(["replay-flags", "replay-segments", "replay-rest", "replay-click"]),
      );
      for (const call of replay) expect(call[1].startUs).toBeLessThanOrEqual(h.range.startUs);
      wrapper.unmount();
    });

    it("rebuilds the snapshot on Retry after a click failure with a loaded snapshot", async () => {
      snapshotAnswer();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const wrapper = await mountPhased();
      expect(stageVisible(wrapper)).toBe(true);

      const base = h.run.getMockImplementation()!;
      h.run.mockImplementation(async (id: string, ...rest: unknown[]) =>
        id === "totals" ? { status: "error", error: { message: "boom" } } : base(id, ...rest),
      );
      h.pa.refreshTick.value++;
      await flushPromises();
      await new Promise((r) => setTimeout(r, 50));
      expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-stage"]').exists()).toBe(false);

      h.run.mockImplementation(base);
      h.run.mockClear();
      await wrapper.find('[data-test="rum-heatmap-retry-btn"]').trigger("click");
      for (let i = 0; i < 40 && !ids().includes("replay-rest"); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await flushPromises();

      expect(ids()).toEqual(expect.arrayContaining(["replay-views", "replay-segments"]));
      expect(wrapper.find('[data-test="rum-heatmap-load-error"]').exists()).toBe(false);
      expect(stageVisible(wrapper)).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-stage"] iframe').exists()).toBe(true);
      wrapper.unmount();
    });

    it("does not widen the view lookup when the active range already has a view", async () => {
      snapshotAnswer();
      const wrapper = await mountPhased();

      expect(ids().filter((id) => id === "replay-views")).toHaveLength(1);
      wrapper.unmount();
    });

    it("keeps the mounted snapshot when only the shell range changes", async () => {
      snapshotAnswer();
      const wrapper = await mountPhased();
      const stage = wrapper.find('[data-test="rum-heatmap-stage"]').element;
      h.run.mockClear();
      h.gotos = [];

      h.range = { startUs: 5, endUs: 9_000_000_000_000 };
      h.pa.scopeKey.value = "k2";
      await flushPromises();
      await new Promise((r) => setTimeout(r, 100));

      expect(ids()).toContain("totals");
      expect(ids()).not.toContain("replay-views");
      expect(ids()).not.toContain("replay-segments");
      expect(h.gotos).toEqual([]);
      expect(wrapper.find('[data-test="rum-heatmap-stage"]').element).toBe(stage);
      expect(wrapper.find('[data-test="rum-heatmap-snapshot-loading"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it("remounts the snapshot when the device changes", async () => {
      snapshotAnswer();
      const wrapper = await mountPhased();
      h.run.mockClear();

      wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "phone");
      await flushPromises();
      await new Promise((r) => setTimeout(r, 100));

      expect(ids()).toContain("replay-views");
      wrapper.unmount();
    });

    it("draws heat when the clicks land after the first frame, and when they land before it", async () => {
      snapshotAnswer();
      const base = h.run.getMockImplementation()!;
      let releaseRank: (v: unknown) => void = () => {};
      h.run.mockImplementation(async (id: string, ...rest: unknown[]) =>
        id === "ranking" ? new Promise((r) => (releaseRank = r)) : base(id, ...rest),
      );
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true } },
        attachTo: document.body,
      });
      await flushPromises();
      await new Promise((r) => setTimeout(r, 400));
      expect(wrapper.find('[data-test="rum-heatmap-stage"]').isVisible()).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-canvas"]').exists()).toBe(false);

      releaseRank(ok([{ selector: "#buy", name: "Buy now", clicks: 9, sessions: 3 }]));
      await new Promise((r) => setTimeout(r, 100));
      await flushPromises();
      expect(wrapper.find('[data-test="rum-heatmap-canvas"]').exists()).toBe(true);
      wrapper.unmount();

      snapshotAnswer();
      h.run.mockClear();
      const early = await mountPhased();
      expect(early.find('[data-test="rum-heatmap-canvas"]').exists()).toBe(true);
      early.unmount();
    });

    it("drops the second phase when a newer load supersedes it", async () => {
      snapshotAnswer();
      let calls = 0;
      let release: (v: unknown) => void = () => {};
      hookRest(() =>
        ++calls === 1 ? new Promise((r) => (release = r)) : new Promise(() => undefined),
      );
      const wrapper = await mountPhased();

      wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "phone");
      await flushPromises();
      release(ok([{ start: 1, segment: "{}" }]));
      await new Promise((r) => setTimeout(r, 100));
      await flushPromises();

      expect(h.gotos).not.toContain(1);
      wrapper.unmount();
    });
  });

  describe("stage fit and hover auto-scroll with real-ish geometry", () => {
    const rows = {
      props: ["data", "rowClass", "rowRailTone"],
      emits: ["row-mouseenter", "row-mouseleave", "row-click"],
      template:
        '<div v-for="r in data" :key="r.selector" class="row" :data-row="r.selector" @mouseenter="$emit(\'row-mouseenter\', r)" @mouseleave="$emit(\'row-mouseleave\', r)"><slot name="cell-feature" :row="r" /></div>',
    };
    const origWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    const origHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    let paneWidth = 1200;
    const mountGeo = async () => {
      h.events = [
        { type: 4, timestamp: 1, data: { width: 1440, height: 800 } },
        { type: 2, timestamp: 2, data: { node: {} } },
      ];
      h.dom = '<button id="buy">Buy now</button><button id="other">Other</button>';
      h.pageWidth = 1440;
      h.pageHeight = 6000;
      h.rectFor = (el) =>
        el.id === "buy"
          ? { left: 100, top: 3000, width: 200, height: 40 }
          : el.id === "other"
            ? { left: 100, top: 700, width: 200, height: 40 }
            : undefined;
      document.documentElement.style.fontSize = "16px";
      Object.defineProperty(Element.prototype, "clientWidth", {
        configurable: true,
        get() {
          return (this as Element).querySelector('[data-test="rum-heatmap-stage"]') ? paneWidth : 0;
        },
      });
      Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true,
        get() {
          return (this as Element).querySelector('[data-test="rum-heatmap-stage"]') ? 600 : 0;
        },
      });
      snapshotAnswer([
        { selector: "#buy", name: "Buy now", clicks: 9, sessions: 3 },
        { selector: "#other", name: "Other", clicks: 5, sessions: 2 },
      ]);
      const wrapper = mount(ClickHeatmap, {
        global: {
          plugins: [store],
          stubs: { OTable: rows as unknown as boolean, DateTimePickerDashboard: true },
        },
        attachTo: document.body,
      });
      await flushPromises();
      await settle();
      const stage = wrapper.find('[data-test="rum-heatmap-stage"]').element as HTMLElement;
      const scroller = stage.closest(".overflow-auto") as HTMLElement;
      scroller.getBoundingClientRect = () => ({ top: 100, left: 0 }) as DOMRect;
      stage.getBoundingClientRect = () => ({ top: 100 - 500 + 16, left: 0 }) as DOMRect;
      let top = 500;
      Object.defineProperty(scroller, "scrollTop", {
        get: () => top,
        set: (v: number) => {
          top = v;
        },
        configurable: true,
      });
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
      return { wrapper, scroller, scrollTo };
    };
    const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
    const scale = (1200 - 32) / 1440;

    beforeEach(() => {
      // jsdom has no CSS.escape; browsers do.
      vi.stubGlobal("CSS", { escape: (v: string) => v.replace(/[^\w-]/g, (c) => `\\${c}`) });
    });

    afterEach(() => {
      if (origWidth) Object.defineProperty(Element.prototype, "clientWidth", origWidth);
      if (origHeight) Object.defineProperty(Element.prototype, "clientHeight", origHeight);
      h.pageWidth = 0;
      h.pageHeight = 0;
      h.rectFor = undefined;
      paneWidth = 1200;
      delete (Element.prototype as any).scrollIntoView;
    });

    it("fits the pane width, not the page height, and sizes the wrapper to page height times scale", async () => {
      const { wrapper } = await mountGeo();
      const fit = wrapper.find('[data-test="rum-heatmap-stage"]').element.parentElement!;

      expect(fit.style.width).toBe(`${1440 * scale}px`);
      expect(fit.style.height).toBe(`${6000 * scale}px`);
      expect(
        (wrapper.find('[data-test="rum-heatmap-stage"]').element as HTMLElement).style.transform,
      ).toBe(`scale(${scale})`);
      wrapper.unmount();
    });

    it("ignores a zero-width measurement and refits once the pane has width", async () => {
      paneWidth = 0;
      const { wrapper } = await mountGeo();
      const stage = wrapper.find('[data-test="rum-heatmap-stage"]').element as HTMLElement;
      expect(stage.style.transform).not.toContain("scale(0");
      expect(stage.style.transform).not.toContain("-");

      paneWidth = 1200;
      window.dispatchEvent(new Event("resize"));
      await wait(300);

      expect(stage.style.transform).toBe(`scale(${scale})`);
      wrapper.unmount();
    });

    it("refits and redraws after entering and leaving full screen", async () => {
      const { wrapper } = await mountGeo();
      const stage = wrapper.find('[data-test="rum-heatmap-stage"]').element as HTMLElement;
      const toggle = wrapper.find('[data-test="rum-heatmap-fullscreen-toggle"]');

      const fit = stage.parentElement as HTMLElement;
      const scroller = stage.closest(".overflow-auto") as HTMLElement;
      scroller.scrollTop = 900;

      paneWidth = 1900;
      await toggle.trigger("click");
      await wait(300);
      expect(stage.style.transform).toBe("scale(1)");
      expect(fit.style.height).toBe("6000px");
      expect(scroller.scrollTop).toBe(0);

      paneWidth = 1200;
      scroller.scrollTop = 900;
      await toggle.trigger("click");
      await wait(300);
      expect(stage.style.transform).toBe(`scale(${scale})`);
      expect(fit.style.width).toBe(`${1440 * scale}px`);
      expect(fit.style.height).toBe(`${6000 * scale}px`);
      expect(scroller.scrollTop).toBe(0);
      expect(wrapper.find('[data-test="rum-heatmap-canvas"]').exists()).toBe(true);
      wrapper.unmount();
    });

    const hitMove = async (w: any, x: number, y: number) => {
      const layer = w.find('[data-test="rum-heatmap-hit-layer"]');
      layer.element.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 0 }) as DOMRect;
      await layer.trigger("mousemove", { clientX: x * scale, clientY: y * scale });
      return layer;
    };
    const tip = (w: any) => w.find('[data-test="rum-heatmap-element-tip"]');

    it("shows the details card over a hit-tested element in Heatmap mode with the panel closed", async () => {
      const { wrapper } = await mountGeo();
      expect(tip(wrapper).exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-heatmap-panel"]').isVisible()).toBe(false);

      const layer = await hitMove(wrapper, 150, 3010);

      expect(tip(wrapper).exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-tip-name"]').text()).toBe("Buy now");
      expect(wrapper.find('[data-test="rum-heatmap-tip-selector"]').text()).toBe("#buy");
      expect(wrapper.find('[data-test="rum-heatmap-tip-clicks"]').text()).toBe("9 clicks");
      expect(wrapper.find('[data-test="rum-heatmap-tip-share"]').text()).toBe("90%");
      expect(wrapper.find('[data-test="rum-heatmap-tip-sessions"]').text()).toBe("3 sessions");
      expect(tip(wrapper).classes()).toContain("pointer-events-none");

      await layer.trigger("mouseleave");
      expect(tip(wrapper).exists()).toBe(false);
      wrapper.unmount();
    });

    it("shows no card when nothing is under the pointer", async () => {
      const { wrapper } = await mountGeo();

      await hitMove(wrapper, 1000, 10);

      expect(tip(wrapper).exists()).toBe(false);
      wrapper.unmount();
    });

    it("hides the card when the stage starts scrolling and brings it back on the next move", async () => {
      const { wrapper, scroller } = await mountGeo();
      await hitMove(wrapper, 150, 3010);
      expect(tip(wrapper).exists()).toBe(true);

      await scroller.dispatchEvent(new Event("scroll"));
      await flushPromises();
      expect(tip(wrapper).exists()).toBe(false);

      await hitMove(wrapper, 152, 3012);
      expect(tip(wrapper).exists()).toBe(true);
      wrapper.unmount();
    });

    it("opens below the element, and flips above it when it would leave the pane", async () => {
      const { wrapper, scroller } = await mountGeo();
      const wrapperEl = wrapper.find('[data-test="rum-heatmap-stage"]').element.parentElement!
        .parentElement as HTMLElement;
      wrapperEl.getBoundingClientRect = () => ({ top: 100, bottom: 5000, left: 0 }) as DOMRect;
      scroller.getBoundingClientRect = () => ({ top: 100, bottom: 700, left: 0 }) as DOMRect;
      Object.defineProperty(window, "innerHeight", { value: 5000, configurable: true });
      const top = () => parseFloat((tip(wrapper).element as HTMLElement).style.top);

      await hitMove(wrapper, 150, 3010);
      const elementTop = 3000 * scale;
      const elementBottom = 3040 * scale;
      expect(top()).toBeCloseTo(elementTop - 8 - 128, 0);
      expect(top()).toBeLessThan(elementTop);

      Object.defineProperty(window, "innerHeight", { value: 5000, configurable: true });
      scroller.getBoundingClientRect = () => ({ top: 100, bottom: 4900, left: 0 }) as DOMRect;
      await wrapper.find('[data-test="rum-heatmap-hit-layer"]').trigger("mouseleave");
      await hitMove(wrapper, 150, 3010);
      expect(top()).toBeCloseTo(elementBottom + 8, 0);
      wrapper.unmount();
    });

    it("shows the card for a hovered marker in Markers mode too", async () => {
      const { wrapper } = await mountGeo();
      await wrapper.find('[data-test="rum-heatmap-mode-markers"]').trigger("click");

      await wrapper.find('[data-test="rum-heatmap-marker-#buy"]').trigger("mouseenter");

      expect(tip(wrapper).exists()).toBe(true);
      expect(wrapper.findAll('[data-test="rum-heatmap-element-tip"]')).toHaveLength(1);
      wrapper.unmount();
    });

    it("scrolls the picture to the centre of a far element when its row is hovered, and not when off", async () => {
      const { wrapper, scrollTo } = await mountGeo();
      const row = wrapper.find('[data-row="#buy"]');

      await row.trigger("mouseenter");
      await wait();
      const top = 16 + 3000 * scale;
      expect(scrollTo).toHaveBeenCalledWith({
        top: (top + (top + 40 * scale)) / 2 - 300,
        behavior: "smooth",
      });
      await row.trigger("mouseleave");

      scrollTo.mockClear();
      wrapper.findComponent(OSwitch).vm.$emit("update:modelValue", false);
      await flushPromises();
      await row.trigger("mouseenter");
      await wait();
      expect(scrollTo).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("does not scroll for an element already in view", async () => {
      const { wrapper, scrollTo } = await mountGeo();

      await wrapper.find('[data-row="#other"]').trigger("mouseenter");
      await wait();

      expect(scrollTo).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("hides the pointer-only hit layer from assistive tech", async () => {
      const { wrapper } = await mountGeo();

      expect(wrapper.find('[data-test="rum-heatmap-hit-layer"]').attributes("aria-hidden")).toBe(
        "true",
      );
      wrapper.unmount();
    });

    it("scrolls the list row into view when the heat area under the pointer is hovered, panel open", async () => {
      const scrollIntoView = vi.fn();
      (Element.prototype as any).scrollIntoView = scrollIntoView;
      const { wrapper } = await mountGeo();
      await wrapper.find('[data-test="rum-heatmap-panel-toggle"]').trigger("click");
      const layer = wrapper.find('[data-test="rum-heatmap-hit-layer"]');
      layer.element.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;

      await layer.trigger("mousemove", { clientX: 150 * scale, clientY: (3000 + 10) * scale });
      expect(wrapper.find('[data-test="rum-heatmap-hover-box"]').exists(), "hover").toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-feature-#buy"]').exists(), "cell").toBe(true);
      await vi.waitFor(
        () => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" }),
        { timeout: 5000 },
      );
      expect(scrollIntoView.mock.contexts[0]).toBe(
        wrapper.find('[data-test="rum-heatmap-feature-#buy"]').element,
      );

      scrollIntoView.mockClear();
      await layer.trigger("mouseleave");
      wrapper.findComponent(OSwitch).vm.$emit("update:modelValue", false);
      await flushPromises();
      vi.useFakeTimers();
      try {
        await layer.trigger("mousemove", { clientX: 150 * scale, clientY: (3000 + 10) * scale });
        await vi.advanceTimersByTimeAsync(1000);
      } finally {
        vi.useRealTimers();
      }
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="rum-heatmap-hover-box"]').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe("toolbar groups and full screen", () => {
    it("keeps tooltip copy out of the page until hover or focus", async () => {
      const wrapper = await mountGroups();

      expect(wrapper.text()).not.toContain("Highlighting stays on either way");
      expect(document.body.textContent).not.toContain("Highlighting stays on either way");
      expect(wrapper.find('[data-test="rum-heatmap-auto-scroll"]').text()).toContain(
        "Auto-scroll to hotspot",
      );
      wrapper.unmount();
    });

    it("renders the stat chips and every toolbar control while the first load is pending", async () => {
      h.run.mockImplementation(() => new Promise(() => {}));
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true, DateTimePickerDashboard: picker } },
      });
      await flushPromises();

      for (const id of [
        "stat-clicks",
        "stat-sessions",
        "stat-frustrated",
        "mode",
        "opacity",
        "auto-scroll",
        "panel-toggle",
        "page-select",
        "device-select",
      ]) {
        expect(wrapper.find(`[data-test="rum-heatmap-${id}"]`).exists(), id).toBe(true);
      }
      expect(wrapper.find('[data-test="rum-heatmap-stat-clicks"]').text()).toContain("—");
      wrapper.unmount();
    });

    const picker = { template: "<div />", props: ["modelValue"] };
    const mountGroups = async (rows = [{ selector: "#buy", clicks: 4, sessions: 2 }]) => {
      answer({
        totals: () => ok([{ clicks: 4, sessions: 2, frustrated: 3 }]),
        ranking: () => ok(rows),
      });
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true, DateTimePickerDashboard: picker } },
        attachTo: document.body,
      });
      await flushPromises();
      return wrapper;
    };
    const fullscreenToggle = (w: { find: (s: string) => any }) =>
      w.find('[data-test="rum-heatmap-fullscreen-toggle"]');

    it("groups stats, view controls and actions with dividers and colours frustrated clicks", async () => {
      const wrapper = await mountGroups();
      const row = wrapper.find('[data-test="rum-heatmap-stage-toolbar"]');

      expect(row.find('[data-test="rum-heatmap-stats"]').exists()).toBe(true);
      expect(row.find('[data-test="rum-heatmap-divider-stats"]').exists()).toBe(true);
      expect(
        row
          .find('[data-test="rum-heatmap-view-group"]')
          .find('[data-test="rum-heatmap-opacity"]')
          .exists(),
      ).toBe(true);
      expect(row.find('[data-test="rum-heatmap-actions"]').classes()).toContain("ms-auto");
      expect(
        wrapper.find('[data-test="rum-heatmap-stat-frustrated"] span:last-child').classes(),
      ).toContain("text-status-negative");
      expect(wrapper.find('[data-test="rum-heatmap-panel-toggle-text"]').text()).toBe(
        "Hide elements",
      );
      wrapper.unmount();
    });

    it("expands the page in the app, labels the toggle and leaves on Escape with focus restored", async () => {
      answer();
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true, DateTimePickerDashboard: picker } },
        attachTo: document.body,
      });
      await flushPromises();
      const root = () => wrapper.find('[data-test="rum-heatmap-page"]');
      expect(fullscreenToggle(wrapper).attributes("aria-label")).toBe("Full screen");
      expect(fullscreenToggle(wrapper).attributes("aria-pressed")).toBe("false");
      expect(root().classes()).not.toContain("fixed");

      await fullscreenToggle(wrapper).trigger("click");
      expect(fullscreenToggle(wrapper).attributes("aria-label")).toBe("Exit full screen");
      expect(fullscreenToggle(wrapper).attributes("aria-pressed")).toBe("true");
      expect(root().classes()).toEqual(
        expect.arrayContaining(["fixed", "inset-0", "z-5000", "bg-surface-base"]),
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await flushPromises();
      expect(fullscreenToggle(wrapper).attributes("aria-label")).toBe("Full screen");
      expect(root().classes()).not.toContain("fixed");
      expect(document.activeElement).toBe(fullscreenToggle(wrapper).element);
      wrapper.unmount();
    });

    it("leaves the Escape key to an open page picker", async () => {
      answer();
      const wrapper = mount(ClickHeatmap, {
        global: { plugins: [store], stubs: { OTable: true, DateTimePickerDashboard: picker } },
        attachTo: document.body,
      });
      await flushPromises();
      await fullscreenToggle(wrapper).trigger("click");
      await wrapper.find('[data-test="rum-heatmap-page-select"]').trigger("click");
      await flushPromises();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await flushPromises();

      expect(fullscreenToggle(wrapper).attributes("aria-pressed")).toBe("true");
      wrapper.unmount();
    });
  });

  describe("overlay modes and markers", () => {
    const other = { selector: "#other", name: "Other", clicks: 5, sessions: 2 };
    const marker = (w: { find: (s: string) => any }, sel: string) =>
      w.find(`[data-test="rum-heatmap-marker-${sel}"]`);
    const mountModes = async () => {
      snapshotAnswer([buy, other, gone]);
      const wrapper = await mountSnapshot();
      await settle();
      return wrapper;
    };
    const pickMode = (w: { find: (s: string) => any }, mode: string) =>
      w.find(`[data-test="rum-heatmap-mode-${mode}"]`).trigger("click");

    beforeEach(() => {
      h.events = [];
      h.dom = "";
    });

    it("defaults to Heatmap with the canvas and legend shown and no markers", async () => {
      const wrapper = await mountModes();

      expect(wrapper.find('[data-test="rum-heatmap-mode-hint"]').text()).toBe(
        "Click density overlay",
      );
      expect(wrapper.find('[data-test="rum-heatmap-canvas"]').classes()).not.toContain("hidden");
      expect(wrapper.find('[data-test="rum-heatmap-legend"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-heatmap-markers"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it("hides the canvas and legend in Markers mode and numbers placed elements", async () => {
      const wrapper = await mountModes();

      await pickMode(wrapper, "markers");

      expect(wrapper.find('[data-test="rum-heatmap-canvas"]').classes()).toContain("hidden");
      expect(wrapper.find('[data-test="rum-heatmap-legend"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-heatmap-mode-hint"]').text()).toBe(
        "Numbered elements, hover for details",
      );
      const badges = wrapper
        .findAll('[data-test="rum-heatmap-marker-badge"]')
        .map((b: { text: () => string }) => b.text());
      expect(badges).toEqual(["1", "2"]);
      const badgeClasses = wrapper.find('[data-test="rum-heatmap-marker-badge"]').classes();
      expect(badgeClasses).toEqual(
        expect.arrayContaining(["bg-surface-base", "text-text-heading", "text-2xs", "border"]),
      );
      expect(badgeClasses).not.toContain("text-white");
      expect(marker(wrapper, "#buy").attributes("aria-label")).toBe(
        "Rank 1, Buy now, 9 clicks, 2 frustrated",
      );
      expect(marker(wrapper, "#other").attributes("aria-label")).toBe("Rank 2, Other, 5 clicks");
      expect(marker(wrapper, "#other").attributes("tabindex")).toBe("0");
      wrapper.unmount();
    });

    it("adds the frustrated count to the marker label only when there is one", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");

      expect(marker(wrapper, "#buy").attributes("aria-label")).toContain("2 frustrated");
      expect(marker(wrapper, "#other").attributes("aria-label")).not.toContain("frustrated");
      wrapper.unmount();
    });

    it("shows heat and markers together in Both mode", async () => {
      const wrapper = await mountModes();

      await pickMode(wrapper, "both");

      expect(wrapper.find('[data-test="rum-heatmap-canvas"]').classes()).not.toContain("hidden");
      expect(wrapper.find('[data-test="rum-heatmap-legend"]').exists()).toBe(true);
      expect(wrapper.findAll('[data-test="rum-heatmap-marker-badge"]')).toHaveLength(2);
      expect(wrapper.find('[data-test="rum-heatmap-mode-hint"]').text()).toBe(
        "Density with element markers",
      );
      wrapper.unmount();
    });

    it("draws no marker for an element that is not on the snapshot", async () => {
      const wrapper = await mountModes();

      await pickMode(wrapper, "markers");

      expect(marker(wrapper, "#gone").exists()).toBe(false);
      wrapper.unmount();
    });

    it("colours markers by their share of the top element's clicks", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");

      expect(marker(wrapper, "#buy").classes()).toContain("border-status-negative");
      expect(marker(wrapper, "#other").classes()).toContain("border-warning");
      wrapper.unmount();
    });

    it("selects the row when a marker is clicked and clears it on a second click", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");

      await marker(wrapper, "#other").trigger("click");
      const rowClass = () =>
        (wrapper.findComponent(OTable).props("rowClass") as (r: { selector: string }) => string)({
          selector: "#other",
        });
      expect(rowClass()).toBe("bg-surface-tint-accent");
      expect(marker(wrapper, "#other").attributes("aria-pressed")).toBe("true");

      await marker(wrapper, "#other").trigger("click");
      expect(rowClass()).toBe("");
      wrapper.unmount();
    });

    it("selects with the Enter key on a focused marker", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");

      await marker(wrapper, "#buy").trigger("keydown", { key: "Enter" });

      expect(marker(wrapper, "#buy").attributes("aria-pressed")).toBe("true");
      wrapper.unmount();
    });

    it("highlights the marker while its table row is hovered", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");
      expect(marker(wrapper, "#buy").classes()).not.toContain("bg-accent/10");

      wrapper.findComponent(OTable).vm.$emit("row-mouseenter", { selector: "#buy" });
      await flushPromises();
      expect(marker(wrapper, "#buy").classes()).toContain("bg-accent/10");

      wrapper.findComponent(OTable).vm.$emit("row-mouseleave", { selector: "#buy" });
      await flushPromises();
      expect(marker(wrapper, "#buy").classes()).not.toContain("bg-accent/10");
      wrapper.unmount();
    });

    it("shows the tooltip with name, selector, clicks, share and sessions on hover and focus", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");
      expect(wrapper.find('[data-test="rum-heatmap-element-tip"]').exists()).toBe(false);

      await marker(wrapper, "#buy").trigger("mouseenter");

      expect(wrapper.find('[data-test="rum-heatmap-tip-name"]').text()).toBe("Buy now");
      expect(wrapper.find('[data-test="rum-heatmap-tip-selector"]').text()).toBe("#buy");
      expect(wrapper.find('[data-test="rum-heatmap-tip-clicks"]').text()).toBe("9 clicks");
      expect(wrapper.find('[data-test="rum-heatmap-tip-share"]').text()).toBe("90%");
      expect(wrapper.find('[data-test="rum-heatmap-tip-sessions"]').text()).toBe("3 sessions");

      await marker(wrapper, "#buy").trigger("mouseleave");
      expect(wrapper.find('[data-test="rum-heatmap-element-tip"]').exists()).toBe(false);
      await marker(wrapper, "#other").trigger("focus");
      expect(wrapper.find('[data-test="rum-heatmap-tip-name"]').text()).toBe("Other");
      wrapper.unmount();
    });

    it("starts with the element panel closed, then shows and hides it with the button label", async () => {
      const wrapper = await mountModes();
      const button = () => wrapper.find('[data-test="rum-heatmap-panel-toggle"]');
      const panel = () => wrapper.find('[data-test="rum-heatmap-panel"]');
      expect(button().attributes("aria-label")).toBe("Show elements");
      expect(button().attributes("aria-expanded")).toBe("false");
      expect(panel().isVisible()).toBe(false);

      await button().trigger("click");
      expect(button().attributes("aria-label")).toBe("Hide elements");
      expect(button().attributes("aria-expanded")).toBe("true");
      expect(panel().isVisible()).toBe(true);

      await button().trigger("click");
      expect(button().attributes("aria-label")).toBe("Show elements");
      expect(panel().isVisible()).toBe(false);
      wrapper.unmount();
    });

    it("scrolls the stage to a hovered row's element only when it is off-screen", async () => {
      const wrapper = await mountModes();
      const scroller = wrapper
        .find('[data-test="rum-heatmap-stage"]')
        .element.closest(".overflow-auto") as HTMLElement;
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
      const hover = async (sel: string) => {
        wrapper.findComponent(OTable).vm.$emit("row-mouseenter", { selector: sel });
        await new Promise((r) => setTimeout(r, 150));
      };

      await hover("#buy");
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith({ top: 10, behavior: "smooth" });

      wrapper.findComponent(OTable).vm.$emit("row-mouseleave", { selector: "#buy" });
      Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
      scrollTo.mockClear();
      await hover("#other");
      expect(scrollTo).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("outlines the element and lights its row when the pointer is over its heat area", async () => {
      const wrapper = await mountModes();
      const rowClass = (sel: string) =>
        (wrapper.findComponent(OTable).props("rowClass") as (r: { selector: string }) => string)({
          selector: sel,
        });
      expect(wrapper.find('[data-test="rum-heatmap-hover-box"]').exists()).toBe(false);

      await wrapper
        .find('[data-test="rum-heatmap-hit-layer"]')
        .trigger("mousemove", { clientX: 10, clientY: 10 });
      expect(wrapper.find('[data-test="rum-heatmap-hover-box"]').exists()).toBe(true);
      expect(rowClass("#buy")).toBe("bg-surface-tint-accent");

      await wrapper.find('[data-test="rum-heatmap-hit-layer"]').trigger("mouseleave");
      expect(wrapper.find('[data-test="rum-heatmap-hover-box"]').exists()).toBe(false);
      expect(rowClass("#buy")).toBe("");
      wrapper.unmount();
    });

    it("selects the hovered element when the heat area is clicked", async () => {
      const wrapper = await mountModes();
      const layer = wrapper.find('[data-test="rum-heatmap-hit-layer"]');

      await layer.trigger("mousemove", { clientX: 10, clientY: 10 });
      await layer.trigger("click");
      await layer.trigger("mouseleave");

      const rowClass = wrapper.findComponent(OTable).props("rowClass") as (r: {
        selector: string;
      }) => string;
      expect(rowClass({ selector: "#buy" })).toBe("bg-surface-tint-accent");
      wrapper.unmount();
    });

    it("lights the row for a hovered marker and keeps marker clicks working", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");
      expect(wrapper.find('[data-test="rum-heatmap-hit-layer"]').exists()).toBe(false);

      await marker(wrapper, "#other").trigger("mouseenter");
      const rowClass = wrapper.findComponent(OTable).props("rowClass") as (r: {
        selector: string;
      }) => string;
      expect(rowClass({ selector: "#other" })).toBe("bg-surface-tint-accent");
      await marker(wrapper, "#other").trigger("click");
      expect(marker(wrapper, "#other").attributes("aria-pressed")).toBe("true");
      wrapper.unmount();
    });

    it("fades the heat canvas with the opacity slider and hides the slider in Markers mode", async () => {
      const wrapper = await mountModes();
      const canvas = () => wrapper.find('[data-test="rum-heatmap-canvas"]');
      const slider = () => wrapper.findComponent(OSlider);
      expect(slider().props("modelValue")).toBe(100);
      expect(slider().attributes("aria-label")).toBe("Heat opacity");
      expect(canvas().attributes("style")).toContain("opacity: 1");

      slider().vm.$emit("update:modelValue", 40);
      await flushPromises();
      expect(canvas().attributes("style")).toContain("opacity: 0.4");
      expect(wrapper.find('[data-test="rum-heatmap-opacity-value"]').text()).toBe("40%");

      await pickMode(wrapper, "markers");
      expect(wrapper.find('[data-test="rum-heatmap-opacity"]').classes()).toContain("invisible");
      expect(wrapper.find('[data-test="rum-heatmap-auto-scroll"]').exists()).toBe(true);
      expect(
        wrapper
          .find('[data-test="rum-heatmap-opacity"] [data-test="rum-heatmap-auto-scroll"]')
          .exists(),
      ).toBe(false);
      wrapper.unmount();
    });

    it("highlights but does not scroll on hover when auto scroll is off, and scrolls when on", async () => {
      const wrapper = await mountModes();
      const scroller = wrapper
        .find('[data-test="rum-heatmap-stage"]')
        .element.closest(".overflow-auto") as HTMLElement;
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
      const hoverRow = async (sel: string) => {
        wrapper.findComponent(OTable).vm.$emit("row-mouseenter", { selector: sel });
        await new Promise((r) => setTimeout(r, 150));
        wrapper.findComponent(OTable).vm.$emit("row-mouseleave", { selector: sel });
      };
      const rowClass = wrapper.findComponent(OTable).props("rowClass") as (r: {
        selector: string;
      }) => string;
      const toggle = wrapper.findComponent(OSwitch);
      expect(toggle.props("modelValue")).toBe(true);

      toggle.vm.$emit("update:modelValue", false);
      await flushPromises();
      wrapper.findComponent(OTable).vm.$emit("row-mouseenter", { selector: "#buy" });
      await new Promise((r) => setTimeout(r, 150));
      expect(rowClass({ selector: "#buy" })).toBe("bg-surface-tint-accent");
      expect(scrollTo).not.toHaveBeenCalled();
      wrapper.findComponent(OTable).vm.$emit("row-mouseleave", { selector: "#buy" });

      toggle.vm.$emit("update:modelValue", true);
      await flushPromises();
      await hoverRow("#buy");
      expect(scrollTo).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it("does not scroll the element list for a hovered marker when auto scroll is off", async () => {
      const scrollIntoView = vi.fn();
      (Element.prototype as any).scrollIntoView = scrollIntoView;
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");
      wrapper.findComponent(OSwitch).vm.$emit("update:modelValue", false);
      await wrapper.find('[data-test="rum-heatmap-panel-toggle"]').trigger("click");

      await marker(wrapper, "#other").trigger("mouseenter");
      await new Promise((r) => setTimeout(r, 150));

      expect(scrollIntoView).not.toHaveBeenCalled();
      delete (Element.prototype as any).scrollIntoView;
      wrapper.unmount();
    });

    it("draws markers as outlines with no translucent fill unless active", async () => {
      const wrapper = await mountModes();
      await pickMode(wrapper, "markers");

      const classes = marker(wrapper, "#buy").classes();
      expect(classes.some((c: string) => c.startsWith("bg-"))).toBe(false);
      await marker(wrapper, "#buy").trigger("mouseenter");
      expect(marker(wrapper, "#buy").classes()).toContain("bg-accent/10");
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

  it("sorts ascending and back to descending from the sort control", async () => {
    answer(rankedRows([buy, gone], 10));
    const wrapper = await mountPage({ OTable: true });
    const table = () => wrapper.findComponent(OTable);
    const order = () => (table().props("data") as { selector: string }[]).map((r) => r.selector);
    const sort = () => wrapper.findComponent('[data-test="rum-heatmap-sort-select"]');
    expect(order()).toEqual(["#buy", "#gone"]);

    sort().vm.$emit("update:modelValue", "asc");
    await flushPromises();
    expect(order()).toEqual(["#gone", "#buy"]);

    sort().vm.$emit("update:modelValue", "desc");
    await flushPromises();
    expect(order()).toEqual(["#buy", "#gone"]);
  });

  it("keeps the summary strip mounted while a filter change refetches", async () => {
    answer(rankedRows([buy, gone], 10));
    const wrapper = await mountPage({ OTable: true });
    const strip = () => wrapper.find('[data-test="rum-heatmap-stats"]');
    expect(strip().exists()).toBe(true);

    let release: (v: unknown) => void = () => {};
    const gate = new Promise((res) => (release = res));
    h.run.mockImplementation(async (id: string) => {
      if (id === "totals") {
        await gate;
        return ok([{ clicks: 20, sessions: 8, frustrated: 1 }]);
      }
      return ok(id === "ranking" ? [buy, gone] : []);
    });
    wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "phone");
    await flushPromises();

    expect(strip().exists()).toBe(true);
    const clicks = () => wrapper.find('[data-test="rum-heatmap-stat-clicks"]');
    expect(clicks().text()).toContain("10");
    expect(clicks().find("span:last-child").classes()).toContain("text-text-secondary");

    release(null);
    await flushPromises();
    expect(clicks().text()).toContain("20");
    expect(clicks().find("span:last-child").classes()).not.toContain("text-text-secondary");
  });

  it("lays each element out as rank, name with share bar and badges, then clicks over share", async () => {
    snapshotAnswer([buy, gone]);
    const rows = {
      props: ["data"],
      template:
        '<div v-for="r in data" :key="r.selector"><slot name="cell-feature" :row="r" /></div>',
    };
    const wrapper = await mountPage({ OTable: rows as unknown as boolean });

    const cell = wrapper.find('[data-test="rum-heatmap-feature-#buy"]');
    expect(cell.find('[data-test="rum-heatmap-row-rank"]').text()).toBe("1");
    expect(cell.find('[data-test="rum-heatmap-row-clicks"]').text()).toBe("9");
    expect(cell.find('[data-test="rum-heatmap-row-share"]').text()).toBe("90%");
    expect(cell.find('[data-test="rum-heatmap-row-sessions"]').text()).toBe("3 sessions");
    expect(cell.find('[data-test="rum-heatmap-row-bar"]').exists()).toBe(true);
    expect(cell.find('[data-test="rum-heatmap-frustrated-#buy"]').text()).toBe("2 frustrated");
    expect(cell.attributes("title")).toContain("#buy");
    expect(wrapper.find('[data-test="rum-heatmap-not-on-snapshot-#buy"]').exists()).toBe(false);
  });

  it("badges rows whose element is missing from the snapshot as Off snapshot", async () => {
    snapshotAnswer([buy, gone]);
    const rows = {
      props: ["data"],
      template:
        '<div v-for="r in data" :key="r.selector"><slot name="cell-feature" :row="r" /></div>',
    };
    const wrapper = mount(ClickHeatmap, {
      global: { plugins: [store], stubs: { OTable: rows as unknown as boolean } },
      attachTo: document.body,
    });
    await flushPromises();
    await settle();

    expect(wrapper.find('[data-test="rum-heatmap-not-on-snapshot-#gone"]').text()).toBe(
      "Off snapshot",
    );
    wrapper.unmount();
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

    expect(ids().sort()).toEqual(["ranking", "replay-views", "replay-views", "totals"]);
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

  it("queries only the primary app when the shell compares apps", async () => {
    h.real = true;
    h.pa.scope.value = {
      app: "web",
      env: [],
      version: [],
      schema: {},
      apps: ["web", "ios"],
      appExclusions: {},
    } as never;
    vi.mocked(searchService.search).mockImplementation((async (req: any) => ({
      data: {
        hits: String(req.query.query.sql).includes("view_url")
          ? [{ view_url: "https://x.test/home" }]
          : [],
      },
    })) as never);
    await mountPage({ OTable: true });

    const sqls = vi
      .mocked(searchService.search)
      .mock.calls.map((c) => String((c[0].query as any).query.sql))
      .filter((q) => q.includes('FROM "_rumdata"'));
    expect(sqls.length).toBeGreaterThan(1);
    for (const sql of sqls) {
      expect(sql).not.toContain("ios");
      expect(sql).not.toContain("application_id IN");
    }
  });

  it("hides Retry when the data is forbidden but keeps it for other failures", async () => {
    answer({ pages: () => ({ status: "forbidden" }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = await mountPage({ OTable: true });

    expect(wrapper.find('[data-test="rum-heatmap-load-error"]').text()).toContain(
      "You don't have access to this data.",
    );
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(false);

    answer({ pages: () => ({ status: "error", error: { message: "boom" } }) });
    h.pa.refreshTick.value++;
    await flushPromises();
    expect(wrapper.find('[data-test="rum-heatmap-retry-btn"]').exists()).toBe(true);
  });

  it("opens the element panel once when there is no replay but clicks are ranked", async () => {
    answer();
    const wrapper = await mountPage({ OTable: true });
    const toggle = () => wrapper.find('[data-test="rum-heatmap-panel-toggle"]');

    expect(wrapper.find('[data-test="rum-heatmap-snapshot-error"]').exists()).toBe(true);
    expect(toggle().attributes("aria-expanded")).toBe("true");

    await toggle().trigger("click");
    expect(toggle().attributes("aria-expanded")).toBe("false");
    await flushPromises();
    expect(toggle().attributes("aria-expanded")).toBe("false");
  });

  it("applies a page and a device pasted in while loading once the load settles", async () => {
    answer();
    const wrapper = await mountPage({ OTable: true });
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((res) => (release = res));
    h.run.mockImplementation(async (id: string) => {
      if (id === "totals") {
        await gate;
        return ok([{ clicks: 4, sessions: 2, frustrated: 0 }]);
      }
      return ok(id === "pages" ? [{ view_url: "https://x.test/home" }] : []);
    });
    h.pa.refreshTick.value++;
    await flushPromises();

    h.pa.heatmap.pageUrl = "https://x.test/pricing";
    h.pa.heatmap.device = "phone";
    await flushPromises();
    answer();
    release(null);
    await flushPromises();
    await flushPromises();

    expect(wrapper.find('[data-test="rum-heatmap-page-current"]').text()).toBe(
      "https://x.test/pricing",
    );
    expect(wrapper.findComponent(OToggleGroup).props("modelValue")).toBe("phone");
  });

  it("keeps the full frustration split in the row tooltip", async () => {
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

    expect(wrapper.find('[data-test="rum-heatmap-feature-#buy"]').attributes("title")).toContain(
      "Rage 1, dead 2, error 0",
    );
  });
});
