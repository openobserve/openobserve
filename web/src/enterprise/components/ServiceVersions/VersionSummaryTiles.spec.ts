// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import en from "@/locales/languages/en-US.json";
import type { CompareResponse, MetricDelta } from "@/services/service_versions";
import Tiles from "./VersionSummaryTiles.vue";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import {
  buildTiles,
  formatDuration,
  formatMetric,
  formatPoints,
  formatSpan,
  formatWindow,
  percentChange,
  shortWindow,
} from "./VersionSummaryTiles.format";
import { whereText } from "@/utils/serviceVersionsCopy";
function translate(key: string, params: Record<string, unknown> = {}) {
  const text = key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
  return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
const t = translate as never;
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: translate }),
}));
const delta = (value: Partial<MetricDelta>): MetricDelta => ({
  a: null,
  b: null,
  delta: null,
  lo: null,
  hi: null,
  ci_kind: "variance",
  insufficient: false,
  ...value,
});
function response(overrides: Partial<CompareResponse> = {}): CompareResponse {
  return {
    service: "web-app",
    where_key: "k8s:c1/web",
    env: "prod",
    mode: "sequential",
    aliases_applied: [],
    arms: {
      a: { version: "0.50.0", start_time: 0, end_time: 1 },
      b: { version: "0.49.2", start_time: 0, end_time: 1 },
    },
    baseline_rule: "previous",
    notes: [],
    traces: {
      status: "complete",
      requests: { a: 22100, b: 20900, rate_a: 221 / 60, rate_b: 209 / 60 },
      error_rate: delta({ a: 0.0118, b: 0.0042, delta: 0.0076, lo: 0.0051, hi: 0.0102 }),
      p95: delta({ a: 241000, b: 212000, delta: 29000, lo: 13144, hi: 46428 }),
      p99: delta({ a: 655000, b: 640000, delta: 15000, lo: -1000, hi: 30000 }),
    },
    ...overrides,
  };
}
describe("summary tile formatting", () => {
  it("formats latency from microseconds and rates as percentages", () => {
    expect(formatMetric("p95", 212000, t)).toBe("212 ms");
    expect(formatMetric("p99", 2600000, t)).toBe("2.6 s");
    expect(formatMetric("error_rate", 0.0042, t)).toBe("0.42%");
    expect(formatMetric("lcp_p75", 1.6609535575144478, t)).toBe("1.66 s");
    expect(formatMetric("inp_p75", 168, t)).toBe("168 ms");
    expect(formatMetric("cls_p75", 0.1, t)).toBe("0.100");
    expect(formatMetric("p95", null, t)).toBe("—");
  });
  it("labels wheres readably and never as raw keys", () => {
    expect(whereText("k8s:c1/web", null, t)).toBe("c1 · web");
    expect(whereText("k8s:/web", null, t)).toBe("web");
    expect(whereText("env:prod", null, t)).toBe("prod");
    expect(whereText("default", null, t)).toBe("Outside Kubernetes");
  });
  it("shows before → after, points for rates and percent ranges for latency", () => {
    const tiles = buildTiles(response(), "traces", t);
    expect(tiles.map((tile) => tile.key)).toEqual(["requests", "error_rate", "p95", "p99"]);
    const [requests, errors, p95, p99] = tiles;
    expect([requests.before, requests.after, requests.delta]).toEqual(["209", "221", "+5.7%"]);
    expect(requests).toMatchObject({ detail: "", tone: "neutral" });
    expect(errors).toMatchObject({
      before: "0.42%",
      after: "1.18%",
      delta: "+0.8 pts",
      detail: "range +0.5 to +1.0",
      tone: "crit",
    });
    expect(p95).toMatchObject({ delta: "+13.7%", detail: "range +6.2% to +21.9%" });
    expect(p99).toMatchObject({ tone: "neutral", detail: "noise" });
  });
  it("shows a count tile's plain change in neutral, with no noise or significance label", () => {
    const busy = response();
    busy.traces!.requests = { a: 13880, b: 10000, rate_a: 138.8 / 60, rate_b: 100 / 60 };
    const requests = buildTiles(busy, "traces", t)[0];
    expect(requests).toMatchObject({
      key: "requests",
      delta: "+38.8%",
      detail: "",
      tone: "neutral",
    });
    const wrapper = mount(Tiles, { props: { result: busy } });
    const tile = wrapper.get('[data-test="svcver-metric-requests"]');
    expect(tile.get('[data-test="svcver-delta-requests"]').text()).toBe("+38.8%");
    expect(tile.find('[data-test="svcver-ci-requests"]').exists()).toBe(false);
    expect(tile.text()).not.toMatch(/noise|counts, no change/);
  });
  it("rounds a points change like a percent change: tenths below 100, whole from 100", () => {
    expect(formatPoints(0.2523, t)).toBe("+25.2 pts");
    expect(formatPoints(-0.0159, t)).toBe("−1.6 pts");
    expect(formatPoints(1, t)).toBe("+100 pts");
    expect(formatPoints(0.99996, t)).toBe("+100 pts");
    expect(percentChange(0.174, 1)).toBe("+17.4%");
    expect(percentChange(-1.2345, 1)).toBe("−123%");
  });
  it("uses amber for a possible regression and green for an improvement", () => {
    expect(buildTiles(response(), "traces", t, true)[1].tone).toBe("warn");
    const better = response();
    better.traces!.error_rate = delta({
      a: 0.0003,
      b: 0.0162,
      delta: -0.0159,
      lo: -0.018,
      hi: -0.0138,
    });
    expect(buildTiles(better, "traces", t)[1]).toMatchObject({
      tone: "good",
      delta: "−1.6 pts",
    });
  });
  it("never colours a metric below its sample floor", () => {
    const thin = response();
    thin.traces = {
      status: "complete",
      insufficient: true,
      requests: { a: 61, b: 675, rate_a: 4.1 / 60, rate_b: 45 / 60 },
      error_rate: delta({
        a: 0.0044,
        b: 0,
        delta: 0.0044,
        lo: 0.001,
        hi: 0.02,
        insufficient: true,
      }),
      p95: delta({ a: 40000, b: 34000, delta: 6000, insufficient: true }),
    };
    const [requests, errors, p95] = buildTiles(thin, "traces", t);
    expect(requests).toMatchObject({ delta: "−90.9%", detail: "", tone: "neutral" });
    expect(errors).toMatchObject({
      tone: "waiting",
      delta: "Not enough data to judge",
      detail: "61 of 100 requests",
    });
    expect(p95.detail).toBe("61 of 500 requests");
  });
  it.each([
    ["error_rate", 99, "waiting"],
    ["error_rate", 100, "crit"],
    ["p95", 200, "waiting"],
    ["p95", 499, "waiting"],
    ["p95", 500, "crit"],
    ["p99", 600, "waiting"],
    ["p99", 1000, "crit"],
  ] as const)(
    "applies the UI floor to %s at %i samples even when the backend says sufficient",
    (key, n, tone) => {
      const result = response();
      result.traces!.requests = { a: n, b: n + 50, rate_a: n / 600, rate_b: n / 600 };
      result.traces!.p99 = delta({ a: 655000, b: 600000, delta: 55000, lo: 1000, hi: 90000 });
      const tile = buildTiles(result, "traces", t).find((row) => row.key === key)!;
      expect(tile.tone).toBe(tone);
      if (tone === "waiting")
        expect(tile.detail).toBe(
          `${n} of ${key === "error_rate" ? 100 : key === "p95" ? 500 : "1,000"} requests`,
        );
    },
  );
  it("keeps JS errors / 1k sessions uncoloured below 100 sessions per arm", () => {
    const rum = (sessions: number) =>
      response({
        rum: {
          status: "complete",
          session_windows: { a: sessions, b: 5000 },
          errors: { a: 90, b: 60 },
        },
      });
    const tile = (sessions: number) =>
      buildTiles(rum(sessions), "rum", t).find((row) => row.key === "js_errors")!;
    expect(tile(80)).toMatchObject({ tone: "waiting", detail: "Too early to judge" });
    expect(tile(1000)).toMatchObject({ before: "12", after: "90", tone: "crit" });
  });
  it("colours JS errors / 1k sessions only when its 90% range excludes zero", () => {
    const rum = (a: number, b: number) =>
      response({
        rum: { status: "complete", session_windows: { a: 3112, b: 2940 }, errors: { a, b } },
      });
    const tile = (a: number, b: number) =>
      buildTiles(rum(a, b), "rum", t).find((row) => row.key === "js_errors")!;
    expect(tile(28, 35)).toMatchObject({
      before: "12",
      after: "9",
      tone: "neutral",
      detail: "noise",
    });
    const real = tile(280, 35);
    expect(real.tone).toBe("crit");
    expect(real.detail).toMatch(/^range \+/);
    expect(
      buildTiles(rum(280, 35), "rum", t, true).find((row) => row.key === "js_errors")?.tone,
    ).toBe("warn");
  });
  it("keeps the traces tile set as it was", () => {
    expect(buildTiles(response(), "traces", t).map((tile) => tile.key)).toEqual([
      "requests",
      "error_rate",
      "p95",
      "p99",
    ]);
  });
});
describe("VersionSummaryTiles", () => {
  it("switches the chart metric from a selectable tile", async () => {
    const wrapper = mount(Tiles, { props: { result: response(), selectable: true } });
    await wrapper.find('[data-test="svcver-metric-p95"]').trigger("click");
    expect(wrapper.emitted("update:metric")?.at(-1)).toEqual(["p95"]);
    expect(wrapper.find('[data-test="svcver-signal-traces"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-legend"]').text()).toContain("before 0.49.2");
  });
  it("names two builds of one version by their image shorts in the legend", () => {
    const result = response({
      arms: {
        a: { version: "2.4.0", image: "9c1e4b7", start_time: 0, end_time: 1 },
        b: { version: "2.4.0", image: "3f9c2ab", start_time: 0, end_time: 1 },
      },
    });
    const legend = mount(Tiles, { props: { result } }).get('[data-test="svcver-legend"]').text();
    expect(legend).toContain("before 2.4.0 · img 3f9c2ab");
    expect(legend).toContain("after 2.4.0 · img 9c1e4b7");
  });
  it("defaults to the higher-volume signal and offers the toggle when both exist", () => {
    const result = response({
      rum: {
        status: "complete",
        views: { a: 90000, b: 80000 },
        error_view_rate: delta({ a: 0.01, b: 0.01, delta: 0, lo: -0.001, hi: 0.001 }),
        inp_p75: delta({ a: 150, b: 150, delta: 0, lo: -2, hi: 2 }),
      },
    });
    const wrapper = mount(Tiles, { props: { result } });
    expect(wrapper.emitted("update:signal")?.[0]).toEqual(["rum"]);
    expect(wrapper.find('[data-test="svcver-metric-inp_p75"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-metric-error_view_rate"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-metric-requests"]').exists()).toBe(false);
  });
  it("marks insufficient tiles with the floor selector", () => {
    const thin = response();
    thin.traces!.insufficient = true;
    thin.traces!.p95 = delta({ a: 1, b: 1, insufficient: true });
    const wrapper = mount(Tiles, { props: { result: thin } });
    expect(wrapper.find('[data-test="svcver-floor-p95"]').exists()).toBe(true);
  });
});
describe("first version tiles (real producer compare with no baseline)", () => {
  const first = () =>
    ({ ...response(), ...structuredClone(producer.first_version) }) as unknown as CompareResponse;
  it("shows the version's own values alone, with no arrow, change or floor that cannot fill", () => {
    const wrapper = mount(Tiles, { props: { result: first(), selectable: true } });
    const text = wrapper.text();
    expect(text).not.toContain("→");
    expect(text).not.toContain("Not enough data to judge");
    expect(text).not.toMatch(/0 of [\d,]+ requests/);
    expect(wrapper.find('[data-test^="svcver-floor-"]').exists()).toBe(false);
    expect(wrapper.find('[data-test^="svcver-delta-"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="svcver-value-requests"]').text()).toBe("887");
  });
  it("shows the version's own measured error rate and latency", () => {
    const wrapper = mount(Tiles, { props: { result: first() } });
    expect(wrapper.get('[data-test="svcver-value-error_rate"]').text()).toBe("0.48%");
    for (const key of ["p95", "p99"])
      expect(wrapper.get(`[data-test="svcver-value-${key}"]`).text()).not.toMatch(/^(—|0 ms)$/);
  });
  it("shows a measured 0% error rate as 0.00%, and a dash, never 0 ms, for an unmeasured latency", () => {
    const result = first();
    expect(result.traces!.requests!.a).toBeGreaterThan(0);
    for (const key of ["error_rate", "p95", "p99"] as const) result.traces![key].a = 0;
    const wrapper = mount(Tiles, { props: { result } });
    expect(wrapper.get('[data-test="svcver-value-error_rate"]').text()).toBe("0.00%");
    for (const key of ["p95", "p99"])
      expect(wrapper.get(`[data-test="svcver-value-${key}"]`).text()).toBe("—");
  });
  it("shows a dash for the error rate only when the version served no requests", () => {
    const result = first();
    result.traces!.requests = { ...result.traces!.requests!, a: 0, rate_a: 0 };
    result.traces!.error_rate.a = 0;
    const wrapper = mount(Tiles, { props: { result } });
    expect(wrapper.get('[data-test="svcver-value-error_rate"]').text()).toBe("—");
  });
  it("shows a measured CLS of 0 as a number and an unmeasured one as a dash", () => {
    const rum = () => {
      const result = first();
      const cls = { ...result.traces!.error_rate, a: 0 };
      result.rum = { status: "complete", views: { a: 420, b: 0 }, cls_p75: cls };
      result.traces = undefined;
      return result;
    };
    const measured = mount(Tiles, { props: { result: rum(), signal: "rum" } });
    expect(measured.get('[data-test="svcver-value-cls_p75"]').text()).toBe("0.000");
    const empty = rum();
    empty.rum!.views = { a: 0, b: 0 };
    const unmeasured = mount(Tiles, { props: { result: empty, signal: "rum" } });
    expect(unmeasured.get('[data-test="svcver-value-cls_p75"]').text()).toBe("—");
  });
  // The producer's per-vital sample counts: views alone do not prove a vital was measured.
  it("shows a dash for a vital with views but no samples, and a measured 0 as a number", () => {
    const rum = (samples: number) => {
      const result = first();
      const zero = { ...result.traces!.error_rate, a: 0 };
      result.rum = {
        status: "complete",
        views: { a: 420, b: 0 },
        cls_p75: zero,
        lcp_p75: zero,
        inp_p75: zero,
        samples: {
          cls_p75: { a: samples, b: 0 },
          lcp_p75: { a: samples, b: 0 },
          inp_p75: { a: samples, b: 0 },
        },
      };
      result.traces = undefined;
      return result;
    };
    const none = mount(Tiles, { props: { result: rum(0), signal: "rum" } });
    for (const key of ["cls_p75", "lcp_p75", "inp_p75"])
      expect(none.get(`[data-test="svcver-value-${key}"]`).text()).toBe("—");
    const zero = mount(Tiles, { props: { result: rum(37), signal: "rum" } });
    expect(zero.get('[data-test="svcver-value-cls_p75"]').text()).toBe("0.000");
    expect(zero.get('[data-test="svcver-value-lcp_p75"]').text()).toBe("0.00 s");
    expect(zero.get('[data-test="svcver-value-inp_p75"]').text()).toBe("0 ms");
  });
  it("reads each arm's own vital samples when comparing two versions", () => {
    const result = response({
      rum: {
        status: "complete",
        views: { a: 900, b: 800 },
        cls_p75: delta({ a: 0, b: 0, insufficient: true }),
        samples: { cls_p75: { a: 0, b: 52 } },
      },
    });
    const cls = buildTiles(result, "rum", t).find((tile) => tile.key === "cls_p75")!;
    expect(cls.after).toBe("—");
    expect(cls.before).toBe("0.000");
  });
  it("keeps the one plain legend before the verdict, with no theme token names", () => {
    const early = response();
    early.traces!.insufficient = true;
    const wrapper = mount(Tiles, { props: { result: early } });
    const rule = wrapper.get('[data-test="svcver-legend-rule"]').text();
    expect(rule).toBe(en.serviceVersions.compare.legend);
    expect(rule).not.toMatch(/primary|violet/);
    expect(wrapper.find('[data-test="svcver-legend"] .border-dashed').exists()).toBe(false);
  });
  it("names only the version in the legend, with no verdict colour rule", () => {
    const wrapper = mount(Tiles, { props: { result: first() } });
    expect(wrapper.get('[data-test="svcver-legend"]').text()).toBe("after 2.2.0");
    expect(wrapper.text()).not.toContain("appear with the verdict");
  });
});
describe("duration formatters", () => {
  it("formats a run length in words and a window length compactly", () => {
    expect(formatDuration(9 * 86400 * 1e6)).toBe("9 days");
    expect(formatDuration(3 * 3600 * 1e6 + 59e6)).toBe("3 hours");
    expect(formatSpan(3 * 3600 * 1e6 + 20 * 60e6)).toBe("3h 20m");
    expect(formatSpan(30e6)).toBe("30s");
  });
  it("keeps the seconds of a span under ten minutes, so 100 s never reads 1m", () => {
    expect(formatSpan(100e6)).toBe("1m 40s");
    expect(formatSpan(120e6)).toBe("2m");
    expect(formatSpan(12 * 60e6 + 5e6)).toBe("12m");
  });
  it("prints seconds on windows under ten minutes, so equal windows never look unequal", () => {
    const start = new Date(2026, 10, 1, 22, 13, 20).getTime() * 1000;
    const before = formatWindow(start, start + 90e6, t);
    const after = formatWindow(start + 90e6, start + 180e6, t);
    expect(before).toMatch(/22:13:20.22:14:50/);
    expect(after).toMatch(/22:14:50.22:16:20/);
    expect(formatWindow(start, start + 3600e6, t)).toMatch(/^22:13.23:13$/);
    expect(
      shortWindow({ start_time: 0, end_time: 3600e6 }, { start_time: 0, end_time: 90e6 }),
    ).toBe(true);
  });
});
describe("Core Web Vitals bands", () => {
  const e2 = () => structuredClone(golden.compare_e2) as unknown as CompareResponse;
  it("shows LCP in seconds as the producer sends it", () => {
    const lcp = buildTiles(e2(), "rum", t).find((tile) => tile.key === "lcp_p75");
    expect(lcp).toMatchObject({ before: "2.02 s", after: "1.68 s", delta: "−17.0%" });
  });
  it("reads the producer's flattened vital deltas", () => {
    const tiles = buildTiles(e2(), "rum", t);
    expect(tiles.find((tile) => tile.key === "inp_p75")).toMatchObject({
      delta: "+19.4%",
      tone: "crit",
    });
    expect(tiles.find((tile) => tile.key === "cls_p75")?.tone).toBe("good");
  });
  it("shows baseline then new band on each vital tile and flags a crossing", () => {
    const wrapper = mount(Tiles, { props: { result: e2(), signal: "rum" } });
    const inp = wrapper.find('[data-test="svcver-tile-band-inp_p75"]');
    expect(inp.text()).toBe("Good→Needs impr.(≤200 ms)");
    expect(inp.attributes("data-crossed")).toBe("true");
    const lcp = wrapper.find('[data-test="svcver-tile-band-lcp_p75"]');
    expect(lcp.text()).toBe("Good→Good");
    expect(wrapper.find('[data-test="svcver-tile-band-cls_p75"]').text()).toBe("Needs impr.→Good");
    expect(lcp.attributes("data-crossed")).toBeUndefined();
    expect(wrapper.find('[data-test="svcver-tile-band-error_view_rate"]').exists()).toBe(false);
  });
  it("shows the RUM tile set in the mockup's order, with no Error-view rate tile", () => {
    const result = structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
    const tiles = buildTiles(result, "rum", t);
    expect(tiles.map((tile) => tile.key)).toEqual([
      "lcp_p75",
      "inp_p75",
      "cls_p75",
      "js_errors",
      "sessions",
    ]);
    const { errors, session_windows: sessions } = result.rum!;
    const perK = (count: number, total: number) =>
      formatMetric("js_errors", (count / total) * 1000, t);
    expect(tiles[3]).toMatchObject({
      before: perK(errors!.b, sessions!.b),
      after: perK(errors!.a, sessions!.a),
    });
    expect(tiles[4]).toMatchObject({
      before: sessions!.b.toLocaleString(),
      after: sessions!.a.toLocaleString(),
      delta: percentChange(sessions!.a - sessions!.b, sessions!.b),
      detail: "",
      tone: "neutral",
    });
    const wrapper = mount(Tiles, { props: { result, selectable: true } });
    expect(wrapper.find('[data-test="svcver-metric-js_errors"]').text()).toContain(
      "JS errors / 1k sessions",
    );
    expect(wrapper.find('[data-test="svcver-metric-sessions"]').text()).toContain("Sessions");
    expect(wrapper.find('[data-test="svcver-metric-error_view_rate"]').exists()).toBe(false);
  });
  it("opens on the headline vital and switches the chart only from a Web Vitals tile", async () => {
    const result = structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
    delete result.traces;
    const wrapper = mount(Tiles, { props: { result, selectable: true } });
    expect(wrapper.emitted("update:metric")?.at(-1)).toEqual(["inp_p75"]);
    expect(wrapper.find('[data-test="svcver-metric-js_errors"]').element.tagName).toBe("DIV");
    expect(wrapper.find('[data-test="svcver-metric-sessions"]').element.tagName).toBe("DIV");
    await wrapper.find('[data-test="svcver-metric-sessions"]').trigger("click");
    expect(wrapper.emitted("update:metric")).toHaveLength(1);
    await wrapper.find('[data-test="svcver-metric-lcp_p75"]').trigger("click");
    expect(wrapper.emitted("update:metric")?.at(-1)).toEqual(["lcp_p75"]);
  });
  it("flags a band crossing only when the new band is not Good, on the same line as the limit", () => {
    const wrapper = mount(Tiles, { props: { result: e2(), signal: "rum" } });
    const inp = wrapper.find('[data-test="svcver-tile-band-inp_p75"]');
    expect(inp.find('[data-test="svcver-tile-band-crossed"]').exists()).toBe(true);
    const limit = inp.find('[data-test="svcver-tile-band-limit-inp_p75"]').element.parentElement!;
    expect(limit.className).toContain("whitespace-nowrap");
    expect(limit.querySelector('[data-test="svcver-tile-band-crossed"]')).not.toBeNull();
    const cls = wrapper.find('[data-test="svcver-tile-band-cls_p75"]');
    expect(cls.attributes("data-crossed")).toBe("true");
    expect(cls.find('[data-test="svcver-tile-band-crossed"]').exists()).toBe(false);
  });
});
describe("RUM tab for a service with no browser data", () => {
  it("shows one neutral notice and no per-tile states, and opens on traces", async () => {
    const result = response({ rum: { status: "insufficient", views: { a: 0, b: 0 } } });
    const wrapper = mount(Tiles, { props: { result, rumAbsent: true, selectable: true } });
    expect(wrapper.find('[data-test="svcver-signal-traces"]').exists()).toBe(true);
    await wrapper.find('[data-test="svcver-signal-rum"]').trigger("click");
    const notices = wrapper.findAll('[data-test="svcver-rum-not-collected"]');
    expect(notices).toHaveLength(1);
    expect(notices[0].text()).toBe("Not collected for this app");
    expect(wrapper.findAll('[data-test^="svcver-metric-"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Too early to judge");
  });
});
describe("a change that prints as zero is noise", () => {
  it("shows a 0.0-point error rate change as noise even when its range clears zero", () => {
    const tiny = response();
    tiny.traces!.error_rate = delta({ a: 0.0001, b: 0, delta: 0.0001, lo: 0.00003, hi: 0.0002 });
    const errors = buildTiles(tiny, "traces", t, true).find((tile) => tile.key === "error_rate")!;
    expect(errors.tone).toBe("neutral");
    expect(errors.detail).toBe("noise");
  });
});
