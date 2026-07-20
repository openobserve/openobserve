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

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The two bugs covered here are both SELF-SEALING — the grid ends up in a state
 * it cannot leave on its own — which is exactly why neither showed up as a test
 * failure or a console error. They were found by reading the code and confirmed
 * against a running org.
 */

const HIST = [
  {
    name: "lat_seconds",
    stream_type: "metrics",
    metrics_meta: { metric_type: "Histogram", metric_family_name: "lat_seconds", help: "", unit: "s" },
    stats: { doc_num: 0 },
  },
  {
    name: "lat_seconds_bucket",
    stream_type: "metrics",
    metrics_meta: { metric_type: "Counter", metric_family_name: "lat_seconds_bucket", help: "", unit: "" },
    stats: { doc_num: 100 },
  },
  {
    name: "lat_seconds_count",
    stream_type: "metrics",
    metrics_meta: { metric_type: "Counter", metric_family_name: "lat_seconds_count", help: "", unit: "" },
    stats: { doc_num: 100 },
  },
];

const STREAMS = [
  ...HIST,
  {
    // A declared unit the metric NAME cannot express. Name inference alone gives
    // "numbers"; only the declared `Cel` says Celsius.
    name: "cpu_temperature",
    stream_type: "metrics",
    metrics_meta: {
      metric_type: "Gauge",
      metric_family_name: "cpu_temperature",
      help: "Core temperature.",
      unit: "Cel",
    },
    stats: { doc_num: 100 },
  },
  {
    name: "target_info",
    stream_type: "metrics",
    metrics_meta: { metric_type: "Info", metric_family_name: "target_info", help: "", unit: "" },
    stats: { doc_num: 100 },
  },
  {
    name: "http_requests_total",
    stream_type: "metrics",
    metrics_meta: { metric_type: "Counter", metric_family_name: "http_requests_total", help: "", unit: "" },
    stats: { doc_num: 100 },
  },
  {
    name: "idle_metric_total",
    stream_type: "metrics",
    metrics_meta: { metric_type: "Counter", metric_family_name: "idle_metric_total", help: "", unit: "" },
    stats: { doc_num: 100 },
  },
];

/** Every in-flight streaming query, so a test can land or strand each one. */
const inFlight: Array<{
  query: string;
  complete: (result: any) => void;
}> = [];

const storeState: any = {
  selectedOrganization: { identifier: "org1" },
  theme: "light",
  zoConfig: { max_dashboard_series: 100 },
  // The same field the panel substitution resolves `$__rate_interval` against.
  organizationData: { organizationSettings: { scrape_interval: 15 } },
};

vi.mock("vuex", () => ({
  useStore: () => ({ state: storeState }),
}));

// Hoisted so a test can hand it a different org (see the query-storm tests).
const { getStreamsMock } = vi.hoisted(() => ({ getStreamsMock: vi.fn() }));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: getStreamsMock }),
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      inFlight.push({
        query: payload.queryReq.query,
        complete: (result: any) => {
          handlers.data({}, { type: "promql_response", content: { results: result } });
          handlers.complete();
        },
      });
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/dashboard/promqlChunkProcessor", () => ({
  createPromQLChunkProcessor: () => ({
    processChunk: (_acc: any, chunk: any) => chunk,
  }),
}));

// No IndexedDB in the test env, and the persisted cache is not what is under
// test — every card starts with nothing cached.
vi.mock("@/composables/dashboard/usePanelCache", () => ({
  usePanelCache: () => ({
    getPanelCache: vi.fn().mockResolvedValue(null),
    savePanelCache: vi.fn().mockResolvedValue(undefined),
  }),
}));

// The factory is hoisted above STREAMS, so the resolved value is set per test.
vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn() } }));
vi.mock("@/services/metrics", () => ({
  default: { labels: vi.fn(), labelValues: vi.fn(), metadata: vi.fn() },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  generateTraceContext: () => ({ traceId: "trace-1", traceparent: "" }),
}));

import useMetricsExplorerGrid, {
  INITIAL_PAGE_SIZE,
  PAGE_SIZE_INCREMENT,
  SWEEP_DEBOUNCE_MS,
} from "./useMetricsExplorerGrid";
import StreamService from "@/services/stream";
import metricsService from "@/services/metrics";

const SERIES = {
  resultType: "matrix",
  result: [{ metric: {}, values: [[1, "1"]] }],
};
const NO_SERIES = { resultType: "matrix", result: [] };

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Lands every query ONE preview fires — not just the round in flight when it is
 * first awaited.
 *
 * A rate-based card asks a second question before it will call itself empty: its
 * first result coming back with no samples does not prove the metric is empty,
 * because `rate()` yields nothing when fewer than two samples fall inside its
 * window. So it follows up with a presence probe (`buildPresenceQuery`) — and a
 * test that answers only the first round leaves the preview awaiting a probe
 * nobody ever replies to.
 *
 * Every round gets the same `result`, so answering with `NO_SERIES` still means
 * "this metric is genuinely empty" — the probe comes back empty too.
 */
const landPreview = async (preview: Promise<any>, result: any) => {
  for (let round = 0; round < 5; round++) {
    await flush();
    if (!inFlight.length) break;
    inFlight.splice(0, inFlight.length).forEach((q) => q.complete(result));
  }
  await preview;
};

const HOUR_US = 3_600_000_000;
const NOW_US = 1_700_000_000_000_000;

describe("useMetricsExplorerGrid", () => {
  beforeEach(() => {
    inFlight.length = 0;
    localStorage.clear();
    // The deferred `fetchSchema=true` load, which the label filters trigger.
    (StreamService.nameList as any).mockResolvedValue({ data: { list: STREAMS } });
    getStreamsMock.mockResolvedValue({ list: STREAMS });
  });

  const setup = async () => {
    const grid = useMetricsExplorerGrid();
    grid.setTimeRange({ start_time: NOW_US - HOUR_US, end_time: NOW_US });
    await grid.loadStreams();
    return grid;
  };

  const cardNamed = (grid: any, name: string) =>
    grid.cards.value.find((c: any) => c.name === name)!;

  describe("the Scratchpad (favorites) narrows the grid when showFavoritesOnly is on", () => {
    it("narrows sortedCards to the pinned scratchpad set (Workspace tab)", async () => {
      const grid = await setup();
      const names = grid.cards.value.map((c: any) => c.name);
      expect(names.length).toBeGreaterThan(1);

      grid.showFavoritesOnly.value = true;
      grid.favorites.value = [names[0]]; // scratchpad pins the first
      expect(grid.sortedCards.value.map((c: any) => c.name)).toEqual([names[0]]);

      // Pinning another metric adds it to the scratchpad view.
      grid.favorites.value = [names[0], names[1]];
      expect(grid.sortedCards.value.map((c: any) => c.name).sort()).toEqual(
        [names[0], names[1]].sort(),
      );
    });
  });

  describe("a metric hidden as no-data must not stay hidden across a range change", () => {
    it("forgets what was empty when the window changes", async () => {
      // The set is self-sealing: a card in it is filtered OUT of the grid, so it
      // never renders, never re-queries, and can never clear itself. Carried
      // across a range change, a metric with nothing in the last 15 minutes
      // stayed hidden after the user widened to 30 days — which is the entire
      // reason anyone widens a window.
      const grid = await setup();

      await landPreview(
        grid.requestPreview(cardNamed(grid, "idle_metric_total")),
        NO_SERIES,
      );

      expect(grid.emptyHiddenCount.value).toBe(1);
      expect(grid.sortedCards.value.map((c: any) => c.name)).not.toContain(
        "idle_metric_total",
      );

      grid.setTimeRange({
        start_time: NOW_US - 720 * HOUR_US, // 30 days
        end_time: NOW_US,
      });

      expect(grid.emptyHiddenCount.value).toBe(0);
      expect(grid.sortedCards.value.map((c: any) => c.name)).toContain(
        "idle_metric_total",
      );
    });

    it("keeps them hidden across a refresh, which re-runs the SAME window", async () => {
      // Otherwise every auto-refresh tick would un-hide every no-data card just
      // to re-hide it a moment later, and the grid would reshuffle under the
      // user's cursor once a minute.
      const grid = await setup();

      await landPreview(
        grid.requestPreview(cardNamed(grid, "idle_metric_total")),
        NO_SERIES,
      );

      grid.setTimeRange(
        { start_time: NOW_US - HOUR_US + 5_000_000, end_time: NOW_US + 5_000_000 },
        { keepPreviews: true },
      );

      expect(grid.emptyHiddenCount.value).toBe(1);
    });
  });

  describe("changing the function must not let the previous one's result land", () => {
    it("cancels the query the override supersedes", async () => {
      // `previewKeysOf` reads `overrides.value`, so asking it for the keys to
      // cancel AFTER the override is written returns the keys of the NEW query —
      // which nothing is running yet. The superseded request would keep its slot
      // and still resolve: `requestPreview` is sitting in `await runQueries(...)`
      // on it and writes the OLD variant's results and footer label into the card.
      // It usually resolves last, too, because the new query is a cache hit (the
      // ⚙ dialog's own tile just ran it) — so the card flashed the new function
      // and then reverted to the old one.
      const grid = await setup();
      const card = cardNamed(grid, "http_requests_total");

      const first = grid.requestPreview(card);
      await flush();
      expect(inFlight).toHaveLength(1);
      const superseded = inFlight[0];
      expect(superseded.query).toContain("sum(rate("); // the default variant

      grid.setOverride("http_requests_total", { variantId: "increase" });
      await first; // resolves as cancelled — the card is not left on its skeleton

      const second = grid.requestPreview(card);
      await flush();
      const fresh = inFlight[inFlight.length - 1];
      expect(fresh.query).toContain("increase(");
      fresh.complete(SERIES);
      await second;

      expect(grid.previews.value["http_requests_total"].footerLabel).toContain(
        "increase",
      );

      // The superseded request lands LATE. It must be inert.
      superseded.complete(SERIES);
      await flush();

      // Still the function the user chose — not the one they replaced.
      expect(grid.previews.value["http_requests_total"].footerLabel).toContain(
        "increase",
      );
      expect(grid.previews.value["http_requests_total"].footerLabel).not.toContain(
        "rate",
      );
      expect(grid.previews.value["http_requests_total"].status).toBe("done");
    });
  });
  describe("a settled card is reused on re-request, not re-queried", () => {
    it("fires no new query when a done card is re-requested (scroll-back / mode toggle)", async () => {
      // The card unmounts and remounts when the Explore body is v-if'd out (e.g.
      // flipping Explore↔Visualize) or scrolled out and back. The remount
      // re-triggers requestPreview — but a card that already has a result must
      // reuse it and hit NO backend, the way a dashboard panel does on revisit.
      const grid = await setup();
      const card = cardNamed(grid, "http_requests_total");

      const first = grid.requestPreview(card);
      await flush();
      expect(inFlight).toHaveLength(1);
      inFlight[0].complete(SERIES);
      await first;
      expect(grid.previews.value["http_requests_total"].status).toBe("done");

      const before = inFlight.length;
      // Re-request (as a remount / scroll-back would) — no skipCache.
      await grid.requestPreview(card);
      await flush();
      expect(inFlight.length).toBe(before); // no new query fired

      // But a refresh (skipCache) still forces a real re-query.
      grid.requestPreview(card, { skipCache: true });
      await flush();
      expect(inFlight.length).toBe(before + 1);
    });
  });

  describe("a label can carry more than one matcher", () => {
    it("keeps both, and both reach the query", async () => {
      // `status=~"5.."` AND `status!="503"` is how you say the useful thing, and
      // PromQL accepts it. Replacing on label meant the second chip silently
      // swallowed the first and the grid filtered on something narrower than
      // what was on screen.
      const grid = await setup();

      await grid.addLabelFilter({ label: "code", value: "5..", operator: "=~" });
      await grid.addLabelFilter({ label: "code", value: "503", operator: "!=" });

      expect(grid.labelFilters.value).toHaveLength(2);

      const preview = grid.requestPreview(cardNamed(grid, "http_requests_total"));
      await flush();
      expect(inFlight[0].query).toContain('code=~"5.."');
      expect(inFlight[0].query).toContain('code!="503"');
      inFlight[0].complete(SERIES);
      await preview;
    });

    it("drops only an exact repeat of a matcher already applied", async () => {
      const grid = await setup();
      await grid.addLabelFilter({ label: "code", value: "500", operator: "=" });
      await grid.addLabelFilter({ label: "code", value: "500", operator: "=" });
      expect(grid.labelFilters.value).toHaveLength(1);
    });

    it("removes the matcher named, not every matcher on its label", async () => {
      const grid = await setup();
      const keep = { label: "code", value: "5..", operator: "=~" };
      const drop = { label: "code", value: "503", operator: "!=" };
      await grid.addLabelFilter(keep);
      await grid.addLabelFilter(drop);

      grid.removeLabelFilter(drop);

      expect(grid.labelFilters.value).toEqual([keep]);
    });
  });
  it("does not blank the grid when the schema load comes back empty", async () => {
    // An empty list is a failure that did not throw, so the catch cannot help:
    // rebuilding the cards from it replaced a working grid with nothing, on a
    // path the user only reached by touching a filter.
    const grid = await setup();
    const before = grid.cards.value.length;

    (StreamService.nameList as any).mockResolvedValueOnce({ data: { list: [] } });
    await grid.ensureSchemas();

    expect(grid.cards.value).toHaveLength(before);
  });
  describe("when the schema load gives us no membership data", () => {
    it("fails OPEN — a label filter must not blank the whole grid", async () => {
      // `schemaLoaded` is set even on failure (so it does not retry on every
      // keystroke), and the eligibility check gated on it — with an EMPTY
      // membership map behind it. Every card then failed the `labels.includes`
      // test and adding a single chip emptied the grid: no error, no
      // explanation, and the opposite of the fail-open it documents.
      const grid = await setup();
      (StreamService.nameList as any).mockRejectedValueOnce(new Error("500"));

      await grid.addLabelFilter({ label: "code", value: "500", operator: "=" });

      expect(grid.schemaLoaded.value).toBe(true); // we did stop trying...
      // ...but we do not claim a card is ineligible when we cannot know.
      // (Against the CARD count, not the stream count: the histogram base is a
      // metadata-only phantom and is suppressed, so it never becomes a card.)
      expect(grid.sortedCards.value).toHaveLength(grid.cards.value.length);
    });

    it("narrows the grid once membership IS known", async () => {
      // The safety property this exists for: the PromQL engine silently ignores
      // a matcher on a stream that lacks the label, so a card that cannot carry
      // the filter would chart unfiltered data. With real membership data, it is
      // withheld rather than charting a lie.
      const grid = await setup();
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: {
          list: STREAMS.map((stream) =>
            // Only this one is known to carry `code`; membership cannot be
            // proven for the others, so they are withheld.
            stream.name === "http_requests_total"
              ? { ...stream, schema: [{ name: "code", type: "Utf8" }] }
              : stream,
          ),
        },
      });

      await grid.addLabelFilter({ label: "code", value: "500", operator: "=" });

      expect(grid.sortedCards.value.map((c: any) => c.name)).toEqual([
        "http_requests_total",
      ]);
    });
  });

  describe("the point count a card is charted with is the one it hands off", () => {
    it("uses the card's own points by default, not the line-chart default", async () => {
      // The rate window derives from the point count, and a heatmap asks for
      // fewer points than a line. Past ~2h of range the two produce genuinely
      // different queries — so a histogram card CHARTED `[10m]` while clicking
      // through to the editor opened `[8m12s]`, and the dialog's tile could not
      // hit the cache entry the card had just filled.
      const grid = await setup();
      // 6h: long enough that the 4x-scrape floor no longer dominates.
      grid.setTimeRange({ start_time: NOW_US - 6 * HOUR_US, end_time: NOW_US });

      const histogram = { ...cardNamed(grid, "http_requests_total"), chartType: "heatmap" };

      // What the default resolves to must equal what the preview path uses.
      const byDefault = grid.effectiveVariant(histogram).resolved.queries[0].expr;
      const asCharted = grid.effectiveVariant(histogram, 40).resolved.queries[0].expr;
      const asLine = grid.effectiveVariant(histogram, 50).resolved.queries[0].expr;

      expect(byDefault).toBe(asCharted);
      expect(asCharted).not.toBe(asLine); // the two really do differ at 6h
    });
  });

  describe("housekeeping", () => {
    it("re-adding an applied filter changes nothing, including the order", async () => {
      const grid = await setup();
      const first = { label: "code", value: "500", operator: "=" };
      const second = { label: "job", value: "api", operator: "=" };
      await grid.addLabelFilter(first);
      await grid.addLabelFilter(second);

      await grid.addLabelFilter({ ...first }); // an exact repeat

      // Not [second, first] — the chip must not shuffle to the end.
      expect(grid.labelFilters.value).toEqual([first, second]);
    });
  });
  describe("an info metric", () => {
    it("previews as a COUNT of its series, not as nothing at all", async () => {
      // Its payload is its labels and its value is always 1, so the chart worth
      // drawing is how many of them there are. This card used to request no
      // preview at all and sat on a loading skeleton forever — a grey box for
      // every `*_info` metric in the org.
      const grid = await setup();

      const preview = grid.requestPreview(cardNamed(grid, "target_info"));
      await flush();
      expect(inFlight[0].query).toBe('count({__name__="target_info"})');
      inFlight[0].complete(SERIES);
      await preview;

      expect(grid.previews.value["target_info"].status).toBe("done");
      expect(grid.previews.value["target_info"].chartType).toBe("line");
    });

    it("says so when the effective variant is one a card cannot draw", async () => {
      // The label table, chosen from the ⚙ dialog. A card renders through
      // ECharts, which does not draw a table — so rather than silently skipping
      // the preview (which left the card on its skeleton), it reports the state
      // and the card tells the user to open it in the editor.
      const grid = await setup();
      grid.setOverride("target_info", { variantId: "series" });

      await grid.requestPreview(cardNamed(grid, "target_info"));

      expect(grid.previews.value["target_info"].status).toBe("unavailable");
      expect(inFlight).toHaveLength(0); // and it costs no query
    });
  });
  describe("the rate window: concrete for a card, a variable for a panel", () => {
    it("executes previews with a resolved window", async () => {
      // The explorer calls the search API directly; nothing substitutes
      // variables for it, so a `$__rate_interval` in a preview query would reach
      // the backend verbatim and fail to parse.
      const grid = await setup();

      const preview = grid.requestPreview(cardNamed(grid, "http_requests_total"));
      await flush();

      // A concrete PromQL duration (`1m27s`, `4m`, …) — never a template token.
      expect(inFlight[0].query).toMatch(/\[(\d+[hms])+\]/);
      expect(inFlight[0].query).not.toContain("$__rate_interval");
      inFlight[0].complete(SERIES);
      await preview;
    });

    it("hands the PANEL the variable instead", async () => {
      // A panel resolves `$__rate_interval` against its own range and pixel
      // width (usePanelVariableSubstitution), every PromQL query goes through
      // that substitution, and the builder's own rate() defaults to the same
      // token. Baking the card's window into the panel froze it at whatever the
      // range was at the moment of the click.
      const grid = await setup();
      const card = cardNamed(grid, "http_requests_total");

      const forPanel = grid.effectiveVariant(card, undefined, {
        rateWindow: "$__rate_interval",
      });

      expect(forPanel.resolved.queries[0].expr).toContain("[$__rate_interval]");
      expect(forPanel.resolved.queries[0].builder.operations[0]).toEqual({
        id: "rate",
        params: ["$__rate_interval"],
      });
    });
  });
  describe("the rate window comes from the ORG's scrape interval", () => {
    /** What usePanelVariableSubstitution computes for a panel. */
    const panelRateInterval = (rangeSeconds: number, scrape: number, widthPx = 1000) =>
      Math.max(Math.round(rangeSeconds / widthPx) + scrape, 4 * scrape);

    it("resolves the same window the panel would, at the same scrape interval", async () => {
      // The card charted `[4m]` while the editor it drilled into charted `[1m]`,
      // because the card assumed a 60s scrape while the panel used the org's 15s.
      // Same metric, same range, different smoothing — and the drill-in is
      // supposed to be what you clicked.
      storeState.organizationData.organizationSettings.scrape_interval = 15;
      const grid = await setup();
      grid.setTimeRange({ start_time: NOW_US - HOUR_US / 4, end_time: NOW_US }); // 15m

      const preview = grid.requestPreview(cardNamed(grid, "http_requests_total"));
      await flush();

      // 15 minutes, scrape 15s => max(step + 15, 60) => 60s.
      expect(panelRateInterval(900, 15)).toBe(60);
      expect(inFlight[0].query).toContain("[1m]");
      inFlight[0].complete(SERIES);
      await preview;
    });

    it("follows the org when it declares a slower scrape", async () => {
      storeState.organizationData.organizationSettings.scrape_interval = 60;
      const grid = await setup();
      grid.setTimeRange({ start_time: NOW_US - HOUR_US / 4, end_time: NOW_US });

      const preview = grid.requestPreview(cardNamed(grid, "http_requests_total"));
      await flush();

      expect(panelRateInterval(900, 60)).toBe(240);
      expect(inFlight[0].query).toContain("[4m]");
      inFlight[0].complete(SERIES);
      await preview;

      storeState.organizationData.organizationSettings.scrape_interval = 15;
    });
  });
  describe("the no-data filter must not cause a query storm", () => {
    /**
     * Hiding empty cards is a POST-query filter — a card must be queried before we
     * know it is empty. If the page slice is taken from the already-hidden list,
     * every card removed as empty pulls a fresh one into the window, which queries,
     * which may also be empty... On a sparse org that cascade walks the whole metric
     * list: a "30 card" page quietly firing hundreds of queries, which is exactly
     * the cost the page size exists to bound.
     */
    const sparseOrg = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `metric_${String(i).padStart(4, "0")}_total`,
        stream_type: "metrics",
        metrics_meta: {
          metric_type: "Counter",
          metric_family_name: `metric_${String(i).padStart(4, "0")}_total`,
          help: "",
          unit: "",
        },
        stats: { doc_num: 100 },
      }));

    it("never renders more than the page size, however many come back empty", async () => {
      getStreamsMock.mockResolvedValue({ list: sparseOrg(500) });

      const grid = useMetricsExplorerGrid();
      grid.setTimeRange({ start_time: NOW_US - HOUR_US, end_time: NOW_US });
      await grid.loadStreams();

      expect(grid.pagedCards.value).toHaveLength(INITIAL_PAGE_SIZE);

      // Every card on the page comes back empty — the worst case.
      const page = [...grid.pagedCards.value];
      for (const card of page) {
        await landPreview(grid.requestPreview(card), NO_SERIES);
        inFlight.length = 0;
      }

      // The page is now EMPTY (all 30 hidden) — it must not have refilled itself
      // from the other 470 metrics.
      expect(grid.pagedCards.value).toHaveLength(0);
      // ...and the budget is untouched: no card outside the first 30 was pulled in.
      expect(grid.pageSlice.value).toHaveLength(INITIAL_PAGE_SIZE);
      expect(grid.pageSlice.value.map((c: any) => c.name)).toEqual(
        page.map((c: any) => c.name),
      );
    });

    it("showMore is how the user asks to spend more budget", async () => {
      getStreamsMock.mockResolvedValue({ list: sparseOrg(500) });
      const grid = useMetricsExplorerGrid();
      grid.setTimeRange({ start_time: NOW_US - HOUR_US, end_time: NOW_US });
      await grid.loadStreams();

      // With empties shown there is nothing to look ahead for: the bump is
      // immediate and exact.
      grid.hideEmptyPanels.value = false;
      expect(grid.pageSlice.value).toHaveLength(INITIAL_PAGE_SIZE);
      grid.showMore();
      expect(grid.pageSlice.value).toHaveLength(
        INITIAL_PAGE_SIZE + PAGE_SIZE_INCREMENT,
      );
    });

    // A budget bump of PAGE_SIZE_INCREMENT can land entirely on cards that turn
    // out empty and get hidden — the grid does not grow and the click looks
    // dead. So with the filter on, showMore keeps spending until the visible
    // grid has grown by a full increment, stepping over the no-data run.
    it("Show more steps over no-data cards so a click reveals a full page", async () => {
      getStreamsMock.mockResolvedValue({ list: sparseOrg(500) });
      const grid = useMetricsExplorerGrid();
      grid.setTimeRange({ start_time: NOW_US - HOUR_US, end_time: NOW_US });
      await grid.loadStreams();

      // Everything past the first page is empty until index 54 — two full
      // increments' worth — then data resumes.
      const emptyIndex = (name: string) => {
        const i = Number(name.match(/metric_(\d+)_total/)![1]);
        return i >= INITIAL_PAGE_SIZE && i < INITIAL_PAGE_SIZE + 24;
      };

      // The first page renders unqueried, so a click asks for PAGE_SIZE_INCREMENT
      // more on top.
      expect(grid.pagedCards.value).toHaveLength(INITIAL_PAGE_SIZE);
      const target = INITIAL_PAGE_SIZE + PAGE_SIZE_INCREMENT;

      const done = grid.showMore();
      // Drive each look-ahead batch's queries as showMore pulls them. A generous
      // fixed number of flushes — this is the harness draining batches, not the
      // increment, so it must not be tied to PAGE_SIZE_INCREMENT.
      for (let i = 0; i < 24; i++) {
        await flush();
        // Mid-flight the budget is untouched: the look-ahead resolves BEFORE
        // the commit, so the grid grows once — not batch by batch — and the
        // count never ticks back down as empties resolve.
        if (grid.showingMore.value)
          expect(grid.pageSlice.value).toHaveLength(INITIAL_PAGE_SIZE);
        if (!inFlight.length) continue;
        inFlight.forEach((q) => {
          const m = q.query.match(/metric_(\d+)_total/);
          q.complete(m && emptyIndex(m[0]) ? NO_SERIES : SERIES);
        });
        inFlight.length = 0;
      }
      await done;

      // The grid grew by a full increment...
      expect(grid.pagedCards.value).toHaveLength(target);
      // ...and it had to spend past the two empty batches to get there.
      expect(grid.pageSlice.value.length).toBeGreaterThan(target);
    });
  });
  describe("an org switch must not be polluted by the previous org", () => {
    it("drops a stream response that lands after the switch", async () => {
      // The requests are indistinguishable once they land — only a generation
      // counter knows which org asked. Without it the old org's cards install
      // themselves, get queried against the NEW org, and poison its cache.
      const grid = await setup();
      expect(grid.cards.value.map((c: any) => c.name)).toContain("target_info");

      // A slow response from the org we are leaving.
      let releaseOldOrg!: (v: any) => void;
      getStreamsMock.mockReturnValueOnce(
        new Promise((resolve) => {
          releaseOldOrg = resolve;
        }),
      );
      const inFlightLoad = grid.loadStreams(true);

      grid.onOrgChange(); // the user switches org mid-flight

      releaseOldOrg({ list: [{ name: "ghost_from_old_org", stream_type: "metrics", metrics_meta: { metric_type: "Counter" }, stats: { doc_num: 1 } }] });
      await inFlightLoad;

      expect(grid.cards.value.map((c: any) => c.name)).not.toContain(
        "ghost_from_old_org",
      );
    });
  });

  describe("a cleared state must stay cleared", () => {
    it("does not resurrect the previous org's chart when a request is cancelled by the switch", async () => {
      // `requestPreview` keeps the preview it is REPLACING so that a cancelled
      // request can put the old chart back instead of leaving a skeleton. But a
      // bulk clear is what CANCELS those requests: `onOrgChange` empties the map
      // and then aborts everything in flight, so every abort ran the restore and
      // wrote its stale preview back into the map that had just been emptied.
      const grid = await setup();
      const card = cardNamed(grid, "http_requests_total");

      // A card with a chart on screen...
      const first = grid.requestPreview(card);
      await flush();
      inFlight.forEach((q) => q.complete(SERIES));
      await first;
      expect(grid.previews.value["http_requests_total"]?.status).toBe("done");
      inFlight.length = 0;

      // ...is refreshed, and the user switches org while that is in flight.
      const second = grid.requestPreview(card, { skipCache: true });
      await flush();
      grid.onOrgChange();
      await second;
      await flush();

      // The new org starts with an empty grid, not with the old org's charts.
      expect(grid.previews.value["http_requests_total"]).toBeUndefined();
    });

    it("does not repaint the old window's data when the range changes mid-flight", async () => {
      const grid = await setup();
      const card = cardNamed(grid, "http_requests_total");

      const first = grid.requestPreview(card);
      await flush();
      inFlight.forEach((q) => q.complete(SERIES));
      await first;
      inFlight.length = 0;

      const second = grid.requestPreview(card, { skipCache: true });
      await flush();
      grid.setTimeRange({ start_time: NOW_US - 24 * HOUR_US, end_time: NOW_US });
      await second;
      await flush();

      expect(grid.previews.value["http_requests_total"]).toBeUndefined();
    });
  });

  describe("the label-value cache is a property of the window", () => {
    it("is dropped when the window changes, rather than growing a stale entry per range", async () => {
      // Its key embeds the time range, so nothing ever hit a stale entry — the
      // entries just accumulated, one per label per window, for the life of the
      // page. And they are wrong to keep anyway: `job`'s values over 15 minutes
      // are not its values over 30 days.
      const grid = await setup();
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: {
          list: STREAMS.map((x) => ({
            ...x,
            schema: [{ name: "job", type: "Utf8" }],
          })),
        },
      });
      await grid.ensureSchemas();
      (metricsService.labelValues as any).mockResolvedValue({
        data: { data: ["api"] },
      });

      expect(await grid.loadLabelValues("job")).toEqual(["api"]);
      const callsAfterFirst = (metricsService.labelValues as any).mock.calls
        .length;

      // Same window: answered from cache, no second request.
      await grid.loadLabelValues("job");
      expect((metricsService.labelValues as any).mock.calls.length).toBe(
        callsAfterFirst,
      );

      // New window: the cache is gone, so it asks again — and serves the NEW
      // window's answer. (Asserting "it asked again" would have proved nothing
      // while the window was part of the key: a new window was a new key, so it
      // re-asked whether or not anything was ever dropped. What the old code
      // actually did was keep the old entry forever, unreachable.)
      (metricsService.labelValues as any).mockResolvedValue({
        data: { data: ["web"] },
      });
      grid.setTimeRange({ start_time: NOW_US - 24 * HOUR_US, end_time: NOW_US });

      expect(await grid.loadLabelValues("job")).toEqual(["web"]);
      expect(
        (metricsService.labelValues as any).mock.calls.length,
      ).toBeGreaterThan(callsAfterFirst);
    });

    it("re-asks for the label NAMES on a new window, as it does for the values", async () => {
      // `labels` is asked over `start_time`/`end_time`, so the set of labels that
      // exist is a property of the window: a label carried only by a job that ran
      // last week is absent from a 15-minute window and present in a 30-day one.
      //
      // The names were fetched once and then never again — the guard was "do I
      // already have any?" — so the picker kept serving the first window's answer
      // for the life of the page. Widening the range to go looking for a label
      // left the label still missing, which is the one thing widening is for.
      const grid = await setup();

      (metricsService.labels as any).mockResolvedValue({
        data: { data: ["job"] },
      });
      await grid.loadLabelNames();
      expect(grid.labelNames.value).toEqual(["job"]);

      const callsAfterFirst = (metricsService.labels as any).mock.calls.length;

      // Same window: already answered, so it must not ask again.
      await grid.loadLabelNames();
      expect((metricsService.labels as any).mock.calls.length).toBe(
        callsAfterFirst,
      );

      // A wider window exposes a label the narrow one never saw.
      (metricsService.labels as any).mockResolvedValue({
        data: { data: ["job", "pod"] },
      });
      grid.setTimeRange({
        start_time: NOW_US - 30 * 24 * HOUR_US,
        end_time: NOW_US,
      });

      await grid.loadLabelNames();
      expect((metricsService.labels as any).mock.calls.length).toBeGreaterThan(
        callsAfterFirst,
      );
      expect(grid.labelNames.value).toEqual(["job", "pod"]);
    });

    it("widens the window when the backend answers success-but-empty", async () => {
      // The label index lags ingestion: a short recent window answers
      // `{status:"success", data:[]}` while a wider ask over the same org
      // returns hundreds of labels. Believing the windowed emptiness left the
      // picker at "No options found".
      const grid = await setup();

      (metricsService.labels as any).mockClear();
      (metricsService.labels as any)
        .mockResolvedValueOnce({ data: { data: [] } })
        .mockResolvedValueOnce({ data: { data: ["job", "pod"] } });

      await grid.loadLabelNames();

      const calls = (metricsService.labels as any).mock.calls;
      expect(calls.length).toBe(2);
      // The second ask reaches further back than the first.
      expect(calls[1][0].start_time).toBeLessThan(calls[0][0].start_time);
      expect(calls[1][0].end_time).toBe(calls[0][0].end_time);
      expect(grid.labelNames.value).toEqual(["job", "pod"]);
    });

    it("falls back to a bounded 30-day window when the widened window is empty", async () => {
      const grid = await setup();

      (metricsService.labels as any).mockClear();
      (metricsService.labels as any)
        .mockResolvedValueOnce({ data: { data: [] } })
        .mockResolvedValueOnce({ data: { data: [] } })
        .mockResolvedValueOnce({ data: { data: ["job"] } });

      await grid.loadLabelNames();

      const calls = (metricsService.labels as any).mock.calls;
      expect(calls.length).toBe(3);
      // Always bounded — an unbounded ask (`start=0` or an omitted range) makes
      // the backend scan the whole file list, which it rejects or 502s.
      expect(calls[2][0].start_time).toBeGreaterThan(0);
      expect(calls[2][0].start_time).toBeLessThan(calls[1][0].start_time);
      expect(grid.labelNames.value).toEqual(["job"]);
    });

    it("walks past a rung that errors instead of giving up", async () => {
      const grid = await setup();

      (metricsService.labels as any).mockClear();
      (metricsService.labels as any)
        .mockResolvedValueOnce({ data: { data: [] } })
        .mockRejectedValueOnce(new Error("502"))
        .mockResolvedValueOnce({ data: { data: ["job"] } });

      await grid.loadLabelNames();

      expect((metricsService.labels as any).mock.calls.length).toBe(3);
      expect(grid.labelNames.value).toEqual(["job"]);
      // The failure was a rung, not the answer: loading is settled.
      expect(grid.labelNamesLoading.value).toBe(false);
    });

    it("ignores a label-name response that lands after the window moved on", async () => {
      // Dropping the list alone would not be enough: a request already in flight
      // for the OLD window lands afterwards and repopulates it with exactly the
      // stale answer we were trying to be rid of.
      const grid = await setup();

      let resolveStale: (v: any) => void = () => {};
      (metricsService.labels as any).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
      );

      const inFlightLoad = grid.loadLabelNames(); // for the CURRENT window

      grid.setTimeRange({
        start_time: NOW_US - 30 * 24 * HOUR_US,
        end_time: NOW_US,
      });

      resolveStale({ data: { data: ["stale-label"] } });
      await inFlightLoad;

      expect(grid.labelNames.value).toEqual([]);
    });
  });

  describe("hiding no-data cards must not depend on the user scrolling to them", () => {
    const names = (grid: any) =>
      grid.sortedCards.value.map((c: any) => c.name);

    /**
     * Answer everything the queue lets through, until it lets nothing more
     * through. The queue runs PREVIEW_CONCURRENCY at a time, so a sweep of the
     * slice arrives in batches — replying to only the first one leaves the rest
     * of the slice sitting in `waiting`, unanswered.
     */
    const drain = async (result: any) => {
      for (let round = 0; round < 20 && inFlight.length; round++) {
        const batch = inFlight.splice(0, inFlight.length);
        batch.forEach((q) => q.complete(result));
        await flush();
      }
    };

    /** Query `name` and answer with nothing, so it is known empty and hidden. */
    const hideAsEmpty = async (grid: any, name: string) => {
      await landPreview(grid.requestPreview(cardNamed(grid, name)), NO_SERIES);
      inFlight.length = 0;
      expect(names(grid)).not.toContain(name);
    };

    it("resolves the WHOLE slice, so an empty card the user never scrolled to is still hidden", async () => {
      // Emptiness is a POST-query fact, and the only thing that ever queried a
      // card was its own IntersectionObserver. So a card below the fold was
      // never queried, therefore never known empty, therefore SHOWN — and it
      // stayed shown until the user scrolled to it, at which point it vanished
      // under their cursor. On a fresh load that is every no-data card on the
      // page.
      const grid = await setup();
      expect(names(grid)).toContain("idle_metric_total"); // nothing known yet

      grid.sweepSlice(); // nobody scrolled anywhere
      await flush();
      await drain(NO_SERIES);

      expect(names(grid)).not.toContain("idle_metric_total");
    });

    it("a manual refresh does NOT put a still-empty card back on screen", async () => {
      // The reported bug. Refresh used to clear the whole set, which un-hid
      // every no-data card in the slice — so turning "hide no-data panels" on
      // and hitting refresh filled the grid with no-data panels.
      const grid = await setup();
      await hideAsEmpty(grid, "idle_metric_total");

      grid.sweepSlice({ skipCache: true });

      // Not even for an instant, and not while the answer is outstanding.
      expect(names(grid)).not.toContain("idle_metric_total");
      await flush();
      expect(names(grid)).not.toContain("idle_metric_total");

      await drain(NO_SERIES); // still nothing
      expect(names(grid)).not.toContain("idle_metric_total");
    });

    it("but a metric that HAS started emitting comes back", async () => {
      // The whole point of re-asking. This is what the old clear-the-set
      // approach was reaching for; it just showed the card before it had an
      // answer instead of after.
      const grid = await setup();
      await hideAsEmpty(grid, "idle_metric_total");

      grid.sweepSlice({ skipCache: true });
      await flush();
      expect(inFlight.length).toBeGreaterThan(0); // it really did re-ask
      await drain(SERIES);

      expect(names(grid)).toContain("idle_metric_total");
    });

    it("asks for nothing while the filter is off", async () => {
      // With the filter off, emptiness changes nothing about what is displayed,
      // so there is no reason to buy the answer — the lazy per-card load already
      // covers what the user can see.
      const grid = await setup();
      grid.hideEmptyPanels.value = false;

      await new Promise((r) => setTimeout(r, SWEEP_DEBOUNCE_MS + 50));
      inFlight.length = 0;

      grid.sweepSlice();
      await flush();

      expect(inFlight).toHaveLength(0);
    });
  });
  describe("an empty rate() is not proof of an empty metric", () => {
    const names = (grid: any) =>
      grid.sortedCards.value.map((c: any) => c.name);

    /** Answers each round of one preview's queries with a different result. */
    const landRounds = async (preview: Promise<any>, ...rounds: any[]) => {
      for (const result of rounds) {
        await flush();
        inFlight.splice(0, inFlight.length).forEach((q) => q.complete(result));
      }
      await flush();
      await preview;
    };

    it("keeps a populated metric whose rate() came back empty, and says why", async () => {
      // The reported bug. `rate()` needs TWO samples inside its window to compute
      // a delta, so a metric scraped once — or scraped less often than the window
      // is wide — yields NOTHING from a rate-based card while its samples sit
      // right there in the selected range. That empty result was taken as proof
      // the metric was empty, and the "With data" filter (whose contract is
      // literally "only metrics with data in the selected time range") hid it.
      const grid = await setup();

      // Round 1: the card's own `sum(rate(...))` — empty.
      // Round 2: the presence probe — the metric is right there.
      await landRounds(
        grid.requestPreview(cardNamed(grid, "lat_seconds_count")),
        NO_SERIES,
        SERIES,
      );

      expect(names(grid)).toContain("lat_seconds_count");
      expect(grid.emptyHiddenCount.value).toBe(0);
      // Not "No data": the card says what is actually wrong with it.
      expect(grid.previews.value["lat_seconds_count"].sparse).toBe(true);
    });

    it("so a histogram with real data never renders NO card at all", async () => {
      // The failure this all adds up to. A Prometheus histogram's base stream is
      // a metadata-only phantom that carries no series of its own, so it is
      // suppressed and never becomes a card. Every card the histogram HAS is one
      // of its rate-based components — so once each was hidden as "empty", the
      // whole histogram vanished from the product and its data was unreachable.
      const grid = await setup();

      expect(grid.cards.value.map((c: any) => c.name)).not.toContain(
        "lat_seconds",
      ); // the phantom base: correctly suppressed, so the components are all there is

      for (const member of ["lat_seconds_bucket", "lat_seconds_count"]) {
        await landRounds(
          grid.requestPreview(cardNamed(grid, member)),
          NO_SERIES,
          SERIES,
        );
      }

      expect(names(grid)).toEqual(
        expect.arrayContaining(["lat_seconds_bucket", "lat_seconds_count"]),
      );
    });

    it("probes for presence, not for a rate", async () => {
      const grid = await setup();
      const preview = grid.requestPreview(cardNamed(grid, "lat_seconds_count"));

      await flush();
      inFlight.splice(0, inFlight.length).forEach((q) => q.complete(NO_SERIES));
      await flush();

      // A yes/no question, asked of the stream the card actually reads — and
      // asked WITHOUT `rate()`, which is the whole point.
      expect(inFlight.map((q) => q.query)).toEqual([
        'count({__name__="lat_seconds_count"})',
      ]);

      inFlight.splice(0, inFlight.length).forEach((q) => q.complete(SERIES));
      await preview;
    });

    it("still hides a metric the probe agrees is empty", async () => {
      // The filter has to keep doing its job: an idle counter is still an idle
      // counter, and the grid must not fill up with no-data panels.
      const grid = await setup();

      await landRounds(
        grid.requestPreview(cardNamed(grid, "idle_metric_total")),
        NO_SERIES,
        NO_SERIES,
      );

      expect(names(grid)).not.toContain("idle_metric_total");
      expect(grid.previews.value["idle_metric_total"].sparse).toBe(false);
    });

    it("never probes a metric that has never been written to", async () => {
      // The long tail the "With data" filter EXISTS for. `doc_num` already
      // settles those from the stream list, for free — buying a second query per
      // card to re-confirm what we were just told would double the cost of
      // exactly the case the filter is an optimisation for.
      getStreamsMock.mockResolvedValue({
        list: [
          {
            name: "never_written_total",
            stream_type: "metrics",
            metrics_meta: {
              metric_type: "Counter",
              metric_family_name: "never_written_total",
              help: "",
              unit: "",
            },
            stats: { doc_num: 0 },
          },
        ],
      });
      const grid = useMetricsExplorerGrid();
      grid.setTimeRange({ start_time: NOW_US - HOUR_US, end_time: NOW_US });
      await grid.loadStreams();

      const preview = grid.requestPreview(
        cardNamed(grid, "never_written_total"),
      );
      await flush();
      inFlight.splice(0, inFlight.length).forEach((q) => q.complete(NO_SERIES));
      await flush();

      expect(inFlight).toHaveLength(0); // no probe
      await preview;
      expect(names(grid)).not.toContain("never_written_total");
    });

    it("never probes a rate-free card, whose empty result IS conclusive", async () => {
      // `avg()` over a populated gauge cannot come back empty. If it did, the
      // metric really has nothing in the window, and there is nothing to ask.
      const grid = await setup();

      const preview = grid.requestPreview(cardNamed(grid, "cpu_temperature"));
      await flush();
      inFlight.splice(0, inFlight.length).forEach((q) => q.complete(NO_SERIES));
      await flush();

      expect(inFlight).toHaveLength(0);
      await preview;
      expect(names(grid)).not.toContain("cpu_temperature");
    });
  });

  describe("label eligibility must follow the EFFECTIVE variant", () => {
    it("re-checks operands when a ⚙ override changes which stream is queried", async () => {
      // The PromQL engine silently IGNORES a matcher on a stream that lacks the
      // label, so a card whose query reads a stream without it would chart
      // UNFILTERED data under an active filter chip. Eligibility was computed from
      // the card kind's default operands — but an override changes them: a
      // histogram switched to "Rate of count" queries `lat_seconds_count`, not
      // `lat_seconds_bucket`.
      const grid = await setup();

      // Only the BUCKET carries `le`; the count sibling does not.
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: {
          list: STREAMS.map((stream) =>
            stream.name === "lat_seconds_bucket"
              ? { ...stream, schema: [{ name: "le", type: "Utf8" }] }
              : { ...stream, schema: [{ name: "pod", type: "Utf8" }] },
          ),
        },
      });

      await grid.addLabelFilter({ label: "le", value: "0.5", operator: "=" });

      // The default histogram variant reads X_bucket, which HAS `le` -> eligible.
      expect(grid.sortedCards.value.map((c: any) => c.name)).toContain(
        "lat_seconds_bucket",
      );

      // Override it to the count line, which reads X_count — no `le` there.
      grid.setOverride("lat_seconds_bucket", { variantId: "count-rate" });

      expect(grid.sortedCards.value.map((c: any) => c.name)).not.toContain(
        "lat_seconds_bucket",
      );
    });
  });
  describe("an org switch must not deadlock the deferred loads", () => {
    it("does not strand schemaLoading at true forever", async () => {
      // `ensureSchemas` early-returns while `schemaLoading` is true, and its
      // `finally` only clears the flag when the generation still matches — which,
      // after an org switch, it never will. Strand that flag and label membership
      // never loads AGAIN for the life of the page: the filters fail open forever
      // and the grid silently stops narrowing. A deadlock created by the very
      // guard that stops cross-org pollution.
      const grid = await setup();

      let releaseOldOrg!: (v: any) => void;
      (StreamService.nameList as any).mockReturnValueOnce(
        new Promise((resolve) => {
          releaseOldOrg = resolve;
        }),
      );
      const inFlight = grid.ensureSchemas();

      grid.onOrgChange(); // switch mid-flight
      expect(grid.schemaLoading.value).toBe(false); // the guard is clear again

      releaseOldOrg({ data: { list: [] } });
      await inFlight;

      // ...and the new org can actually load its membership.
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: { list: STREAMS.map((x) => ({ ...x, schema: [{ name: "pod", type: "Utf8" }] })) },
      });
      await grid.ensureSchemas();

      expect(grid.schemaLoaded.value).toBe(true);
      expect(grid.schemaLoading.value).toBe(false);
    });
  });

  describe("label-value suggestions", () => {
    it("does not cache 'no values' when every request failed", async () => {
      // An empty union after a wholly failed fan-out means we learned NOTHING, not
      // that the label has no values. Caching it suppressed that label's
      // suggestions for the rest of the session on one transient error.
      const grid = await setup();
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: {
          list: STREAMS.map((x) => ({ ...x, schema: [{ name: "pod", type: "Utf8" }] })),
        },
      });
      await grid.ensureSchemas();

      (metricsService.labelValues as any).mockRejectedValue(new Error("boom"));
      expect(await grid.loadLabelValues("pod")).toEqual([]);

      // The transient failure passes; the next ask must really ask.
      (metricsService.labelValues as any).mockResolvedValue({
        data: { data: ["api-1", "api-2"] },
      });
      expect(await grid.loadLabelValues("pod")).toEqual(["api-1", "api-2"]);
    });

    it("widens the window when the fan-out answers success-but-empty", async () => {
      // Same index lag as the label names: a short recent window answers empty
      // with success, and the empty union used to get CACHED — suppressing the
      // label's suggestions for the whole session.
      const grid = await setup();
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: {
          list: STREAMS.map((x) => ({ ...x, schema: [{ name: "pod", type: "Utf8" }] })),
        },
      });
      await grid.ensureSchemas();

      const seen: Array<{ start: number; end: number }> = [];
      (metricsService.labelValues as any).mockImplementation((args: any) => {
        seen.push({ start: args.start_time, end: args.end_time });
        // First (windowed) round: success, no values. Later rounds: values.
        return Promise.resolve({
          data: { data: seen[0].start === args.start_time ? [] : ["api-1"] },
        });
      });

      expect(await grid.loadLabelValues("pod")).toEqual(["api-1"]);
      // The retry reached further back than the first ask.
      const starts = [...new Set(seen.map((s) => s.start))];
      expect(starts.length).toBeGreaterThan(1);
      expect(Math.min(...starts)).toBeLessThan(starts[0]);
    });

    it("awaits an in-flight schema load instead of answering from an empty map", async () => {
      // `ensureSchemas` used to return void while a load was in flight. The
      // values fan-out awaits it precisely to read `labelsByStream` on the next
      // line — so the early return handed it an empty map, no streams matched,
      // and `[]` was cached as the label's answer for the whole session.
      const grid = await setup();

      let releaseSchemas!: (v: any) => void;
      (StreamService.nameList as any).mockReturnValueOnce(
        new Promise((resolve) => {
          releaseSchemas = resolve;
        }),
      );

      // First caller starts the load…
      const first = grid.ensureSchemas();

      (metricsService.labelValues as any).mockClear();
      (metricsService.labelValues as any).mockResolvedValue({
        data: { data: ["api-1"] },
      });

      // …and the second must WAIT for it, not run against {}.
      const values = grid.loadLabelValues("pod");

      releaseSchemas({
        data: {
          list: STREAMS.map((x) => ({ ...x, schema: [{ name: "pod", type: "Utf8" }] })),
        },
      });
      await first;

      expect(await values).toEqual(["api-1"]);
      // It really fanned out — the bug's signature was zero labelValues calls.
      expect(
        (metricsService.labelValues as any).mock.calls.length,
      ).toBeGreaterThan(0);
    });

    it("keeps label values out of the chart-result cache", async () => {
      // The preview LRU is sized for chart data. A 5-way label fan-out pushing five
      // entries into it evicts five cards' worth of results — and label values have
      // their own cache anyway.
      const grid = await setup();
      (StreamService.nameList as any).mockResolvedValueOnce({
        data: {
          list: STREAMS.map((x) => ({ ...x, schema: [{ name: "pod", type: "Utf8" }] })),
        },
      });
      await grid.ensureSchemas();
      (metricsService.labelValues as any).mockResolvedValue({
        data: { data: ["api-1"] },
      });

      await grid.loadLabelValues("pod");

      // A card's preview must still be a cache MISS — nothing evicted it, and the
      // label values did not take its slot.
      const preview = grid.requestPreview(cardNamed(grid, "http_requests_total"));
      await flush();
      expect(inFlight.length).toBeGreaterThan(0); // it really queried
      inFlight.forEach((q) => q.complete(SERIES));
      await preview;
    });
  });
  describe("the declared unit must survive into the preview", () => {
    it("charts a Cel gauge as celsius, not as a bare number", async () => {
      // `effectiveVariant` passed `undefined` as the declared unit, so the preview
      // re-derived the unit from the metric NAME alone — and the card prefers
      // `preview.unit` over `card.unit`, so the family-joined answer was the one
      // the user never saw. A rule-set test cannot catch this: the rule set was
      // always right, the grid just did not ask it the question.
      const grid = await setup();
      const card = cardNamed(grid, "cpu_temperature");

      expect(card.declaredUnit).toBe("Cel");
      expect(card.unit).toBe("celsius");

      const { resolved } = grid.effectiveVariant(card);
      expect(resolved.unit).toBe("celsius"); // ...and so does what the chart uses
    });
  });
});
