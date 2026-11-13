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

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

import AssistantHomeTab from "./AssistantHomeTab.vue";

const mocks = vi.hoisted(() => ({
  state: { value: "ai" as string },
  offReason: { value: null as string | null },
  lgUp: { value: true },
  query: {} as Record<string, string>,
  runtimeRead: vi.fn(),
  listOrgRcaRuns: vi.fn(),
  railMounted: vi.fn(),
  focusAsk: vi.fn(),
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
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive: live } = await import("vue");
  const lg = live(mocks.lgUp);
  return { default: () => ({ lgUp: computed(() => lg.value) }) };
});
vi.mock("@/composables/assistant", () => ({
  useAssistantRuns: () => {
    mocks.runtimeRead();
    return { rows: { value: [] }, active: { value: 0 }, cap: { value: 3 } };
  },
}));
vi.mock("@/services/rca_runs_org", () => ({ listOrgRcaRuns: mocks.listOrgRcaRuns }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: mocks.query }) }));
vi.mock("@/components/ai-assistant/welcome/AssistantLauncher.vue", () => ({
  default: {
    name: "AssistantLauncher",
    props: ["layout", "pageRange"],
    methods: { focusAsk: () => mocks.focusAsk() },
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
    mocks.query = {};
    mocks.runtimeRead.mockReset();
    mocks.listOrgRcaRuns.mockReset();
    mocks.railMounted.mockReset();
    mocks.focusAsk.mockReset();
    localStorage.clear();
    store.state.currentuser.role = "admin";
  });

  it("with the agent on, shows the greeting, then the Ask box, in one centred column", async () => {
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
  });

  it("hands the Ask box the URL's range: a relative period ends now, absolute bounds go from microseconds to milliseconds", async () => {
    vi.useFakeTimers({ now: 10_000_000 });
    try {
      const relative = mountTab();
      await flushPromises();
      expect(relative.getComponent({ name: "AssistantLauncher" }).props("pageRange")).toEqual({
        from: 10_000_000 - 86_400_000,
        to: 10_000_000,
        period: "24h",
      });
      mocks.query = { from: "1500", to: "2500" };
      const absolute = mountTab();
      await flushPromises();
      expect(absolute.getComponent({ name: "AssistantLauncher" }).props("pageRange")).toEqual({
        from: 1,
        to: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the Ask box to take focus on mount", async () => {
    mountTab();
    await flushPromises();
    expect(mocks.focusAsk).toHaveBeenCalledTimes(1);
  });

  it("asks nothing to focus when the agent is off", async () => {
    set(mocks.offReason, "off");
    mountTab();
    await flushPromises();
    expect(mocks.focusAsk).not.toHaveBeenCalled();
  });

  it("on a wide screen with the agent on, lists the chats in a see-through left rail beside the column, mounted once", async () => {
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

  it("with no agent, swaps the Ask box for the reason", async () => {
    set(mocks.state, "noai");
    set(mocks.offReason, "off_for_org");
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe(
      "off_for_org",
    );
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

  it("draws no Needs Attention section, no Needs you list and no Problems", async () => {
    for (const offReason of [null, "off_for_org"]) {
      set(mocks.offReason, offReason);
      const wrapper = mountTab();
      await flushPromises();
      expect(wrapper.find('[data-test^="home-attention"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Needs Attention");
      expect(wrapper.text()).not.toContain("Needs you");
      wrapper.unmount();
    }
    const wrapper = mountTab();
    await flushPromises();
    expect(wrapper.find('[data-test="agent-home-greeting-need-you"]').exists()).toBe(false);
  });

  it("draws no health strip: no chips and no pages line, the greeting flows into the Ask box", async () => {
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
});
