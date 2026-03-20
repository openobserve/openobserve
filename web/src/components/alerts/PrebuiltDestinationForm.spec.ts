// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import PrebuiltDestinationForm from "@/components/alerts/PrebuiltDestinationForm.vue";

async function mountComp(props: Record<string, any> = {}) {
  return mount(PrebuiltDestinationForm, {
    props: {
      destinationType: "slack",
      modelValue: {},
      isTesting: false,
      hideActions: false,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

describe("PrebuiltDestinationForm - base rendering", () => {
  it("renders the form wrapper", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="prebuilt-destination-form"]').exists()).toBe(true);
  });

  it("shows preview and test buttons when hideActions=false", async () => {
    const w = await mountComp({ destinationType: "slack", hideActions: false });
    expect(w.find('[data-test="destination-preview-button"]').exists()).toBe(true);
    expect(w.find('[data-test="destination-test-button"]').exists()).toBe(true);
  });

  it("hides preview and test buttons when hideActions=true", async () => {
    const w = await mountComp({ destinationType: "slack", hideActions: true });
    expect(w.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(w.find('[data-test="destination-test-button"]').exists()).toBe(false);
  });

  it("preview button emits preview event", async () => {
    const w = await mountComp({ destinationType: "slack" });
    await w.find('[data-test="destination-preview-button"]').trigger("click");
    expect(w.emitted("preview")).toBeTruthy();
  });

  it("test button emits test event", async () => {
    const w = await mountComp({ destinationType: "slack" });
    await w.find('[data-test="destination-test-button"]').trigger("click");
    expect(w.emitted("test")).toBeTruthy();
  });
});

describe("PrebuiltDestinationForm - Slack type", () => {
  it("renders webhook URL input for slack", async () => {
    const w = await mountComp({ destinationType: "slack" });
    expect(w.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);
  });

  it("renders channel input for slack", async () => {
    const w = await mountComp({ destinationType: "slack" });
    expect(w.find('[data-test="slack-channel-input"]').exists()).toBe(true);
  });

  it("does not render discord fields for slack", async () => {
    const w = await mountComp({ destinationType: "slack" });
    expect(w.find('[data-test="discord-webhook-url-input"]').exists()).toBe(false);
  });
});

describe("PrebuiltDestinationForm - Discord type", () => {
  it("renders discord webhook URL input", async () => {
    const w = await mountComp({ destinationType: "discord" });
    expect(w.find('[data-test="discord-webhook-url-input"]').exists()).toBe(true);
  });

  it("renders discord username input", async () => {
    const w = await mountComp({ destinationType: "discord" });
    expect(w.find('[data-test="discord-username-input"]').exists()).toBe(true);
  });

  it("does not render slack fields for discord", async () => {
    const w = await mountComp({ destinationType: "discord" });
    expect(w.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
  });
});

describe("PrebuiltDestinationForm - MS Teams type", () => {
  it("renders msteams webhook URL input", async () => {
    const w = await mountComp({ destinationType: "msteams" });
    expect(w.find('[data-test="msteams-webhook-url-input"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - PagerDuty type", () => {
  it("renders integration key input for pagerduty", async () => {
    const w = await mountComp({ destinationType: "pagerduty" });
    expect(w.find('[data-test="pagerduty-integration-key-input"]').exists()).toBe(true);
  });

  it("renders severity select for pagerduty", async () => {
    const w = await mountComp({ destinationType: "pagerduty" });
    expect(w.find('[data-test="pagerduty-severity-select"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - Email type", () => {
  it("renders email recipients input", async () => {
    const w = await mountComp({ destinationType: "email" });
    expect(w.find('[data-test="email-recipients-input"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - Opsgenie type", () => {
  it("renders opsgenie api key input", async () => {
    const w = await mountComp({ destinationType: "opsgenie" });
    expect(w.find('[data-test="opsgenie-api-key-input"]').exists()).toBe(true);
  });

  it("renders opsgenie priority select", async () => {
    const w = await mountComp({ destinationType: "opsgenie" });
    expect(w.find('[data-test="opsgenie-priority-select"]').exists()).toBe(true);
  });

  it("renders opsgenie EU region toggle", async () => {
    const w = await mountComp({ destinationType: "opsgenie" });
    expect(w.find('[data-test="opsgenie-eu-region-toggle"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - ServiceNow type", () => {
  it("renders servicenow instance URL input", async () => {
    const w = await mountComp({ destinationType: "servicenow" });
    expect(w.find('[data-test="servicenow-instance-url-input"]').exists()).toBe(true);
  });

  it("renders servicenow username input", async () => {
    const w = await mountComp({ destinationType: "servicenow" });
    expect(w.find('[data-test="servicenow-username-input"]').exists()).toBe(true);
  });

  it("renders servicenow password input", async () => {
    const w = await mountComp({ destinationType: "servicenow" });
    expect(w.find('[data-test="servicenow-password-input"]').exists()).toBe(true);
  });

  it("renders servicenow assignment group input", async () => {
    const w = await mountComp({ destinationType: "servicenow" });
    expect(w.find('[data-test="servicenow-assignment-group-input"]').exists()).toBe(true);
  });
});

describe("PrebuiltDestinationForm - validateEmailList", () => {
  it("accepts single valid email", async () => {
    const w = await mountComp({ destinationType: "email" });
    expect((w.vm as any).validateEmailList("test@example.com")).toBe(true);
  });

  it("accepts comma-separated valid emails", async () => {
    const w = await mountComp({ destinationType: "email" });
    expect((w.vm as any).validateEmailList("a@example.com, b@example.com")).toBe(true);
  });

  it("rejects invalid email", async () => {
    const w = await mountComp({ destinationType: "email" });
    expect((w.vm as any).validateEmailList("notanemail")).toBe(false);
  });

  it("rejects list with one invalid email", async () => {
    const w = await mountComp({ destinationType: "email" });
    expect((w.vm as any).validateEmailList("good@example.com, bad")).toBe(false);
  });
});

describe("PrebuiltDestinationForm - severityOptions and priorityOptions", () => {
  it("severityOptions has 4 entries", async () => {
    const w = await mountComp({ destinationType: "pagerduty" });
    expect((w.vm as any).severityOptions).toHaveLength(4);
  });

  it("priorityOptions has 5 entries", async () => {
    const w = await mountComp({ destinationType: "opsgenie" });
    expect((w.vm as any).priorityOptions).toHaveLength(5);
  });
});
