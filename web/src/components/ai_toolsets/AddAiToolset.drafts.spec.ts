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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import aiToolsetsService from "@/services/ai_toolsets";
import { queryClient } from "@/composables/query/queryClient";
import {
  editorDraftKey,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { fillField } from "@/test/unit/helpers/fillField";
import AiToolsets from "@/components/settings/AiToolsets.vue";
import AddAiToolset from "./AddAiToolset.vue";

vi.mock("@/services/ai_toolsets", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(() => Promise.resolve({ data: {} })),
    update: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn(() => () => undefined) }));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: toastMock,
}));

const QueryEditorStub = {
  name: "QueryEditor",
  props: ["query", "editorId", "language"],
  emits: ["update:query"],
  template: '<div class="query-editor-stub" />',
};

interface ToolsetForm {
  state: {
    values: Record<string, unknown> & { mcp: { headers: { key: string; value: string }[] } };
  };
  setFieldValue: (k: string, v: unknown) => void;
  getFieldMeta: (k: string) => { errors?: unknown[] } | undefined;
  handleSubmit: () => Promise<void>;
}

const ORG = store.state.selectedOrganization.identifier;
const EMAIL = store.state.userInfo.email;
const newScope: EditorDraftScope = {
  kind: "ai_toolset",
  org: ORG,
  entityId: null,
  userEmail: EMAIL,
};
const editScope: EditorDraftScope = { ...newScope, entityId: "ts1" };

const serverToolset = (headers: Record<string, string> = {}) => ({
  id: "ts1",
  name: "github_mcp",
  kind: "mcp",
  description: "GitHub tools",
  data: {
    url: "https://api.example.com/mcp/",
    timeout_seconds: 30,
    headers: { Authorization: "Bearer saved-token", "X-Team": "sre-team", ...headers },
  },
});

const Stub = { render: () => h("div") };

let router: Router;
let wrapper: VueWrapper | null = null;

const mountPage = async (query: Record<string, string> = { action: "add" }) => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ai_toolsets", name: "aiToolsets", component: AiToolsets },
      { path: "/logs", name: "logs", component: Stub },
    ],
  });
  await router.push({ name: "aiToolsets", query: { org_identifier: ORG, ...query } });
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [router, store, i18n],
        provide: { store },
        stubs: { QueryEditor: QueryEditorStub },
      },
    },
  );
  await flushPromises();
};

const remount = async (query?: Record<string, string>) => {
  wrapper?.unmount();
  wrapper = null;
  await mountPage(query);
};

const form = () =>
  (wrapper!.findComponent(AddAiToolset).vm as unknown as { form: ToolsetForm }).form;

const edit = async (values: Record<string, unknown>) => {
  window.dispatchEvent(new Event("pointerdown"));
  Object.entries(values).forEach(([field, value]) => form().setFieldValue(field, value));
  await nextTick();
};

// The list's own loading toast is not a notice about the toolset.
const noticeVariants = () =>
  toastMock.mock.calls
    .map(([arg]) => (arg as { variant: string }).variant)
    .filter((variant) => variant !== "loading");

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );
const restoreButton = (id: string) =>
  document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-restore-dialog"] [data-test="${id}"]`,
  );

describe("AddAiToolset drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.mocked(aiToolsetsService.list).mockResolvedValue({
      data: { toolsets: [{ id: "ts1", name: "github_mcp", kind: "mcp", description: "" }] },
    } as never);
    vi.mocked(aiToolsetsService.get).mockResolvedValue({ data: serverToolset() } as never);
    vi.mocked(aiToolsetsService.create).mockClear();
    vi.mocked(aiToolsetsService.update).mockClear();
    toastMock.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("never writes header, env or credential file values to storage", async () => {
    await mountPage();
    await edit({
      name: "ops_mcp",
      "mcp.url": "https://mcp.example.com/",
      "mcp.headers": [
        { key: "Authorization", value: "Bearer s3cr3t", visible: false },
        { key: "X-Tenant", value: "tenant-42", visible: true },
      ],
      "cli.env": [{ key: "GH_TOKEN", value: "ghp_abcdef", visible: false }],
      "cli.credFiles": [{ key: "KUBECONFIG", value: "apiVersion: v1\ntoken: kube-secret" }],
    });
    window.dispatchEvent(new Event("pagehide"));

    const stored = localStorage.getItem(editorDraftKey(newScope)) ?? "";
    expect(stored).toContain("X-Tenant");
    expect(stored).toContain("https://mcp.example.com/");
    for (const secret of ["s3cr3t", "tenant-42", "ghp_abcdef", "kube-secret"]) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toContain("visible");

    await remount();
    const note = byTest("editor-draft-credentials-not-saved")?.textContent ?? "";
    expect(note).toContain("environment variable GH_TOKEN");
    expect(note).toContain("credential file KUBECONFIG");
  });

  it("counts a name typed with no key or pointer event", async () => {
    await mountPage();
    await fillField("ai-toolset-name-input", "filled_toolset");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("filled_toolset");
  });

  it("a password visibility toggle alone is not an unsaved change", async () => {
    await mountPage({ action: "edit", id: "ts1" });
    await edit({ "mcp.headers[0].visible": true });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(editScope)).toBeNull();

    byTest("ai-toolset-cancel-btn")?.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(router.currentRoute.value.query.action).toBeUndefined();
  });

  it("continues a new toolset's draft, and Start fresh or Escape answer the offer", async () => {
    await mountPage();
    await edit({ name: "draft_tool", description: "From the draft" });
    window.dispatchEvent(new Event("pagehide"));

    await remount();
    expect(byTest("editor-draft-restore-message")?.textContent).toContain(
      "unsaved changes to this AI toolset",
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    if (byTest("editor-draft-restore-dialog")) restoreButton("o-dialog-close-btn")?.click();
    await flushPromises();
    expect(form().state.values.name).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();

    await remount();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values).toMatchObject({
      name: "draft_tool",
      description: "From the draft",
    });

    await remount();
    restoreButton("o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(readEditorDraft(newScope)).toBeNull();
    expect(form().state.values.name).toBe("");
  });

  it("an edit draft refills unchanged headers by name and blocks Save on a changed one", async () => {
    await mountPage({ action: "edit", id: "ts1" });
    expect(form().state.values.mcp.headers.map((row) => row.key)).toEqual([
      "Authorization",
      "X-Team",
    ]);
    await edit({
      description: "Edited",
      "mcp.headers": [
        { key: "X-Team", value: "sre-team", visible: false },
        { key: "Authorization", value: "Bearer new-token", visible: false },
      ],
    });
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(editorDraftKey(editScope))).not.toContain("new-token");

    await remount({ action: "edit", id: "ts1" });
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain(
      "Your change to the Authorization header was not kept.",
    );
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(form().state.values.description).toBe("Edited");
    expect(form().state.values.mcp.headers).toEqual([
      { key: "X-Team", value: "sre-team", visible: false },
      { key: "Authorization", value: "", visible: false },
    ]);
    expect(form().getFieldMeta("mcp.headers[1].value")?.errors?.length).toBeGreaterThan(0);

    await form().handleSubmit();
    await flushPromises();
    expect(aiToolsetsService.update).not.toHaveBeenCalled();

    await edit({ "mcp.headers[1].value": "Bearer typed-again" });
    await form().handleSubmit();
    await flushPromises();
    expect(aiToolsetsService.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(aiToolsetsService.update).mock.calls[0][2]).toMatchObject({
      data: { headers: { "X-Team": "sre-team", Authorization: "Bearer typed-again" } },
    });
  });

  it("warns when the toolset changed on the server", async () => {
    await mountPage({ action: "edit", id: "ts1" });
    await edit({ description: "Edited" });
    window.dispatchEvent(new Event("pagehide"));

    await remount({ action: "edit", id: "ts1" });
    expect(byTest("editor-draft-changed-on-server")).toBeNull();

    vi.mocked(aiToolsetsService.get).mockResolvedValue({
      data: serverToolset({ "X-Region": "eu" }),
    } as never);
    await remount({ action: "edit", id: "ts1" });
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("drops the draft of a toolset that no longer exists with one notice, and goes back", async () => {
    writeEditorDraft(editScope, { data: { name: "github_mcp" } });
    vi.mocked(aiToolsetsService.get).mockRejectedValue({ response: { status: 404 } });
    await mountPage({ action: "edit", id: "ts1" });

    expect(readEditorDraft(editScope)).toBeNull();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(noticeVariants()).toEqual(["info"]);
    expect(router.currentRoute.value.query.action).toBeUndefined();
  });

  it("a deleted toolset with no draft shows the load error and goes back", async () => {
    vi.mocked(aiToolsetsService.get).mockRejectedValue({ response: { status: 404 } });
    await mountPage({ action: "edit", id: "ts1" });

    expect(noticeVariants()).toEqual(["error"]);
    expect(router.currentRoute.value.query.action).toBeUndefined();
  });

  it("a not-kept header does not block Save once the toolset is switched to another kind", async () => {
    await mountPage();
    await edit({
      name: "switch_kind",
      "mcp.url": "https://mcp.example.com/",
      "mcp.headers": [{ key: "Authorization", value: "Bearer s3cr3t", visible: false }],
    });
    window.dispatchEvent(new Event("pagehide"));

    await remount();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    await form().handleSubmit();
    await flushPromises();
    expect(aiToolsetsService.create).not.toHaveBeenCalled();

    await edit({ kind: "cli", "cli.command": "kubectl" });
    await form().handleSubmit();
    await flushPromises();
    expect(aiToolsetsService.create).toHaveBeenCalledTimes(1);
  });

  it("marks a not-kept credential file under its editor until it is filled again", async () => {
    vi.mocked(aiToolsetsService.get).mockResolvedValue({
      data: {
        id: "ts1",
        name: "kube_cli",
        kind: "cli",
        description: "",
        data: {
          command: "kubectl",
          timeout_seconds: 30,
          max_output_bytes: 100000,
          env: {},
          credential_files: { KUBECONFIG: "apiVersion: v1" },
        },
      },
    } as never);
    await mountPage({ action: "edit", id: "ts1" });
    await edit({ "cli.credFiles[0].value": "apiVersion: v2" });
    window.dispatchEvent(new Event("pagehide"));

    await remount({ action: "edit", id: "ts1" });
    expect(byTest("editor-draft-credentials-not-saved")?.textContent).toContain("KUBECONFIG");
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    expect(byTest("ai-toolset-cred-file-reenter-0")).not.toBeNull();

    await edit({ "cli.credFiles[0].value": "apiVersion: v3" });
    await flushPromises();
    expect(byTest("ai-toolset-cred-file-reenter-0")).toBeNull();
  });

  it("Cancel asks; Keep draft returns to the list with a dot on Add, Discard drops it", async () => {
    await mountPage();
    await edit({ name: "kept_tool" });
    byTest("ai-toolset-cancel-btn")?.click();
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    // A slow list reload must not remount the editor and offer the draft just kept.
    let releaseList!: () => void;
    vi.mocked(aiToolsetsService.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseList = () =>
            resolve({
              data: { toolsets: [{ id: "ts1", name: "github_mcp", kind: "mcp", description: "" }] },
            } as never);
        }),
    );
    leaveButton("o-dialog-secondary-btn")?.click();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(wrapper!.findComponent(AddAiToolset).exists()).toBe(false);
    releaseList();
    await flushPromises();

    expect(router.currentRoute.value.query.action).toBeUndefined();
    expect(readEditorDraft<{ name: string }>(newScope)?.data.name).toBe("kept_tool");
    const add = wrapper!.find('[data-test="ai-toolsets-add-btn"]');
    expect(add.find('[data-test="ai-toolsets-add-draft-dot"]').exists()).toBe(true);
    expect(add.attributes("aria-label")).toBe("New AI Toolset · unsaved draft");

    await remount();
    byTest("editor-draft-continue")?.click();
    await flushPromises();
    byTest("ai-toolset-back-btn")?.click();
    await flushPromises();
    leaveButton("o-dialog-neutral-btn")?.click();
    await flushPromises();
    expect(router.currentRoute.value.query.action).toBeUndefined();
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Save in the leave dialog saves and goes where the user was headed", async () => {
    await mountPage();
    await edit({ name: "saved_tool", "mcp.url": "https://mcp.example.com/" });

    const navigation = router.push("/logs");
    await flushPromises();
    leaveButton("editor-draft-leave-save")?.click();
    await navigation;
    await flushPromises();

    expect(aiToolsetsService.create).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("a normal save drops the draft and returns to the list without asking", async () => {
    await mountPage();
    await edit({ name: "saved_tool", "mcp.url": "https://mcp.example.com/" });
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await form().handleSubmit();
    await vi.waitFor(() => expect(router.currentRoute.value.query.action).toBeUndefined());
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("marks a toolset row with a draft and drops the draft when the toolset is deleted", async () => {
    writeEditorDraft(editScope, { data: { name: "github_mcp" } });
    await mountPage({});
    expect(byTest("ai-toolsets-draft-dot-github_mcp")).not.toBeNull();

    const page = wrapper!.findComponent(AiToolsets).vm as unknown as {
      confirmDeleteToolset: (row: { id: string; name: string }) => void;
      deleteToolset: () => void;
    };
    page.confirmDeleteToolset({ id: "ts1", name: "github_mcp" });
    page.deleteToolset();
    await flushPromises();
    expect(readEditorDraft(editScope)).toBeNull();
  });
});
