// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import golden from "@/test/unit/fixtures/serviceVersions/stage5.json";
import { queryClient } from "@/composables/query/queryClient";
import { useAnnotations } from "@/composables/dashboard/useAnnotations";
import { convertPanelData } from "./convertPanelData";
import { hasAnnotationTopLabels, reserveAnnotationLabelRoom } from "./markLineLabelRoom";

const mocks = vi.hoisted(() => ({ deploys: vi.fn(), manual: vi.fn() }));
vi.mock("@/services/service_versions", async (original) => {
  const actual = await original<{ default: object }>();
  return { ...actual, default: { ...actual.default, deploys: mocks.deploys } };
});
vi.mock("@/services/dashboard_annotations", async (original) => {
  const actual = await original<{ annotationService: object }>();
  return {
    ...actual,
    annotationService: { ...actual.annotationService, get_timed_annotations: mocks.manual },
  };
});
vi.mock("@/utils/chartTheme", async (original) => ({
  ...(await original<object>()),
  chartColor: (token: string) => token,
}));

const deploys = golden.deploys.deploys;
const at = deploys[0].at;
const manual = {
  annotation_id: "m1",
  title: "maintenance",
  text: "",
  tags: [],
  panels: ["p1"],
  start_time: at + 60_000_000,
  end_time: null,
};
const store = {
  state: { timezone: "UTC", theme: "light", selectedOrganization: { identifier: "org" } },
};
const sqlPanel = {
  id: "p1",
  type: "line",
  queryType: "sql",
  title: "p",
  queries: [
    {
      query: "select",
      customQuery: false,
      fields: {
        stream: "s",
        x: [
          { label: "", alias: "x_axis_1", column: "_timestamp", aggregationFunction: "histogram" },
        ],
        y: [{ label: "", alias: "y_axis_1", column: "x", aggregationFunction: "count" }],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: {},
    },
  ],
  config: { show_legends: true, unit: null, decimals: 2 },
};
const iso = (offsetMinutes: number) =>
  new Date(at / 1000 + offsetMinutes * 60_000).toISOString().slice(0, 19);
const sqlData = [
  [-2, -1, 0, 1, 2].map((minute, i) => ({ x_axis_1: iso(minute), y_axis_1: i + 3 })),
];

function panelRef() {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetWidth", { value: 600 });
  Object.defineProperty(el, "offsetHeight", { value: 300 });
  Object.defineProperty(el, "clientWidth", { value: 600 });
  Object.defineProperty(el, "clientHeight", { value: 300 });
  return { value: el };
}

async function annotations(withManual: boolean, withDeploys: boolean) {
  mocks.manual.mockResolvedValue({ data: withManual ? [manual] : [] });
  mocks.deploys.mockResolvedValue({ data: { deploys: withDeploys ? deploys : [] } });
  const scope = () => ({
    service: "store",
    metric: "overall",
    timezone: "UTC",
    user: "u@example.com",
    t: ((key: string) => key) as never,
  });
  const list = await useAnnotations("org", "dash", "p1", true, scope).refreshAnnotations(
    at - 3_600_000_000,
    at + 3_600_000_000,
  );
  return { value: list ?? [] };
}

async function sqlOptions(list: { value: unknown[] }) {
  const result: any = await convertPanelData(
    sqlPanel,
    sqlData,
    store,
    panelRef(),
    { value: null },
    { value: [] },
    {},
    { height: "300px" },
    list,
  );
  return result.options;
}

const markLineItems = (options: any) =>
  options.series.flatMap((series: any) => series.markLine?.data ?? []);

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
});

describe("annotation label room on dashboard panels", () => {
  it.each([
    ["deploy markers", false, true],
    ["a manual annotation", true, false],
    ["deploy markers and a manual annotation", true, true],
  ])("moves only the grid top down for %s so the end labels sit inside", async (_, m, d) => {
    const plain = await sqlOptions({ value: [] });
    const options = await sqlOptions(await annotations(m, d));
    const items = markLineItems(options).filter((item: any) => item.annotationDetails);
    expect(items.length).toBe((m ? 1 : 0) + (d ? deploys.length : 0));
    expect(items.every((item: any) => (item.label?.position ?? "end") === "end")).toBe(true);
    expect(options.grid).toEqual({ ...plain.grid, top: 24 });
  });
});

describe("reserveAnnotationLabelRoom", () => {
  const deployItem = { xAxis: 1, annotationDetails: {}, label: { show: true, position: "end" } };
  const shaped = (grid: unknown, data: unknown[]) => ({
    options: { grid, series: [{ markLine: { data } }] },
  });

  it("ignores threshold lines, hidden labels and inside positions", () => {
    for (const item of [
      { yAxis: 5, xAxis: null, label: { show: true, position: "insideEndTop" } },
      { xAxis: 3, label: { show: true, position: "insideEndTop" } },
      { ...deployItem, label: { show: false } },
      { ...deployItem, label: { show: true, position: "insideEndTop" } },
      { xAxis: 1, label: { show: true } },
    ]) {
      const input = shaped({ top: 12 }, [item]);
      expect(reserveAnnotationLabelRoom(input)).toBe(input);
    }
  });

  it("leaves trellis grids, percentage tops and roomier grids unchanged", () => {
    for (const grid of [[{ top: "5%" }], { top: "15%" }, { top: 40 }, undefined]) {
      const input = shaped(grid, [deployItem]);
      expect(reserveAnnotationLabelRoom(input)).toBe(input);
    }
    expect(hasAnnotationTopLabels([{ markLine: { data: [deployItem] } }])).toBe(true);
    expect(hasAnnotationTopLabels(undefined)).toBe(false);
  });
});
