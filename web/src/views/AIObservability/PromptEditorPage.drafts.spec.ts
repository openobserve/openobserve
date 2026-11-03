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
import llmPromptsService from "@/services/llm-prompts.service";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { byTest, click, clickLeave, clickRestore, pressEscape } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import { promptEditorDefaults } from "./PromptEditor.schema";
import PromptEditorPage from "./PromptEditorPage.vue";

vi.mock("@/services/llm-prompts.service", () => ({
  default: {
    get: vi.fn(),
    getVersion: vi.fn(),
    match: vi.fn(),
    create: vi.fn(),
    createVersion: vi.fn(),
  },
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false", isCloud: "false" } }));

interface PromptDraftData {
  values: Record<string, unknown>;
  messages: { role: string; content: string }[];
}

interface FormApi {
  setFieldValue: (field: string, value: unknown) => void;
  handleSubmit: () => Promise<void>;
  state: { values: Record<string, unknown> };
}

const newScope: EditorDraftScope = {
  kind: "prompt",
  org: "test-org",
  entityId: null,
  userEmail: "me@x.io",
};
const versionScope: EditorDraftScope = { ...newScope, entityId: "prompt-a" };

const savedPrompt = {
  entityId: "prompt-a",
  name: "triage",
  folderId: "default",
  type: "text",
  description: null,
  tags: [],
  status: "active",
  latestVersion: 2,
  createdBy: "",
  createdAt: 0,
  updatedBy: "",
  updatedAt: 0,
  labels: [],
};
const savedVersion = {
  id: "v-2",
  entityId: "prompt-a",
  version: 2,
  payload: "Classify {{ ticket }}",
  config: { model: "gpt-4o", params: {}, tools: null, responseFormat: null },
  commitMessage: "second",
  source: "ui",
  baseVersion: 1,
  contentHash: "",
  createdBy: "",
  createdAt: 0,
};
const mutationResult = {
  prompt: { ...savedPrompt, entityId: "pr-new" },
  version: { ...savedVersion, entityId: "pr-new", version: 1 },
};

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io" },
    timezone: "UTC",
  },
});

const blank = { render: () => h("div") };
let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async (path = "/ai/prompts/new") => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ai/prompts", name: "aiPrompts", component: blank },
      { path: "/ai/prompts/new", name: "aiPromptCreate", component: PromptEditorPage },
      {
        path: "/ai/prompts/:entityId/versions/new",
        name: "aiPromptVersionCreate",
        component: PromptEditorPage,
      },
      { path: "/ai/playground", name: "aiPlayground", component: blank },
      { path: "/logs", name: "logs", component: blank },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [router, store, i18n] } },
  );
  await flushPromises();
};

const form = () => (wrapper!.findComponent(OForm).vm as unknown as { form: FormApi }).form;

const edit = async (field: string, value: unknown) => {
  window.dispatchEvent(new Event("pointerdown"));
  form().setFieldValue(field, value);
  await nextTick();
};

const fillValid = async () => {
  await edit("name", "summarise");
  await edit("textPayload", "Summarise {{ doc }}");
  await edit("commitMessage", "first");
};

describe("PromptEditorPage drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(llmPromptsService.get).mockResolvedValue(savedPrompt as never);
    vi.mocked(llmPromptsService.getVersion).mockResolvedValue(savedVersion as never);
    vi.mocked(llmPromptsService.match).mockResolvedValue([]);
    vi.mocked(llmPromptsService.create).mockResolvedValue(mutationResult as never);
    vi.mocked(llmPromptsService.createVersion).mockResolvedValue(mutationResult as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("writes a new prompt's draft when the page hides", async () => {
    await mountEditor();
    await edit("textPayload", "Hello {{ name }}");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<PromptDraftData>(newScope);
    expect(draft?.data.values).toMatchObject({ type: "text", textPayload: "Hello {{ name }}" });
    expect(draft?.data.values).not.toHaveProperty("chatContent");
  });

  it("drafts and guards a new prompt filled with no key or pointer event (autofill, fill())", async () => {
    await mountEditor();
    await fillField("prompt-editor-name", "filled_prompt");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<PromptDraftData>(newScope)?.data.values.name).toBe("filled_prompt");

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-close-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("aiPromptCreate");
  });

  it("drafts and guards a new version filled with no key or pointer event", async () => {
    await mountEditor("/ai/prompts/prompt-a/versions/new");
    await fillField("prompt-editor-text", "Classify {{ ticket }} by fill");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft<PromptDraftData>(versionScope)?.data.values.textPayload).toBe(
      "Classify {{ ticket }} by fill",
    );

    const navigation = router.push("/logs");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-close-btn");
    await navigation;
  });

  it("offers a saved draft on open and continues it", async () => {
    const { chatContent: _chatContent, ...values } = promptEditorDefaults();
    writeEditorDraft(newScope, {
      data: { values: { ...values, name: "restored", textPayload: "Draft body" }, messages: [] },
    });
    await mountEditor();

    expect(byTest("editor-draft-restore-dialog")?.textContent).toContain(
      "unsaved changes to this prompt",
    );
    click("editor-draft-continue");
    await flushPromises();

    expect(form().state.values).toMatchObject({ name: "restored", textPayload: "Draft body" });
  });

  it("keys a new version's draft by the prompt and the version it started from", async () => {
    await mountEditor("/ai/prompts/prompt-a/versions/new");
    await edit("textPayload", "Classify {{ ticket }} briefly");
    window.dispatchEvent(new Event("pagehide"));

    const draft = readEditorDraft<PromptDraftData>(versionScope);
    expect(draft?.data.values.textPayload).toBe("Classify {{ ticket }} briefly");
    expect(draft?.baseHash).toBe(
      hashDraftValue({
        entityId: "prompt-a",
        latestVersion: 2,
        version: 2,
        payload: savedVersion.payload,
        config: savedVersion.config,
      }),
    );
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("Escape on the restore dialog keeps the draft, Start fresh drops it", async () => {
    await mountEditor();
    await edit("textPayload", "From the draft");
    window.dispatchEvent(new Event("pagehide"));
    wrapper!.unmount();

    await mountEditor();
    pressEscape();
    await flushPromises();
    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(form().state.values.textPayload).toBe("");
    expect(readEditorDraft(newScope)).not.toBeNull();
    wrapper!.unmount();

    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();
    expect(form().state.values.textPayload).toBe("");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("keep draft lets the route leave and offers the work on the next visit", async () => {
    await mountEditor();
    await edit("textPayload", "Kept for later");

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("o-dialog-secondary-btn");
    await navigation;
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft<PromptDraftData>(newScope)?.data.values).toMatchObject({
      textPayload: "Kept for later",
    });
    wrapper!.unmount();

    await mountEditor();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();
  });

  it("cancel with unsaved changes asks, and discard leaves and drops the draft", async () => {
    await mountEditor();
    await edit("textPayload", "to discard");
    window.dispatchEvent(new Event("pagehide"));

    click("prompt-editor-cancel-btn");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

    clickLeave("o-dialog-neutral-btn");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("aiPrompts");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("save from the leave dialog creates without opening the list, then goes on", async () => {
    await mountEditor();
    await fillValid();

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(llmPromptsService.create).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.name).toBe("logs");
    expect(readEditorDraft(newScope)).toBeNull();
  });

  it("save from the leave dialog stays when the commit message is missing", async () => {
    await mountEditor();
    await edit("name", "summarise");
    await edit("textPayload", "Summarise {{ doc }}");

    const navigation = router.push("/logs");
    await flushPromises();
    clickLeave("editor-draft-leave-save");
    await navigation;
    await flushPromises();

    expect(llmPromptsService.create).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("aiPromptCreate");
  });

  it("a normal save drops the draft and opens the list without asking", async () => {
    await mountEditor();
    await fillValid();
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(newScope)).not.toBeNull();

    await form().handleSubmit();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("aiPrompts");
    expect(router.currentRoute.value.query.selected).toBe("pr-new");
    expect(readEditorDraft(newScope)).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
  });

  it("opening the playground keeps the work as a draft without asking", async () => {
    await mountEditor();
    await edit("textPayload", "Try {{ this }}");

    click("prompt-editor-test-btn");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("aiPlayground");
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(readEditorDraft<PromptDraftData>(newScope)?.data.values.textPayload).toBe(
      "Try {{ this }}",
    );
  });

  it("asks before another base version reloads the form", async () => {
    await mountEditor("/ai/prompts/prompt-a/versions/new");
    await edit("textPayload", "Edited");

    const navigation = router.push("/ai/prompts/prompt-a/versions/new?base_version=1");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    clickLeave("o-dialog-close-btn");
    await navigation;

    expect(router.currentRoute.value.query.base_version).toBeUndefined();
    expect(form().state.values.textPayload).toBe("Edited");
  });
});
