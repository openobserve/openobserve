// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import en from "@/locales/languages/en-US.json";
import type { CompareResponse } from "@/services/service_versions";
import Banner from "./VersionVerdictBanner.vue";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import switches from "@/test/unit/fixtures/serviceVersions/baselineSwitch.json";
import { buildTiles } from "./VersionSummaryTiles.format";
import { baselineProvenance } from "./verdictText";
function lookup(key: string) {
  return key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
}
function translate(key: string, params: Record<string, unknown> = {}) {
  return String(lookup(key) ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: translate, te: (key: string) => typeof lookup(key) === "string" }),
}));
// The E2 mockup state: a watch whose live read is below its floor, whatever the capture concluded.
const e2 = () => {
  const result = structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
  Object.assign(result.live_verdict!, { verdict: "insufficient", reason_code: "below_min_count" });
  Object.assign(result.stored_verdict!, { verdict: "watch", reason_code: "not_significant_yet" });
  return result;
};
// The drawer hands a RUM-only version the result without its empty traces section.
const rumOnly = () => ({ ...e2(), traces: undefined }) as CompareResponse;
function line(result: CompareResponse, test: string) {
  return mount(Banner, {
    props: { result },
    global: { stubs: { VerdictChip: true, OTag: true, OProgressBar: true } },
  })
    .find(`[data-test="${test}"]`)
    .text();
}
const sentence = (result: CompareResponse) => line(result, "svcver-verdict-sentence");
describe("RUM verdict banner headline", () => {
  it("reads as the RUM mockup: tile metric, change, pair, then the improved vitals", () => {
    expect(sentence(e2())).toBe(
      "Possible regression: INP p75 +19.4% (179 → 213 ms); LCP and CLS improved.",
    );
  });
  it("keeps the shared sentence on a traces verdict", () => {
    const result = e2();
    for (const verdict of [result.live_verdict!, result.stored_verdict!]) verdict.signal = "traces";
    expect(sentence(result)).toBe("Possible regression: INP 179 ms → 213 ms.");
  });
});
describe("RUM verdict banner Why and window lines", () => {
  it("explains a real INP change held under the regression threshold", () => {
    expect(line(e2(), "svcver-verdict-reason")).toBe(
      "Why Possible regression: the INP change is real, but below the regression threshold.",
    );
  });
  it("names the Good band limit when the vital stayed Good", () => {
    const result = e2();
    for (const verdict of [result.live_verdict!, result.stored_verdict!])
      verdict.reason_code = "within_good_band";
    expect(line(result, "svcver-verdict-reason")).toBe(
      "Why Possible regression: the INP change is real, but INP is still Good (≤200 ms) and below the regression threshold.",
    );
  });
  it("counts the windows in sessions without the equal-windows note", () => {
    const text = line(rumOnly(), "svcver-baseline-detail");
    expect(text).toMatch(
      /^Before: 0\.0\.1 .+ · after: 0\.0\.2 .+ · 2\.4K and 6K sessions · 90% ranges$/,
    );
    expect(text).not.toContain("views");
    expect(text).not.toContain("equal windows");
  });
  it("still names a concurrent run, counted in sessions", () => {
    const result = rumOnly();
    result.mode = "concurrent";
    const text = line(result, "svcver-baseline-detail");
    expect(text).toContain("(running concurrently, same wall clock)");
    expect(text).toContain("2.4K and 6K sessions");
  });
});
const banner = (result: CompareResponse) =>
  mount(Banner, {
    props: { result },
    global: { stubs: { VerdictChip: true, OTag: true, OProgressBar: true } },
  });
// Both verdicts start from a real producer's stored and live traces verdicts after a bad deploy.
function traced(
  stored: Record<string, unknown>,
  live: Record<string, unknown>,
  base: { stored_verdict: unknown; live_verdict: unknown } = producer.regressed,
) {
  const result = e2();
  result.stored_verdict = { ...structuredClone(base.stored_verdict as never), ...stored };
  result.live_verdict = { ...structuredClone(base.live_verdict as never), ...live };
  return result;
}
describe("stored release verdict against the live check", () => {
  it("shows the stored Regressed with no change note while the live check waits", () => {
    const wrapper = banner(
      traced(
        { verdict: "regressed", reason_code: "regressed_significant", checks_done: 16 },
        { verdict: "watch", reason_code: "debounce_pending", checks_done: 1 },
      ),
    );
    expect(wrapper.find('[data-test="svcver-verdict-sentence"]').text()).toMatch(/^Regressed: /);
    expect(wrapper.find('[data-test="svcver-verdict-changed"]').exists()).toBe(false);
  });
  it("notes a confirmed change", () => {
    const wrapper = banner(
      traced(
        { verdict: "ok", reason_code: "below_min_effect" },
        { verdict: "regressed", reason_code: "regressed_significant" },
      ),
    );
    expect(wrapper.find('[data-test="svcver-verdict-changed"]').text()).toBe(
      "Changed since release verdict",
    );
  });
});
describe("headline direction", () => {
  const p95 = (base: number, value: number) => ({
    verdict: "watch",
    reason_code: "not_significant_yet",
    headline: { metric: "p95", new: value, base, lo: 1, hi: 2, ci_kind: "", unit: "us" },
  });
  it("never explains a fall as a rise", () => {
    const wrapper = banner(traced(p95(23000, 12000), p95(23000, 12000)));
    expect(wrapper.find('[data-test="svcver-verdict-reason"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("rose");
  });
  it("keeps the rise line when the metric rose", () => {
    expect(line(traced(p95(12000, 23000), p95(12000, 23000)), "svcver-verdict-reason")).toBe(
      "Why Possible regression: p95 rose by a real 11 ms.",
    );
  });
});
describe("first version", () => {
  const first = (value: Record<string, unknown> = {}) =>
    banner(traced(value, value, producer.first_version));
  it("reads First version with no progress bar that could never fill", () => {
    const wrapper = first();
    expect(wrapper.find('[data-test="svcver-verdict-sentence"]').text()).toBe("First version");
    expect(wrapper.find('[data-test="svcver-progress"]').exists()).toBe(false);
  });
});
describe("headline and Why from one driver (real producer regression)", () => {
  it("leads with the error rate and gives the error-types reason the headline shows", () => {
    const result = traced({}, {});
    expect(result.live_verdict?.reason_code).toBe("new_error_types");
    expect(result.live_verdict?.headline?.metric).toBe("error_rate");
    const wrapper = banner(result);
    expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toMatch(
      /^Regressed: error rate /,
    );
    expect(wrapper.get('[data-test="svcver-verdict-reason"]').text()).toBe(
      "Why Regressed: 1.5.0 shows error types the baseline never had.",
    );
  });
  it("explains a p95 headline instead of naming error types it does not show", () => {
    const headline = {
      metric: "p95",
      new: 2_400_000,
      base: 1_000_000,
      lo: 1_200_000,
      hi: 1_600_000,
      ci_kind: "bootstrap",
      unit: "us",
    };
    const wrapper = banner(traced({ headline }, { headline }));
    expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toMatch(/^Regressed: p95 /);
    expect(wrapper.get('[data-test="svcver-verdict-reason"]').text()).toMatch(
      /^Why Regressed: p95 rose by a real /,
    );
  });
});
describe("window line of a real producer compare", () => {
  const compare = (fixture: Record<string, unknown>) => {
    const result = traced({}, {}, fixture as never);
    return { ...result, ...structuredClone(fixture) } as unknown as CompareResponse;
  };
  it("names only the first version's own window and requests", () => {
    const result = compare(producer.first_version);
    const text = line(result, "svcver-baseline-detail");
    expect(text).toMatch(/^2\.2\.0 .+ · 13\.3K requests$/);
    expect(text).not.toContain("Before");
    expect(text).not.toContain("equal windows");
  });
  it("drops the equal-windows claim when the sequential windows differ in length", () => {
    const result = compare({ ...producer.regressed.compare, ...producer.regressed });
    const { a, b } = result.arms;
    expect(a.end_time - a.start_time).not.toBe(b.end_time - b.start_time);
    const text = line(result, "svcver-baseline-detail");
    expect(text).toMatch(/^Before: 1\.4\.0 .+ · after: 1\.5\.0 /);
    expect(text).not.toContain("equal windows");
  });
});
describe("Why line of an OK verdict reads the tiles it sits above", () => {
  const metric = (a: number, b: number, lo: number, hi: number) => ({
    a,
    b,
    delta: a - b,
    lo,
    hi,
    ci_kind: "variance",
    insufficient: false,
    straddles_zero: lo <= 0 && hi >= 0,
  });
  // A real producer's OK verdicts over a traces section shaped per case.
  function ok(traces: Record<string, unknown>) {
    const value = { verdict: "ok", reason_code: "below_min_effect", signal: "traces" };
    const result = traced(value, value);
    result.rum = undefined;
    result.traces = {
      status: "complete",
      requests: { a: 9000, b: 9000, rate_a: 150, rate_b: 150 },
      error_rate: metric(0.01, 0.01, -0.001, 0.001),
      p95: metric(212000, 210000, -4000, 8000),
      p99: metric(640000, 655000, -30000, 1000),
      ...traces,
    } as never;
    return result;
  }
  const why = (result: CompareResponse) => line(result, "svcver-verdict-reason");
  it("says every change is noise when no tile moved for real", () => {
    expect(why(ok({}))).toBe("Why OK: every change is within noise.");
  });
  it("names the improved metrics when the only real changes are improvements", () => {
    expect(why(ok({ p95: metric(150000, 210000, -70000, -50000) }))).toBe(
      "Why OK: p95 improved, and nothing got worse.",
    );
  });
  it("maps the producer's within_noise and improved reasons to their own copy", () => {
    const noise = ok({});
    for (const value of [noise.live_verdict!, noise.stored_verdict!])
      value.reason_code = "within_noise";
    expect(why(noise)).toBe("Why OK: every change is within noise.");
    const better = ok({ p99: metric(500000, 655000, -200000, -100000) });
    for (const value of [better.live_verdict!, better.stored_verdict!])
      value.reason_code = "improved";
    expect(why(better)).toBe("Why OK: p99 improved, and nothing got worse.");
  });
  it("keeps the below-threshold reason only when a tile shows a real worsening", () => {
    expect(why(ok({ error_rate: metric(0.012, 0.01, 0.001, 0.003) }))).toBe(
      "Why OK: the change is real, but below the regression threshold.",
    );
  });
});
describe("rollback headline and Why", () => {
  const rollback = (outcome: "recovered" | "not_recovered", base: number, value: number) => {
    const fields = {
      verdict: "ok",
      reason_code: "below_min_effect",
      signal: "traces",
      rollback_outcome: outcome,
      deploy: { kind: "rollback", at: 1793500620000000, from_version: "0.0.1" },
      headline: {
        metric: "error_rate",
        new: value,
        base,
        lo: null,
        hi: null,
        ci_kind: "variance",
        unit: "ratio",
      },
    };
    return traced(fields, fields);
  };
  it("reads Rolled back · recovered with the fall it measured", () => {
    const result = rollback("recovered", 0.0162, 0.0003);
    expect(sentence(result)).toBe("Rolled back · recovered: error rate 1.62% → 0.03%.");
    expect(line(result, "svcver-verdict-reason")).toBe(
      "Why recovered: back on 1.5.0, error rate fell by a real 1.6 points against 0.0.1, the version serving before the rollback, and is back to its level before 0.0.1.",
    );
  });
  it("reads Rolled back · still worse and never explains it as a recovery", () => {
    const result = rollback("not_recovered", 0.0003, 0.0162);
    expect(sentence(result)).toBe("Rolled back · still worse: error rate 0.03% → 1.62%.");
    expect(line(result, "svcver-verdict-reason")).toBe(
      "Why still worse: back on 1.5.0, error rate is still worse than it was before 0.0.1.",
    );
  });
});
describe("a stated change agrees with the numbers on screen", () => {
  it("computes the change from the rounded before and after", () => {
    const result = e2();
    for (const verdict of [result.live_verdict!, result.stored_verdict!]) verdict.signal = "traces";
    expect(line(result, "svcver-verdict-reason")).toBe(
      "Why Possible regression: INP rose by a real 34 ms.",
    );
  });
});
describe("not-serving banner", () => {
  const notServing = (stored: Record<string, unknown>) => {
    const value = traced(
      { verdict: "not_serving", headline: null, ...stored },
      { verdict: "not_serving", headline: null, ...stored },
    );
    return {
      ...value,
      ...structuredClone(producer.regressed.compare),
      stored_verdict: value.stored_verdict,
      live_verdict: value.live_verdict,
    } as CompareResponse;
  };
  it("says not serving once: the sentence names it, the Why line only adds who takes the traffic", () => {
    const wrapper = banner(notServing({ reason_code: "seen_in_k8s_no_requests" }));
    const text = wrapper.text();
    expect(text.match(/not serving/gi)).toHaveLength(1);
    expect(text).not.toMatch(/served no requests|serves no requests/);
    expect(wrapper.find('[data-test="svcver-not-serving"]').text()).toBe(
      "1.4.0 still takes all traffic.",
    );
  });
  it("adds no second not-serving line for a traffic drop or a bare not serving", () => {
    for (const reason_code of ["traffic_drop", "no_requests"]) {
      const wrapper = banner(notServing({ reason_code }));
      expect(wrapper.find('[data-test="svcver-not-serving"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("No latency or error verdict");
    }
  });
});
describe("banner and tiles share one noise judgement", () => {
  // A watch whose error rate rose 0.00% to 0.01%: a range clear of zero, but a change that prints as 0.0 points.
  function tiny(next: number) {
    const headline = { metric: "error_rate", new: next, base: 0, lo: 0.00003, hi: 0.0002 };
    const value = {
      verdict: "watch",
      reason_code: "regressed_significant",
      signal: "traces",
      headline,
    };
    const result = traced(value, value);
    result.traces = {
      status: "complete",
      requests: { a: 54000, b: 54000, rate_a: 900, rate_b: 900 },
      error_rate: {
        a: next,
        b: 0,
        delta: next,
        lo: 0.00003,
        hi: 0.0002,
        ci_kind: "variance",
        insufficient: false,
      },
    };
    return banner(result);
  }
  it("never calls a 0.0-point change real", () => {
    const wrapper = tiny(0.0001);
    expect(wrapper.find('[data-test="svcver-verdict-reason"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("real");
  });
});
describe("baseline switch on the producer's summary", () => {
  // The producer stores the first baseline version on every summary; its golden run drains no canary, so no summary has switched.
  const first = () => structuredClone(producer.regressed.stored_verdict.baseline);
  const notice = (baseline: Record<string, unknown>) =>
    banner(traced({ baseline }, { baseline })).find('[data-test="svcver-baseline-switched"]');
  it("names the switch only when the baseline moved off the producer's first version", () => {
    const at = producer.regressed.stored_verdict.deploy.at + 60_000_000;
    expect(notice({ ...first(), version: "1.3.0", switched_at: at }).exists()).toBe(true);
    expect(notice({ ...first(), switched_at: at }).exists()).toBe(false);
  });
});
describe("baseline switch while the live check leads", () => {
  // A real drained-canary reply: only the stored verdict carries the switch provenance, and the live OK leads.
  const reply = () => structuredClone(switches.switched_canary) as unknown as CompareResponse;
  const notice = (result: CompareResponse) =>
    banner(result).find('[data-test="svcver-baseline-switched"]');
  it("reads the stored switch when the live baseline is the same version", () => {
    const line = notice(reply());
    expect(line.exists()).toBe(true);
    expect(line.text()).toMatch(/^Baseline switched at /);
  });
  it("names no switch when the live baseline is another version", () => {
    const result = reply();
    result.live_verdict!.baseline!.version = "1.5";
    expect(notice(result).exists()).toBe(false);
  });
  it("keeps a stored-only reply as it was", () => {
    const result = reply();
    result.live_verdict = undefined;
    expect(notice(result).text()).toMatch(/^Baseline switched at /);
    result.stored_verdict!.baseline!.switched_at = null;
    expect(notice(result).exists()).toBe(false);
  });
});
describe("a compare section that timed out or failed", () => {
  // The producer's deadline and failure shapes (signals/api.rs section_result); RUM beside them is the recorded r2f shape.
  const shapes = [
    { status: "timeout", insufficient: true, reason: "timeout" },
    { status: "error", insufficient: true, reason: "query_failed" },
  ] as const;
  function failed(section: (typeof shapes)[number], stored: Record<string, unknown>) {
    const result = traced(stored, {});
    result.live_verdict = null;
    result.arms = structuredClone(producer.regressed.compare.arms) as never;
    result.traces = { ...section };
    result.rum = {
      status: "complete",
      insufficient: true,
      reason: "below_min_count",
      views: { a: 0, b: 0 },
      session_windows: { a: 0, b: 0 },
    };
    return banner(result);
  }
  for (const section of shapes) {
    it(`prints no zero counts and no traffic claim for a ${section.status} traces read`, () => {
      const wrapper = failed(section, { verdict: "not_serving", reason_code: "traffic_drop" });
      const detail = wrapper.get('[data-test="svcver-baseline-detail"]').text();
      expect(detail).toMatch(/^Before: 1\.4\.0 .+ · after: 1\.5\.0 .+ · 90% ranges$/);
      expect(detail).not.toMatch(/\b0 and 0\b|requests|views|sessions/);
      expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toBe(
        "Not serving: requests dropped sharply since 1.5.0.",
      );
    });
  }
  it("still counts a RUM verdict's sessions when only its traces read failed", () => {
    const result = rumOnly();
    result.traces = { status: "timeout", insufficient: true, reason: "timeout" };
    expect(line(result, "svcver-baseline-detail")).toContain("2.4K and 6K sessions");
  });
});
describe("every Why path passes the one noise judgement", () => {
  // A RUM watch with INP 100 → 160 ms whose range crosses zero.
  function inpNoise(reason: string) {
    const result = e2();
    const headline = { ...result.stored_verdict!.headline!, new: 160, base: 100, lo: -20, hi: 140 };
    for (const verdict of [result.live_verdict!, result.stored_verdict!]) {
      verdict.reason_code = reason;
      verdict.headline = headline;
    }
    result.rum!.inp_p75 = {
      ...result.rum!.inp_p75!,
      a: 160,
      b: 100,
      delta: 60,
      lo: -20,
      hi: 140,
      straddles_zero: true,
    };
    return result;
  }
  it("gives no within-good-band line for an INP change its tile calls noise", () => {
    const result = inpNoise("within_good_band");
    const tile = buildTiles(result, "rum", translate).find((row) => row.key === "inp_p75");
    expect(tile?.tone).toBe("neutral");
    const wrapper = banner(result);
    expect(wrapper.find('[data-test="svcver-verdict-reason"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("real");
  });
  it("gives no still-worse line for a rollback whose change is noise", () => {
    const headline = { metric: "error_rate", new: 0.012, base: 0.01, lo: -0.001, hi: 0.005 };
    const fields = { verdict: "ok", rollback_outcome: "not_recovered", signal: "traces", headline };
    const wrapper = banner(traced(fields, fields));
    expect(wrapper.find('[data-test="svcver-verdict-reason"]').exists()).toBe(false);
  });
});
describe("an OK verdict with a real improvement", () => {
  // A rollback that is OK while its outcome is pending, error rate 29.17% → 0.00% with a range clear of zero.
  function pending(lo: number, hi: number) {
    const headline = { metric: "error_rate", new: 0, base: 0.2917, lo, hi };
    const fields = {
      verdict: "ok",
      reason_code: null,
      signal: "traces",
      rollback_outcome: "pending",
      deploy: { kind: "rollback", at: 1, from_version: "2.0" },
      sample: { n_new: 2400, n_base: 2400, since: 1 },
      headline,
    };
    const result = traced(fields, fields);
    result.rum = undefined;
    result.traces = {
      status: "complete",
      requests: { a: 2400, b: 2400, rate_a: 40, rate_b: 40 },
      error_rate: {
        a: 0,
        b: 0.2917,
        delta: -0.2917,
        lo,
        hi,
        ci_kind: "variance",
        insufficient: false,
        straddles_zero: lo <= 0 && hi >= 0,
      },
    };
    return banner(result);
  }
  it("drops the no-real-change clause while the Why line names the improvement", () => {
    const wrapper = pending(-0.311, -0.273);
    expect(wrapper.get('[data-test="svcver-verdict-reason"]').text()).toBe(
      "Why OK: error rate improved, and nothing got worse.",
    );
    expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toBe("OK · 2,400 requests");
  });
  it("keeps the clause when every change is noise", () => {
    const wrapper = pending(-0.4, 0.1);
    expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toBe(
      "OK: no real change · 2,400 requests",
    );
  });
});
describe("verdict banner where wording", () => {
  it("names an env-fallback arm outside Kubernetes without its default where key", () => {
    const result = e2();
    result.baseline_rule = "env_fallback";
    result.where_key = "default";
    result.arms.b.where_key = "k8s:c1/web";
    const text = line(result, "svcver-baseline-detail");
    expect(text).toContain(`${result.arms.a.version} outside Kubernetes`);
    expect(text).toContain(`${result.arms.b.version} in c1 · web`);
    expect(text).not.toMatch(/default/i);
  });
});
describe("two builds of one version", () => {
  // A real producer regression, re-labelled as two image builds of one version text.
  const rebuilt = (bVersion = "2.4.0", versionImages = 2) => {
    const result = traced({}, {});
    const fixture = structuredClone(producer.regressed.compare) as unknown as CompareResponse;
    result.arms = fixture.arms;
    result.mode = fixture.mode;
    result.arms.a = { ...result.arms.a, version: "2.4.0", image: "9c1e4b7" };
    result.arms.b = { ...result.arms.b, version: bVersion, image: "3f9c2ab" };
    for (const verdict of [result.live_verdict!, result.stored_verdict!]) {
      verdict.version = "2.4.0";
      verdict.version_images = versionImages;
      verdict.baseline = { ...verdict.baseline!, version: bVersion, version_images: versionImages };
    }
    return result;
  };
  it("names each build by its image short in the window line", () => {
    const text = line(rebuilt(), "svcver-baseline-detail");
    expect(text).toMatch(/^Before: 2\.4\.0 · img 3f9c2ab .+ · after: 2\.4\.0 · img 9c1e4b7 /);
  });
  it("adds the rebuilt clause to the Why line", () => {
    expect(line(rebuilt(), "svcver-verdict-reason")).toMatch(
      / · 2\.4\.0 was rebuilt: same service\.version, new image\.$/,
    );
  });
  it("keeps plain versions and no rebuilt clause when the texts differ and each has one image", () => {
    const result = rebuilt("2.3.9", 1);
    expect(line(result, "svcver-baseline-detail")).toMatch(/^Before: 2\.3\.9 .+ · after: 2\.4\.0 /);
    expect(line(result, "svcver-baseline-detail")).not.toContain("img");
    expect(line(result, "svcver-verdict-reason")).not.toContain("rebuilt");
  });
});
describe("baseline switch between builds of one version text", () => {
  const at = 1_793_586_540_000_000;
  const build = (image: string, initial_image: string) => ({
    version: "2.4.0",
    image,
    rule: "previous",
    initial_version: "2.4.0",
    initial_image,
    switched_at: at,
  });
  const notice = (result: CompareResponse) =>
    banner(result).find('[data-test="svcver-baseline-switched"]');
  it("names a switch from one build to another of the same version", () => {
    const moved = build("8ebf1f7", "1f08369");
    expect(notice(traced({ baseline: moved }, { baseline: moved })).exists()).toBe(true);
    const stayed = build("8ebf1f7", "8ebf1f7");
    expect(notice(traced({ baseline: stayed }, { baseline: stayed })).exists()).toBe(false);
  });
  it("borrows the stored switch only while the live baseline is the same build", () => {
    const sameBuild = structuredClone(switches.switched_canary) as unknown as CompareResponse;
    sameBuild.stored_verdict!.baseline!.image = "1f08369";
    sameBuild.live_verdict!.baseline!.image = "1f08369";
    expect(notice(sameBuild).exists()).toBe(true);
    const otherBuild = structuredClone(sameBuild);
    otherBuild.live_verdict!.baseline!.image = "8ebf1f7";
    expect(notice(otherBuild).exists()).toBe(false);
    expect(baselineProvenance(otherBuild, otherBuild.live_verdict!)?.switched_at).toBeFalsy();
  });
});
