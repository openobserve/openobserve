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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

import { settleAsyncParts } from "@/components/ai-assistant/__tests__/assistantPartStubs";
import { fakeRuntime } from "@/composables/assistant/__tests__/fakeRuntime";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import { resetEditorProposalsForTests } from "@/composables/assistant/useEditorProposal";
import { contextRegistry } from "@/composables/contextProviders/registry";
import i18n from "@/locales";

const { flag } = vi.hoisted(() => ({ flag: { on: true } }));

vi.mock("@/composables/assistant/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant/flags")>()),
  isAssistantV2: () => flag.on,
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/components/ai-assistant/entry/AiEntryButton.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.aiEntryButtonStub),
);
vi.mock("@/components/ai-assistant/shell/AssistantDock.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.assistantDockStub),
);
vi.mock("@/components/ai-assistant/entry/AiLabel.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.aiLabelStub),
);
vi.mock("@/components/ai-assistant/evidence/AssistantDiffBlock.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.diffBlockStub),
);

import AddFunction from "./AddFunction.vue";

const vuex = () =>
  createStore({
    state: {
      theme: "light",
      isAiChatEnabled: false,
      zoConfig: { ai_enabled: true },
      selectedOrganization: { identifier: "org1" },
      userInfo: { email: "ada@example.com" },
    },
    actions: { setIsAiChatEnabled: vi.fn() },
  });

async function setup(dockHost: boolean, path = "/pipeline/pipelines/edit") {
  const runtime = fakeRuntime();
  setRuntimeHandle(runtime as never);
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/functions", component: { render: () => null } },
      { path: "/pipeline/pipelines/edit", component: { render: () => null } },
    ],
  });
  await router.push(path);
  const wrapper = mount(AddFunction, {
    props: {
      modelValue: { name: "parse_json", function: ".a = 1", params: "row", transType: "0" },
      isUpdated: true,
      dockHost,
    },
    global: {
      plugins: [i18n, router],
      provide: { store: vuex() },
      stubs: {
        UnifiedQueryEditor: { template: "<div><textarea /></div>", methods: { replaceValue() {} } },
        TestFunction: { template: "<div />", methods: { testFunction: vi.fn() } },
        O2AIChat: { template: '<div data-test="legacy-chat" />' },
      },
    },
    attachTo: document.body,
  });
  await settleAsyncParts();
  return { wrapper, runtime };
}

beforeEach(() => {
  flag.on = true;
  sessionStorage.clear();
  contextRegistry.cleanup();
});

afterEach(() => {
  resetEditorProposalsForTests();
  setRuntimeHandle(null);
  document.body.innerHTML = "";
});

describe("AddFunction with the revamped assistant", () => {
  it("docks in a pipeline node: the toggle docks and the function host registers", async () => {
    const { wrapper, runtime } = await setup(true);
    const toggle = wrapper.get('[data-test="ai-entry-function-ask"]');
    expect(toggle.attributes("data-appearance")).toBe("toggle");
    expect(toggle.attributes("data-dock-host")).toBe("function");
    const adapter = runtime.hosts.get("function")!;
    expect(adapter.language).toBe("vrl");
    expect(String(adapter.objectTitle())).toBe("Function · parse_json");
    runtime.store.open({ kind: "docked", hostId: "function" }, { focus: "none" });
    await settleAsyncParts();
    expect(wrapper.find('[data-test="assistant-dock-stub"]').exists()).toBe(true);
  });

  it("opens the sidebar on the functions page: no dock host, but the function's context is pushed", async () => {
    const { wrapper, runtime } = await setup(false, "/functions");
    const toggle = wrapper.get('[data-test="ai-entry-function-ask"]');
    expect(toggle.attributes("data-appearance")).toBe("button");
    expect(toggle.attributes("data-dock-host")).toBe("");
    expect(runtime.hosts.has("function")).toBe(false);
    expect((await contextRegistry.getActiveContext())?.currentVRLQuery).toBe(".a = 1");
  });

  it("keeps the route-substring legacy toggle with the revamp off", async () => {
    flag.on = false;
    const { wrapper, runtime } = await setup(true);
    expect(wrapper.find('[data-test="ai-entry-function-ask"]').exists()).toBe(false);
    expect(runtime.hosts.has("function")).toBe(false);
  });
});
