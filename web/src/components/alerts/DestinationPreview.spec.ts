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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DestinationPreview from "./DestinationPreview.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

installQuasar();

describe("DestinationPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render Slack preview when type is slack", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const slackPreview = wrapper.find('[data-test="slack-preview"]');
    expect(slackPreview.exists()).toBe(true);
  });

  it("should display Slack bot name", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const botName = wrapper.find('[data-test="slack-bot-name"]');
    expect(botName.text()).toBe("OpenObserve Bot");
  });

  it("should display Slack message body", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const messageBody = wrapper.find('[data-test="slack-message-body"]');
    expect(messageBody.exists()).toBe(true);
  });

  it("should render MS Teams preview when type is msteams", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "msteams",
      },
      global: {
        plugins: [i18n],
      },
    });

    const teamsPreview = wrapper.find('[data-test="msteams-preview"]');
    expect(teamsPreview.exists()).toBe(true);
  });

  it("should display MS Teams card content", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "msteams",
      },
      global: {
        plugins: [i18n],
      },
    });

    const cardContent = wrapper.find('[data-test="msteams-card-content"]');
    expect(cardContent.exists()).toBe(true);
    expect(cardContent.text()).toContain("Alert");
  });

  it("should render Email preview when type is email", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "email",
      },
      global: {
        plugins: [i18n],
      },
    });

    const emailPreview = wrapper.find('[data-test="email-preview"]');
    expect(emailPreview.exists()).toBe(true);
  });

  it("should display Email subject", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "email",
      },
      global: {
        plugins: [i18n],
      },
    });

    const subject = wrapper.find('[data-test="email-subject"]');
    expect(subject.text()).toContain("OpenObserve Alert Notification");
  });

  it("should display Email from address", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "email",
      },
      global: {
        plugins: [i18n],
      },
    });

    const from = wrapper.find('[data-test="email-from"]');
    expect(from.text()).toContain("alerts@openobserve.ai");
  });

  it("should display Email body", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "email",
      },
      global: {
        plugins: [i18n],
      },
    });

    const body = wrapper.find('[data-test="email-body"]');
    expect(body.exists()).toBe(true);
  });

  it("should render PagerDuty preview when type is pagerduty", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "pagerduty",
      },
      global: {
        plugins: [i18n],
      },
    });

    const pagerdutyPreview = wrapper.find('[data-test="pagerduty-preview"]');
    expect(pagerdutyPreview.exists()).toBe(true);
  });

  it("should render ServiceNow preview when type is servicenow", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "servicenow",
      },
      global: {
        plugins: [i18n],
      },
    });

    const servicenowPreview = wrapper.find('[data-test="servicenow-preview"]');
    expect(servicenowPreview.exists()).toBe(true);
  });

  it("should render Opsgenie preview when type is opsgenie", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "opsgenie",
      },
      global: {
        plugins: [i18n],
      },
    });

    const opsgeniePreview = wrapper.find('[data-test="opsgenie-preview"]');
    expect(opsgeniePreview.exists()).toBe(true);
  });

  it("should emit update:modelValue when close button is clicked", async () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const closeBtn = wrapper.find('[data-test="preview-close-button"]');
    await closeBtn.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("should display correct destination type name for slack", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const title = wrapper.find('[data-test="preview-title"]');
    expect(title.text()).toContain("Slack");
  });

  it("should display correct destination type name for msteams", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "msteams",
      },
      global: {
        plugins: [i18n],
      },
    });

    const title = wrapper.find('[data-test="preview-title"]');
    expect(title.text()).toContain("Microsoft Teams");
  });

  it("should display correct destination type name for email", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "email",
      },
      global: {
        plugins: [i18n],
      },
    });

    const title = wrapper.find('[data-test="preview-title"]');
    expect(title.text()).toContain("Email");
  });

  it("should handle copy template action", async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
        templateContent: "Test template content",
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.vm.copyTemplate();

    expect(mockWriteText).toHaveBeenCalledWith("Test template content");
  });

  it("should display current time", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const time = wrapper.vm.getCurrentTime();
    expect(time).toBeTruthy();
    expect(typeof time).toBe("string");
  });

  it("should get correct destination type name", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.vm.getDestinationTypeName("slack")).toBe("Slack");
    expect(wrapper.vm.getDestinationTypeName("msteams")).toBe("Microsoft Teams");
    expect(wrapper.vm.getDestinationTypeName("email")).toBe("Email");
    expect(wrapper.vm.getDestinationTypeName("pagerduty")).toBe("PagerDuty");
    expect(wrapper.vm.getDestinationTypeName("servicenow")).toBe("ServiceNow");
    expect(wrapper.vm.getDestinationTypeName("opsgenie")).toBe("Opsgenie");
    expect(wrapper.vm.getDestinationTypeName("unknown")).toBe("unknown");
  });

  it("should render copy template button", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: true,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const copyBtn = wrapper.find('[data-test="preview-copy-button"]');
    expect(copyBtn.exists()).toBe(true);
    expect(copyBtn.text()).toContain("Copy Template");
  });

  it("should not render preview when modelValue is false", () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: false,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    const dialog = wrapper.find('[data-test="destination-preview-dialog"]');
    expect(dialog.exists()).toBe(true);
    // Dialog exists but should not be visible
    expect(wrapper.vm.isOpen).toBe(false);
  });

  it("should update isOpen when modelValue changes", async () => {
    const wrapper = mount(DestinationPreview, {
      props: {
        modelValue: false,
        type: "slack",
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.vm.isOpen).toBe(false);

    await wrapper.setProps({ modelValue: true });
    expect(wrapper.vm.isOpen).toBe(true);
  });
});
