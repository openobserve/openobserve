// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DestinationPreview from "./DestinationPreview.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

installQuasar();

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can drive the dialog's emitted events directly.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-width="width"
      :data-primary-label="primaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>
  `,
};

const QIconStub = {
  name: "QIcon",
  props: ["name", "size"],
  template: `<i data-test="q-icon" :data-name="name" />`,
};

const mountComponent = (props: Record<string, any> = {}) => {
  return mount(DestinationPreview, {
    props: {
      modelValue: true,
      type: "slack",
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        ODialog: ODialogStub,
        "q-icon": QIconStub,
      },
    },
  });
};

describe("DestinationPreview", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("should render the component", () => {
    wrapper = mountComponent({ type: "slack" });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
  });

  it("should forward modelValue to ODialog open prop", () => {
    wrapper = mountComponent({ modelValue: true, type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(true);
  });

  it("should forward modelValue=false to ODialog open prop", () => {
    wrapper = mountComponent({ modelValue: false, type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);
  });

  it("should pass width=55 to ODialog", () => {
    wrapper = mountComponent({ type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("width")).toBe(55);
  });

  it("should pass 'Close' as primaryButtonLabel to ODialog", () => {
    wrapper = mountComponent({ type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("primaryButtonLabel")).toBe("Close");
  });

  it("should render Slack preview when type is slack", () => {
    wrapper = mountComponent({ type: "slack" });
    expect(wrapper.find('[data-test="slack-preview"]').exists()).toBe(true);
  });

  it("should display Slack bot name", () => {
    wrapper = mountComponent({ type: "slack" });
    const botName = wrapper.find('[data-test="slack-bot-name"]');
    expect(botName.text()).toBe("OpenObserve Bot");
  });

  it("should display Slack message body", () => {
    wrapper = mountComponent({ type: "slack" });
    expect(wrapper.find('[data-test="slack-message-body"]').exists()).toBe(true);
  });

  it("should render MS Teams preview when type is msteams", () => {
    wrapper = mountComponent({ type: "msteams" });
    expect(wrapper.find('[data-test="msteams-preview"]').exists()).toBe(true);
  });

  it("should display MS Teams card content with Alert text", () => {
    wrapper = mountComponent({ type: "msteams" });
    const cardContent = wrapper.find('[data-test="msteams-card-content"]');
    expect(cardContent.exists()).toBe(true);
    expect(cardContent.text()).toContain("Alert");
  });

  it("should render Email preview when type is email", () => {
    wrapper = mountComponent({ type: "email" });
    expect(wrapper.find('[data-test="email-preview"]').exists()).toBe(true);
  });

  it("should display Email subject", () => {
    wrapper = mountComponent({ type: "email" });
    const subject = wrapper.find('[data-test="email-subject"]');
    expect(subject.text()).toContain("OpenObserve Alert Notification");
  });

  it("should display Email from address", () => {
    wrapper = mountComponent({ type: "email" });
    const from = wrapper.find('[data-test="email-from"]');
    expect(from.text()).toContain("alerts@openobserve.ai");
  });

  it("should display Email body", () => {
    wrapper = mountComponent({ type: "email" });
    expect(wrapper.find('[data-test="email-body"]').exists()).toBe(true);
  });

  it("should render PagerDuty preview when type is pagerduty", () => {
    wrapper = mountComponent({ type: "pagerduty" });
    expect(wrapper.find('[data-test="pagerduty-preview"]').exists()).toBe(true);
  });

  it("should render ServiceNow preview when type is servicenow", () => {
    wrapper = mountComponent({ type: "servicenow" });
    expect(wrapper.find('[data-test="servicenow-preview"]').exists()).toBe(true);
  });

  it("should render Opsgenie preview when type is opsgenie", () => {
    wrapper = mountComponent({ type: "opsgenie" });
    expect(wrapper.find('[data-test="opsgenie-preview"]').exists()).toBe(true);
  });

  it("should emit update:modelValue=false when ODialog primary click is received", async () => {
    wrapper = mountComponent({ type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
  });

  it("should emit update:modelValue when ODialog emits update:open", async () => {
    wrapper = mountComponent({ type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("update:open", false);
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
  });

  it("should display correct destination type name for slack in dialog title", () => {
    wrapper = mountComponent({ type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toContain("Slack");
  });

  it("should display correct destination type name for msteams in dialog title", () => {
    wrapper = mountComponent({ type: "msteams" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toContain("Microsoft Teams");
  });

  it("should display correct destination type name for email in dialog title", () => {
    wrapper = mountComponent({ type: "email" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toContain("Email");
  });

  it("should handle copy template action successfully", async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    });

    wrapper = mountComponent({
      type: "slack",
      templateContent: "Test template content",
    });

    await (wrapper.vm as any).copyTemplate();
    await flushPromises();

    expect(mockWriteText).toHaveBeenCalledWith("Test template content");
  });

  it("should handle copy template failure gracefully", async () => {
    const mockWriteText = vi.fn().mockRejectedValue(new Error("clipboard error"));
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    });

    wrapper = mountComponent({
      type: "slack",
      templateContent: "Failing content",
    });

    await (wrapper.vm as any).copyTemplate();
    await flushPromises();

    expect(mockWriteText).toHaveBeenCalledWith("Failing content");
  });

  it("should expose getCurrentTime returning a string", () => {
    wrapper = mountComponent({ type: "slack" });
    const time = (wrapper.vm as any).getCurrentTime();
    expect(time).toBeTruthy();
    expect(typeof time).toBe("string");
  });

  it("should map all destination type names correctly", () => {
    wrapper = mountComponent({ type: "slack" });
    const get = (wrapper.vm as any).getDestinationTypeName;
    expect(get("slack")).toBe("Slack");
    expect(get("msteams")).toBe("Microsoft Teams");
    expect(get("email")).toBe("Email");
    expect(get("pagerduty")).toBe("PagerDuty");
    expect(get("servicenow")).toBe("ServiceNow");
    expect(get("opsgenie")).toBe("Opsgenie");
    expect(get("unknown")).toBe("unknown");
  });

  it("should render copy template button", () => {
    wrapper = mountComponent({ type: "slack" });
    const copyBtn = wrapper.find('[data-test="preview-copy-button"]');
    expect(copyBtn.exists()).toBe(true);
    expect(copyBtn.text()).toContain("Copy Template");
  });

  it("should reflect modelValue=false on ODialog open prop", () => {
    wrapper = mountComponent({ modelValue: false, type: "slack" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);
  });

  it("should update isOpen when modelValue prop changes", async () => {
    wrapper = mountComponent({ modelValue: false, type: "slack" });
    expect((wrapper.vm as any).isOpen).toBe(false);

    await wrapper.setProps({ modelValue: true });
    expect((wrapper.vm as any).isOpen).toBe(true);
  });

  it("should default templateContent to empty string", async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: mockWriteText },
    });

    wrapper = mountComponent({ type: "slack" });
    await (wrapper.vm as any).copyTemplate();
    await flushPromises();

    expect(mockWriteText).toHaveBeenCalledWith("");
  });

  it("should not render Slack preview when type is email", () => {
    wrapper = mountComponent({ type: "email" });
    expect(wrapper.find('[data-test="slack-preview"]').exists()).toBe(false);
  });

  it("should render the destination-preview-card container", () => {
    wrapper = mountComponent({ type: "slack" });
    expect(wrapper.find('[data-test="destination-preview-card"]').exists()).toBe(true);
  });
});
