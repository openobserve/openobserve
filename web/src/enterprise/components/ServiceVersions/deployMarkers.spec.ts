import { describe, expect, it, vi } from "vitest";
import golden from "@/test/unit/fixtures/serviceVersions/stage5.json";
import stage7 from "@/test/unit/fixtures/serviceVersions/stage7.json";
import {
  dashboardDeploys,
  deployMarkers,
  OVERALL_METRIC,
  unavailableMarkers,
  withoutAnnotatedVersions,
} from "./deployMarkers";
import type { DeployMarker } from "@/services/service_versions";
vi.mock("@/utils/chartTheme", () => ({ chartColor: (token: string) => token }));
const marker = (extra = {}) =>
  ({
    version: "v2",
    at: 123000,
    deploy_key: "d",
    where_key: "env:prod",
    provisional: false,
    metrics: { p95: { badge: "worse" } },
    ...extra,
  }) as DeployMarker;
const t = ((key: string) =>
  key === "serviceVersions.panel.clickToCompare"
    ? "click to compare"
    : "<stored sentence>") as never;
it("excludes pre-existing and preserves exact transition identity and microsecond conversion", () => {
  expect(deployMarkers([marker({ kind: "pre_existing" })], "p95")).toEqual([]);
  expect(deployMarkers([marker()], "p95")[0]).toMatchObject({
    xAxis: 123,
    deployKey: "d",
    where: "env:prod",
    version: "v2",
  });
});
it("uses only each metric badge; requests stay neutral", () => {
  expect(deployMarkers([marker()], "p95")[0].lineStyle.color).toContain("error");
  expect(deployMarkers([marker()], "requests")[0].lineStyle.color).toContain("secondary");
});
it("draws dashed lines with the label above the line in the marker colour", () => {
  const mapped = deployMarkers([marker()], "p95")[0];
  expect(mapped).toMatchObject({
    symbol: ["none", "none"],
    lineStyle: { type: "dashed" },
    label: { position: "end", formatter: "v2" },
  });
  expect(mapped.label.color).toBe(mapped.lineStyle.color);
});
it("shows rollback glyph, hollow provisional and not-serving outline", () => {
  const rollback = deployMarkers([marker({ kind: "rollback" })], "p95")[0];
  expect(rollback.label.formatter).toBe("↩ v2");
  expect(rollback.symbol).toEqual(["none", "emptyCircle"]);
  expect(deployMarkers([marker({ provisional: true })], "p95")[0]).toMatchObject({
    symbol: ["none", "emptyCircle"],
    lineStyle: { type: "dotted" },
  });
  expect(deployMarkers([marker({ verdict: { verdict: "not_serving" } })], "p95")[0].symbol).toEqual(
    ["none", "emptyCircle"],
  );
});
it("colours a metric that improved for real green, as the drawer does", () => {
  const better = marker({ metrics: { lcp_p75: { badge: "ok", delta: -0.3, lo: -0.4, hi: -0.2 } } });
  expect(deployMarkers([better], "lcp_p75")[0].lineStyle.color).toContain("success");
  const noise = marker({ metrics: { lcp_p75: { badge: "ok", delta: -0.1, lo: -0.3, hi: 0.1 } } });
  expect(deployMarkers([noise], "lcp_p75")[0].lineStyle.color).toContain("secondary");
});
it("colours a recovered rollback as success", () => {
  const value = marker({
    kind: "rollback",
    metrics: {},
    verdict: { verdict: "ok", rollback_outcome: "recovered", version: "v2" },
  });
  expect(deployMarkers([value], "p95")[0].lineStyle.color).toContain("success");
});
it("suppresses restricted metric badges and handles empty data", () => {
  expect(
    deployMarkers([marker({ verdict: { restricted: true } })], "p95")[0].lineStyle.color,
  ).toContain("secondary");
  expect(deployMarkers([], "p95")).toEqual([]);
});
it("reads per-metric badges under the deploy's severity and escapes the transition tooltip", () => {
  const value = marker({
    from_version: "<v1>",
    verdict: {
      verdict: "regressed",
      version: "v2",
      metrics: [{ metric: "p95", badge: "possible" }],
    },
  });
  const mapped = deployMarkers([value], "p95", "UTC", t)[0];
  expect(mapped.lineStyle.color).toContain("error");
  expect(mapped.tooltip.formatter).toBe(
    "<b>&lt;v1&gt; → v2</b> · prod · &lt;stored sentence&gt; · click to compare",
  );
});
it("names each build of an image rebuild on its marker and tooltip, and bare versions otherwise", () => {
  const translate = ((key: string, params?: { image?: string }) =>
    key === "serviceVersions.image.short" ? `img ${params?.image}` : "") as never;
  const [rebuilt, upgraded] = deployMarkers(
    [
      marker({ version: "2.4.0", image: "f167103", from_version: "2.4.0", from_image: "1f08369" }),
      marker({ version: "2.5.0", image: "aaaaaaa", from_version: "2.4.0", from_image: "f167103" }),
    ],
    "requests",
    "UTC",
    translate,
  );
  expect(rebuilt.label.formatter).toBe("2.4.0 · img f167103");
  expect(rebuilt.tooltip.formatter).toContain("<b>2.4.0 · img 1f08369 → 2.4.0 · img f167103</b>");
  expect(rebuilt.version).toBe("2.4.0");
  expect(upgraded.label.formatter).toBe("2.5.0");
  expect(upgraded.tooltip.formatter).toContain("<b>2.4.0 → 2.5.0</b>");
});
describe("deploy marker producers on the recorded golden deploys", () => {
  const real = golden.deploys.deploys as unknown as DeployMarker[];
  it("colours the overall badge from the whole verdict on charts without a per-metric verdict", () => {
    const [regressed, evaluating] = deployMarkers(real, OVERALL_METRIC, "UTC", t);
    expect(regressed.lineStyle.color).toContain("error");
    expect(evaluating.lineStyle.color).toContain("secondary");
    const watch = { ...real[0], verdict: { ...real[0].verdict!, verdict: "watch" as const } };
    expect(deployMarkers([watch], OVERALL_METRIC)[0].lineStyle.color).toContain("warning");
  });
  it("keeps one marker per version and where", () => {
    const twice = [real[0], { ...real[0], at: real[0].at + 1 }, real[1]];
    expect(dashboardDeploys(twice).map((row) => row.version)).toEqual(["2.0", "3.0"]);
    const elsewhere = { ...real[0], where_key: "k8s:other/ns" };
    expect(dashboardDeploys([real[0], elsewhere])).toHaveLength(2);
  });
  it("hides a derived marker only when a manual annotation names its version", () => {
    const markers = deployMarkers(real, OVERALL_METRIC);
    expect(withoutAnnotatedVersions(markers, [{ title: " 2.0 " }]).map((m) => m.version)).toEqual([
      "3.0",
    ]);
    expect(withoutAnnotatedVersions(markers, [{ title: "x", tags: ["3.0"] }])).toHaveLength(1);
    expect(withoutAnnotatedVersions(markers, [{ title: "2.0.1" }])).toHaveLength(2);
    expect(withoutAnnotatedVersions(markers, null)).toHaveLength(2);
  });
  it("labels a Web Vitals chart marker with that chart's metric change, as the RUM mockup does", () => {
    const rum = stage7.deploys_rum.deploys as unknown as DeployMarker[];
    const tv = ((key: string, values?: { value?: string }) =>
      key === "serviceVersions.compare.unit.percent"
        ? `${values?.value}%`
        : key.startsWith("serviceVersions.compare.inline.")
          ? key.split(".").pop()!.split("_")[0].toUpperCase()
          : key) as never;
    expect(deployMarkers(rum, "inp_p75", "UTC", tv)[0].label.formatter).toBe("0.0.2 · INP +19.4%");
    expect(deployMarkers(rum, "lcp_p75", "UTC", tv)[0].label.formatter).toBe("0.0.2 · LCP −17.0%");
    expect(deployMarkers(rum, "cls_p75", "UTC", tv)[0].label.formatter).toBe("0.0.2 · CLS −0.09");
    expect(deployMarkers(rum, OVERALL_METRIC, "UTC", tv)[0].label.formatter).toBe("0.0.2");
    expect(deployMarkers(rum, "inp_p75")[0].label.formatter).toBe("0.0.2");
    const restricted = { ...rum[0], verdict: { ...rum[0].verdict!, restricted: true } };
    expect(deployMarkers([restricted], "inp_p75", "UTC", tv)[0].label.formatter).toBe("0.0.2");
    const thin = {
      ...rum[0],
      verdict: {
        ...rum[0].verdict!,
        metrics: rum[0].verdict!.metrics!.map((row) => ({ ...row, badge: "insufficient" })),
      },
    };
    expect(deployMarkers([thin], "inp_p75", "UTC", tv)[0].label.formatter).toBe("0.0.2");
  });
  it("draws grey first-seen markers with the unavailable label and no deploy key", () => {
    const tr = ((key: string) =>
      key === "serviceVersions.rum.markers.unavailable"
        ? "verdict unavailable · retry"
        : key) as never;
    const [grey] = unavailableMarkers([{ version: "<v9>", firstSeen: 5_000_000 }], "UTC", tr);
    expect(grey).toMatchObject({
      xAxis: 5000,
      at: 5_000_000,
      deployKey: undefined,
      unavailable: true,
      label: { formatter: "<v9> · verdict unavailable · retry" },
    });
    expect(grey.lineStyle.color).toContain("secondary");
    expect(grey.tooltip.formatter).toBe("<b>&lt;v9&gt;</b> · verdict unavailable · retry");
  });
});
describe("one severity for a worsened metric's marker", () => {
  // A real RUM deploy whose INP is a possible regression, reshaped as a Regressed deploy.
  const e2 = (verdict: string, reason: string) =>
    marker({
      metrics: undefined,
      verdict: {
        ...structuredClone(stage7.compare_e2.stored_verdict),
        verdict,
        reason_code: reason,
      },
    });
  it("paints the INP marker red when the deploy is Regressed, as the strip and drawer do", () => {
    const inp = deployMarkers([e2("regressed", "new_error_types")], "inp_p75")[0];
    expect(inp.lineStyle.color).toBe("--color-status-error-text");
    expect(inp.label.color).toBe("--color-status-error-text");
  });
  it("keeps amber for a Possible regression and green for an improved vital", () => {
    const watch = e2("watch", "not_significant_yet");
    expect(deployMarkers([watch], "inp_p75")[0].lineStyle.color).toBe(
      "--color-status-warning-text",
    );
    expect(deployMarkers([e2("regressed", "new_error_types")], "cls_p75")[0].lineStyle.color).toBe(
      "--color-status-success-text",
    );
  });
});
