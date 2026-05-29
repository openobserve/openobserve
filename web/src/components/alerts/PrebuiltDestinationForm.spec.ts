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

import { describe, expect, it, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

import PrebuiltDestinationForm from "@/components/alerts/PrebuiltDestinationForm.vue";

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(PrebuiltDestinationForm, {
    props: {
      destinationType: "slack",
      modelValue: {},
      isTesting: false,
      hideActions: false,
      ...props,
    },
    global: { plugins: [i18n] },
  });
}

describe("PrebuiltDestinationForm - base rendering", () => {
  it("renders the form wrapper", async () => {
    wrapper = await mountComp();

    expect(wrapper.find('[data-test="prebuilt-destination-form"]').exists()).toBe(true);
  });

  it("shows preview and test buttons when hideActions=false", async () => {
    wrapper = await mountComp({ destinationType: "slack", hideActions: false });

    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(true);
  });

  it("hides preview and test buttons when hideActions=true", async () => {
    wrapper = await mountComp({ destinationType: "slack", hideActions: true });

    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(false);
  });

  it("preview button emits preview event", async () => {
    wrapper = await mountComp({ destinationType: "slack" });

    await wrapper.find('[data-test="destination-preview-button"]').trigger("click");

    expect(wrapper.emitted("preview")).toBeTruthy();
  });

  it("test button emits test event", async () => {
    wrapper = await mountComp({ destinationType: "slack" });

    await wrapper.find('[data-test="destination-test-button"]').trigger("click");

    expect(wrapper.emitted("test")).toBeTruthy();
  });
});

describe("PrebuiltDestinationForm - Slack type", () => {
  it("renders webhook URL input for slack", async () => {
    wrapper = await mountComp({ destinationType: "slack" });

    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);
  });

  it("renders channel input for slack", async () => {
    wrapper = await mountComp({ destinationType: "slack" });

    expect(wrapper.find('[data-test="slack-channel-input"]').exists()).toBe(true);
  });

  it("does not render discord fields for slack", async () => {
    wrapper = await mountComp({ destinationType: "slack" });

    expect(wrapper.find('[data-test="discord-webhook-url-input"]').exists()).toBe(false);
  });
});

describe("PrebuiltDestinationForm - Discord type", () => {
  it("renders discord webhook URL input", async () => {
    wrapper = await mountComp({ destinationType: "discord" });

    expect(wrapper.find('[data-test="discord-webhook-url-input"]').exists()).toBe(true);
  });

  it("renders discord username input", async () => {
    wrapper = await mountComp({ destinationType: "discord" });

    expect(wrapper.find('[data-test="discord-username-input"]').exists()).toBe(true);
  });

  it("does not render slack fields for discord", async () => {
    wrapper = await mountComp({ destinationType: "discord" });

    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
  });
});

describe("PrebuiltDestinationForm - MS Teams type", () => {
  it("renders msteams webhook URL input", async () => {
    wrapper = await mountComp({ destinationType: "msteams" });

    expect(wrapper.find('[data-test="msteams-webhook-url-input"]').exists()).toBe(true);
  });

  it("does not render slack fields for msteams", async () => {
    wrapper = await mountComp({ destinationType: "msteams" });

    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
  });
});

describe("PrebuiltDestinationForm - PagerDuty type", () => {
  it("renders integration key input for pagerduty", async () => {
    wrapper = await mountComp({ destinationType: "pagerduty" });

    expect(wrapper.find('[data-test="pagerduty-integration-key-input"]').exists()).toBe(true);
  });

  it("renders severity select for pagerduty", async () => {
    wrapper = await mountComp({ destinationType: "pagerduty" });

    expect(wrapper.find('[data-test="pagerduty-severity-select"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - Email type", () => {
  it("renders email recipients input", async () => {
    wrapper = await mountComp({ destinationType: "email" });

    expect(wrapper.find('[data-test="email-recipients-input"]').exists()).toBe(true);
  });

  it("does not render slack fields for email", async () => {
    wrapper = await mountComp({ destinationType: "email" });

    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
  });
});

describe("PrebuiltDestinationForm - Opsgenie type", () => {
  it("renders opsgenie api key input", async () => {
    wrapper = await mountComp({ destinationType: "opsgenie" });

    expect(wrapper.find('[data-test="opsgenie-api-key-input"]').exists()).toBe(true);
  });

  it("renders opsgenie priority select", async () => {
    wrapper = await mountComp({ destinationType: "opsgenie" });

    expect(wrapper.find('[data-test="opsgenie-priority-select"]').exists()).toBe(true);
  });

  it("renders opsgenie EU region toggle", async () => {
    wrapper = await mountComp({ destinationType: "opsgenie" });

    expect(wrapper.find('[data-test="opsgenie-eu-region-toggle"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - ServiceNow type", () => {
  it("renders servicenow instance URL input", async () => {
    wrapper = await mountComp({ destinationType: "servicenow" });

    expect(wrapper.find('[data-test="servicenow-instance-url-input"]').exists()).toBe(true);
  });

  it("renders servicenow username input", async () => {
    wrapper = await mountComp({ destinationType: "servicenow" });

    expect(wrapper.find('[data-test="servicenow-username-input"]').exists()).toBe(true);
  });

  it("renders servicenow password input", async () => {
    wrapper = await mountComp({ destinationType: "servicenow" });

    expect(wrapper.find('[data-test="servicenow-password-input"]').exists()).toBe(true);
  });

  it("renders servicenow assignment group input", async () => {
    wrapper = await mountComp({ destinationType: "servicenow" });

    expect(wrapper.find('[data-test="servicenow-assignment-group-input"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - validate()", () => {
  it("returns false when required slack webhookUrl is empty", async () => {
    wrapper = await mountComp({ destinationType: "slack", modelValue: {} });

    const result = (wrapper.vm as any).validate();

    expect(result).toBe(false);
  });

  it("returns true when all required slack fields are provided", async () => {
    wrapper = await mountComp({
      destinationType: "slack",
      modelValue: { webhookUrl: "https://hooks.slack.com/test" },
    });

    const result = (wrapper.vm as any).validate();

    expect(result).toBe(true);
  });

  it("returns false for pagerduty when integrationKey is empty", async () => {
    wrapper = await mountComp({
      destinationType: "pagerduty",
      modelValue: {},
    });

    const result = (wrapper.vm as any).validate();

    expect(result).toBe(false);
  });

  it("returns false for email when recipients is empty", async () => {
    wrapper = await mountComp({
      destinationType: "email",
      modelValue: {},
    });

    const result = (wrapper.vm as any).validate();

    expect(result).toBe(false);
  });

  it("returns true for email when recipients is provided", async () => {
    wrapper = await mountComp({
      destinationType: "email",
      modelValue: { recipients: "user@example.com" },
    });

    const result = (wrapper.vm as any).validate();

    expect(result).toBe(true);
  });
});

describe("PrebuiltDestinationForm - severityOptions and priorityOptions", () => {
  it("severityOptions has 4 entries", async () => {
    wrapper = await mountComp({ destinationType: "pagerduty" });

    expect((wrapper.vm as any).severityOptions).toHaveLength(4);
  });

  it("priorityOptions has 5 entries", async () => {
    wrapper = await mountComp({ destinationType: "opsgenie" });

    expect((wrapper.vm as any).priorityOptions).toHaveLength(5);
  });
});

describe("PrebuiltDestinationForm - v-model sync", () => {
  it("emits update:modelValue when credentials change", async () => {
    wrapper = await mountComp({
      destinationType: "slack",
      modelValue: { webhookUrl: "" },
    });

    // Directly trigger update through computed setter
    (wrapper.vm as any).credentials = { webhookUrl: "https://hooks.slack.com/new" };

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });
});
