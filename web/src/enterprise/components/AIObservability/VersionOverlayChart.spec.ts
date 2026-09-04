// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { buildOverlaySchema, buildInjectedRows } from "./VersionOverlayChart.vue";

vi.mock("vue-i18n", async () => {
  const en: any = (await import("@/locales/languages/en-US.json")).default;
  return {
    useI18n: vi.fn(() => ({
      t: (key: string) => {
        const msg = key.split(".").reduce((a: any, k) => (a == null ? a : a[k]), en);
        return typeof msg === "string" ? msg : key;
      },
    })),
  };
});

const seriesA = [
  { x: 0, y: 10 },
  { x: 1, y: 12 },
];
const seriesB = [
  { x: 0, y: 20 },
  { x: 1, y: 18 },
];

describe("VersionOverlayChart buildOverlaySchema", () => {
  it("uses a value-type x axis via breakdown line chart in sinceRollout mode", () => {
    const schema = buildOverlaySchema({
      mode: "sinceRollout",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Hours since rollout",
    });
    expect(schema.type).toBe("line");
    expect(schema.queryType).toBe("sql");
    expect(schema.queries[0].fields.x[0].label).toBe("Hours since rollout");
    expect(schema.queries[0].fields.breakdown).toHaveLength(1);
  });

  it("carries the xAxisLabel through for sameWallClock mode too (renderer infers axis type from data)", () => {
    const schema = buildOverlaySchema({
      mode: "sameWallClock",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Time",
    });
    expect(schema.queries[0].fields.x[0].label).toBe("Time");
  });

  it("keeps exactly one query so the renderer's has-at-least-one-query gate passes", () => {
    const schema = buildOverlaySchema({
      mode: "sinceRollout",
      labelA: "Version A",
      labelB: "Version B",
      xAxisLabel: "Hours since rollout",
    });
    expect(schema.queries).toHaveLength(1);
    expect(schema.queries[0].query).toBeTruthy();
  });
});

describe("VersionOverlayChart buildInjectedRows", () => {
  it("flattens both series into one row array, tagged by series label", () => {
    const rows = buildInjectedRows(seriesA, seriesB, "Version A", "Version B");
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.series === "Version A")).toHaveLength(2);
    expect(rows.filter((r) => r.series === "Version B")).toHaveLength(2);
  });

  it("maps each point's x/y verbatim", () => {
    const rows = buildInjectedRows(seriesA, seriesB, "Version A", "Version B");
    expect(rows[0]).toEqual({ x: 0, y: 10, series: "Version A" });
    expect(rows[2]).toEqual({ x: 0, y: 20, series: "Version B" });
  });
});

describe("VersionOverlayChart mount", () => {
  it("renders the version-overlay-chart data-test hook via PanelSchemaRenderer", async () => {
    vi.doMock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
      default: { name: "PanelSchemaRenderer", template: "<div />" },
    }));
    const { default: VersionOverlayChart } = await import("./VersionOverlayChart.vue");
    const wrapper = mount(VersionOverlayChart, {
      props: { seriesA, seriesB, mode: "sinceRollout" },
      global: {
        stubs: { PanelSchemaRenderer: { template: "<div />" } },
      },
    });
    expect(wrapper.find('[data-test="version-overlay-chart"]').exists()).toBe(true);
  });
});
