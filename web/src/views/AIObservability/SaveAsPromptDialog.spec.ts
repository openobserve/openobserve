// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  match: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  getVersion: vi.fn(),
  createVersion: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/services/llm-prompts.service", () => ({ default: mocks }));
vi.mock("@/types/i18n", () => ({
  useI18nTyped: () => ({ t: (key: string) => key }),
  raw: (value: string) => value,
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
import SaveAsPromptDialog from "./SaveAsPromptDialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";

const config = { model: null, params: null, tools: null, responseFormat: null };
const prompt = {
  entityId: "prompt-1",
  name: "summary",
  status: "active",
  type: "text",
  latestVersion: 3,
};
function mountSave() {
  return shallowMount(SaveAsPromptDialog, {
    props: { open: true, orgId: "org", type: "text", payload: "Summarize this", config },
    global: {
      renderStubDefaultSlot: true,
      stubs: { ODialog: { template: "<div><slot /></div>" } },
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([{ ...prompt, latestVersion: 1 }]);
  mocks.match.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ prompt });
  mocks.get.mockResolvedValue(prompt);
  mocks.getVersion.mockResolvedValue({ version: 3, contentHash: "head-3" });
  mocks.createVersion.mockResolvedValue({ prompt: { ...prompt, latestVersion: 4 } });
});

describe("save as prompt", () => {
  it("requires a second submission after showing duplicate content and resets confirmation for a new destination", async () => {
    mocks.match.mockResolvedValue([{ id: "version-1", name: "existing", version: 1 }]);
    const wrapper = mountSave();
    const form = wrapper.findComponent(OForm).props("form");
    form.setFieldValue("name", "summary");
    form.setFieldValue("commitMessage", "Initial version");
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("matchingContentExists");
    form.setFieldValue("name", "another-summary");
    await flushPromises();
    await form.handleSubmit();
    expect(mocks.create).not.toHaveBeenCalled();
    await form.handleSubmit();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("appends to the freshly read head rather than the cached selector version", async () => {
    const wrapper = mountSave();
    const form = wrapper.findComponent(OForm).props("form");
    form.setFieldValue("mode", "append");
    form.setFieldValue("targetId", "prompt-1");
    form.setFieldValue("commitMessage", "Updated content");
    await flushPromises();
    await form.handleSubmit();
    expect(mocks.createVersion).toHaveBeenCalledWith(
      "org",
      "prompt-1",
      expect.objectContaining({
        baseVersion: 3,
        baseHash: "head-3",
        commitMessage: "Updated content",
      }),
      expect.objectContaining({ ifHead: 3 }),
    );
  });

  it("keeps the form open when the selected prompt was archived", async () => {
    mocks.get.mockResolvedValue({ ...prompt, status: "archived" });
    const wrapper = mountSave();
    const form = wrapper.findComponent(OForm).props("form");
    form.setFieldValue("mode", "append");
    form.setFieldValue("targetId", "prompt-1");
    form.setFieldValue("commitMessage", "Updated content");
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    expect(mocks.createVersion).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.text()).toContain("selectActivePrompt");
  });
});
