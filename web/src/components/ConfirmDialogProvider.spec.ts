// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ConfirmDialogProvider from "@/components/ConfirmDialogProvider.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import i18n from "@/locales";
import { raw, type I18nKey } from "@/types/i18n";

i18n.global.mergeLocaleMessage("en-us", {
  confirmDialogSpec: { deleteNamed: "Are you sure you want to delete the {name} alert?" },
});
const keypath = "confirmDialogSpec.deleteNamed" as I18nKey;

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "primaryButtonLabel", "primaryButtonVariant", "initialFocus"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div data-test="o-dialog-stub"><slot /></div>`,
};

function buildWrapper() {
  return mount(ConfirmDialogProvider, {
    global: { plugins: [i18n], stubs: { ODialog: ODialogStub } },
  });
}

describe("ConfirmDialogProvider", () => {
  let wrapper: ReturnType<typeof buildWrapper> | undefined;
  const { handleCancel } = useConfirmDialog();

  afterEach(() => {
    handleCancel();
    wrapper?.unmount();
  });

  it("renders a named message with the name in a bold span", async () => {
    wrapper = buildWrapper();
    useConfirmDialog().confirm({
      title: raw("Delete alert"),
      messageKeypath: keypath,
      messageName: "cpu-high",
      confirmVariant: "destructive",
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Are you sure you want to delete the cpu-high alert?");
    const name = wrapper.find('[data-test="confirm-dialog-provider-name"]');
    expect(name.text()).toBe("cpu-high");
    expect(name.classes()).toContain("font-semibold");
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonVariant")).toBe("destructive");
  });

  it("keeps rendering a plain message", async () => {
    wrapper = buildWrapper();
    useConfirmDialog().confirm({ title: raw("Title"), message: raw("Plain message") });
    await flushPromises();
    expect(wrapper.text()).toContain("Plain message");
    expect(wrapper.find('[data-test="confirm-dialog-provider-name"]').exists()).toBe(false);
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonVariant")).toBe("primary");
  });

  it("resolves true when the named dialog is confirmed", async () => {
    wrapper = buildWrapper();
    const result = useConfirmDialog().confirm({
      title: raw("Delete alert"),
      messageKeypath: keypath,
      messageName: "cpu-high",
    });
    await flushPromises();
    await wrapper.findComponent(ODialogStub).vm.$emit("click:primary");
    await expect(result).resolves.toBe(true);
  });
});
