import { beforeEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import {
  attachDeployMarkerClicks,
  deployMarkerClickHandler,
  deployMarkerScope,
  panelMetric,
} from "./deployMarkerScope";
const mocks = vi.hoisted(() => ({ config: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/aws-exports", () => ({ default: mocks.config }));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: () => ({ open: vi.fn() }),
}));
const store = { state: { timezone: "Asia/Kolkata", userInfo: { email: "u@example.com" } } };
const variables = (values: Record<string, unknown>) => ({
  values: Object.entries(values).map(([name, value]) => ({ name, value })),
});
const dashboard = (withService = true) =>
  reactive({
    variables: { list: withService ? [{ name: "service" }, { name: "env" }] : [{ name: "env" }] },
    tabs: [
      {
        panels: [
          { id: "p1", config: { show_legends: true } },
          { id: "p2", config: {} },
        ],
      },
    ],
  });
beforeEach(() => {
  mocks.config.isEnterprise = "true";
  mocks.config.isCloud = "false";
});
it("picks each vitals panel's own metric and the overall verdict for the rest", () => {
  const panel = (query: string) => ({ queries: [{ query }] });
  expect(
    panelMetric(panel("SELECT approx_percentile_cont(view_largest_contentful_paint, 0.75)")),
  ).toBe("lcp_p75");
  expect(panelMetric(panel("SELECT max(view_interaction_to_next_paint)"))).toBe("inp_p75");
  expect(panelMetric(panel("SELECT avg(view_cumulative_layout_shift)"))).toBe("cls_p75");
  expect(panelMetric(panel("SELECT count(*) FROM _rumdata"))).toBe("overall");
});
it("scopes markers to one selected service and env, never the all-values sentinel", () => {
  const panel = { queries: [{ query: "x" }] };
  expect(
    deployMarkerScope(panel, variables({ service: "web", env: ["prod"] }), store),
  ).toMatchObject({
    service: "web",
    env: "prod",
    metric: "overall",
    timezone: "Asia/Kolkata",
    user: "u@example.com",
  });
  expect(deployMarkerScope(panel, variables({ service: "_o2_all_" }), store)).toBeUndefined();
  expect(deployMarkerScope(panel, variables({ service: ["a", "b"] }), store)).toBeUndefined();
  expect(deployMarkerScope(panel, variables({ env: "prod" }), store)).toBeUndefined();
  expect(
    deployMarkerScope(panel, variables({ service: "web", env: "_o2_all_" }), store)?.env,
  ).toBeUndefined();
});
it("draws no deploy markers in the open-source build", () => {
  mocks.config.isEnterprise = "false";
  expect(deployMarkerScope({}, variables({ service: "web" }), store)).toBeUndefined();
});
it("attaches the marker click to every panel of a dashboard with a service variable, invisibly to saves", () => {
  const handler = vi.fn();
  const value = dashboard();
  attachDeployMarkerClicks(value, handler);
  const config = value.tabs[0].panels[0].config as Record<string, unknown>;
  expect(config.chart_mark_line_click).toBe(handler);
  expect((value.tabs[0].panels[1].config as Record<string, unknown>).chart_mark_line_click).toBe(
    handler,
  );
  expect(Object.keys(config)).toEqual(["show_legends"]);
  expect(JSON.parse(JSON.stringify(value))).toEqual(JSON.parse(JSON.stringify(dashboard())));
  expect(() => structuredClone(JSON.parse(JSON.stringify(value)))).not.toThrow();
});
it("leaves dashboards without a service variable alone", () => {
  const value = dashboard(false);
  attachDeployMarkerClicks(value, vi.fn());
  expect("chart_mark_line_click" in value.tabs[0].panels[0].config).toBe(false);
});
it("opens the drawer for a keyed marker with its own service and where", () => {
  const open = vi.fn();
  const click = deployMarkerClickHandler(open);
  click({ service: "web", version: "0.0.2", where: "env:prod", deployKey: "dk" });
  click({ version: "0.0.2", where: "env:prod", deployKey: "dk" });
  click({ service: "web", version: "0.0.2", where: "env:prod" });
  expect(open.mock.calls).toEqual([
    [{ service: "web", where: "env:prod", a: "0.0.2", deployKey: "dk" }],
  ]);
});
