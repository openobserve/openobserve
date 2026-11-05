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

import { settleAsyncParts } from "@/components/ai-assistant/__tests__/assistantPartStubs";
import { fakeRuntime } from "@/composables/assistant/__tests__/fakeRuntime";
import { setRuntimeHandle } from "@/composables/assistant/runtimeHandle";
import {
  proposalFor,
  resetEditorProposalsForTests,
} from "@/composables/assistant/useEditorProposal";
import { contextRegistry } from "@/composables/contextProviders/registry";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const { flag } = vi.hoisted(() => ({ flag: { on: true } }));

vi.mock("@/composables/assistant/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant/flags")>()),
  isAssistantV2: () => flag.on,
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true" } }));
vi.mock("@/components/ai-assistant/shell/AssistantDock.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.assistantDockStub),
);
vi.mock("@/components/ai-assistant/entry/AiLabel.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.aiLabelStub),
);
vi.mock("@/components/ai-assistant/evidence/AssistantDiffBlock.vue", () =>
  import("@/components/ai-assistant/__tests__/assistantPartStubs").then((m) => m.diffBlockStub),
);

import JsonEditor from "./JsonEditor.vue";

const replaceValue = vi.fn();

function setup(type: "alerts" | "pipelines" = "alerts") {
  const runtime = fakeRuntime();
  setRuntimeHandle(runtime as never);
  const wrapper = mount(JsonEditor, {
    props: {
      data: { id: "a1", name: "checkout-latency", org_id: "org1", threshold: 5 },
      title: "Edit JSON",
      type,
      validationErrors: [],
      isEditing: true,
    },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        "query-editor": {
          template: '<div data-test="common-json-editor"><textarea /></div>',
          methods: { replaceValue },
        },
        O2AIChat: { template: '<div data-test="legacy-chat" />' },
      },
    },
    attachTo: document.body,
  });
  return { wrapper, runtime };
}

beforeEach(() => {
  flag.on = true;
  sessionStorage.clear();
  contextRegistry.cleanup();
  replaceValue.mockClear();
});

afterEach(() => {
  resetEditorProposalsForTests();
  setRuntimeHandle(null);
  document.body.innerHTML = "";
});

describe("JsonEditor with the revamped assistant", () => {
  it("registers the JSON host with the object's title and its id in the context", async () => {
    const { runtime } = setup();
    await settleAsyncParts();
    const adapter = runtime.hosts.get("json_editor")!;
    expect(adapter.language).toBe("json");
    expect(adapter.objectKind).toBe("alert");
    expect(String(adapter.objectTitle())).toBe("Alert · checkout-latency");
    expect(adapter.getContext()).toEqual({ alertId: "a1" });
  });

  it("lands an accepted proposal through the protected-field merge and says what it kept", async () => {
    const { wrapper } = setup();
    await settleAsyncParts();
    const proposal = proposalFor("json_editor")!;
    const changed = JSON.stringify({ id: "zz", name: "renamed", org_id: "org1", threshold: 9 });
    const handle = await proposal.propose(changed, {
      mode: "replace",
      provenance: { prompt: "raise the threshold" },
      canRun: false,
    });
    await settleAsyncParts();
    expect(wrapper.find('[data-test="assistant-diff-block"]').exists()).toBe(true);
    handle.accept();
    await settleAsyncParts();
    const landed = JSON.parse(replaceValue.mock.calls.at(-1)![0]);
    expect(landed).toMatchObject({ id: "a1", name: "checkout-latency", threshold: 9 });
    expect(proposal.label.value?.note).toBe("assistant.editor.protectedFields");
    expect(wrapper.find('[data-test="ai-label-editor"]').exists()).toBe(true);
  });

  it("docks beside the JSON in the drawer's body row", async () => {
    const { wrapper, runtime } = setup("pipelines");
    await settleAsyncParts();
    runtime.store.open({ kind: "docked", hostId: "json_editor" }, { focus: "none" });
    await settleAsyncParts();
    expect(wrapper.find('[data-test="assistant-dock-stub"]').attributes("data-host")).toBe(
      "json_editor",
    );
    expect(wrapper.find('[data-test="legacy-chat"]').exists()).toBe(false);
  });

  it("keeps the legacy chat with the revamp off", async () => {
    flag.on = false;
    store.state.isAiChatEnabled = true;
    const { wrapper, runtime } = setup();
    await settleAsyncParts();
    expect(runtime.hosts.has("json_editor")).toBe(false);
    expect(wrapper.find('[data-test="legacy-chat"]').exists()).toBe(true);
    store.state.isAiChatEnabled = false;
  });
});
