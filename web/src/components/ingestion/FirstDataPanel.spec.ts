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
import { computed, h, nextTick, ref, type Component } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import { copyToClipboard } from "@/utils/clipboard";
import analytics from "@/services/product_analytics";
import type {
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import FirstDataPanel from "./FirstDataPanel.vue";

const fake = {
  state: ref<FirstEventState>("waiting"),
  result: ref<FirstEventResult>(),
  diagnosis: ref(),
  startedAtMs: ref<number>(Date.now()),
  troubleshooting: ref(false),
  start: vi.fn(),
  stop: vi.fn(),
  probeNow: vi.fn(),
  troubleshoot: vi.fn(),
};
const watchArgs = vi.fn();
vi.mock("@/composables/firstEvent/useFirstEventWatch", () => ({
  useFirstEventWatch: (...args: unknown[]) => {
    watchArgs(...args);
    return {
      ...fake,
      scope: computed(() => "new-data"),
      sinceUs: computed(() => undefined),
    };
  },
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
const awsConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "true" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));
const credentialApi = vi.hoisted(() => ({
  get_organization_passcode: vi.fn(),
  list_org_ingestion_tokens: vi.fn(),
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: credentialApi });
});

const ORG = "acme-prod";
const PASSCODE = "secret-token-value";
const USER_PASSCODE = "user-passcode-value";
const PICK_KEY = `o2.onboarding.firstSource.${ORG}`;

const routeNames = [
  "logs",
  "dashboards",
  "home",
  "recommended",
  "ingestFromKubernetes",
  "curl",
  "otelCollector",
];

const makeStore = (
  opts: { flag?: boolean; ingested?: boolean; orgName?: string; passcode?: string } = {},
) =>
  createStore({
    state: {
      API_ENDPOINT: "https://api.openobserve.ai",
      zoConfig: {
        restricted_routes_on_empty_data: opts.flag ?? true,
        ingestion_url: "https://api.openobserve.ai",
      },
      userInfo: { email: "dev@acme.io" },
      selectedOrganization: { identifier: ORG, label: opts.orgName },
      organizations: [],
      organizationData: {
        isDataIngested: opts.ingested ?? false,
        organizationPasscode: opts.passcode ?? PASSCODE,
        organizationPasscodeForbidden: false,
        orgTokens: [{ name: "default", token: PASSCODE, enabled: true }],
      },
    },
    mutations: {
      setIsDataIngested(state: any, payload: boolean) {
        state.organizationData.isDataIngested = payload;
      },
      setOrganizationPasscode(state: any, payload: string) {
        state.organizationData.organizationPasscode = payload;
      },
      setOrganizationPasscodeUser() {},
      setOrganizationPasscodeForbidden(state: any, payload: boolean) {
        state.organizationData.organizationPasscodeForbidden = payload;
      },
      setOrgTokens(state: any, payload: unknown[]) {
        state.organizationData.orgTokens = payload;
      },
    },
    actions: {
      setIsDataIngested({ commit }, payload: boolean) {
        commit("setIsDataIngested", payload);
      },
      setOrganizationPasscode({ commit }, payload: string) {
        commit("setOrganizationPasscode", payload);
      },
      setOrganizationPasscodeUser({ commit }, payload: string) {
        commit("setOrganizationPasscodeUser", payload);
      },
      setOrganizationPasscodeForbidden({ commit }, payload: boolean) {
        commit("setOrganizationPasscodeForbidden", payload);
      },
      setOrgTokens({ commit }, payload: unknown[]) {
        commit("setOrgTokens", payload);
      },
    },
  });

let wrapper: VueWrapper;
let router: ReturnType<typeof createRouter>;
let store: ReturnType<typeof makeStore>;

const mountPanel = async (
  props: Record<string, unknown>,
  opts: {
    flag?: boolean;
    ingested?: boolean;
    orgName?: string;
    passcode?: string;
    at?: string;
    slot?: (p: { layout: string; statusLine: Component }) => unknown;
  } = {},
) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: routeNames.map((name) => ({
      path: `/${name}`,
      name,
      component: { template: "<div />" },
    })),
  });
  await router.push(`/${opts.at ?? "logs"}`);
  store = makeStore(opts);
  wrapper = mount(FirstDataPanel, {
    props,
    slots: {
      default: opts.slot ?? (() => h("div", { "data-test": "page-empty-state" }, "existing cards")),
    },
    global: { plugins: [i18n, store, router] },
  });
  // the credential reads settle through the query client's own timer
  for (let i = 0; i < 3; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
  return wrapper;
};
const q = (id: string) => wrapper.find(`[data-test="${id}"]`);
const seedLists = (lists: Partial<Record<"logs" | "metrics" | "traces", unknown[]>>) => {
  for (const [type, list] of Object.entries(lists)) {
    queryClient.setQueryData(streamKeys.nameList(ORG, type), list);
  }
};
const failList = async (type: string, status: number) => {
  await queryClient
    .fetchQuery({
      queryKey: streamKeys.nameList(ORG, type),
      queryFn: () => Promise.reject(Object.assign(new Error("denied"), { response: { status } })),
      retry: false,
    })
    .catch(() => undefined);
};
const watchedSignal = () => (watchArgs.mock.calls[0]?.[1] as { value?: string })?.value;

beforeEach(() => {
  credentialApi.list_org_ingestion_tokens.mockResolvedValue({
    data: { data: [{ name: "default", token: PASSCODE, enabled: true }] },
  });
  credentialApi.get_organization_passcode.mockResolvedValue({
    data: { data: { passcode: USER_PASSCODE, user: "dev@acme.io" } },
  });
  window.localStorage.clear();
  fake.state.value = "waiting";
  fake.result.value = undefined;
  awsConfig.isCloud = "true";
});

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("FirstDataPanel — flag off", () => {
  it("renders the page's own empty state only, with no watcher", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full" }, { flag: false });
    expect(q("page-empty-state").exists()).toBe(true);
    expect(q("first-data-panel").exists()).toBe(false);
    expect(q("first-event-status").exists()).toBe(false);
    expect(watchArgs).not.toHaveBeenCalled();
  });

  it("draws no compact card", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel({ signal: "any", variant: "compact" }, { flag: false, at: "home" });
    expect(wrapper.html()).not.toContain("first-data-panel");
    expect(watchArgs).not.toHaveBeenCalled();
  });
});

describe("FirstDataPanel — full panel on Logs, Traces and Metrics", () => {
  it("shows the pick, its masked command and the status on an org whose only data is metrics", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full" }, { ingested: true });

    const panel = q("first-data-panel");
    expect(panel.attributes("data-signal")).toBe("logs");
    expect(panel.attributes("data-variant")).toBe("full");
    expect(panel.attributes("data-pick")).toBe("kubernetes");
    expect(panel.text()).toContain("Your logs will show up here");
    expect(panel.text()).toContain("No logs have reached acme-prod yet");
    const code = q("first-data-panel-code-block");
    expect(code.exists()).toBe(true);
    expect(code.text()).toContain("install.sh");
    expect(code.text()).toContain("cluster1");
    expect(code.text()).not.toContain(btoa(`dev@acme.io:${PASSCODE}`));
    expect(q("first-data-panel-code-block-token-link").text()).toContain("default");
    expect(q("first-event-status").attributes("data-state")).toBe("waiting");
    expect(q("first-event-status").text()).toContain("Waiting for your first logs");
    expect(q("first-data-panel-open-guide-btn").exists()).toBe(true);
    expect(q("first-data-panel-change-source-link").exists()).toBe(true);
    expect(q("page-empty-state").exists()).toBe(true);
  });

  it("names the org by its name, not its identifier, in the body", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full" }, { orgName: "Acme Production" });
    expect(q("first-data-panel").text()).toContain("No logs have reached Acme Production yet");
    expect(q("first-data-panel").text()).not.toContain(`reached ${ORG}`);
  });

  it("watches only the page's signal", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "traces", variant: "full" });
    expect(watchedSignal()).toBe("traces");
  });

  it("flips the store and hands the result to the page on the first stream", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full" });
    const result: FirstEventResult = {
      streamName: "default",
      streamType: "logs",
      count: 1284,
      rangeStart: 0,
      rangeEnd: 1,
    };
    fake.result.value = result;
    fake.state.value = "received";
    await flushPromises();

    expect(store.state.organizationData.isDataIngested).toBe(true);
    expect(wrapper.emitted("detected")?.[0]).toEqual([result]);
  });

  it("puts the real Logs over HTTP command in the block, the token masked", async () => {
    window.localStorage.setItem(PICK_KEY, "http");
    await mountPanel({ signal: "logs", variant: "full" });
    const code = q("first-data-panel-code-block");
    expect(code.text()).toContain("curl -u dev@acme.io:");
    expect(code.text()).toContain(`/api/${ORG}/default/_json`);
    expect(code.text()).not.toContain(" -k ");
    expect(code.text()).not.toContain(PASSCODE);
    expect(q("first-data-panel-code-block-pre").attributes("style")).toContain("padding: 0.75rem");
  });

  it("restarts the fast cadence and records the copy when the block is copied", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full" });
    wrapper.findComponent({ name: "OCodeBlock" }).vm.$emit("copy", { partial: false });
    await nextTick();
    expect(fake.start).toHaveBeenCalledWith("copy");
    expect(analytics.track).toHaveBeenCalledWith("snippet_copied", {
      route: "logs",
      partial: false,
    });
  });

  it("opens the guide and the source list in one click each", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full" });
    await q("first-data-panel-open-guide-btn").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("ingestFromKubernetes");
    expect(router.currentRoute.value.query.org_identifier).toBe(ORG);
    await q("first-data-panel-change-source-link").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("recommended");
  });

  it("shows the no-access state, no panel and no watcher when the stream list is forbidden (e6)", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await failList("logs", 403);
    await mountPanel({ signal: "logs", variant: "full" });
    expect(q("first-data-panel-no-access").exists()).toBe(true);
    expect(q("first-data-panel").exists()).toBe(false);
    expect(q("page-empty-state").exists()).toBe(false);
    expect(watchArgs).not.toHaveBeenCalled();
  });

  it("keeps the panel when the list failed for another reason", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await failList("logs", 500);
    await mountPanel({ signal: "logs", variant: "full" });
    expect(q("first-data-panel").exists()).toBe(true);
    expect(q("page-empty-state").exists()).toBe(true);
  });
});

describe("FirstDataPanel — no pick or a pick of another signal", () => {
  it.each([
    ["no stored pick", null],
    ["a pick that sends only traces", "llm"],
    ["an unknown stored id", "carrier-pigeon"],
  ])("adds only the status line above the existing cards with %s", async (_label, pickId) => {
    if (pickId) window.localStorage.setItem(PICK_KEY, pickId);
    await mountPanel({ signal: "logs", variant: "full" });
    const line = q("first-data-panel");
    expect(line.attributes("data-pick")).toBe("none");
    expect(line.text()).toContain("Waiting for your first logs");
    expect(q("first-data-panel-code-block").exists()).toBe(false);
    expect(q("first-data-panel-open-guide-btn").exists()).toBe(false);
    expect(q("page-empty-state").text()).toBe("existing cards");
  });
});

describe("FirstDataPanel — compact card on Dashboards and Home", () => {
  it("shows the pick, the pill, Copy command and Open the guide on an empty org", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [{ name: "usage", stream_type: "logs" }], metrics: [], traces: [] });
    await mountPanel({ signal: "any", variant: "compact" }, { at: "dashboards" });

    const panel = q("first-data-panel");
    expect(panel.attributes("data-variant")).toBe("compact");
    expect(panel.attributes("data-signal")).toBe("any");
    expect(panel.text()).toContain("No data in acme-prod yet");
    expect(panel.text()).toContain("Dashboards fill in once your Kubernetes setup");
    expect(q("first-event-status").text()).toContain("Waiting for first data");
    expect(q("first-data-panel-code-block").exists()).toBe(false);
    expect(watchedSignal()).toBeUndefined();

    await q("first-data-panel-copy-btn").trigger("click");
    await flushPromises();
    const copied = vi.mocked(copyToClipboard).mock.calls[0][0];
    expect(copied).toContain("install.sh");
    expect(copied).toContain(btoa(`dev@acme.io:${PASSCODE}`));
    expect(fake.start).toHaveBeenCalledWith("copy");
    expect(q("first-data-panel-open-guide-btn").exists()).toBe(true);
  });

  it("titles the card with the org name, not its identifier", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel(
      { signal: "any", variant: "compact" },
      { at: "dashboards", orgName: "Acme Production" },
    );
    expect(q("first-data-panel").text()).toContain("No data in Acme Production yet");
    expect(q("first-data-panel").text()).not.toContain(`No data in ${ORG}`);
  });

  it("names the org from the org list when the selection has no label", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel({ signal: "any", variant: "compact" }, { at: "dashboards" });
    store.state.organizations = [{ identifier: ORG, name: "Acme Production" }];
    await flushPromises();
    expect(q("first-data-panel").text()).toContain("No data in Acme Production yet");
  });

  it("speaks for the Home tab it stands in for, the command line in its own span", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel({ signal: "any", variant: "compact", context: "overview" }, { at: "home" });
    const spans = q("first-data-panel-compact-text").findAll("span");
    expect(spans.map((sp) => sp.text())).toEqual([
      "Incidents, anomalies and service health show here once your Kubernetes setup sends its first records.",
      "Your command is one click away.",
    ]);
    await wrapper.setProps({ context: "usage" });
    expect(q("first-data-panel-compact-text").text()).toContain(
      "Streams, events and ingested size show here once your Kubernetes setup",
    );
  });

  it("stays hidden until MainLayout's lists say the org is empty, so an org with data never sees it", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "any", variant: "compact" }, { at: "home" });
    expect(q("first-data-panel").exists()).toBe(false);
    expect(watchArgs).not.toHaveBeenCalled();

    seedLists({ logs: [{ name: "app", stream_type: "logs" }], metrics: [], traces: [] });
    await flushPromises();
    expect(q("first-data-panel").exists()).toBe(false);
  });

  it("stays hidden once the org has data", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel({ signal: "any", variant: "compact" }, { at: "home", ingested: true });
    expect(q("first-data-panel").exists()).toBe(false);
  });
});

describe("FirstDataPanel — the page's empty state places the status line (e1, e2)", () => {
  const pageState = (p: { layout: string; statusLine: Component }) =>
    h("div", { "data-test": "page-empty-state", "data-layout": p.layout }, [
      h("p", { "data-test": "page-copy" }, "copy"),
      p.layout === "status" ? h(p.statusLine) : null,
      h("p", { "data-test": "page-cards" }, "cards"),
    ]);
  const order = () =>
    wrapper
      .findAll("[data-test]")
      .map((el) => el.attributes("data-test"))
      .filter((id) => ["page-copy", "first-data-panel", "page-cards"].includes(id ?? ""));

  it("hands the no-pick status line to the page, which draws it between its copy and its cards (e2)", async () => {
    await mountPanel({ signal: "logs", variant: "full", statusInSlot: true }, { slot: pageState });
    expect(q("page-empty-state").attributes("data-layout")).toBe("status");
    expect(wrapper.findAll('[data-test="first-data-panel"]')).toHaveLength(1);
    expect(order()).toEqual(["page-copy", "first-data-panel", "page-cards"]);
    const line = q("first-data-panel");
    expect(line.attributes("data-pick")).toBe("none");
    expect(line.attributes("data-signal")).toBe("logs");
    expect(line.text()).toContain("Waiting for your first logs");
  });

  it("flips the store and hands the result to the page from the handed status line", async () => {
    await mountPanel({ signal: "logs", variant: "full", statusInSlot: true }, { slot: pageState });
    const result: FirstEventResult = {
      streamName: "default",
      streamType: "logs",
      count: 3,
      rangeStart: 0,
      rangeEnd: 1,
    };
    fake.result.value = result;
    fake.state.value = "received";
    await flushPromises();
    expect(store.state.organizationData.isDataIngested).toBe(true);
    expect(wrapper.emitted("detected")?.[0]).toEqual([result]);
  });

  it("tells the page the pick's card is drawn above it, so it keeps only its alternatives (e1)", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await mountPanel({ signal: "logs", variant: "full", statusInSlot: true }, { slot: pageState });
    expect(q("page-empty-state").attributes("data-layout")).toBe("panel");
    expect(q("first-data-panel").attributes("data-pick")).toBe("kubernetes");
    expect(order()).toEqual(["first-data-panel", "page-copy", "page-cards"]);
  });

  it("reports no layout with the flag off, so the page renders unchanged", async () => {
    await mountPanel(
      { signal: "logs", variant: "full", statusInSlot: true },
      { flag: false, slot: pageState },
    );
    expect(q("page-empty-state").attributes("data-layout")).toBe("none");
    expect(q("first-data-panel").exists()).toBe(false);
  });

  it("draws the status line itself above the slot when the page does not opt in", async () => {
    await mountPanel(
      { signal: "logs", variant: "full" },
      { slot: () => h("p", { "data-test": "page-copy" }, "existing cards") },
    );
    expect(order()).toEqual(["first-data-panel", "page-copy"]);
    expect(q("first-data-panel").attributes("data-pick")).toBe("none");
  });
});

describe("FirstDataPanel — Home layouts", () => {
  const layoutOf = (p: { layout: string; statusLine: Component }) =>
    h("div", { "data-test": "page-empty-state", "data-layout": p.layout }, [
      p.layout === "status" ? h(p.statusLine) : null,
    ]);
  const homeProps = { signal: "any", variant: "compact", statusInSlot: true, context: "overview" };
  const layout = () => q("page-empty-state").attributes("data-layout");

  it("holds the page in pending, with no watcher, until MainLayout's lists are known", async () => {
    await mountPanel(homeProps, { at: "home", slot: layoutOf });
    expect(layout()).toBe("pending");
    expect(watchArgs).not.toHaveBeenCalled();

    seedLists({ logs: [], metrics: [], traces: [] });
    await flushPromises();
    expect(layout()).toBe("status");
  });

  it("keeps the card and its watcher while the watcher's list refresh shows the stream it is confirming", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel(homeProps, { at: "home", slot: layoutOf });
    expect(layout()).toBe("card");

    seedLists({ logs: [{ name: "default", stream_type: "logs" }] });
    await flushPromises();
    expect(layout()).toBe("card");
    expect(q("first-event-status").exists()).toBe(true);
  });

  it("waits for the watcher's confirmation when another list read flips the store first", async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(PICK_KEY, "kubernetes");
      seedLists({ logs: [], metrics: [], traces: [] });
      await mountPanel(homeProps, { at: "home", slot: layoutOf });
      store.state.organizationData.isDataIngested = true;
      await flushPromises();
      expect(layout()).toBe("card");

      const result: FirstEventResult = {
        streamName: "default",
        streamType: "logs",
        count: 3,
        rangeStart: 0,
        rangeEnd: 1,
      };
      fake.result.value = result;
      fake.state.value = "received";
      await flushPromises();
      expect(wrapper.emitted("detected")?.[0]).toEqual([result]);
      expect(layout()).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the page mount its own view when no confirmation follows the store flip", async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem(PICK_KEY, "kubernetes");
      seedLists({ logs: [], metrics: [], traces: [] });
      await mountPanel(homeProps, { at: "home", slot: layoutOf });
      store.state.organizationData.isDataIngested = true;
      await flushPromises();
      expect(layout()).toBe("card");
      vi.advanceTimersByTime(10_000);
      await flushPromises();
      expect(layout()).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an org with data mount its own view once the lists arrive", async () => {
    await mountPanel(homeProps, { at: "home", slot: layoutOf });
    seedLists({ logs: [{ name: "app", stream_type: "logs" }], metrics: [], traces: [] });
    await flushPromises();
    expect(layout()).toBe("none");
  });

  it.each([
    ["no pick", null, "status"],
    ["a pick", "kubernetes", "card"],
  ])(
    "keeps the empty state and the pill when a list failed for another reason, with %s",
    async (_label, pickId, expected) => {
      if (pickId) window.localStorage.setItem(PICK_KEY, pickId);
      for (const type of ["logs", "metrics", "traces"]) await failList(type, 500);
      await mountPanel(homeProps, { at: "home", slot: layoutOf });
      expect(layout()).toBe(expected);
      expect(q("first-event-status").exists()).toBe(true);
      expect(watchArgs).toHaveBeenCalled();
    },
  );

  it("still lets an org known to hold data mount its own view when a list failed", async () => {
    await failList("logs", 500);
    await mountPanel(homeProps, { at: "home", ingested: true, slot: layoutOf });
    expect(layout()).toBe("none");
  });

  it("hands a no-pick status line laid out for a hero", async () => {
    window.localStorage.setItem(PICK_KEY, "unsure");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel(homeProps, { at: "home", slot: layoutOf });
    expect(layout()).toBe("status");
    expect(q("first-data-panel").classes()).toContain("justify-center");
  });

  it("reports card when it draws the compact card above the page", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel(homeProps, { at: "home", slot: layoutOf });
    expect(layout()).toBe("card");
    expect(q("first-data-panel").attributes("data-variant")).toBe("compact");
  });

  it("reports forbidden when a stream list answers 403 and the org is not known to hold data", async () => {
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    await failList("logs", 403);
    await mountPanel(homeProps, { at: "home", slot: layoutOf });
    expect(layout()).toBe("forbidden");
    expect(q("first-data-panel").exists()).toBe(false);
    expect(watchArgs).not.toHaveBeenCalled();
  });

  it("does not report forbidden once the org holds data, or with the flag off", async () => {
    await failList("logs", 403);
    await mountPanel(homeProps, { at: "home", ingested: true, slot: layoutOf });
    expect(layout()).toBe("none");
    wrapper.unmount();
    await mountPanel(homeProps, { at: "home", flag: false, slot: layoutOf });
    expect(layout()).toBe("none");
  });
});

describe("FirstDataPanel — the org credential, loaded where the snippet is", () => {
  const ORG_TOKEN = "org-token-value-123";
  const tokenRow = { name: "ci-token", token: ORG_TOKEN, enabled: true };
  const decodedAccessKey = (copied: string) => {
    const key = copied.match(/--access-key=["']?([A-Za-z0-9+/=]+)/)?.[1] ?? "";
    return atob(key);
  };

  it("loads the credential itself on Home and copies the org token, not an empty password", async () => {
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [tokenRow] } });
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel(
      { signal: "any", variant: "compact", context: "overview" },
      { at: "home", passcode: "" },
    );

    await q("first-data-panel-copy-btn").trigger("click");
    await flushPromises();
    expect(decodedAccessKey(vi.mocked(copyToClipboard).mock.calls[0][0])).toBe(
      `dev@acme.io:${ORG_TOKEN}`,
    );
  });

  it("puts the loaded credential in the empty Logs page's block", async () => {
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    window.localStorage.setItem(PICK_KEY, "http");
    await mountPanel({ signal: "logs", variant: "full" }, { passcode: "" });

    const code = wrapper.findComponent({ name: "OCodeBlock" }).props("code") as string;
    expect(code).toContain(`curl -u dev@acme.io:${USER_PASSCODE} `);
  });

  it("offers no command while the credential is unknown, so nothing empty is copied", async () => {
    credentialApi.get_organization_passcode.mockReturnValue(new Promise(() => {}));
    window.localStorage.setItem(PICK_KEY, "kubernetes");
    seedLists({ logs: [], metrics: [], traces: [] });
    await mountPanel({ signal: "any", variant: "compact" }, { at: "dashboards", passcode: "" });
    expect(q("first-data-panel").exists()).toBe(true);
    expect(q("first-data-panel-copy-btn").exists()).toBe(false);
    wrapper.unmount();

    await mountPanel({ signal: "logs", variant: "full" }, { passcode: "" });
    expect(q("first-data-panel").exists()).toBe(true);
    expect(q("first-data-panel-code-block").exists()).toBe(false);
  });

  it("asks for no credential with the flag off", async () => {
    window.localStorage.setItem(PICK_KEY, "http");
    await mountPanel({ signal: "logs", variant: "full" }, { flag: false, passcode: "" });
    expect(credentialApi.get_organization_passcode).not.toHaveBeenCalled();
    expect(credentialApi.list_org_ingestion_tokens).not.toHaveBeenCalled();
  });
});

describe("FirstDataPanel — first data arrived strip (e5)", () => {
  it("offers Open in Logs and drops 'loading them below' on a compact page", async () => {
    await mountPanel({
      signal: "any",
      variant: "compact",
      arrived: {
        streamName: "default",
        streamType: "logs",
        count: 1204,
        rangeStart: 0,
        rangeEnd: 1,
      },
    });
    expect(q("first-data-panel-arrived-summary").text()).toBe("1,204 records in stream default");
    const open = q("first-data-panel-arrived-open-btn");
    expect(open.text()).toBe("Open in Logs");
    await open.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("states the records and stream, and closes", async () => {
    await mountPanel({
      signal: "logs",
      variant: "full",
      arrived: {
        streamName: "default",
        streamType: "logs",
        count: 1284,
        rangeStart: 0,
        rangeEnd: 1,
      },
    });
    const strip = q("first-data-panel-arrived");
    expect(strip.text()).toContain("Your first logs arrived");
    expect(q("first-data-panel-arrived-summary").text()).toBe(
      "1,284 records in stream default · loading them below",
    );
    expect(q("page-empty-state").exists()).toBe(false);
    expect(watchArgs).not.toHaveBeenCalled();
    await q("first-data-panel-arrived-dismiss-btn").trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });
});
