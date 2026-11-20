// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import en from "@/locales/languages/en-US.json";
import type { CompareResponse } from "@/services/service_versions";
import Chart from "./RumVersionChart.vue";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
function translate(key: string, params: Record<string, unknown> = {}) {
  const text = key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
  return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: translate }),
}));
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { name: "PanelSchemaRenderer", template: "<div />" },
}));
const e2 = () => structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
function lineFor(result: CompareResponse, arm: "a" | "b") {
  const wrapper = mount(Chart, {
    props: { result, metric: "inp_p75" },
    global: { stubs: { OButton: true } },
  });
  return wrapper.get(`[data-test="svcver-overlay-line-${arm}"]`).attributes("d")!;
}
const moves = (path: string) => path.match(/M/g)?.length ?? 0;
describe("RUM before/after chart gaps on the real overlay renderer", () => {
  it("breaks the line at an interior bucket with no samples instead of joining across it", () => {
    const result = e2();
    const points = result.rum_series!.a!.inp_p75.points;
    expect(points.length).toBeGreaterThanOrEqual(3);
    points[1] = { ...points[1], value: null, n: 0 };
    const path = lineFor(result, "a");
    expect(moves(path)).toBe(2);
    expect(path.split(" ")).toHaveLength(points.length - 1);
  });
  it("keeps one unbroken line when only leading buckets are empty", () => {
    const result = e2();
    const points = result.rum_series!.b!.inp_p75.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    points[0] = { ...points[0], value: null, n: 0 };
    expect(moves(lineFor(result, "b"))).toBe(1);
    expect(moves(lineFor(result, "a"))).toBe(1);
  });
});
