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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentId, CapabilityAgent } from "@/composables/assistant";

import { fakeAssistant, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantLauncherAgent from "./AssistantLauncherAgent.vue";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));

vi.mock("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue", () => ({
  __esModule: true,
  default: {
    name: "AskAdminStub",
    props: ["kind", "agent"],
    template: '<div data-test="ask-admin-stub" :data-kind="kind"><slot name="trigger" /></div>',
  },
}));

const ROSTER: CapabilityAgent[] = [
  { id: "o2-ai", pickable: true, available: true },
  { id: "sre", pickable: true, available: true },
  { id: "generate-query", pickable: true, available: false, reason: "role" },
];

// The dropdown's own spec covers opening; here its trigger and rows render in place.
const stubs = {
  ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
  ODropdownGroup: {
    props: ["label"],
    template: '<div>{{ label }}<slot name="label-action" /><slot /></div>',
  },
  ODropdownItem: {
    emits: ["select"],
    template:
      '<div @click="$emit(\'select\')"><slot name="icon-left" /><slot /><slot name="icon-right" /></div>',
  },
  OTooltip: { props: ["content"], template: '<span data-test="tooltip">{{ content }}</span>' },
};

function setup(roster: CapabilityAgent[] = ROSTER, agent: AgentId | null = null) {
  fake.current = fakeAssistant("available", { agents: roster });
  return mount(AssistantLauncherAgent, {
    props: { modelValue: agent },
    global: { plugins: [fakeVuex()], stubs },
    attachTo: document.body,
  });
}

const chip = (w: ReturnType<typeof setup>) => w.get('[data-test="assistant-launcher-agent"]');
const option = (w: ReturnType<typeof setup>, id: string) =>
  w.get(`[data-test="assistant-launcher-agent-option-${id}"]`);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantLauncherAgent", () => {
  it("draws nothing without a choice of agents", () => {
    for (const roster of [[], [ROSTER[0]]]) {
      expect(setup(roster).find('[data-test="assistant-launcher-agent"]').exists()).toBe(false);
    }
  });

  it("is a context chip naming the default agent, with no ✕ and a hint on hover", () => {
    const wrapper = setup();
    expect(chip(wrapper).text()).toBe("O2 Assistant");
    expect(chip(wrapper).attributes("data-agent")).toBe("o2-ai");
    expect(chip(wrapper).element.tagName).toBe("BUTTON");
    expect(wrapper.find('[data-test="assistant-context-chip-remove"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="tooltip"]').text()).toBe("The agent that answers");
  });

  it("lists one radio row per agent, checks the current one, and says why one is locked", () => {
    const wrapper = setup(ROSTER, "sre");
    expect(chip(wrapper).text()).toBe("Investigator");
    expect(wrapper.findAll('[role="menuitemradio"]')).toHaveLength(3);
    expect(option(wrapper, "sre").attributes("aria-checked")).toBe("true");
    expect(option(wrapper, "o2-ai").attributes("aria-checked")).toBe("false");
    expect(
      option(wrapper, "sre").find('[data-test="assistant-launcher-agent-option-checked"]').exists(),
    ).toBe(true);
    expect(
      option(wrapper, "generate-query")
        .get('[data-test="assistant-launcher-agent-option-clause"]')
        .text(),
    ).toBe("Not available");
    expect(wrapper.get('[data-test="ask-admin-stub"]').attributes("data-kind")).toBe(
      "agent_access",
    );
  });

  it("sets the picked agent, the default agent as null, and never a locked one", async () => {
    const wrapper = setup();
    await option(wrapper, "sre").trigger("click");
    await option(wrapper, "generate-query").trigger("click");
    await wrapper.setProps({ modelValue: "sre" });
    await option(wrapper, "o2-ai").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["sre"], [null]]);
  });
});
