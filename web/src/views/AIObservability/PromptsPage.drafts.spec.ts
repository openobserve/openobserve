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
import { h } from "vue";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import { queryClient } from "@/composables/query/queryClient";
import llmPromptsService, { type Prompt } from "@/services/llm-prompts.service";
import { readEditorDraft, writeEditorDraft } from "@/utils/drafts/editorDraftStore";
import PromptsPage from "./PromptsPage.vue";

vi.mock("@/services/llm-prompts.service", () => ({
  default: { list: vi.fn(), getSettings: vi.fn(), archive: vi.fn(), get: vi.fn() },
}));
vi.mock("@/utils/commons", () => ({ getFoldersListByType: vi.fn(async () => []) }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));

const prompt = (entityId: string): Prompt => ({
  entityId,
  name: entityId,
  folderId: "default",
  type: "text",
  description: null,
  tags: [],
  status: "active",
  latestVersion: 1,
  createdBy: "",
  createdAt: 0,
  updatedBy: "",
  updatedAt: 0,
  labels: [],
});

const scope = (entityId: string | null) => ({
  kind: "prompt" as const,
  org: "test-org",
  entityId,
  userEmail: "me@x.io",
});

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io", role: "admin" },
    timezone: "UTC",
  },
});

let wrapper: VueWrapper | null = null;

const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ai/prompts", name: "aiPrompts", component: { render: () => h("div") } },
      { path: "/ai/prompts/new", name: "aiPromptCreate", component: { render: () => h("div") } },
    ],
  });
  await router.push("/ai/prompts");
  wrapper = mount(PromptsPage, {
    global: {
      plugins: [router, store],
      stubs: {
        OPageLayout: { template: `<main><slot name="actions" /><slot /></main>` },
        FolderList: true,
        PromptDetailDrawer: true,
        PromptSettingsDrawer: true,
        SelectFolderDropDown: true,
      },
    },
  });
  await vi.waitFor(() => {
    if (!wrapper!.text().includes("summary")) throw new Error("rows not rendered yet");
  });
  return wrapper;
};

describe("PromptsPage drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.mocked(llmPromptsService.list).mockResolvedValue([prompt("triage"), prompt("summary")]);
    vi.mocked(llmPromptsService.getSettings).mockResolvedValue({
      protectedLabels: ["production"],
    } as never);
    vi.mocked(llmPromptsService.archive).mockImplementation(async (_org, entityId) => ({
      ...prompt(entityId),
      status: "archived",
    }));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("marks New prompt and names it while a new-prompt draft exists", async () => {
    await mountPage();
    const button = () => wrapper!.get('[data-test="prompt-new"]');
    expect(wrapper!.find('[data-test="prompt-new-draft-dot"]').exists()).toBe(false);

    writeEditorDraft(scope(null), { data: { values: {}, messages: [] } });
    await flushPromises();

    expect(wrapper!.find('[data-test="prompt-new-draft-dot"]').exists()).toBe(true);
    expect(button().attributes("aria-label")).toBe("New prompt · unsaved draft");
  });

  it("marks only the row whose prompt has a version draft", async () => {
    writeEditorDraft(scope("triage"), { data: { values: {}, messages: [] } });
    await mountPage();

    expect(wrapper!.find('[data-test="prompt-draft-dot-triage"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="prompt-draft-dot-summary"]').exists()).toBe(false);
  });

  it("drops a prompt's drafts when it is archived", async () => {
    writeEditorDraft(scope("triage"), { data: { values: {}, messages: [] } });
    writeEditorDraft(scope("summary"), { data: { values: {}, messages: [] } });
    await mountPage();

    const vm = wrapper!.vm as unknown as { archive: (target: Prompt) => Promise<void> };
    await vm.archive(prompt("triage"));
    await flushPromises();

    expect(readEditorDraft(scope("triage"))).toBeNull();
    expect(readEditorDraft(scope("summary"))).not.toBeNull();
    expect(wrapper!.find('[data-test="prompt-draft-dot-triage"]').exists()).toBe(false);
  });

  it("keeps the drafts when archiving fails", async () => {
    writeEditorDraft(scope("triage"), { data: { values: {}, messages: [] } });
    vi.mocked(llmPromptsService.archive).mockRejectedValueOnce(new Error("nope"));
    await mountPage();

    const vm = wrapper!.vm as unknown as { archive: (target: Prompt) => Promise<void> };
    await vm.archive(prompt("triage"));
    await flushPromises();

    expect(readEditorDraft(scope("triage"))).not.toBeNull();
  });
});
