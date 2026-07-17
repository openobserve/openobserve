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

// PrebuiltDestinationForm is a presentational DESCENDANT now: it renders the
// active type's credential inputs (named `credentials.<key>`) into a PARENT
// <OForm> — it owns no form/schema/v-model of its own (the credential validation
// lives in AddDestination.schema, covered by PrebuiltDestinationForm.schema.spec).
// These tests mount it inside a host <OForm> and assert the fields render + bind
// into the ONE parent form, and that the preview/test buttons emit.

import { describe, expect, it, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { z } from "zod";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import PrebuiltDestinationForm from "@/components/alerts/PrebuiltDestinationForm.vue";
import { prebuiltDestinationDefaults } from "@/components/alerts/PrebuiltDestinationForm.schema";
import OForm from "@/lib/forms/Form/OForm.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";

let wrapper: any = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

// A minimal parent-form host: provides the FORM_CONTEXT_KEY the descendant's
// OForm* fields inject, seeded with the active type's credential defaults. The
// schema is permissive — the credential rules are exercised in the schema spec.
const Host = defineComponent({
  name: "Host",
  components: { OForm, PrebuiltDestinationForm },
  props: {
    destinationType: { type: String, default: "slack" },
    modelValue: { type: Object, default: () => ({}) },
    hideActions: { type: Boolean, default: false },
  },
  setup(props) {
    const form = useOForm<any>({
      defaultValues: {
        credentials: prebuiltDestinationDefaults(
          props.destinationType,
          props.modelValue as Record<string, unknown>,
        ),
      },
      schema: z.object({ credentials: z.record(z.string(), z.unknown()) }),
      onSubmit: () => {},
    });
    return { form, props };
  },
  render() {
    return h(OForm, { form: this.form, id: "host" }, () => [
      h(PrebuiltDestinationForm, {
        destinationType: this.props.destinationType,
        hideActions: this.props.hideActions,
      }),
    ]);
  },
});

function mountComp(props: Record<string, any> = {}) {
  return mount(Host, {
    props: { destinationType: "slack", hideActions: false, ...props },
    global: { plugins: [i18n, store] },
  });
}

const hostForm = (w: any) => w.findComponent({ name: "OForm" }).vm.form;

describe("PrebuiltDestinationForm - base rendering", () => {
  it("renders the wrapper", () => {
    wrapper = mountComp();
    expect(
      wrapper.find('[data-test="prebuilt-destination-form"]').exists(),
    ).toBe(true);
  });

  it("shows preview/test buttons when hideActions=false", () => {
    wrapper = mountComp({ hideActions: false });
    expect(
      wrapper.find('[data-test="destination-preview-button"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="destination-test-button"]').exists(),
    ).toBe(true);
  });

  it("hides preview/test buttons when hideActions=true", () => {
    wrapper = mountComp({ hideActions: true });
    expect(
      wrapper.find('[data-test="destination-preview-button"]').exists(),
    ).toBe(false);
  });

  it("preview/test buttons emit their events", async () => {
    wrapper = mountComp();
    const child = wrapper.findComponent(PrebuiltDestinationForm);
    await wrapper
      .find('[data-test="destination-preview-button"]')
      .trigger("click");
    await wrapper.find('[data-test="destination-test-button"]').trigger("click");
    expect(child.emitted("preview")).toBeTruthy();
    expect(child.emitted("test")).toBeTruthy();
  });
});

describe("PrebuiltDestinationForm - rendering per type", () => {
  it("renders slack webhook + channel inputs", () => {
    wrapper = mountComp({ destinationType: "slack" });
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="slack-channel-input"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-test="discord-webhook-url-input"]').exists(),
    ).toBe(false);
  });

  it("renders discord webhook + username inputs", () => {
    wrapper = mountComp({ destinationType: "discord" });
    expect(
      wrapper.find('[data-test="discord-webhook-url-input"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="discord-username-input"]').exists()).toBe(
      true,
    );
  });

  it("renders msteams webhook input", () => {
    wrapper = mountComp({ destinationType: "msteams" });
    expect(
      wrapper.find('[data-test="msteams-webhook-url-input"]').exists(),
    ).toBe(true);
  });

  it("renders pagerduty integration key + severity select", () => {
    wrapper = mountComp({ destinationType: "pagerduty" });
    expect(
      wrapper.find('[data-test="pagerduty-integration-key-input"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="pagerduty-severity-select"]').exists(),
    ).toBe(true);
  });

  it("renders opsgenie api key + priority + eu-region toggle", () => {
    wrapper = mountComp({ destinationType: "opsgenie" });
    expect(wrapper.find('[data-test="opsgenie-api-key-input"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-test="opsgenie-priority-select"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="opsgenie-eu-region-toggle"]').exists(),
    ).toBe(true);
  });

  it("renders servicenow url/username/password/assignment-group", () => {
    wrapper = mountComp({ destinationType: "servicenow" });
    expect(
      wrapper.find('[data-test="servicenow-instance-url-input"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="servicenow-password-input"]').exists(),
    ).toBe(true);
  });

  it("renders email recipients input", () => {
    wrapper = mountComp({ destinationType: "email" });
    expect(wrapper.find('[data-test="email-recipients-input"]').exists()).toBe(
      true,
    );
  });

  it("keeps type=password on sensitive inputs", () => {
    wrapper = mountComp({ destinationType: "pagerduty" });
    const input = wrapper
      .find('[data-test="pagerduty-integration-key-input"]')
      .find("input");
    expect(input.attributes("type")).toBe("password");
  });
});

describe("PrebuiltDestinationForm - binds into the ONE parent form", () => {
  it("seeds credential inputs from the parent form's credentials", () => {
    wrapper = mountComp({
      destinationType: "slack",
      modelValue: { webhookUrl: "https://hooks.slack.com/x", channel: "#a" },
    });
    const input = wrapper
      .find('[data-test="slack-webhook-url-input"]')
      .findComponent(OInput);
    expect(input.props("modelValue")).toBe("https://hooks.slack.com/x");
  });

  it("typing a credential updates the parent form (name=credentials.*)", async () => {
    wrapper = mountComp({ destinationType: "slack" });
    await wrapper
      .find('[data-test="slack-webhook-url-input"] input')
      .setValue("https://hooks.slack.com/typed");
    await nextTick();
    await flushPromises();
    expect(hostForm(wrapper).state.values.credentials.webhookUrl).toBe(
      "https://hooks.slack.com/typed",
    );
  });
});
