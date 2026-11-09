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

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed } from "vue";

import i18n from "@/locales";

import { fakeVuex } from "../../components/ai-assistant/__tests__/fakeAssistant";

const homeState = vi.hoisted(() => ({ value: "ai" as string }));

vi.mock("./useAgentHomeState", () => ({
  useAgentHomeState: () => ({
    state: computed(() => homeState.value),
    offReason: computed(() => null),
  }),
}));
vi.mock("./AgentHomeGreeting.vue", () => ({
  default: { name: "AgentHomeGreeting", template: '<div data-test="greeting-stub" />' },
}));
vi.mock("@/components/ai-assistant/welcome/AssistantLauncher.vue", () => ({
  default: {
    name: "AssistantLauncher",
    props: ["layout", "goToOnly"],
    template: '<div data-test="launcher-stub" :data-layout="layout" />',
  },
}));
vi.mock("./AgentHomeBriefing.vue", () => ({
  default: {
    name: "AgentHomeBriefing",
    props: ["canBrief"],
    template: '<div data-test="brief-stub" :data-can="String(canBrief)" />',
  },
}));

import AgentHomeFirstRun from "./AgentHomeFirstRun.vue";

const mountFirstRun = () => mount(AgentHomeFirstRun, { global: { plugins: [i18n, fakeVuex()] } });

describe("AgentHomeFirstRun (HomeFirstRun board, B-shell-5)", () => {
  it("puts the no-data note above Ask, then the starters' launcher, in the main column", () => {
    const main = mountFirstRun().get('[data-test="agent-home-first-run-main"]');
    const order = [...main.element.children].map((el) => el.getAttribute("data-test"));
    expect(order).toEqual(["greeting-stub", "agent-home-first-run-note", "launcher-stub"]);
    expect(main.get('[data-test="agent-home-first-run-title"]').text()).toContain("No data yet");
    expect(main.get('[data-test="launcher-stub"]').attributes("data-layout")).toBe("overview");
  });

  it("gives the page the right rail: Brief me, then the recent threads", () => {
    homeState.value = "ai";
    const aside = mountFirstRun().get('[data-test="agent-home-first-run-aside"]');
    expect(aside.get('[data-test="brief-stub"]').attributes("data-can")).toBe("true");
    expect(aside.get('[data-test="agent-home-first-run-threads"]').attributes("data-layout")).toBe(
      "chats",
    );
  });

  it("lists no threads and offers no Brief me while the agent cannot answer", () => {
    homeState.value = "off";
    const aside = mountFirstRun().get('[data-test="agent-home-first-run-aside"]');
    expect(aside.get('[data-test="brief-stub"]').attributes("data-can")).toBe("false");
    expect(aside.find('[data-test="agent-home-first-run-threads"]').exists()).toBe(false);
    homeState.value = "ai";
  });
});
