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
import { resetEditorProposalsForTests } from "@/composables/assistant/useEditorProposal";
import { contextRegistry } from "@/composables/contextProviders/registry";
import i18n from "@/locales";
import useDnD from "@/plugins/pipelines/useDnD";
import store from "@/test/unit/helpers/store";

const { flag } = vi.hoisted(() => ({ flag: { on: true } }));

vi.mock("@/composables/assistant/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant/flags")>()),
  isAssistantV2: () => flag.on,
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "_timestamp", type: "datetime" }] }),
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
  }),
}));
vi.mock("@/plugins/pipelines/useDnD", () => ({ default: vi.fn() }));
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
  default: { name: "O2AIChat", template: "<div data-test='legacy-chat'></div>" },
}));

import Query from "./Query.vue";

const editorProvider = { getContext: async () => ({ pipelineName: "orders" }) };

function setup() {
  const runtime = fakeRuntime();
  setRuntimeHandle(runtime as never);
  vi.mocked(useDnD).mockImplementation(
    () =>
      ({
        pipelineObj: {
          isEditNode: false,
          currentSelectedNodeData: null,
          currentSelectedNodeID: "query-node-1",
          currentSelectedPipeline: { name: "orders", nodes: [], edges: [] },
          userClickedNode: {},
          userSelectedNode: {},
        },
        addNode: vi.fn(),
        deletePipelineNode: vi.fn(),
      }) as never,
  );
  const wrapper = mount(Query, {
    props: {
      open: true,
      streamName: "orders",
      streamType: "logs",
      streamRoutes: {},
      editingRoute: null,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: {
          props: ["open"],
          template: '<div v-if="open"><slot name="header-right" /><slot /></div>',
        },
        UnifiedQueryEditor: { template: "<div><textarea /></div>", methods: { replaceValue() {} } },
        FieldExpansion: true,
        GroupedFieldList: true,
        PreviewPromqlQuery: true,
        JsonPreview: true,
        ConfirmDialog: true,
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
  contextRegistry.register("pipelines", editorProvider);
  contextRegistry.setActive("pipelines");
});

afterEach(() => {
  resetEditorProposalsForTests();
  setRuntimeHandle(null);
  document.body.innerHTML = "";
});

describe("ScheduledPipeline with the revamped assistant", () => {
  it("registers the query node's host with its language and the pipeline in its title", async () => {
    const { wrapper, runtime } = setup();
    await settleAsyncParts();
    const toggle = wrapper.get('[data-test="ai-entry-scheduled-query-ask"]');
    expect(toggle.attributes("data-dock-host")).toBe("scheduled_query");
    const adapter = runtime.hosts.get("scheduled_query")!;
    expect(adapter.language).toBe("sql");
    expect(adapter.objectKind).toBe("pipeline_node");
    expect(String(adapter.objectTitle())).toContain("orders");
  });

  it("pushes the node's context over the editor's and pops only its own on close", async () => {
    const { wrapper, runtime } = setup();
    await settleAsyncParts();
    runtime.store.open({ kind: "docked", hostId: "scheduled_query" }, { focus: "none" });
    await settleAsyncParts();
    expect(wrapper.find('[data-test="assistant-dock-stub"]').attributes("data-host")).toBe(
      "scheduled_query",
    );
    expect(await contextRegistry.getActiveContext()).toMatchObject({ currentSQLQuery: "" });
    wrapper.unmount();
    await settleAsyncParts();
    expect(runtime.hosts.has("scheduled_query")).toBe(false);
    expect(await contextRegistry.getActiveContext()).toEqual({ pipelineName: "orders" });
  });

  it("keeps the legacy register path with the revamp off", async () => {
    flag.on = false;
    const { wrapper, runtime } = setup();
    await settleAsyncParts();
    expect(runtime.hosts.has("scheduled_query")).toBe(false);
    expect(wrapper.find('[data-test="assistant-dock-stub"]').exists()).toBe(false);
    expect(await contextRegistry.getActiveContext()).not.toEqual({ pipelineName: "orders" });
  });
});
