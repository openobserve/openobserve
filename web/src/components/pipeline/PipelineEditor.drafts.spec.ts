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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import pipelineService from "@/services/pipelines";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { pipelineObj } from "@/plugins/pipelines/useDnD";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";
import PipelineEditor from "./PipelineEditor.vue";
import { projectPipeline, type PipelineDraftData } from "./pipelineDraft";

vi.mock("@vue-flow/core", () => ({
  MarkerType: { ArrowClosed: "arrowclosed" },
  useVueFlow: () => ({
    getSelectedEdges: { value: [] },
    removeEdges: vi.fn(),
    screenToFlowCoordinate: (p: { x: number; y: number }) => p,
    onNodesInitialized: () => ({ off: vi.fn() }),
    updateNode: vi.fn(),
  }),
}));
vi.mock("@/plugins/pipelines/PipelineFlow.vue", () => ({
  default: { name: "PipelineFlow", render: () => null },
}));
vi.mock("@/components/pipeline/NodeForm/Stream.vue", async () => {
  const { h: render } = await import("vue");
  return {
    default: {
      name: "StreamNode",
      render: () => render("div", { "data-test": "stub-stream-form" }),
    },
  };
});
vi.mock("@/components/pipeline/NodeForm/Query.vue", () => ({
  default: { name: "QueryForm", render: () => null },
}));
vi.mock("@/components/pipeline/NodeForm/Condition.vue", () => ({
  default: { name: "ConditionForm", render: () => null },
}));
vi.mock("@/components/pipeline/NodeForm/AssociateFunction.vue", async () => {
  const { h: render } = await import("vue");
  return {
    default: {
      name: "AssociateFunction",
      render: () => render("div", { "data-test": "stub-function-form" }),
    },
  };
});
vi.mock("@/components/pipeline/NodeForm/ExternalDestination.vue", () => ({
  default: { name: "ExternalDestination", render: () => null },
}));
vi.mock("@/components/common/JsonEditor.vue", () => ({
  default: { name: "JsonEditor", render: () => null },
}));
vi.mock("@/services/pipelines", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getPipelines: vi.fn(() => Promise.resolve({ data: { list: [] } })),
      createPipeline: vi.fn(() => Promise.resolve({ data: {} })),
      updatePipeline: vi.fn(() => Promise.resolve({ data: {} })),
    },
  });
});
vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(() => Promise.resolve({ data: { list: [] } })) },
  });
});
vi.mock("@/composables/usePipelines", () => ({
  default: () => ({
    getUsedStreamsList: vi.fn(() => Promise.resolve([])),
    getPipelineDestinations: vi.fn(() => Promise.resolve([])),
  }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn(() => Promise.resolve({ list: [] })) }),
}));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/composables/contextProviders", () => ({
  contextRegistry: { register: vi.fn(), unregister: vi.fn(), setActive: vi.fn() },
  createPipelinesContextProvider: vi.fn(() => ({})),
}));

const ORG = store.state.selectedOrganization.identifier;
const EMAIL = store.state.userInfo.email;
const newScope: EditorDraftScope = { kind: "pipeline", org: ORG, entityId: null, userEmail: EMAIL };
const editScope: EditorDraftScope = { ...newScope, entityId: "p1" };

const streamNode = (id: string, ioType: "input" | "output", stream: string) => ({
  id,
  type: ioType,
  io_type: ioType,
  position: { x: 10, y: ioType === "input" ? 0 : 200 },
  data: { node_type: "stream", stream_name: stream, stream_type: "logs", org_id: ORG },
});

const draftData = (overrides: Partial<PipelineDraftData> = {}): PipelineDraftData => ({
  name: "draft_pipe",
  description: "",
  source: { source_type: "realtime" },
  nodes: [streamNode("n1", "input", "in"), streamNode("n2", "output", "out")],
  edges: [{ id: "en1-n2", source: "n1", target: "n2" }],
  drawer: null,
  ...overrides,
});

const serverPipeline = () => ({
  pipeline_id: "p1",
  version: 7,
  enabled: true,
  paused_at: null,
  org: ORG,
  name: "parse_nginx",
  description: "",
  source: { source_type: "realtime", org_id: ORG, stream_name: "in", stream_type: "logs" },
  nodes: [
    { ...streamNode("n1", "input", "in"), type: undefined, is_disabled: false },
    { ...streamNode("n2", "output", "out"), type: undefined, is_disabled: false },
  ],
  edges: [{ id: "en1-n2", source: "n1", target: "n2" }],
});

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async (path: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/pipeline/pipelines",
        name: "pipelines",
        component: { render: () => h(RouterView) },
        children: [
          { path: "add", name: "createPipeline", component: PipelineEditor },
          { path: "edit", name: "pipelineEditor", component: PipelineEditor },
        ],
      },
      { path: "/logs", name: "logs", component: { render: () => h("div") } },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, i18n],
        provide: { store },
        stubs: { NodePalette: true, StepPickerDialog: true, OTooltip: true },
      },
    },
  );
  await flushPromises();
  return wrapper;
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );

const firstInput = () => window.dispatchEvent(new Event("pointerdown"));

const addValidPipeline = async (name = "my_pipe") => {
  firstInput();
  pipelineObj.currentSelectedPipeline.name = name;
  pipelineObj.currentSelectedPipeline.nodes = [
    streamNode("n1", "input", "in"),
    streamNode("n2", "output", "out"),
  ];
  pipelineObj.currentSelectedPipeline.edges = [{ id: "en1-n2", source: "n1", target: "n2" }];
  await nextTick();
};

describe("PipelineEditor drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    pipelineObj.dirtyFlag = false;
    pipelineObj.dialog.show = false;
    pipelineObj.dialog.name = "";
    for (const id of ["o2-page-actions", "o2-page-title"]) {
      const el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
    vi.mocked(pipelineService.createPipeline).mockClear();
    vi.mocked(pipelineService.updatePipeline).mockClear();
    vi.mocked(pipelineService.getPipelines).mockImplementation(() =>
      Promise.resolve({ data: { list: [serverPipeline()] } } as never),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("writes a new pipeline's nodes, edges and name when the page hides", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline("my_pipe");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<PipelineDraftData>(newScope);
    expect(draft?.data.name).toBe("my_pipe");
    expect(draft?.data.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(draft?.data.edges).toEqual([{ id: "en1-n2", source: "n1", target: "n2" }]);
    expect(draft?.data.drawer).toBeNull();
  });

  it("continues a draft after the reset, with decorated edges and the open node drawer", async () => {
    writeEditorDraft(newScope, {
      data: draftData({
        drawer: {
          type: "stream",
          nodeId: "n2",
          isEditNode: true,
          stagedNode: null,
          pendingSource: null,
        },
      }),
    });
    await mountEditor("/pipeline/pipelines/add");

    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this pipeline",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    const current = pipelineObj.currentSelectedPipeline;
    expect(current.name).toBe("draft_pipe");
    expect(current.nodes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
    expect(current.edges[0]).toMatchObject({ id: "en1-n2", type: "custom", animated: true });
    expect(pipelineObj.hasInputNode).toBe(true);
    expect(pipelineObj.dialog).toMatchObject({ show: true, name: "stream" });
    expect(pipelineObj.isEditNode).toBe(true);
    expect(pipelineObj.currentSelectedNodeData.id).toBe("n2");
    expect(byTest("stub-stream-form")).not.toBeNull();
  });

  it("reopens the drawer of a node that was being added, with its pending edge", async () => {
    const staged = {
      id: "n3",
      type: "default",
      io_type: "default",
      position: { x: 5, y: 5 },
      data: { node_type: "function" },
    };
    writeEditorDraft(newScope, {
      data: draftData({
        drawer: {
          type: "function",
          nodeId: "n3",
          isEditNode: false,
          stagedNode: staged,
          pendingSource: "n1",
        },
      }),
    });
    await mountEditor("/pipeline/pipelines/add");
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    expect(pipelineObj.currentSelectedNodeData).toEqual(staged);
    expect(pipelineObj.pendingEdge).toEqual({ source: "n1" });
    expect(pipelineObj.isEditNode).toBe(false);
    expect(byTest("stub-function-form")).not.toBeNull();
  });

  it("keys an edited pipeline's draft by its id and hashes only its editable fields", async () => {
    await mountEditor("/pipeline/pipelines/edit?id=p1");
    firstInput();
    pipelineObj.currentSelectedPipeline.nodes[1].position = { x: 99, y: 99 };
    pipelineObj.dirtyFlag = true;
    await nextTick();
    window.dispatchEvent(new Event("pagehide"));

    const server = serverPipeline();
    server.nodes.forEach((node) => Object.assign(node, { type: node.io_type }));
    const draft = readEditorDraft<PipelineDraftData>(editScope);
    expect(draft?.data.nodes[1].position).toEqual({ x: 99, y: 99 });
    expect(draft?.baseHash).toBe(hashDraftValue(projectPipeline(server)));
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("warns when the pipeline changed on the server after the draft was written", async () => {
    writeEditorDraft(editScope, { data: draftData(), baseHash: "00000000" });
    await mountEditor("/pipeline/pipelines/edit?id=p1");

    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(pipelineObj.dirtyFlag).toBe(true);
  });

  it("drops the draft of a pipeline that no longer exists", async () => {
    writeEditorDraft({ ...newScope, entityId: "gone" }, { data: draftData() });
    await mountEditor("/pipeline/pipelines/edit?id=gone");

    expect(readEditorDraft({ ...newScope, entityId: "gone" })).toBeNull();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(router.currentRoute.value.name).toBe("pipelines");
  });

  it("Cancel with unsaved changes asks, and Discard drops the draft and leaves", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();
    window.dispatchEvent(new Event("pagehide"));

    byTest("add-pipeline-cancel-btn")?.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(router.currentRoute.value.name).toBe("createPipeline");

    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("pipelines");
    expect(readEditorDraft(newScope)).toBeNull();
    expect(pipelineObj.dialog.show).toBe(false);
  });

  it("Save in the leave dialog saves without opening the list, then continues the navigation", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(pipelineService.createPipeline).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog of a basic pipeline asks first, then goes where the user was headed", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();
    pipelineObj.currentSelectedPipeline.nodes = [
      streamNode("n1", "input", "same"),
      streamNode("n2", "output", "same"),
    ];
    await nextTick();

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("createPipeline");
    expect(pipelineService.createPipeline).not.toHaveBeenCalled();

    document.body
      .querySelector<HTMLElement>('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]')
      ?.click();
    await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("logs"));
    expect(pipelineService.createPipeline).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("the toolbar Save of a basic pipeline still opens the list after the prompt", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();
    pipelineObj.currentSelectedPipeline.nodes = [
      streamNode("n1", "input", "same"),
      streamNode("n2", "output", "same"),
    ];
    await nextTick();
    // A stayed leave must not leave its destination behind for a later prompt.
    const stayed = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-close-btn")?.click();
    await stayed;
    await flushPromises();

    byTest("add-pipeline-save-btn")?.click();
    const confirm = () =>
      document.body.querySelector<HTMLElement>(
        '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
      );
    await vi.waitFor(() => expect(confirm()).not.toBeNull());
    confirm()!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("pipelines"));
    expect(pipelineService.createPipeline).toHaveBeenCalledTimes(1);
  });

  it("Save in the leave dialog keeps the user in the editor when the pipeline is invalid", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline("");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(pipelineService.createPipeline).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("createPipeline");
  });

  it("Discard on a route leave resets the shared pipeline state, so the next open starts clean", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline("dropped_pipe");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-neutral-btn")?.click();
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
    expect(pipelineObj.currentSelectedPipeline.name).toBe("");
    expect(pipelineObj.currentSelectedPipeline.nodes).toEqual([]);
    expect(pipelineObj.currentSelectedPipeline.edges).toEqual([]);
    expect(pipelineObj.dirtyFlag).toBe(false);
  });

  it("Keep draft lets a route leave go and keeps the work", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline("kept_pipe");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<PipelineDraftData>(newScope)?.data.name).toBe("kept_pipe");
    expect(pipelineObj.currentSelectedPipeline.name).toBe("");
  });

  it("a failed save shows the server's message and keeps the draft", async () => {
    dismissAll();
    vi.mocked(pipelineService.createPipeline).mockRejectedValueOnce({
      response: { status: 400, data: { message: "Stream out is missing" } },
    });
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();
    window.dispatchEvent(new Event("pagehide"));

    byTest("add-pipeline-save-btn")?.click();
    await vi.waitFor(() => expect(pipelineService.createPipeline).toHaveBeenCalledTimes(1));
    await flushPromises();

    const errors = toastRecords.filter((r) => r.variant === "error").map((r) => r.message);
    expect(errors).toContain("Stream out is missing");
    expect(router.currentRoute.value.name).toBe("createPipeline");
    expect(readEditorDraft(newScope)).not.toBeNull();
  });

  it("a forbidden save shows no error toast", async () => {
    dismissAll();
    vi.mocked(pipelineService.createPipeline).mockRejectedValueOnce({
      response: { status: 403, data: { message: "Forbidden" } },
    });
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();

    byTest("add-pipeline-save-btn")?.click();
    await vi.waitFor(() => expect(pipelineService.createPipeline).toHaveBeenCalledTimes(1));
    await flushPromises();

    expect(toastRecords.some((r) => r.variant === "error")).toBe(false);
  });

  it("a normal save drops the draft and opens the list without asking", async () => {
    await mountEditor("/pipeline/pipelines/add");
    await addValidPipeline();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    byTest("add-pipeline-save-btn")?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("pipelines"));

    expect(pipelineService.createPipeline).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("pipelines");
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(newScope)).toBeNull();
  });
});
