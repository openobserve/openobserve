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
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapabilityAgent } from "@/composables/assistant";
import { queryClient } from "@/composables/query/queryClient";
import { alertKeys } from "@/services/alerts.querykeys";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";
import { raw } from "@/types/i18n";

import { fakeAssistant, fakeRouter, fakeVuex } from "../__tests__/fakeAssistant";
import AssistantComposer from "../composer/AssistantComposer.vue";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));

const ROSTER: CapabilityAgent[] = [
  { id: "o2-ai", pickable: true, available: true },
  { id: "sre", pickable: true, available: true },
  { id: "generate-query", pickable: true, available: true },
];

function seedMenu(): void {
  queryClient.clear();
  queryClient.setQueryData(streamKeys.nameList("default", "logs"), [{ name: "checkout" }]);
  queryClient.setQueryData(streamKeys.nameList("default", "metrics"), []);
  queryClient.setQueryData(streamKeys.nameList("default", "traces"), []);
  queryClient.setQueryData(alertKeys.list("default", "default", undefined, undefined), []);
  queryClient.setQueryData(pipelineKeys.list("default"), []);
  queryClient.setQueryData(dashboardKeys.byFolder("default", "default"), []);
}

function setup(messages = false) {
  seedMenu();
  fake.current = fakeAssistant("available", { agents: ROSTER });
  const { store } = fake.current;
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  store.state.shell.activeSid = sid;
  if (messages) store.state.sessions[sid].messages.push({ role: "user", content: raw("q") });
  const wrapper = mount(AssistantComposer, {
    props: { sid },
    global: { plugins: [fakeRouter(), fakeVuex()] },
    attachTo: document.body,
  });
  const field = wrapper.get<HTMLTextAreaElement>('[data-test="assistant-composer-field"]');
  const status = () => wrapper.get('[data-test="assistant-composer-status"]').text();
  return { wrapper, store, sid, field, status };
}

async function typeAndChoose(field: ReturnType<typeof setup>["field"], text: string) {
  await field.setValue(text);
  await flushPromises();
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("@agent through the real composer (MULTI-AGENT-02)", () => {
  it("removes the token, adds no chip, sets the agent and speaks only the agent's sentence", async () => {
    const { store, sid, field, status } = setup();
    await typeAndChoose(field, "why @inv");
    const session = store.state.sessions[sid];
    expect(session.composer.text.trim()).toBe("why");
    expect(session.composer.chips).toHaveLength(0);
    expect(session.agentId).toBe("sre");
    expect(status()).toBe("Investigator will answer.");
  });

  it("lets a second mention replace the first", async () => {
    const { store, sid, field } = setup();
    await typeAndChoose(field, "@inv");
    await typeAndChoose(field, "@query");
    expect(store.state.sessions[sid].agentId).toBe("generate-query");
  });

  it("stages Next on a chat with turns and writes no marker", async () => {
    const { store, sid, field } = setup(true);
    await typeAndChoose(field, "@sre");
    const session = store.state.sessions[sid];
    expect(session.nextAgentId).toBe("sre");
    expect(session.agentId).toBeUndefined();
  });

  it("leaves the text and the agent alone on Escape", async () => {
    const { store, sid, field } = setup();
    await field.setValue("@inv");
    await flushPromises();
    await field.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(store.state.sessions[sid].composer.text).toBe("@inv");
    expect(store.state.sessions[sid].agentId).toBeUndefined();
  });
});
