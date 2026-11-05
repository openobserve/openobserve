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
import { createMemoryHistory, createRouter } from "vue-router";

import { settleAsyncParts } from "@/components/ai-assistant/__tests__/assistantPartStubs";
import { AVAILABLE, fakeRuntime } from "@/composables/assistant/__tests__/fakeRuntime";
import { queueDockStage } from "@/composables/assistant/hostAdapter";
import {
  registerLifecycleDialogs,
  resetLifecycleForTests,
  runLeaveGuards,
  useLifecycleQuestion,
} from "@/composables/assistant/lifecycleQuestions";
import { createOpenAssistant } from "@/composables/assistant/openAssistant";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import { resetEditorProposalsForTests } from "@/composables/assistant/useEditorProposal";
import { contextRegistry } from "@/composables/contextProviders/registry";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const { flag } = vi.hoisted(() => ({ flag: { on: true } }));

vi.mock("@/composables/assistant/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant/flags")>()),
  isAssistantV2: () => flag.on,
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true" } }));
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
vi.mock("@/components/O2AIChat.vue", () => ({
  default: { name: "O2AIChat", template: "<div data-test='o2-ai-chat'></div>" },
}));

import AddRegexPattern from "./AddRegexPattern.vue";

const drawer = {
  name: "ODrawer",
  props: ["open", "width"],
  template:
    '<div data-test="o-drawer-stub" :data-width="String(width)"><slot name="header-right" /><slot /></div>',
};

async function setup() {
  const base = fakeRuntime();
  const runtime = {
    ...base,
    openAssistant: createOpenAssistant({
      store: base.store,
      capability: () => AVAILABLE,
      hosts: base.hosts,
      routeName: () => "regexPatterns",
      routePrefersFloating: () => false,
      pushRoute: vi.fn(),
      lgUp: () => true,
      viewportPx: () => 1280,
      currentOrg: () => "org1",
      now: () => Date.now(),
      notify: vi.fn(),
    }),
  };
  setRuntimeHandle(runtime as never);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { render: () => null } }],
  });
  await router.push("/?from=logs");
  const wrapper = mount(AddRegexPattern, {
    props: { open: true },
    global: {
      plugins: [i18n, store, router],
      stubs: { ODrawer: drawer, FullViewContainer: { template: "<div><slot /></div>" } },
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
  store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: true };
  store.state.organizationData = {
    ...store.state.organizationData,
    regexPatternPrompt: "",
    regexPatternTestValue: "",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetEditorProposalsForTests();
  resetLifecycleForTests();
  setRuntimeHandle(null);
  document.body.innerHTML = "";
});

describe("AddRegexPattern with the revamped assistant", () => {
  it("has one assistant door: the toggle, without the inline Try link", async () => {
    const { wrapper, runtime } = await setup();
    expect(wrapper.findAll('[data-test="ai-entry-regex-ask"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="add-regex-pattern-open-close-ai-btn"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Try O2 Assistant");
    expect(runtime.hosts.get("regex")?.language).toBe("regex");
  });

  it("widens the drawer as it did for the legacy chat while docked, and docks in its body row", async () => {
    const { wrapper, runtime } = await setup();
    expect(wrapper.get('[data-test="add-regex-pattern-drawer"]').attributes("data-width")).toBe(
      "40",
    );
    runtime.store.open({ kind: "docked", hostId: "regex" }, { focus: "none" });
    await settleAsyncParts();
    expect(wrapper.get('[data-test="add-regex-pattern-drawer"]').attributes("data-width")).toBe(
      "70",
    );
    expect(wrapper.find('[data-test="assistant-dock-stub"]').exists()).toBe(true);
  });

  it("stages a log field's hand-off once into its own dock, never the sidebar", async () => {
    vi.stubGlobal("innerWidth", 1440);
    queueDockStage(
      "regex",
      { chips: [], text: "Which regex matches values like the sample?" },
      { entryKind: "object_verb", objectKind: "log_field" },
    );
    const { runtime } = await setup();
    await settleAsyncParts();
    expect(runtime.store.state.shell.placement).toEqual({ kind: "docked", hostId: "regex" });
    const sid = runtime.store.state.shell.activeSid!;
    expect(runtime.store.state.sessions[sid].composer.text).toBe(
      "Which regex matches values like the sample?",
    );
    expect(runtime.store.state.sessions[sid].origin.objectKind).toBe("log_field");
  });

  it("falls back to the sidebar where the widened drawer cannot hold 20 rem beside the pattern", async () => {
    vi.stubGlobal("innerWidth", 1100);
    queueDockStage(
      "regex",
      { chips: [], text: "Which regex?" },
      { entryKind: "object_verb", objectKind: "log_field" },
    );
    const { runtime } = await setup();
    await settleAsyncParts();
    expect(runtime.store.state.shell.placement.kind).toBe("sidebar");
  });

  it("guards a typed pattern: leaving asks first, named by the pattern", async () => {
    const off = registerLifecycleDialogs();
    const { wrapper } = await setup();
    (wrapper.vm as unknown as { patternValue: string }).patternValue = "\\d{16}";
    const leaving = runLeaveGuards();
    await settleAsyncParts();
    expect(useLifecycleQuestion().value?.question).toEqual({
      kind: "leave_guard",
      name: "this pattern",
    });
    useLifecycleQuestion().value!.answer("keep");
    await expect(leaving).resolves.toBe(false);
    off();
  });

  it("keeps both legacy controls with the revamp off", async () => {
    flag.on = false;
    const { wrapper, runtime } = await setup();
    expect(wrapper.find('[data-test="add-regex-pattern-open-close-ai-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-entry-regex-ask"]').exists()).toBe(false);
    expect(runtime.hosts.has("regex")).toBe(false);
  });
});
