// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prompt, PromptVersion } from "@/services/llm-prompts.service";

const mocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
  listActivity: vi.fn(),
  moveLabel: vi.fn(),
  get: vi.fn(),
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
import PromptDetailDrawer from "./PromptDetailDrawer.vue";
import PromptLabelsPanel from "./PromptLabelsPanel.vue";

const prompt: Prompt = {
  entityId: "prompt-1",
  name: "summary",
  folderId: "default",
  type: "text",
  description: null,
  tags: [],
  status: "active",
  latestVersion: 2,
  createdBy: "user",
  createdAt: 0,
  updatedBy: "user",
  updatedAt: 0,
  labels: [{ name: "production", version: 1, deletedAt: null, updatedBy: "user", updatedAt: 0 }],
};
function version(number: number): PromptVersion {
  return {
    id: `version-${number}`,
    entityId: prompt.entityId,
    version: number,
    payload: `Prompt ${number}`,
    config: { model: null, params: null, tools: null, responseFormat: null },
    commitMessage: "Change",
    source: "ui",
    baseVersion: null,
    contentHash: "hash",
    createdBy: "user",
    createdAt: 0,
  };
}
function mountDrawer(initialVersion = 1) {
  return shallowMount(PromptDetailDrawer, {
    props: {
      open: true,
      orgId: "org",
      prompt,
      initialTab: "labels",
      initialVersion,
      protectedLabels: ["production"],
    },
    global: { stubs: { ODrawer: { template: "<div><slot /><slot name='footer' /></div>" } } },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listVersions.mockResolvedValue([version(2), version(1)]);
  mocks.listActivity.mockResolvedValue([]);
  mocks.confirm.mockResolvedValue(true);
  mocks.get.mockResolvedValue({ ...prompt, labels: [{ ...prompt.labels[0], version: 2 }] });
  mocks.moveLabel.mockResolvedValue({ ...prompt.labels[0], version: 2 });
});

describe("prompt detail navigation and labels", () => {
  it("preserves the viewed version and refreshes history after moving a label", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    const panel = wrapper.findComponent(PromptLabelsPanel);
    await panel.props("saveLabel")("production", 2);
    await flushPromises();
    expect(mocks.moveLabel).toHaveBeenCalledWith("org", "prompt-1", "production", 2, 1);
    expect(mocks.listActivity).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent(PromptLabelsPanel).props("selectedVersion")).toBe(1);
    expect(wrapper.emitted("updated")).toHaveLength(1);
  });

  it("does not mutate protected labels after cancelling confirmation", async () => {
    mocks.confirm.mockResolvedValue(false);
    const wrapper = mountDrawer();
    await flushPromises();
    expect(await wrapper.findComponent(PromptLabelsPanel).props("saveLabel")("production", 2)).toBe(
      false,
    );
    expect(mocks.moveLabel).not.toHaveBeenCalled();
  });

  it("refreshes versions when a new version is saved for the same prompt", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    mocks.listVersions.mockResolvedValue([version(3), version(2), version(1)]);
    await wrapper.setProps({ prompt: { ...prompt, latestVersion: 3 } });
    await flushPromises();
    expect(wrapper.findComponent(PromptLabelsPanel).props("versions")).toHaveLength(3);
  });

  it("ignores an old detail response after switching to another prompt", async () => {
    let resolveOld: (versions: PromptVersion[]) => void = () => undefined;
    mocks.listVersions.mockReturnValueOnce(
      new Promise<PromptVersion[]>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = mountDrawer();
    await wrapper.setProps({ prompt: { ...prompt, entityId: "prompt-2", latestVersion: 3 } });
    await flushPromises();
    resolveOld([version(99)]);
    await flushPromises();
    expect(wrapper.find('[data-test="prompt-detail-version-select"]').exists()).toBe(true);
    expect(
      wrapper
        .findComponent(PromptLabelsPanel)
        .props("versions")
        .map((entry: PromptVersion) => entry.version),
    ).toEqual([2, 1]);
  });
});
