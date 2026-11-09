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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import { alertRow, incidentRow, serviceRow } from "./homeFixtures";
import AssistantHomeTab from "./AssistantHomeTab.vue";

const mocks = vi.hoisted(() => ({
  state: { value: "ai" as string },
  offReason: { value: null as string | null },
  lgUp: { value: true },
  rows: { value: [] as unknown[] },
  load: vi.fn(),
  setRange: vi.fn(),
  push: vi.fn(),
  provider: vi.fn(),
  history: vi.fn(),
  historyRows: [] as unknown[],
  sessions: {} as Record<string, { turn: { state: string } }>,
  runRows: [] as { group: string; otherOrg?: boolean }[],
  incidentsOn: { value: false },
  listOrgRcaRuns: vi.fn(),
}));

vi.mock("./useAgentHomeState", async () => {
  const { computed, reactive: live } = await import("vue");
  const state = live(mocks.state);
  const off = live(mocks.offReason);
  return {
    useAgentHomeState: () => ({
      state: computed(() => state.value),
      offReason: computed(() => off.value),
    }),
  };
});
vi.mock("./useHomeNowData", async (importOriginal) => {
  const { computed, reactive: live, ref } = await import("vue");
  const rows = live(mocks.rows);
  const incidentsOn = live(mocks.incidentsOn);
  return {
    homeRunsOf: (await importOriginal<typeof import("./useHomeNowData")>()).homeRunsOf,
    useHomeNowData: () => {
      const selectedKey = ref<string | null>(null);
      const snapshot = computed(() => ({
        rows: rows.value,
        selectedKey: selectedKey.value,
        window: { start: 0, end: 86_400_000_000 },
        services: {
          available: true,
          partial: false,
          dataUntil: null,
          window: null,
          allRegions: false,
        },
        noData: false,
      }));
      return {
        nowList: { selectedKey, snapshot, state: ref(null) },
        range: ref({ type: "relative", period: "24h" }),
        window: ref({ start: 0, end: 86_400_000_000 }),
        incidents: ref(null),
        trend: ref(null),
        alertList: ref([]),
        topology: ref(null),
        pending: ref(false),
        failedSources: ref([]),
        deniedSources: ref([]),
        sources: ref(["events"]),
        trendCapped: ref(false),
        tracesLocked: ref(false),
        alertsLocked: ref(false),
        incidentsOn: computed(() => incidentsOn.value),
        timezone: ref("UTC"),
        org: ref("default"),
        load: mocks.load,
        setRange: mocks.setRange,
      };
    },
  };
});
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive: live } = await import("vue");
  const lg = live(mocks.lgUp);
  return { default: () => ({ lgUp: computed(() => lg.value) }) };
});
vi.mock("@/composables/assistant", () => ({
  useAssistantHistory: () => {
    mocks.history();
    return { recent: () => ({ value: mocks.historyRows }) };
  },
  useAssistantStore: () => ({ state: { sessions: mocks.sessions } }),
  useAssistantRuns: () => ({ rows: { value: mocks.runRows } }),
  openAssistant: vi.fn(),
}));
vi.mock("@/services/rca_runs_org", () => ({ listOrgRcaRuns: mocks.listOrgRcaRuns }));
vi.mock("@/composables/contextProviders/homeContextProvider", () => ({
  useHomeContextProvider: mocks.provider,
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({
    push: mocks.push,
    replace: vi.fn(),
    currentRoute: { value: { name: "elsewhere", query: {} } },
  }),
}));
vi.mock("@/components/ai-assistant/welcome/AssistantLauncher.vue", () => ({
  default: {
    name: "AssistantLauncher",
    props: ["layout", "goToOnly", "pageRange"],
    template:
      '<div data-test="launcher-stub" :data-layout="layout" :data-go-to="goToOnly ? \'yes\' : \'no\'"><slot name="note" /></div>',
  },
}));
vi.mock("./AgentHomeAskNote.vue", () => ({
  default: {
    name: "AgentHomeAskNote",
    props: ["reason"],
    template: '<p data-test="ask-note-stub" :data-reason="reason" />',
  },
}));
vi.mock("./HomeNowList.vue", () => ({
  default: {
    name: "HomeNowList",
    props: [
      "variant",
      "snapshot",
      "createAlert",
      "rowMeta",
      "clearText",
      "incidentRuns",
      "failedRuns",
    ],
    template:
      "<section :data-test=\"`now-list-${variant ?? 'now'}`\" :data-rows=\"snapshot.rows.map((r) => r.key).join(',')\" :data-create=\"createAlert ? String(createAlert.enabled) : 'none'\" :data-clear=\"clearText ?? ''\" :data-runs=\"incidentRuns ? [...incidentRuns.keys()].join(',') : 'none'\" :data-failed=\"(failedRuns ?? []).map((r) => r.run_id).join(',')\" />",
  },
}));
vi.mock("./AgentHomeDashboards.vue", () => ({
  default: { name: "AgentHomeDashboards", template: '<div data-test="dashboards-stub" />' },
}));

const mountTab = () =>
  mount(AssistantHomeTab, {
    global: { plugins: [i18n, store], stubs: { AlertHistoryDrawer: true } },
  });

const set = (target: { value: unknown }, value: unknown) => (reactive(target).value = value);

describe("AssistantHomeTab", () => {
  beforeEach(() => {
    set(mocks.state, "ai");
    set(mocks.offReason, null);
    set(mocks.lgUp, true);
    set(mocks.rows, [
      serviceRow("checkout", { coverage: "none" }),
      incidentRow("inc-1"),
      serviceRow("cart", { coverage: "covered", bucket: "degraded" }),
    ]);
    mocks.load.mockReset();
    mocks.push.mockReset().mockResolvedValue(undefined);
    mocks.provider.mockReset();
    mocks.history.mockReset();
    mocks.historyRows = [];
    mocks.sessions = {};
    mocks.runRows = [];
    set(mocks.incidentsOn, false);
    mocks.listOrgRcaRuns.mockReset();
    localStorage.clear();
    store.state.currentuser.role = "admin";
  });

  it("with the agent on, shows the greeting, Needs you above the Ask box, Problems with no alert, Since and threads, and loads once without asking the agent", async () => {
    mocks.runRows = [
      { group: "ready" },
      { group: "ready", otherOrg: true },
      { group: "answering" },
    ];
    const wrapper = mountTab();
    await flushPromises();
    expect(
      wrapper.find('[data-test="launcher-stub"][data-layout="overview"]').attributes("data-go-to"),
    ).toBe("no");
    expect(wrapper.get('[data-test="agent-home-greeting-need-you"]').text()).toBe("2 need you");
    expect(wrapper.get('[data-test="agent-home-greeting-answers"]').text()).toBe("1 answer ready");
    const main = wrapper.get('[data-test="assistant-home-main"]').element;
    const order = [...main.querySelectorAll("[data-test]")]
      .map((el) => el.getAttribute("data-test"))
      .filter((id) => id === "now-list-now" || id === "launcher-stub");
    expect(order).toEqual(["now-list-now", "launcher-stub"]);
    expect(
      wrapper
        .get('[data-test="assistant-home-aside"]')
        .find('[data-test="agent-home-brief-me"]')
        .exists(),
    ).toBe(true);
    expect(wrapper.get('[data-test="now-list-now"]').attributes("data-rows")).toBe(
      "incident:inc-1,service:cart",
    );
    expect(wrapper.get('[data-test="now-list-now"]').attributes("data-clear")).toBe(
      "Nothing else is over baseline right now",
    );
    expect(wrapper.get('[data-test="now-list-problems"]').attributes("data-rows")).toBe(
      "service:checkout",
    );
    expect(wrapper.find('[data-test="assistant-home-threads"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="agent-home-brief-me"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboards-stub"]').exists()).toBe(true);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("with credits used up, turns the Ask box into Go to with the reason and drops Brief me", async () => {
    set(mocks.state, "budget");
    set(mocks.offReason, "budget");
    const wrapper = mountTab();
    await flushPromises();
    expect(
      wrapper.find('[data-test="launcher-stub"][data-layout="overview"]').attributes("data-go-to"),
    ).toBe("yes");
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe("budget");
    expect(wrapper.find('[data-test="agent-home-brief-me"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="now-list-problems"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-home-threads"]').exists()).toBe(true);
  });

  it("with no agent, keeps Now and Problems readable but drops threads", async () => {
    set(mocks.state, "noai");
    set(mocks.offReason, "off_for_org");
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe(
      "off_for_org",
    );
    expect(wrapper.find('[data-test="now-list-now"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-home-threads"]').exists()).toBe(false);
  });

  it("on Open Source, reads no assistant history and shows Now, Problems with no alert and dashboards", async () => {
    set(mocks.state, "oss");
    set(mocks.offReason, "oss");
    const wrapper = mountTab();
    await flushPromises();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe("oss");
    expect(wrapper.find('[data-test="now-list-problems"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboards-stub"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-home-threads"]').exists()).toBe(false);
  });

  it("shows a viewer Create alert disabled", async () => {
    store.state.currentuser.role = "viewer";
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.get('[data-test="now-list-problems"]').attributes("data-create")).toBe("false");
  });

  it("on a phone shows only the Ask box and Now, with the services no alert matches kept in Now", async () => {
    set(mocks.lgUp, false);
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="now-list-problems"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-home-aside"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboards-stub"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="now-list-now"]').attributes("data-rows")).toContain(
      "service:checkout",
    );
  });

  it("writes this visit on leave and reads it back as the last visit", async () => {
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="agent-home-since-first-visit"]').exists()).toBe(true);
    wrapper.unmount();
    const again = mountTab();
    await flushPromises();
    expect(again.find('[data-test="agent-home-since-first-visit"]').exists()).toBe(false);
    expect(again.find('[data-test="agent-home-since-none"]').exists()).toBe(true);
  });

  it("keeps a recovered alert out of Now and the headline, on a wide screen and a phone", async () => {
    set(mocks.rows, [
      incidentRow("inc-1"),
      alertRow("calm", { state: "recovered", bucket: "recovered", count: 1 }),
    ]);
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.get('[data-test="agent-home-greeting-need-you"]').text()).toBe("1 needs you");
    expect(wrapper.get('[data-test="now-list-now"]').attributes("data-rows")).toBe(
      "incident:inc-1",
    );
    wrapper.unmount();
    set(mocks.lgUp, false);
    const phone = mountTab();
    await flushPromises();
    expect(phone.get('[data-test="now-list-now"]').attributes("data-rows")).toBe("incident:inc-1");
  });

  it("gives the agent and its page chips only the rows Home draws, not a recovered one", async () => {
    set(mocks.rows, [
      incidentRow("inc-1"),
      alertRow("calm", { state: "recovered", bucket: "recovered", count: 1 }),
    ]);
    mountTab();
    await flushPromises();
    const read = mocks.provider.mock.calls[0][0] as () => { rows: { key: string }[] };
    expect(read().rows.map((row) => row.key)).toEqual(["incident:inc-1"]);
  });

  it("says a stopped thread was stopped, not finished, since the last visit", async () => {
    mountTab().unmount();
    const row = { title: "Why slow", activeTurn: false, pendingApproval: false };
    mocks.historyRows = [
      { ...row, sid: "s1", updatedAt: Date.now() + 60_000 },
      { ...row, sid: "s2", updatedAt: Date.now() + 30_000 },
    ];
    mocks.sessions = { s1: { turn: { state: "stopped" } } };
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="agent-home-since-thread_stopped"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="agent-home-since-thread_updated"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="agent-home-since-thread_finished"]').exists()).toBe(false);
  });

  it("says a thread finished from the server's row after a reload, not that it has new activity", async () => {
    mountTab().unmount();
    const row = { title: "Why slow", activeTurn: false, pendingApproval: false };
    mocks.historyRows = [
      { ...row, sid: "s1", updatedAt: Date.now() + 60_000, lastTurnEnd: "done" },
      { ...row, sid: "s2", updatedAt: Date.now() + 30_000, lastTurnEnd: "failed" },
    ];
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="agent-home-since-thread_finished"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="agent-home-since-thread_failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="agent-home-since-thread_updated"]').exists()).toBe(false);
  });

  it("opens an incident's analysis tab after Investigate sent its question to the Panel", async () => {
    const wrapper = mountTab();
    await flushPromises();
    wrapper.getComponent({ name: "HomeNowList" }).vm.$emit("analysis", incidentRow("inc-1"));
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "incidentDetail",
        params: { id: "inc-1" },
        query: expect.objectContaining({ tab: "incidentAnalysis", org_identifier: "default" }),
      }),
    );
  });

  it("reads the org's runs since the window opened, hands each incident its run, and counts failed auto-runs as needing you", async () => {
    set(mocks.incidentsOn, true);
    const run = (over: Record<string, unknown>) => ({
      run_id: "r",
      incident_id: "inc-1",
      incident_title: "Checkout errors",
      severity: "P1",
      state: "completed",
      trigger: "auto",
      started_at: 2,
      ended_at: 3,
      error_code: null,
      ...over,
    });
    mocks.listOrgRcaRuns.mockResolvedValue({
      data: {
        runs: [
          run({ run_id: "r3", incident_id: "inc-9", state: "failed", error_code: "turn_limit" }),
          run({ run_id: "r2", incident_id: "inc-1", state: "running" }),
          run({ run_id: "r1", incident_id: "inc-9", state: "completed" }),
          run({ run_id: "r0", incident_id: "inc-5", state: "refused", trigger: "manual" }),
        ],
        has_more: false,
      },
    });
    const wrapper = mountTab();
    await flushPromises();
    expect(mocks.listOrgRcaRuns).toHaveBeenCalledWith("default", { since: 0, limit: 100 });
    const list = wrapper.get('[data-test="now-list-now"]');
    expect(list.attributes("data-runs")).toBe("inc-9,inc-1,inc-5");
    expect(list.attributes("data-failed")).toBe("r3");
    expect(wrapper.get('[data-test="agent-home-greeting-need-you"]').text()).toBe("3 need you");
  });

  it("reads no runs where incidents are off, and gives the rows none", async () => {
    const wrapper = mountTab();
    await flushPromises();
    expect(mocks.listOrgRcaRuns).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="now-list-now"]').attributes("data-runs")).toBe("none");
  });
});
