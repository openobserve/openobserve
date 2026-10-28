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
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import OForm from "@/lib/forms/Form/OForm.vue";
import remoteTasksService, { type RemoteTask } from "@/services/remote-tasks.service";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import RemoteTaskFormPage from "./RemoteTaskFormPage.vue";
import {
  remoteTaskFormDefaults,
  remoteTaskToFormValues,
  type RemoteTaskFormValues,
} from "./RemoteTaskForm.schema";

vi.mock("@/services/remote-tasks.service", () => ({
  default: {
    create: vi.fn(),
    saveDraft: vi.fn(),
    testConnection: vi.fn(),
    testCandidate: vi.fn(),
    testRun: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

interface FormApi {
  setFieldValue: (field: string, value: unknown) => void;
  handleSubmit: () => Promise<void>;
  state: { values: RemoteTaskFormValues };
}

const newScope: EditorDraftScope = {
  kind: "remote_task",
  org: "acme",
  entityId: null,
  userEmail: "me@x.io",
};
const editScope: EditorDraftScope = { ...newScope, entityId: "head-1" };

const storedTask: RemoteTask = {
  id: "row-1",
  orgId: "acme",
  entityId: "head-1",
  version: 2,
  isDraft: false,
  isReferenceable: true,
  taskRef: "summarizer@2",
  name: "summarizer",
  description: "calls the summarizer",
  endpoint: "https://tasks.example.com/run",
  httpMethod: "POST",
  auth: { type: "none", usesSecret: false },
  customHeaders: [{ key: "X-Team", value: "search", usesSecret: false }],
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
} as RemoteTask;

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "acme" },
    userInfo: { email: "me@x.io" },
    timezone: "UTC",
  },
});

const Blank = { render: () => h("div") };
let router: Router;
let wrapper: VueWrapper | null = null;

const mountAt = async (path: string) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ai/remote-tasks", name: "aiRemoteTasks", component: Blank },
      { path: "/ai/remote-tasks/new", name: "aiRemoteTaskCreate", component: RemoteTaskFormPage },
      {
        path: "/ai/remote-tasks/:id/edit",
        name: "aiRemoteTaskEdit",
        component: RemoteTaskFormPage,
      },
      { path: "/ai/remote-tasks/:id", name: "aiRemoteTaskDetail", component: Blank },
      { path: "/logs", name: "logs", component: Blank },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: { plugins: [router, store, i18n], stubs: { RemoteTaskTestPanel: true } },
    },
  );
  await flushPromises();
};

const form = () => (wrapper!.findComponent(OForm).vm as unknown as { form: FormApi }).form;

const edit = async (field: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue(field, value);
  await nextTick();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const inDialog = (dialog: string, id: string) =>
  document.body.querySelector<HTMLElement>(`[data-test="${dialog}"] [data-test="${id}"]`);
const leaveButton = (id: string) => inDialog("editor-draft-leave-dialog", id);
const restoreButton = (id: string) => inDialog("editor-draft-restore-dialog", id);

const published = { published: true, versionBumped: true, task: { version: 1 }, report: null };

describe("RemoteTaskFormPage drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(remoteTasksService.get).mockResolvedValue(storedTask);
    vi.mocked(remoteTasksService.create).mockResolvedValue({ entityId: "head-9" } as never);
    vi.mocked(remoteTasksService.saveDraft).mockResolvedValue({} as never);
    vi.mocked(remoteTasksService.testConnection).mockResolvedValue(published as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("drafts a new task filled with no key or pointer event, and leaving asks", async () => {
    await mountAt("/ai/remote-tasks/new");
    await fillField("ai-remote-task-form-name-input", "summarizer");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<RemoteTaskFormValues>(newScope)?.data.name).toBe("summarizer");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("aiRemoteTaskCreate");
  });

  it("names the restore as local changes and continues the draft with its secrets blank", async () => {
    writeEditorDraft(newScope, {
      data: { ...remoteTaskFormDefaults(), name: "restored", authType: "bearer", token: "" },
      redactedPaths: ["/token"],
      changedRedactedPaths: ["/token"],
    });
    await mountAt("/ai/remote-tasks/new");

    const dialog = byTest("editor-draft-restore-dialog");
    expect(dialog?.textContent).toContain("Unsaved local changes");
    expect(dialog?.textContent).toContain("unsaved changes to this remote task");
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("Token");

    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values).toMatchObject({ name: "restored", authType: "bearer", token: "" });
  });

  it("start fresh drops the draft and opens a blank form", async () => {
    writeEditorDraft(newScope, { data: { ...remoteTaskFormDefaults(), name: "old" } });
    await mountAt("/ai/remote-tasks/new");

    restoreButton("o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("escape opens a blank form and keeps the draft", async () => {
    writeEditorDraft(newScope, { data: { ...remoteTaskFormDefaults(), name: "old" } });
    await mountAt("/ai/remote-tasks/new");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft<RemoteTaskFormValues>(newScope)?.data.name).toBe("old");
  });

  it("never stores the token, the signing key or a secret header value", async () => {
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "signed");
    await edit("authType", "bearer");
    await edit("token", "tok-123");
    await edit("signingEnabled", true);
    await flushPromises();
    await edit("headers", [
      { key: "Authorization", value: "Bearer abc", usesSecret: false },
      { key: "X-Team", value: "search", usesSecret: false },
    ]);
    const generated = form().state.values.signingKey;
    expect(generated).not.toBe("");
    window.dispatchEvent(new Event("pagehide"));

    const stored = JSON.stringify(localStorage);
    expect(stored).not.toContain("tok-123");
    expect(stored).not.toContain(generated);
    expect(stored).not.toContain("Bearer abc");
    expect(readEditorDraft<RemoteTaskFormValues>(newScope)?.data.headers[1].value).toBe("search");
  });

  it("a continued signed draft gets a fresh signing key and says so beside it", async () => {
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "signed");
    await edit("signingEnabled", true);
    await flushPromises();
    const first = form().state.values.signingKey;
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();
    wrapper = null;

    await mountAt("/ai/remote-tasks/new");
    expect(byTest("editor-draft-credentials-not-saved")).toBeNull();
    expect(byTest("editor-draft-restore-note")?.textContent).toContain(
      "Signing keys are not kept in drafts",
    );
    expect(byTest("editor-draft-continue")?.textContent).toContain("Continue editing");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.signingEnabled).toBe(true);
    expect(form().state.values.signingKey).not.toBe("");
    expect(form().state.values.signingKey).not.toBe(first);
    expect(byTest("ai-remote-task-form-signing-key-regenerated")?.textContent).toContain(
      "This is a new signing key. The one in your draft was not kept",
    );

    byTest("ai-remote-task-form-signing-key-regenerate")?.click();
    await flushPromises();
    expect(byTest("ai-remote-task-form-signing-key-regenerated")).toBeNull();
  });

  it("switching auth to none releases a token that was not kept", async () => {
    writeEditorDraft(newScope, {
      data: {
        ...remoteTaskFormDefaults(),
        name: "summarizer",
        endpoint: "https://tasks.example.com/run",
        authType: "bearer",
        token: "",
      },
      redactedPaths: ["/token"],
      changedRedactedPaths: ["/token"],
    });
    await mountAt("/ai/remote-tasks/new");
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    await edit("authType", "none");
    await form().handleSubmit();
    await flushPromises();
    expect(remoteTasksService.create).toHaveBeenCalledTimes(1);
  });

  it("a failed publish that keeps the registered head moves the draft to that task", async () => {
    vi.mocked(remoteTasksService.testConnection).mockResolvedValue({
      published: false,
      error: "500 from upstream",
    } as never);
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "summarizer");
    await edit("endpoint", "https://tasks.example.com/run");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await form().handleSubmit();
    await flushPromises();
    expect(remoteTasksService.delete).not.toHaveBeenCalled();
    expect(readEditorDraft(newScope)).toBeNull();

    await edit("description", "after the failed test");
    window.dispatchEvent(new Event("pagehide"));
    const headScope = { ...newScope, entityId: "head-9" };
    expect(readEditorDraft<RemoteTaskFormValues>(headScope)?.data.description).toBe(
      "after the failed test",
    );
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("a rejected save of the kept head keeps the edits drafted and leaving still asks", async () => {
    vi.mocked(remoteTasksService.testConnection).mockResolvedValue({
      published: false,
      error: "500 from upstream",
    } as never);
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "summarizer");
    await edit("endpoint", "https://tasks.example.com/run");
    await form().handleSubmit();
    await flushPromises();
    const headScope = { ...newScope, entityId: "head-9" };

    vi.mocked(remoteTasksService.saveDraft).mockRejectedValue({
      response: { status: 409, data: { message: "Remote task name already exists" } },
    });
    await edit("name", "taken");
    await form().handleSubmit();
    await flushPromises();

    expect(remoteTasksService.saveDraft).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Remote task name already exists" }),
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<RemoteTaskFormValues>(headScope)?.data.name).toBe("taken");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-close-btn")?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("aiRemoteTaskCreate");
  });

  it("a failed publish that rolls the head back keeps the new-task draft", async () => {
    vi.mocked(remoteTasksService.testConnection).mockResolvedValue({
      published: false,
      error: "401",
    } as never);
    vi.mocked(remoteTasksService.delete).mockResolvedValue(undefined as never);
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "summarizer");
    await edit("endpoint", "https://tasks.example.com/run");
    await edit("authType", "bearer");
    await edit("token", "tok-123");
    window.dispatchEvent(new Event("pagehide"));

    await form().handleSubmit();
    await flushPromises();
    expect(remoteTasksService.delete).toHaveBeenCalledWith("acme", "head-9");
    expect(readEditorDraft(newScope)).not.toBeNull();
    expect(readEditorDraft({ ...newScope, entityId: "head-9" })).toBeNull();
  });

  it("a changed secret header comes back blank and Save is blocked until it is retyped", async () => {
    writeEditorDraft(newScope, {
      data: {
        ...remoteTaskFormDefaults(),
        name: "headers",
        endpoint: "https://tasks.example.com/run",
        headers: [{ key: "X-Api-Key", value: "", usesSecret: false }],
      },
      redactedPaths: ["/headers/0/value"],
      redactedLabels: { "/headers/0/value": "X-Api-Key" },
      changedRedactedPaths: ["/headers/0/value"],
    });
    await mountAt("/ai/remote-tasks/new");
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("X-Api-Key header");
    byTest("editor-draft-continue")?.click();
    await flushPromises();

    await form().handleSubmit();
    await flushPromises();
    expect(remoteTasksService.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Header value is required");

    await edit("headers", [{ key: "X-Api-Key", value: "key-new", usesSecret: false }]);
    await form().handleSubmit();
    await flushPromises();
    expect(remoteTasksService.create).toHaveBeenCalledTimes(1);
  });

  it("save from the leave dialog publishes without opening the detail page, then goes on", async () => {
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "summarizer");
    await edit("endpoint", "https://tasks.example.com/run");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(remoteTasksService.create).toHaveBeenCalledTimes(1);
    expect(remoteTasksService.testConnection).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("save from the leave dialog stays when the test connection fails", async () => {
    vi.mocked(remoteTasksService.testConnection).mockResolvedValue({
      published: false,
      error: "500 from upstream",
    } as never);
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "summarizer");
    await edit("endpoint", "https://tasks.example.com/run");

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("aiRemoteTaskCreate");
  });

  it("keep draft leaves and keeps the work; discard leaves and drops it", async () => {
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "kept");
    let navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-secondary-btn")?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<RemoteTaskFormValues>(newScope)?.data.name).toBe("kept");

    await router.push("/ai/remote-tasks/new");
    await flushPromises();
    restoreButton("o-dialog-secondary-btn")?.click();
    await flushPromises();
    await edit("name", "dropped");
    navigation = router.push("/logs");
    await flushPromises();
    leaveButton("o-dialog-neutral-btn")?.click();
    await navigation;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("cancel with unsaved changes asks before going back to the list", async () => {
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "to discard");

    byTest("ai-remote-task-form-cancel-btn")?.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("aiRemoteTasks");
  });

  it("a normal publish drops the draft and opens the detail page without asking", async () => {
    await mountAt("/ai/remote-tasks/new");
    await edit("name", "summarizer");
    await edit("endpoint", "https://tasks.example.com/run");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await form().handleSubmit();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("aiRemoteTaskDetail");
    expect(readEditorDraft(newScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("edit mode keys the draft by task and hashes the task as the form shows it", async () => {
    await mountAt("/ai/remote-tasks/head-1/edit");
    await edit("description", "edited");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<RemoteTaskFormValues>(editScope);
    expect(draft?.data.description).toBe("edited");
    expect(draft?.baseHash).toBe(hashDraftValue(remoteTaskToFormValues(storedTask)));
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("warns when the task changed on the server, but not when only its run state did", async () => {
    writeEditorDraft(editScope, {
      data: { ...remoteTaskToFormValues(storedTask), description: "mine" },
      baseHash: hashDraftValue(remoteTaskToFormValues(storedTask)),
    });
    vi.mocked(remoteTasksService.get).mockResolvedValue({
      ...storedTask,
      updatedAt: 99,
      verificationStatus: "failed",
    } as RemoteTask);
    await mountAt("/ai/remote-tasks/head-1/edit");
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
    expect(byTest("editor-draft-changed-on-server")).toBeNull();
    wrapper!.unmount();
    wrapper = null;

    vi.mocked(remoteTasksService.get).mockResolvedValue({
      ...storedTask,
      endpoint: "https://tasks.example.com/v2",
    } as RemoteTask);
    await mountAt("/ai/remote-tasks/head-1/edit");
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("opening the draft of a deleted task drops it with an info toast", async () => {
    writeEditorDraft(editScope, { data: remoteTaskToFormValues(storedTask) });
    vi.mocked(remoteTasksService.get).mockRejectedValue({ response: { status: 404 } });
    await mountAt("/ai/remote-tasks/head-1/edit");

    expect(readEditorDraft(editScope)).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        message: "This remote task no longer exists, so its unsaved draft was discarded.",
      }),
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(router.currentRoute.value.name).toBe("aiRemoteTasks");
  });
});
