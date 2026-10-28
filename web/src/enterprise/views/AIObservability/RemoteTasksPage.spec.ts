// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { RemoteTask } from "@/services/remote-tasks.service";

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "acme" }, userInfo: { email: "me@x.io" } },
  }),
}));

const list = vi.fn();
const remove = vi.fn();
vi.mock("@/services/remote-tasks.service", () => ({
  default: {
    list: (...a: any[]) => list(...a),
    delete: (...a: any[]) => remove(...a),
  },
}));

const listExperiments = vi.fn();
vi.mock("@/services/llm-experiments.service", () => ({
  default: { list: (...a: any[]) => listExperiments(...a) },
}));

const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));

const confirm = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));

import RemoteTasksPage from "./RemoteTasksPage.vue";
import {
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";

const draftScope = (entityId: string | null): EditorDraftScope => ({
  kind: "remote_task",
  org: "acme",
  entityId,
  userEmail: "me@x.io",
});

function task(overrides: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id: "row-1",
    orgId: "acme",
    entityId: "head-1",
    version: 2,
    isDraft: false,
    isReferenceable: true,
    taskRef: "summarizer@2",
    name: "summarizer",
    endpoint: "https://tasks.example.com/run",
    httpMethod: "POST",
    auth: { type: "none", usesSecret: false },
    customHeaders: [],
    contentType: "application/json",
    responseSchema: "$.output",
    timeoutMs: 60_000,
    maxAttempts: 3,
    maxConcurrency: 4,
    signing: { enabled: false, usesSecret: false },
    verificationStatus: "verified",
    isActive: true,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

/** A table stub that renders every cell slot, so column templates are exercised. */
const OTableStub = {
  props: ["data", "columns"],
  template: `<table><tbody><tr v-for="row in data" :key="row.entityId">
      <td v-for="column in columns" :key="column.id">
        <slot :name="'cell-' + column.id" :row="row" />
      </td>
    </tr></tbody></table>`,
};

const OButtonStub = {
  emits: ["click"],
  props: ["disabled"],
  // The event object must be forwarded: the row buttons use `@click.stop`, which
  // calls stopPropagation on the first emitted argument.
  template: `<button v-bind="$attrs" :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
};

function mountPage() {
  return mount(RemoteTasksPage, {
    global: { stubs: { OTable: OTableStub, OButton: OButtonStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listExperiments.mockResolvedValue([]);
});

describe("RemoteTasksPage", () => {
  it("renders each registered task without runtime errors", async () => {
    list.mockResolvedValue([task()]);
    const errors: unknown[] = [];
    const wrapper = mount(RemoteTasksPage, {
      global: { config: { errorHandler: (e) => errors.push(e) } },
    });
    await flushPromises();
    expect(errors).toEqual([]);
    expect(list).toHaveBeenCalledWith("acme");
    // The real OTable virtualizes its body, so the page-level assertion is that
    // it mounted and fetched; row rendering is asserted against the stub below.
    expect(wrapper.text()).toContain("New Task");
  });

  it("renders the task name in the table", async () => {
    list.mockResolvedValue([task()]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("summarizer");
  });

  // "Can an Experiment pin this?" is the question, not the raw verification
  // status — so a retired-but-verified head must not read as Published.
  it("labels each registry state distinctly", async () => {
    list.mockResolvedValue([
      task({ entityId: "published" }),
      task({ entityId: "draft", isDraft: true, version: 0, isReferenceable: false }),
      task({
        entityId: "failed",
        isDraft: true,
        version: 0,
        isReferenceable: false,
        verificationStatus: "failed",
      }),
      task({ entityId: "retired", isActive: false }),
    ]);
    const wrapper = mountPage();
    await flushPromises();

    const labels = ["published", "draft", "failed", "retired"].map((id) =>
      wrapper.get(`[data-test="ai-remote-tasks-state-${id}"]`).text(),
    );
    expect(labels).toEqual(["Published", "Draft", "Test Failed", "Retired"]);
  });

  it("shows no version for a draft, because it has none to pin", async () => {
    list.mockResolvedValue([task({ isDraft: true, version: 0, isReferenceable: false })]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).not.toContain("v0");
  });

  it("allows editing a task that uses a write-only signing secret", async () => {
    list.mockResolvedValue([
      task({
        entityId: "signed",
        signing: { enabled: true, usesSecret: true },
      }),
    ]);
    const wrapper = mountPage();
    await flushPromises();

    expect(
      wrapper.get('[data-test="ai-remote-tasks-edit-signed"]').attributes("disabled"),
    ).toBeUndefined();

    await wrapper.get('[data-test="ai-remote-tasks-edit-signed"]').trigger("click");
    expect(push).toHaveBeenCalled();
  });

  // The list endpoint carries no reference count, so it is derived from the
  // Experiments in the org — keyed by NAME, because a task_ref carries no id.
  it("counts the experiments pinned to each task", async () => {
    list.mockResolvedValue([task({ entityId: "a", name: "summarizer" })]);
    listExperiments.mockResolvedValue([
      { task: { type: "remote", taskRef: "summarizer@1" } },
      { task: { type: "remote", taskRef: "summarizer@2" } },
      { task: { type: "remote", taskRef: "other@1" } },
      { task: { type: "inline_prompt" } },
    ]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("2 experiments");
  });

  it("still renders the list when the experiment lookup fails", async () => {
    list.mockResolvedValue([task()]);
    listExperiments.mockRejectedValue(new Error("nope"));
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("summarizer");
  });

  it("deletes only after confirmation, then re-reads the list", async () => {
    list.mockResolvedValue([task()]);
    confirm.mockResolvedValue(false);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="ai-remote-tasks-delete-head-1"]').trigger("click");
    await flushPromises();
    expect(remove).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKeypath: "aiObservability.remoteTasks.delete.message",
        messageName: "summarizer",
        confirmVariant: "destructive",
      }),
    );

    confirm.mockResolvedValue(true);
    remove.mockResolvedValue(undefined);
    const before = list.mock.calls.length;
    await wrapper.get('[data-test="ai-remote-tasks-delete-head-1"]').trigger("click");
    await flushPromises();

    expect(remove).toHaveBeenCalledWith("acme", "head-1");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect(list.mock.calls.length).toBe(before + 1);
  });

  it("marks New and a task's name when this user keeps a draft for them", async () => {
    list.mockResolvedValue([task(), task({ id: "row-2", entityId: "head-2", name: "ranker" })]);
    const wrapper = mountPage();
    await flushPromises();
    const newButton = wrapper.get('[data-test="ai-remote-tasks-new-btn"]');
    expect(wrapper.find('[data-test="ai-remote-tasks-new-draft-dot"]').exists()).toBe(false);
    expect(newButton.attributes("aria-label")).toBeUndefined();

    writeEditorDraft(draftScope(null), { data: { name: "new one" } });
    writeEditorDraft(draftScope("head-2"), { data: { name: "ranker" } });
    await flushPromises();

    expect(wrapper.find('[data-test="ai-remote-tasks-new-draft-dot"]').exists()).toBe(true);
    expect(newButton.attributes("aria-label")).toBe("New Task · unsaved draft");
    expect(wrapper.find('[data-test="ai-remote-tasks-draft-dot-head-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-remote-tasks-draft-dot-head-1"]').exists()).toBe(false);
  });

  it("deleting a task drops its drafts; a failed delete keeps them", async () => {
    list.mockResolvedValue([task()]);
    writeEditorDraft(draftScope("head-1"), { data: { name: "summarizer" } });
    writeEditorDraft({ ...draftScope("head-1"), userEmail: "other@x.io" }, { data: {} });
    confirm.mockResolvedValue(true);
    remove.mockRejectedValueOnce({ response: { data: { message: "nope" } } });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.get('[data-test="ai-remote-tasks-delete-head-1"]').trigger("click");
    await flushPromises();
    expect(readEditorDraft(draftScope("head-1"))).not.toBeNull();

    remove.mockResolvedValue(undefined);
    await wrapper.get('[data-test="ai-remote-tasks-delete-head-1"]').trigger("click");
    await flushPromises();
    expect(readEditorDraft(draftScope("head-1"))).toBeNull();
    expect(readEditorDraft({ ...draftScope("head-1"), userEmail: "other@x.io" })).toBeNull();
  });

  it("reports a failed load rather than rendering an empty table silently", async () => {
    list.mockRejectedValue({ response: { data: { message: "boom" } } });
    mountPage();
    await flushPromises();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "boom" }),
    );
  });
});
