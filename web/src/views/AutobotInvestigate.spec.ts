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
import enUS from "@/locales/languages/en-US.json";
import store from "@/test/unit/helpers/store";

import { threadHost } from "@/composables/assistant/pure";

import AutobotInvestigate from "./AutobotInvestigate.vue";

const mocks = vi.hoisted(() => ({
  state: { value: "ai" as string },
  offReason: { value: null as string | null },
  fill: vi.fn(),
  route: { name: "autobotInvestigate", query: {} as Record<string, string> },
  threadSync: vi.fn(),
}));

vi.mock("vue-router", () => ({ useRoute: () => mocks.route }));
vi.mock("./home/useThreadUrl", () => ({ useThreadUrlSync: mocks.threadSync }));
vi.mock("./AssistantView.vue", () => ({
  __esModule: true,
  default: {
    name: "AssistantView",
    props: ["chatId", "bare"],
    template: '<div data-test="thread-stub" :data-chat="chatId" />',
  },
}));

vi.mock("./home/useAgentHomeState", async () => {
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
  const { computed } = await import("vue");
  return { default: () => ({ lgUp: computed(() => true) }) };
});
vi.mock("@/components/ai-assistant/welcome/AssistantLauncher.vue", () => ({
  default: {
    name: "AssistantLauncher",
    props: ["layout", "fixedAgent", "askPlaceholder"],
    methods: { focusAsk: () => undefined, fill: (prompt: string) => mocks.fill(prompt) },
    template:
      '<div data-test="launcher-stub" :data-agent="fixedAgent" :data-placeholder="askPlaceholder" />',
  },
}));
vi.mock("@/components/ai-assistant/welcome/PromptSuggestions.vue", () => ({
  default: { name: "PromptSuggestions", template: '<div data-test="prompts-stub" />' },
}));
vi.mock("./home/AgentHomeAskNote.vue", () => ({
  default: {
    name: "AgentHomeAskNote",
    props: ["reason"],
    template: '<p data-test="ask-note-stub" :data-reason="reason" />',
  },
}));
vi.mock("./home/HomeChatsRail.vue", () => ({
  __esModule: true,
  default: {
    name: "HomeChatsRail",
    props: { investigations: Boolean, thread: Boolean },
    template:
      '<div data-test="chats-rail-stub" :data-investigations="String(investigations)" :data-thread="String(thread)" />',
  },
}));

const mountPage = () => mount(AutobotInvestigate, { global: { plugins: [i18n, store] } });
const set = (target: { value: unknown }, value: unknown) => (reactive(target).value = value);

describe("AutobotInvestigate", () => {
  beforeEach(() => {
    set(mocks.state, "ai");
    set(mocks.offReason, null);
    mocks.fill.mockReset();
    mocks.route.query = {};
    threadHost.value = "home";
  });

  it("hosts its own thread while mounted and opens ?thread= beside the Investigations rail", async () => {
    mocks.route.query = { thread: "s1" };
    const wrapper = mountPage();
    await flushPromises();
    expect(threadHost.value).toBe("autobotInvestigate");
    expect(mocks.threadSync).toHaveBeenCalledWith(expect.any(Promise), "autobotInvestigate");
    expect(wrapper.get('[data-test="autobot-investigate-thread"]').attributes("data-chat")).toBe(
      "s1",
    );
    expect(wrapper.get('[data-test="chats-rail-stub"]').attributes("data-thread")).toBe("true");
    expect(wrapper.find('[data-test="launcher-stub"]').exists()).toBe(false);
    expect(wrapper.element.classList).toContain("overflow-hidden");
    expect(wrapper.element.classList).toContain("h-full");
    expect(wrapper.get('[data-test="autobot-investigate-thread"]').classes()).toContain("min-h-0");
    wrapper.unmount();
    expect(threadHost.value).toBe("home");
  });

  it("fixes the Ask box to the investigate agent and lists investigations only", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const launcher = wrapper.get('[data-test="launcher-stub"]');
    expect(launcher.attributes("data-agent")).toBe("sre");
    expect(launcher.attributes("data-placeholder")).toBe(enUS.autobotInvestigate.placeholder);
    expect(wrapper.get('[data-test="chats-rail-stub"]').attributes("data-investigations")).toBe(
      "true",
    );
  });

  it("shows the four investigate cards and no prompt list; a card fills the Ask box", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const cards = wrapper.findAll('[data-test^="assistant-home-capability-"]');
    expect(cards.map((card) => card.text())).toEqual([
      enUS.autobotInvestigate.cards.whyAlertFired.title,
      enUS.autobotInvestigate.cards.investigateIncident.title,
      enUS.autobotInvestigate.cards.errorSpike.title,
      enUS.autobotInvestigate.cards.slowService.title,
    ]);
    expect(wrapper.find('[data-test="prompts-stub"]').exists()).toBe(false);
    await cards[0].trigger("click");
    expect(mocks.fill).toHaveBeenCalledWith(enUS.autobotInvestigate.cards.whyAlertFired.prompt);
  });

  it("swaps the Ask box for the same note as Home when the agent is off", async () => {
    set(mocks.state, "noai");
    set(mocks.offReason, "not_entitled");
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[data-test="ask-note-stub"]').attributes("data-reason")).toBe(
      "not_entitled",
    );
    expect(wrapper.find('[data-test="launcher-stub"]').exists()).toBe(false);
    expect(wrapper.find('[data-test^="assistant-home-capability-"]').exists()).toBe(false);
  });
});
