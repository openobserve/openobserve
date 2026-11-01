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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapabilityAgent } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import { composerUi } from "@/components/ai-assistant/composer/composerUi";

import { fakeAssistant, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantAgentPicker from "./AssistantAgentPicker.vue";

const { fake, breakpoint } = vi.hoisted(() => ({
  fake: { current: null as any },
  breakpoint: { mobile: false },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
  useAssistantPlacement: () => ({ container: { value: "sidebar" } }),
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return { default: () => ({ mdUp: computed(() => !breakpoint.mobile) }) };
});

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
  { id: "sre", pickable: true, available: true, readOnly: true },
  { id: "generate-query", pickable: true, available: true },
];

const stubs = {
  ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
  ODropdownGroup: { props: ["label"], template: "<div>{{ label }}<slot /></div>" },
  ODropdownSeparator: true,
  ODropdownItem: {
    props: ["description"],
    emits: ["select"],
    template:
      '<div role="menuitemradio" @click="$emit(\'select\')"><slot name="icon-left" /><slot /><p>{{ description }}</p><slot name="icon-right" /></div>',
  },
  OSheet: { template: '<div><slot name="header" /><slot /></div>' },
};

function setup(roster: CapabilityAgent[] = ROSTER, messages = false) {
  fake.current = fakeAssistant("available", { agents: roster });
  const { store } = fake.current;
  store.syncCapability({ ...store.state.capability, agents: roster });
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  if (messages) store.state.sessions[sid].messages.push({ role: "user", content: raw("q") });
  const wrapper = mount(AssistantAgentPicker, {
    props: { sid },
    global: { plugins: [fakeVuex()], stubs },
    attachTo: document.body,
  });
  return { wrapper, sid, store };
}

const trigger = (w: ReturnType<typeof mount>) => w.get('[data-test="assistant-agent-picker"]');
const option = (w: ReturnType<typeof mount>, id: string) =>
  w.get(`[data-test="assistant-agent-option-${id}"]`);
const next = (w: ReturnType<typeof mount>) => w.find('[data-test="assistant-agent-picker-next"]');

beforeEach(() => {
  breakpoint.mobile = false;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantAgentPicker", () => {
  it("renders nothing without a choice to offer", () => {
    expect(setup([]).wrapper.find('[data-test="assistant-agent-picker"]').exists()).toBe(false);
    expect(setup([ROSTER[0]]).wrapper.find('[data-test="assistant-agent-picker"]').exists()).toBe(
      false,
    );
  });

  it("names the trigger for a screen reader and lists the roster with heading, note and policy", () => {
    const { wrapper } = setup();
    expect(trigger(wrapper).attributes("aria-label")).toContain("Change agent");
    expect(wrapper.text()).toContain("Who answers");
    expect(wrapper.text()).toContain("Type @ and a name");
    expect(option(wrapper, "sre").text()).toContain("Read-only");
    expect(option(wrapper, "generate-query").text()).toContain("Asks before changing anything");
    expect(wrapper.findAll('[role="menuitemradio"]')).toHaveLength(3);
  });

  it("sets a new chat's agent without sending, and announces it", async () => {
    const { wrapper, store, sid } = setup();
    const send = vi.spyOn(store, "send");
    await option(wrapper, "sre").trigger("click");
    expect(store.state.sessions[sid].agentId).toBe("sre");
    expect(send).not.toHaveBeenCalled();
    expect(trigger(wrapper).text()).toContain("Investigator");
    expect(next(wrapper).exists()).toBe(false);
    expect(composerUi(sid).status?.text).toBe("Investigator will answer.");
  });

  it("shows Next on a chat with turns, and the current agent takes it away", async () => {
    const { wrapper, store, sid } = setup(ROSTER, true);
    await option(wrapper, "sre").trigger("click");
    expect(next(wrapper).text()).toBe("Next: Investigator");
    expect(store.state.sessions[sid].messages.some((m: any) => m.handoffFrom)).toBe(false);
    await option(wrapper, "o2-ai").trigger("click");
    expect(next(wrapper).exists()).toBe(false);
  });

  it("locks a row with its reason, offers Ask an admin for a role, and reads the reason on Enter", async () => {
    const roster: CapabilityAgent[] = [
      ROSTER[0],
      { id: "sre", pickable: true, available: false, reason: "unreachable" },
      { id: "generate-query", pickable: true, available: false, reason: "role" },
    ];
    const { wrapper, store, sid } = setup(roster);
    expect(option(wrapper, "generate-query").text()).toContain("Not available to your role");
    expect(wrapper.get('[data-test="ask-admin-stub"]').attributes("data-kind")).toBe(
      "agent_access",
    );
    expect(option(wrapper, "sre").text()).toContain("Not reachable right now");
    await option(wrapper, "generate-query").trigger("click");
    expect(store.state.sessions[sid].agentId).toBeUndefined();
    expect(composerUi(sid).status?.text).toBe("Not available to your role");
  });

  it("marks an agent a send refused, until the capability is re-read", async () => {
    const { wrapper, store } = setup();
    store.noteAgentRefused("sre", "agent_disabled");
    await flushPromises();
    expect(option(wrapper, "sre").text()).toContain("Turned off");
  });

  it("uses a sheet list with tall rows on a phone", async () => {
    breakpoint.mobile = true;
    const { wrapper, store, sid } = setup();
    await trigger(wrapper).trigger("click");
    expect(wrapper.find('[data-test="assistant-agent-sheet"]').exists()).toBe(true);
    expect(trigger(wrapper).classes()).toContain("min-h-11");
    expect(option(wrapper, "sre").classes()).toContain("min-h-14");
    await option(wrapper, "sre").trigger("click");
    expect(store.state.sessions[sid].agentId).toBe("sre");
  });
});
