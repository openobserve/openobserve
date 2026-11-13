import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import VersionOverlayChart, { overlayTimeTicks } from "./VersionOverlayChart.vue";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import { formatDeployClock, setDeployTimeZone } from "@/utils/serviceVersionsCopy";

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { name: "PanelSchemaRenderer", template: "<div />" },
}));

const { arms } = producer.regressed.compare;
const deployAt = producer.regressed.stored_verdict.deploy.at / 1000;
const minute = 60_000;

describe("service versions overlay axis", () => {
  it("spans both windows and draws the after series right of the deploy marker", () => {
    const range = { min: arms.b.start_time / 1000, max: arms.a.end_time / 1000 };
    const wrapper = mount(VersionOverlayChart, {
      global: { plugins: [i18n] },
      props: {
        seriesA: [deployAt, deployAt + 5 * minute].map((x) => ({ x, y: 1 })),
        seriesB: [range.min + minute, deployAt - minute].map((x) => ({ x, y: 1 })),
        mode: "sameWallClock",
        serviceVersions: true,
        marker: { x: deployAt, label: arms.a.version },
        range,
      },
    });
    const ticks = wrapper.findAll("text").map((node) => node.text());
    const label = (x: number) => formatDeployClock(x * 1000);
    expect(ticks).toContain(label(range.min));
    expect(ticks).toContain(label(range.max));
    const markerX = Number(
      wrapper.get('[data-test="svcver-overlay-marker"] line').attributes("x1"),
    );
    const path = wrapper.get('[data-test="svcver-overlay-line-a"]').attributes("d");
    const xs = [...path.matchAll(/[ML]([\d.]+),/g)].map((match) => Number(match[1]));
    expect(xs[xs.length - 1]).toBeGreaterThan(markerX);
    expect(markerX).toBeLessThan(668);
  });

  it("labels the axis on the drawer's 24-hour clock in the user's timezone", () => {
    setDeployTimeZone("Asia/Kolkata");
    try {
      const start = Date.UTC(2026, 10, 2, 12, 16);
      const wrapper = mount(VersionOverlayChart, {
        global: { plugins: [i18n] },
        props: {
          seriesA: [0, 30].map((m) => ({ x: start + m * minute, y: 1 })),
          seriesB: [],
          mode: "sameWallClock",
          serviceVersions: true,
        },
      });
      const ticks = wrapper.findAll("text").map((node) => node.text());
      expect(ticks).toContain("17:46");
      expect(ticks.some((tick) => /AM|PM/i.test(tick))).toBe(false);
      expect(ticks).toContain(formatDeployClock(start * 1000));
    } finally {
      setDeployTimeZone(undefined);
    }
  });

  it("never repeats a time on a short window and steps the ticks evenly", () => {
    const start = Date.UTC(2026, 10, 1, 5, 0, 10);
    const wrapper = mount(VersionOverlayChart, {
      global: { plugins: [i18n] },
      props: {
        seriesA: [0, 30, 60, 90, 120].map((s) => ({ x: start + s * 1000, y: 1 })),
        seriesB: [],
        mode: "sameWallClock",
        serviceVersions: true,
      },
    });
    const ticks = wrapper
      .findAll("text")
      .map((node) => node.text())
      .filter((text) => /\d:\d\d/.test(text));
    expect(ticks.length).toBeGreaterThan(2);
    expect(new Set(ticks).size).toBe(ticks.length);
    const inner = overlayTimeTicks(start, start + 120_000, String)
      .filter((tick) => !tick.edge)
      .map((tick) => tick.at);
    expect(inner.length).toBeGreaterThan(1);
    expect(inner.every((at) => at % 30_000 === 0)).toBe(true);
    expect(new Set(inner.slice(1).map((at, i) => at - inner[i])).size).toBe(1);
  });
});
