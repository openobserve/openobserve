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

describe("DestinationPreview", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Helper function to mount component with proper dialog support
  const mountComponent = async (props: any) => {
    wrapper = mount(DestinationPreview, {
      props,
      global: {
        plugins: [i18n],
      },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  it("should render the component", async () => {
    await mountComponent({
      modelValue: true,
      type: "slack",
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render Slack preview when type is slack", async () => {
    await mountComponent({
      modelValue: true,
      type: "slack",
    });

    const slackPreview = document.querySelector('[data-test="slack-preview"]');
    expect(slackPreview).toBeTruthy();
  });

  it("should display Slack bot name", async () => {
    await mountComponent({
      modelValue: true,
      type: "slack",
    });

    const botName = document.querySelector('[data-test="slack-bot-name"]');
    expect(botName?.textContent).toBe("OpenObserve Bot");
  });

  it("should display Slack message body", async () => {
    await mountComponent({
      modelValue: true,
      type: "slack",
    });

    const messageBody = document.querySelector('[data-test="slack-message-body"]');
    expect(messageBody).toBeTruthy();
  });

  it("should render MS Teams preview when type is msteams", async () => {
    await mountComponent({
        modelValue: true,
        type: "msteams",
    });

    const teamsPreview = document.querySelector('[data-test="msteams-preview"]');
    expect(teamsPreview).toBeTruthy();
  });

  it("should display MS Teams card content", async () => {
    await mountComponent({
        modelValue: true,
        type: "msteams",
    });

    const cardContent = document.querySelector('[data-test="msteams-card-content"]');
    expect(cardContent).toBeTruthy();
    expect(cardContent?.textContent).toContain("Alert");
  });

  it("should render Email preview when type is email", async () => {
    await mountComponent({
        modelValue: true,
        type: "email",
    });

    const emailPreview = document.querySelector('[data-test="email-preview"]');
    expect(emailPreview).toBeTruthy();
  });

  it("should display Email subject", async () => {
    await mountComponent({
        modelValue: true,
        type: "email",
    });

    const subject = document.querySelector('[data-test="email-subject"]');
    expect(subject?.textContent).toContain("OpenObserve Alert Notification");
  });

  it("should display Email from address", async () => {
    await mountComponent({
        modelValue: true,
        type: "email",
    });

    const from = document.querySelector('[data-test="email-from"]');
    expect(from?.textContent).toContain("alerts@openobserve.ai");
  });

  it("should display Email body", async () => {
    await mountComponent({
        modelValue: true,
        type: "email",
    });

    const body = document.querySelector('[data-test="email-body"]');
    expect(body).toBeTruthy();
  });

  it("should render PagerDuty preview when type is pagerduty", async () => {
    await mountComponent({
        modelValue: true,
        type: "pagerduty",
    });

    const pagerdutyPreview = document.querySelector('[data-test="pagerduty-preview"]');
    expect(pagerdutyPreview).toBeTruthy();
  });

  it("should render ServiceNow preview when type is servicenow", async () => {
    await mountComponent({
        modelValue: true,
        type: "servicenow",
    });

    const servicenowPreview = document.querySelector('[data-test="servicenow-preview"]');
    expect(servicenowPreview).toBeTruthy();
  });

  it("should render Opsgenie preview when type is opsgenie", async () => {
    await mountComponent({
        modelValue: true,
        type: "opsgenie",
    });

    const opsgeniePreview = document.querySelector('[data-test="opsgenie-preview"]');
    expect(opsgeniePreview).toBeTruthy();
  });

  it("should emit update:modelValue when close button is clicked", async () => {
    await mountComponent({
        modelValue: true,
        type: "slack",
    });

    const closeBtn = document.querySelector('[data-test="preview-close-button"]') as HTMLElement;
    closeBtn?.click();
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("should display correct destination type name for slack", async () => {
    await mountComponent({
        modelValue: true,
        type: "slack",
    });

    const title = document.querySelector('[data-test="preview-title"]');
    expect(title?.textContent).toContain("Slack");
  });

  it("should display correct destination type name for msteams", async () => {
    await mountComponent({
        modelValue: true,
        type: "msteams",
    });

    const title = document.querySelector('[data-test="preview-title"]');
    expect(title?.textContent).toContain("Microsoft Teams");
  });

  it("should display correct destination type name for email", async () => {
    await mountComponent({
        modelValue: true,
        type: "email",
    });

    const title = document.querySelector('[data-test="preview-title"]');
    expect(title?.textContent).toContain("Email");
  });

  it("should handle copy template action", async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    await mountComponent({
        modelValue: true,
        type: "slack",
        templateContent: "Test template content",
    });

    await wrapper.vm.copyTemplate();

    expect(mockWriteText).toHaveBeenCalledWith("Test template content");
  });

  it("should display current time", async () => {
    await mountComponent({
        modelValue: true,
        type: "slack",
    });

    const time = wrapper.vm.getCurrentTime();
    expect(time).toBeTruthy();
    expect(typeof time).toBe("string");
  });

  it("should get correct destination type name", async () => {
    await mountComponent({
        modelValue: true,
        type: "slack",
    });

    expect(wrapper.vm.getDestinationTypeName("slack")).toBe("Slack");
    expect(wrapper.vm.getDestinationTypeName("msteams")).toBe("Microsoft Teams");
    expect(wrapper.vm.getDestinationTypeName("email")).toBe("Email");
    expect(wrapper.vm.getDestinationTypeName("pagerduty")).toBe("PagerDuty");
    expect(wrapper.vm.getDestinationTypeName("servicenow")).toBe("ServiceNow");
    expect(wrapper.vm.getDestinationTypeName("opsgenie")).toBe("Opsgenie");
    expect(wrapper.vm.getDestinationTypeName("unknown")).toBe("unknown");
  });

  it("should render copy template button", async () => {
    await mountComponent({
        modelValue: true,
        type: "slack",
    });

    const copyBtn = document.querySelector('[data-test="preview-copy-button"]');
    expect(copyBtn).toBeTruthy();
    expect(copyBtn?.textContent).toContain("Copy Template");
  });

  it("should not render preview when modelValue is false", async () => {
    await mountComponent({
        modelValue: false,
        type: "slack",
    });

    // When modelValue is false, q-dialog doesn't render content
    const card = document.querySelector('[data-test="destination-preview-card"]');
    expect(card).toBeNull();
  });

  it("should update isOpen when modelValue changes", async () => {
    await mountComponent({
        modelValue: false,
        type: "slack",
    });

    expect(wrapper.vm.isOpen).toBe(false);

    await wrapper.setProps({ modelValue: true });
    expect(wrapper.vm.isOpen).toBe(true);
  });
});
