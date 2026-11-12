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
import { defineComponent, nextTick, reactive } from "vue";

import { alertCreationDialog } from "@/composables/alerts/useAlertCreation";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import { alertRow, anomalyRow, incidentRow, serviceRow } from "./homeFixtures";
import AssistantHomeTab from "./AssistantHomeTab.vue";

const mocks = vi.hoisted(() => ({
  state: { value: "ai" as string },
  offReason: { value: null as string | null },
  lgUp: { value: true },
  rows: { value: [] as unknown[] },
  load: vi.fn(),
  setRange: vi.fn(),
  push: vi.fn(),
  runtimeRead: vi.fn(),
  runRows: [] as { group: string; otherOrg?: boolean }[],
  committed: { value: null as unknown },
  failed: { value: [] as unknown[] },
  alerts: { value: [] as unknown[] },
  listOrgRcaRuns: vi.fn(),
  railMounted: vi.fn(),
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
  const committed = live(mocks.committed);
  const failed = live(mocks.failed);
  const alerts = live(mocks.alerts);
  const actual = await importOriginal<typeof import("./useHomeNowData")>();
  return {
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
        nowList: { selectedKey, snapshot, state: computed(() => committed.value) },
        range: ref({ type: "relative", period: "24h" }),
        window: ref({ start: 0, end: 86_400_000_000 }),
        incidents: ref(null),
        trend: ref(null),
        alertList: computed(() => alerts.value),
        alertHits: ref([{ alert_name: "alert-a", status: "firing", timestamp: 1 }]),
        topology: ref(null),
        failedSources: computed(() => failed.value),
        deniedSources: ref([]),
        tracesLocked: ref(false),
        alertsLocked: ref(false),
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
  useAssistantRuns: () => {
    mocks.runtimeRead();
    return { rows: { value: mocks.runRows } };
  },
  openAssistant: vi.fn(),
}));
vi.mock("@/services/rca_runs_org", () => ({ listOrgRcaRuns: mocks.listOrgRcaRuns }));
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
    props: ["layout", "pageRange"],
    template: '<div data-test="launcher-stub" :data-layout="layout" />',
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
    props: ["snapshot", "createAlert", "rowMeta"],
    template:
      '<section data-test="now-list-problems" :data-rows="snapshot.rows.map((r) => r.key).join(\',\')" :data-create="createAlert ? String(createAlert.enabled) : \'none\'" />',
  },
}));

vi.mock("@/components/alerts/AlertHistoryDrawer.vue", () => ({
  __esModule: true,
  default: {
    name: "AlertHistoryDrawer",
    props: ["alertId", "alertType"],
    template: '<div :data-id="alertId" :data-type="alertType" />',
  },
}));

// The async rail reads `default` only off a module namespace.
vi.mock("./HomeChatsRail.vue", () => ({
  __esModule: true,
  default: {
    name: "HomeChatsRail",
    mounted: () => mocks.railMounted(),
    template: '<div data-test="chats-rail-stub" />',
  },
}));

const mountTab = () => mount(AssistantHomeTab, { global: { plugins: [i18n, store] } });

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
    mocks.runtimeRead.mockReset();
    mocks.runRows = [];
    set(mocks.committed, null);
    set(mocks.failed, []);
    set(mocks.alerts, []);
    mocks.listOrgRcaRuns.mockReset();
    mocks.railMounted.mockReset();
    localStorage.clear();
    store.state.currentuser.role = "admin";
  });

  it("with the agent on, shows the greeting, then the Ask box, in one centred column, and loads once without asking the agent", async () => {
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="launcher-stub"][data-layout="overview"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ask-note-stub"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="agent-home-greeting-answers"]').exists()).toBe(false);
    const main = wrapper.get('[data-test="assistant-home-main"]').element;
    expect(main).toBeTruthy();
    expect(wrapper.findAll('[data-test="launcher-stub"]')).toHaveLength(1);
    expect(wrapper.get('[data-test="assistant-home-main"]').classes()).toEqual(
      expect.arrayContaining(["mx-auto", "max-w-5xl"]),
    );
    for (const gone of [
      "assistant-home-aside",
      "assistant-home-threads",
      "agent-home-brief-me",
      "agent-home-since",
    ]) {
      expect(wrapper.find(`[data-test="${gone}"]`).exists()).toBe(false);
    }
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("on a wide screen with the agent on, lists the chats in a see-through left rail beside the column, mounted once after Home's own read", async () => {
    const wrapper = mountTab();
    await vi.waitFor(() => expect(mocks.railMounted).toHaveBeenCalled());
    const rail = wrapper.get('[data-test="assistant-home-chats"]');
    expect(rail.element.tagName).toBe("ASIDE");
    expect(rail.attributes("aria-label")).toBe("Chats");
    expect(rail.classes()).toEqual(
      expect.arrayContaining([
        "w-64",
        "shrink-0",
        "h-full",
        "border-e",
        "border-border-subtle",
        "bg-surface-base/40",
      ]),
    );
    expect(rail.classes()).not.toContain("bg-surface-panel");
    expect(rail.classes()).not.toContain("border-border-default");
    expect(rail.element.parentElement?.classList.contains("flex")).toBe(true);
    expect(rail.element.nextElementSibling).toBe(
      wrapper.get('[data-test="assistant-home-tab"]').element,
    );
    expect(rail.find('[data-test="chats-rail-stub"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="assistant-home-tab"]').classes()).toEqual(
      expect.arrayContaining(["flex-1", "overflow-y-auto"]),
    );
    expect(mocks.railMounted).toHaveBeenCalledTimes(1);
    expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.railMounted.mock.invocationCallOrder[0],
    );
  });

  it("keeps the chats rail with the credits used up, so past chats stay readable", async () => {
    set(mocks.state, "budget");
    set(mocks.offReason, "budget");
    const wrapper = mountTab();
    await vi.waitFor(() => expect(mocks.railMounted).toHaveBeenCalledTimes(1));
    expect(wrapper.find('[data-test="chats-rail-stub"]').exists()).toBe(true);
  });

  it("draws no chats rail and reads no chats on a phone, with no agent, on Open Source or while the gate loads", async () => {
    const cases: [state: string, wide: boolean][] = [
      ["ai", false],
      ["noai", true],
      ["oss", true],
      ["loading", true],
    ];
    for (const [state, wide] of cases) {
      set(mocks.state, state);
      set(mocks.lgUp, wide);
      const wrapper = mountTab();
      await flushPromises();
      expect(wrapper.find('[data-test="assistant-home-chats"]').exists()).toBe(false);
      wrapper.unmount();
    }
    expect(mocks.railMounted).not.toHaveBeenCalled();
  });

  it("keeps the Ask box in flow right under the greeting, centred and set a little down the page, on every screen size", async () => {
    for (const wide of [true, false]) {
      set(mocks.lgUp, wide);
      const wrapper = mountTab();
      await flushPromises();
      const main = wrapper.get('[data-test="assistant-home-main"]');
      expect(main.classes()).toEqual(expect.arrayContaining(["flex", "flex-col", "pt-[12vh]"]));
      const ask = wrapper.get('[data-test="launcher-stub"][data-layout="overview"]');
      expect(ask.element.previousElementSibling?.getAttribute("data-test")).toBe(
        "agent-home-greeting",
      );
      expect(ask.classes()).toEqual(expect.arrayContaining(["mx-auto", "max-w-3xl"]));
      for (const pinned of ["sticky", "bottom-0", "mt-auto", "z-10", "from-surface-base"]) {
        expect(ask.classes()).not.toContain(pinned);
      }
      expect(wrapper.get('[data-test="assistant-home-tab"]').classes()).not.toContain(
        "max-md:pb-0",
      );
      wrapper.unmount();
    }
  });

  it("with credits used up, swaps the Ask box for the reason", async () => {
    set(mocks.state, "budget");
    set(mocks.offReason, "budget");
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="launcher-stub"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe("budget");
  });

  it("with no agent, keeps Needs Attention readable", async () => {
    set(mocks.state, "noai");
    set(mocks.offReason, "off_for_org");
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe(
      "off_for_org",
    );
    expect(wrapper.find('[data-test="home-attention"]').exists()).toBe(true);
  });

  it("on Open Source, reads no assistant runtime", async () => {
    set(mocks.state, "oss");
    set(mocks.offReason, "oss");
    const wrapper = mountTab();
    await flushPromises();
    expect(mocks.runtimeRead).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe("oss");
  });

  it("reads no RCA runs on load", async () => {
    mountTab();
    await flushPromises();
    expect(mocks.listOrgRcaRuns).not.toHaveBeenCalled();
  });

  it("draws no Needs you section and no Problems with no alert list", async () => {
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.findAllComponents({ name: "HomeNowList" })).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Needs you");
    expect(wrapper.find('[data-test="agent-home-greeting-need-you"]').exists()).toBe(false);
  });

  it("draws no health strip: no chips and no pages line, the greeting flows into the Ask box", async () => {
    set(mocks.committed, { rows: [] });
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test^="home-health"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Page In Range");
    const main = wrapper.get('[data-test="assistant-home-main"]').element;
    const order = [...main.querySelectorAll("[data-test]")]
      .map((el) => el.getAttribute("data-test"))
      .filter((id) => ["agent-home-greeting", "launcher-stub"].includes(id ?? ""));
    expect(order).toEqual(["agent-home-greeting", "launcher-stub"]);
  });

  it("draws no capability cards under Ask and no dashboards section", async () => {
    const wide = mountTab();
    await flushPromises();
    const ask = (w: ReturnType<typeof mountTab>) =>
      w.get('[data-test="launcher-stub"][data-layout="overview"]');
    expect(ask(wide).exists()).toBe(true);
    expect(wide.find(".capability-card").exists()).toBe(false);
    expect(wide.find('[data-test="assistant-launcher-capabilities"]').exists()).toBe(false);
    expect(wide.find('[data-test="agent-home-dashboards"]').exists()).toBe(false);
    set(mocks.lgUp, false);
    const phone = mountTab();
    await flushPromises();
    expect(ask(phone).exists()).toBe(true);
  });

  it("draws no decorative backdrop: no glow and no dot grid behind the page", async () => {
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-home-backdrop"]').exists()).toBe(false);
    expect(wrapper.find(".bg-dot-grid").exists()).toBe(false);
    expect(wrapper.find(".bg-gradient-brand-ribbon.blur-3xl").exists()).toBe(false);
  });

  it("plays the staggered entrance on mount only, never under reduced motion, and not again after a kept-alive return", async () => {
    const Host = defineComponent({
      components: { AssistantHomeTab },
      data: () => ({ shown: true }),
      template: "<KeepAlive><AssistantHomeTab v-if='shown' /></KeepAlive>",
    });
    const host = mount(Host, { global: { plugins: [i18n, store] } });
    await flushPromises();
    const greeting = () => host.get('[data-test="agent-home-greeting"]').classes();
    expect(greeting()).toContain("motion-safe:animate-[assistant-fade-up_0.5s_ease-out_both]");
    expect(greeting().join(" ")).not.toMatch(/(^|\s)animate-/);
    host.vm.shown = false;
    await nextTick();
    host.vm.shown = true;
    await nextTick();
    expect(greeting().join(" ")).not.toContain("animate-");
  });

  describe("Needs Attention", () => {
    const keys = (w: ReturnType<typeof mountTab>) =>
      w.findAll('[data-test^="home-attention-row-"]').map((row) => row.attributes("data-test"));

    it("sits under the Ask box, with the three most urgent rows of every kind", async () => {
      set(mocks.rows, [
        serviceRow("checkout", { coverage: "none" }),
        incidentRow("inc-1"),
        alertRow("hot"),
        anomalyRow("spike"),
        alertRow("calm", { state: "recovered", bucket: "recovered" }),
      ]);
      const wrapper = mountTab();
      await flushPromises();
      const main = wrapper.get('[data-test="assistant-home-main"]').element;
      const order = [...main.querySelectorAll("[data-test]")]
        .map((el) => el.getAttribute("data-test"))
        .filter((id) => ["launcher-stub", "home-attention"].includes(id ?? ""));
      expect(order).toEqual(["launcher-stub", "home-attention"]);
      expect(keys(wrapper)).toEqual([
        "home-attention-row-service:checkout",
        "home-attention-row-incident:inc-1",
        "home-attention-row-alert:hot",
      ]);
      expect(wrapper.get('[data-test="home-attention"]').classes()).toContain("mt-4");
    });

    it("says All Clear when nothing needs attention but something is watched", async () => {
      set(mocks.rows, [alertRow("calm", { state: "recovered", bucket: "recovered" })]);
      set(mocks.committed, {});
      set(mocks.alerts, [{ name: "calm" }]);
      const quiet = mountTab();
      await flushPromises();
      expect(quiet.get("[data-test='home-attention'] h2").text()).toBe("Needs Attention");
      expect(quiet.get('[data-test="home-attention-empty"]').attributes("data-empty")).toBe(
        "clear",
      );
    });

    it("says No Data Yet, not All Clear, when nothing is monitored", async () => {
      set(mocks.rows, []);
      set(mocks.committed, {});
      const empty = mountTab();
      await flushPromises();
      expect(empty.get('[data-test="home-attention-empty"]').attributes("data-empty")).toBe(
        "no-data",
      );
    });

    it("sends no-data users to ingestion and offers no Create Alert", async () => {
      set(mocks.rows, []);
      set(mocks.committed, {});
      const empty = mountTab();
      await flushPromises();
      await empty.get('[data-test="home-attention-send-data"]').trigger("click");
      expect(mocks.push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ingestion",
          query: expect.objectContaining({ org_identifier: "default" }),
        }),
      );
      expect(empty.find('[data-test="home-attention-create-alert"]').exists()).toBe(false);
    });

    it("says it could not load everything and retries on demand", async () => {
      set(mocks.rows, []);
      set(mocks.failed, [{ key: "anomalies", label: "Anomalies" }]);
      set(mocks.committed, {});
      const failed = mountTab();
      await flushPromises();
      expect(failed.get('[data-test="home-attention-empty"]').attributes("data-empty")).toBe(
        "failed",
      );
      mocks.load.mockClear();
      await failed.get('[data-test="home-attention-retry"]').trigger("click");
      expect(mocks.load).toHaveBeenCalledWith(true);
    });

    it("shows only the heading and a skeleton before the first load finishes", async () => {
      set(mocks.rows, []);
      set(mocks.committed, null);
      const loading = mountTab();
      await flushPromises();
      expect(loading.find('[data-test="home-attention-loading"]').exists()).toBe(true);
      expect(loading.find('[data-test="home-attention-empty"]').exists()).toBe(false);
    });

    it("still shows the rows that loaded when another source failed", async () => {
      set(mocks.rows, [incidentRow("inc-1")]);
      set(mocks.failed, [{ key: "anomalies", label: "Anomalies" }]);
      const failed = mountTab();
      await flushPromises();
      expect(keys(failed)).toEqual(["home-attention-row-incident:inc-1"]);
    });

    it("shows on a phone too", async () => {
      set(mocks.lgUp, false);
      const wrapper = mountTab();
      await flushPromises();
      expect(keys(wrapper)).toHaveLength(3);
    });

    it("opens an incident's page, a service's traces, and an alert's or anomaly's history", async () => {
      set(mocks.rows, [
        incidentRow("inc-1"),
        serviceRow("cart"),
        alertRow("hot"),
        anomalyRow("spike"),
      ]);
      const open = async (w: ReturnType<typeof mountTab>, key: string) => {
        await w.get(`[data-test="home-attention-row-${key}"] button`).trigger("click");
        await flushPromises();
      };
      const wrapper = mountTab();
      await flushPromises();
      await open(wrapper, "incident:inc-1");
      expect(mocks.push.mock.calls.at(-1)?.[0]).toMatchObject({
        name: "incidentDetail",
        params: { id: "inc-1" },
        query: { org_identifier: "default" },
      });
      await open(wrapper, "service:cart");
      expect(mocks.push.mock.calls.at(-1)?.[0]).toMatchObject({
        name: "traces",
        query: { tab: "spans" },
      });
      await open(wrapper, "alert:hot");
      const drawer = () => wrapper.get('[data-test="assistant-home-alert-history"]');
      await vi.waitFor(() => expect(drawer().attributes("data-id")).toBe("hot"));
      expect(drawer().attributes("data-type")).toBe("scheduled");
      set(mocks.rows, [anomalyRow("spike")]);
      const anomaly = mountTab();
      await flushPromises();
      await open(anomaly, "anomaly:spike");
      await vi.waitFor(() =>
        expect(
          anomaly.get('[data-test="assistant-home-alert-history"]').attributes("data-type"),
        ).toBe("anomaly_detection"),
      );
    });

    it("takes View All to the Overview tab through the URL", async () => {
      const wrapper = mountTab();
      await flushPromises();
      await wrapper.get('[data-test="home-attention-view-all"]').trigger("click");
      expect(mocks.push).toHaveBeenCalledWith({ query: { tab: "overview" } });
    });
  });
});
