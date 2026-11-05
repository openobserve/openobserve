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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { computed, defineComponent, h, provide, ref, type Ref } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";

import { GO_TO_PAGES, type GoToMatch, type GoToPage } from "./types";
import {
  DASHBOARD_SEARCH_DEBOUNCE_MS,
  goToGroupOf,
  goToTokens,
  matchGoTo,
  openGoToMatch,
  useGoToIndex,
  type GoToCandidate,
} from "./useGoToIndex";
import { HOME_RETURN_QUERY_KEY } from "./homeReturn";

const api = vi.hoisted(() => ({
  folders: vi.fn(),
  alerts: vi.fn(),
  dashboards: vi.fn(),
}));

vi.mock("@/services/common", () => ({ default: { list_Folders: api.folders } }));
vi.mock("@/services/alerts", () => ({ default: { listByFolderId: api.alerts } }));
vi.mock("@/services/dashboards", () => ({ default: { list: api.dashboards } }));

const PAGES: GoToPage[] = [
  { id: "home", label: raw("Home"), route: { path: "/" } },
  { id: "logs", label: raw("Logs"), route: { path: "/logs" } },
  { id: "traces", label: raw("Traces"), route: { path: "/traces" } },
  {
    id: "traces:service-graph",
    label: raw("Service graph"),
    group: raw("Traces"),
    route: { name: "traces", query: { tab: "service-graph" } },
  },
  { id: "alertList", label: raw("Alerts"), group: raw("Reliability"), route: { path: "/alerts" } },
  { id: "dashboards", label: raw("Dashboards"), route: { path: "/dashboards" } },
];

const FOLDERS = {
  alerts: [
    { name: "default", folderId: "default", description: "" },
    { name: "Payments", folderId: "f-pay", description: "" },
  ],
  dashboards: [{ name: "Checkout", folderId: "d-chk", description: "" }],
};

const candidate = (label: string, terms: string[] = []): GoToCandidate => ({
  match: { id: label, kind: "page", label: raw(label), exact: false },
  group: "pages",
  terms,
});

describe("goToTokens / matchGoTo", () => {
  it("drops the stop words and splits on separators", () => {
    expect(goToTokens("Show me the Traces › service-graph")).toEqual([
      "traces",
      "service",
      "graph",
    ]);
  });

  it("needs every token to start some label, group or folder token", () => {
    const rows = matchGoTo("serv gr", [candidate("Service graph"), candidate("Services")]);
    expect(rows.map((row) => row.id)).toEqual(["Service graph"]);
  });

  it("ranks label-start matches first, then shorter labels", () => {
    const rows = matchGoTo("logs", [
      candidate("Pipelines", ["logs"]),
      candidate("Logs explorer"),
      candidate("Logs"),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["Logs", "Logs explorer", "Pipelines"]);
  });

  it("marks exact only when the whole input is the label", () => {
    const rows = matchGoTo("logs", [candidate("Logs"), candidate("Logs explorer")]);
    expect(rows.map((row) => row.exact)).toEqual([true, false]);
    expect(matchGoTo("log", [candidate("Logs")])[0].exact).toBe(false);
  });

  it("matches nothing for stop words alone", () => {
    expect(matchGoTo("show me the", [candidate("Home")])).toEqual([]);
  });
});

describe("useGoToIndex", () => {
  let wrapper: VueWrapper | undefined;

  const mountIndex = async (
    text: Ref<string>,
    opts: { canAsk?: boolean; pages?: GoToPage[] } = {},
  ): Promise<{ matches: () => GoToMatch[] }> => {
    let index: ReturnType<typeof useGoToIndex> | undefined;
    const Harness = defineComponent({
      setup() {
        index = useGoToIndex(text, { canAsk: opts.canAsk ?? true });
        return () => h("div");
      },
    });
    const Host = defineComponent({
      setup() {
        provide(
          GO_TO_PAGES,
          computed(() => opts.pages ?? PAGES),
        );
        return () => h(Harness);
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(Host, {
      global: { plugins: [i18n, store, [VueQueryPlugin, { queryClient }]] },
    });
    await flushPromises();
    return { matches: () => index!.matches.value };
  };

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(DASHBOARD_SEARCH_DEBOUNCE_MS + 10);
    await flushPromises();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    api.folders.mockImplementation((_org: string, type: "alerts" | "dashboards") =>
      Promise.resolve({ data: { list: FOLDERS[type] } }),
    );
    api.alerts.mockResolvedValue({
      data: {
        list: [
          { alert_id: "a1", name: "Card declines", folder_id: "f-pay", folder_name: "Payments" },
          { alert_id: "a2", name: "Disk full", folder_id: "default", folder_name: "default" },
        ],
      },
    });
    api.dashboards.mockResolvedValue({
      data: {
        dashboards: [
          {
            dashboard_id: "d1",
            title: "Checkout latency",
            folder_id: "d-chk",
            folder_name: "Checkout",
          },
        ],
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
    vi.clearAllMocks();
    resetListViewState();
  });

  it("finds the Payments alert folder for “alerts for payments”", async () => {
    const { matches } = await mountIndex(ref("alerts for payments"));
    const first = matches()[0];
    expect(first.kind).toBe("alert_folder");
    expect(String(first.label)).toBe("Payments");
    expect(String(first.secondary)).toBe("Alerts");
    expect(first.route).toEqual({
      name: "alertList",
      query: { folder: "f-pay", org_identifier: "default" },
    });
  });

  it.each([
    ["home", "page:home"],
    ["logs", "page:logs"],
    ["service graph", "page:traces:service-graph"],
  ])("matches %s to its menu page", async (text, id) => {
    const { matches } = await mountIndex(ref(text));
    expect(matches()[0].id).toBe(id);
    expect(matches()[0].exact).toBe(true);
  });

  it("offers only Ask for a question", async () => {
    const { matches } = await mountIndex(ref("why is checkout-api failing"));
    expect(matches().map((row) => row.kind)).toEqual(["ask"]);
    expect(String(matches()[0].label)).toBe("Ask: why is checkout-api failing");
  });

  it("keeps Ask last and drops it when the assistant cannot chat", async () => {
    const text = ref("traces");
    const on = await mountIndex(text);
    expect(on.matches().at(-1)?.kind).toBe("ask");
    wrapper?.unmount();
    const off = await mountIndex(text, { canAsk: false });
    expect(off.matches().some((row) => row.kind === "ask")).toBe(false);
  });

  it("marks exact only on whole-label input", async () => {
    const text = ref("trac");
    const { matches } = await mountIndex(text);
    expect(matches().filter((row) => row.exact)).toEqual([]);
    text.value = "traces";
    await flushPromises();
    expect(matches().find((row) => row.id === "page:traces")?.exact).toBe(true);
  });

  it("searches dashboards by the typed text, debounced, from two characters", async () => {
    const text = ref("c");
    const { matches } = await mountIndex(text);
    await settle();
    expect(api.dashboards).not.toHaveBeenCalled();
    text.value = "checkout lat";
    await flushPromises();
    expect(api.dashboards).not.toHaveBeenCalled();
    await settle();
    expect(api.dashboards).toHaveBeenCalledTimes(1);
    expect(api.dashboards.mock.calls[0][7]).toBe("checkout lat");
    const row = matches().find((m) => m.kind === "dashboard");
    expect(row?.route).toEqual({
      name: "viewDashboard",
      query: { dashboard: "d1", folder: "d-chk", org_identifier: "default" },
    });
  });

  it("ends Dashboards with a more row at 100 hits", async () => {
    api.dashboards.mockResolvedValue({
      data: {
        dashboards: Array.from({ length: 100 }, (_, i) => ({
          dashboard_id: `d${i}`,
          title: `Checkout ${i}`,
          folder_id: "default",
        })),
      },
    });
    const text = ref("checkout");
    const { matches } = await mountIndex(text);
    await settle();
    const dashboards = matches().filter((m) => goToGroupOf(m) === "dashboards");
    expect(dashboards.filter((m) => m.kind === "dashboard")).toHaveLength(4);
    expect(dashboards.at(-1)?.id).toBe("more:dashboards");
    expect(String(dashboards.at(-1)?.label)).toBe("Search dashboards for “checkout”");
  });

  it("ends Alerts with a more row when the list hits 1000", async () => {
    api.alerts.mockResolvedValue({
      data: {
        list: Array.from({ length: 1000 }, (_, i) => ({
          alert_id: `a${i}`,
          name: `Rule ${i}`,
          folder_id: "default",
        })),
      },
    });
    const { matches } = await mountIndex(ref("rule"));
    const alerts = matches().filter((m) => goToGroupOf(m) === "alerts");
    expect(alerts.filter((m) => m.kind === "alert")).toHaveLength(5);
    expect(alerts.at(-1)?.id).toBe("more:alerts");
  });

  it("lists the groups in order, five rows each", async () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      label: raw(`Payments page ${i}`),
      route: { path: `/p${i}` },
    }));
    const { matches } = await mountIndex(ref("pay"), {
      pages: [...pages, ...PAGES],
    });
    const groups = matches().map((m) => goToGroupOf(m));
    expect(groups.filter((g) => g === "pages")).toHaveLength(5);
    expect(groups).toEqual([...groups].sort((a, b) => order(a) - order(b)));
  });

  it("offers no page, folder or alert the menu does not show", async () => {
    const { matches } = await mountIndex(ref("payments"), {
      pages: PAGES.filter((p) => p.id !== "alertList"),
    });
    expect(matches().some((m) => m.kind === "alert_folder" || m.kind === "alert")).toBe(false);
    expect(api.alerts).not.toHaveBeenCalled();
    expect(api.folders).not.toHaveBeenCalledWith("default", "alerts", expect.anything());
  });

  it("returns nothing for empty input", async () => {
    const { matches } = await mountIndex(ref("  "));
    expect(matches()).toEqual([]);
  });
});

describe("openGoToMatch", () => {
  afterEach(() => resetListViewState());

  it("pushes the route, through home_return when the trip started on Home", () => {
    const push = vi.fn();
    const match: GoToMatch = {
      id: "page:logs",
      kind: "page",
      label: raw("Logs"),
      route: { path: "/logs", query: { org_identifier: "default" } },
      exact: true,
    };
    openGoToMatch(match, { push } as never, "logs");
    expect(push).toHaveBeenLastCalledWith(match.route);
    openGoToMatch(match, { push } as never, "logs", { focus: "ask" });
    expect(push.mock.calls[1][0].query).toEqual({
      [HOME_RETURN_QUERY_KEY]: "focus=ask",
      org_identifier: "default",
    });
  });

  it("hands a more row's text to the list page's search across folders", () => {
    const push = vi.fn();
    openGoToMatch(
      {
        id: "more:alerts",
        kind: "more",
        label: raw("x"),
        route: { name: "alertList" },
        exact: false,
      },
      { push } as never,
      "card",
    );
    const view = useListViewState("alerts", { searchQuery: "", searchAcrossFolders: false });
    expect(view.searchQuery).toBe("card");
    expect(view.searchAcrossFolders).toBe(true);
  });
});

function order(group: ReturnType<typeof goToGroupOf>): number {
  return group ? ["pages", "alertFolders", "alerts", "dashboards"].indexOf(group) : 9;
}
