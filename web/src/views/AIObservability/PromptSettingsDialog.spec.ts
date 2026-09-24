// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  rotateSecret: vi.fn(),
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
import PromptSettingsDialog from "./PromptSettingsDialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

const settings = { protectedLabels: ["production"], webhook: null };
function mountSettings() {
  return shallowMount(PromptSettingsDialog, {
    props: { open: true, orgId: "org-a" },
    global: {
      renderStubDefaultSlot: true,
      stubs: { ODialog: { template: "<div><slot /></div>" } },
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSettings.mockResolvedValue(settings);
  mocks.updateSettings.mockResolvedValue(settings);
});

describe("prompt settings recovery", () => {
  it("does not expose editable defaults after a failed load and supports retry", async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error("Unavailable"));
    const wrapper = mountSettings();
    await flushPromises();
    expect(wrapper.findComponent(OForm).exists()).toBe(false);
    expect(wrapper.findComponent(OEmptyState).props("description")).toBe("Unavailable");
    wrapper.findComponent(OEmptyState).vm.$emit("action");
    await flushPromises();
    expect(wrapper.findComponent(OForm).props("form").state.values.protectedLabels).toEqual([
      "production",
    ]);
  });

  it("reports partial success when the settings save but the signing secret fails", async () => {
    mocks.rotateSecret.mockRejectedValue(new Error("Unavailable"));
    const wrapper = mountSettings();
    await flushPromises();
    const form = wrapper.findComponent(OForm).props("form");
    form.setFieldValue("webhookEnabled", true);
    form.setFieldValue("endpoint", "https://example.com/hook");
    form.setFieldValue("events", ["label_moved"]);
    form.setFieldValue("secret", "test-only-secret");
    await form.handleSubmit();
    await flushPromises();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("updated")).toHaveLength(1);
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(wrapper.find('[data-test="prompt-settings-save-error"]').text()).toContain(
      "secretSavePartial",
    );
    expect(form.state.values.secret).toBe("test-only-secret");
  });

  it("ignores a settings response for an organization that is no longer selected", async () => {
    let resolveOld: (value: typeof settings) => void = () => undefined;
    mocks.getSettings.mockReturnValueOnce(
      new Promise<typeof settings>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const wrapper = mountSettings();
    mocks.getSettings.mockResolvedValue({ protectedLabels: ["staging"], webhook: null });
    await wrapper.setProps({ orgId: "org-b" });
    await flushPromises();
    resolveOld(settings);
    await flushPromises();
    expect(wrapper.findComponent(OForm).props("form").state.values.protectedLabels).toEqual([
      "staging",
    ]);
  });
});
