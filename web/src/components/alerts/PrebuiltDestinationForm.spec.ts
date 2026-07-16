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

// Behavior-first spec for the OForm + Zod migration of PrebuiltDestinationForm.
// The credential fields are config-driven per destinationType; the schema is
// built dynamically from getPrebuiltConfig().credentialFields (single source of
// truth). These tests mount the REAL <OForm> and drive its schema/handleSubmit.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import PrebuiltDestinationForm from "@/components/alerts/PrebuiltDestinationForm.vue";
import { generateDestinationUrl } from "@/utils/prebuilt-templates";

const US_OPSGENIE_URL = "https://api.opsgenie.com/v2/alerts";
const EU_OPSGENIE_URL = "https://api.eu.opsgenie.com/v2/alerts";

let wrapper: any = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountComp(props: Record<string, any> = {}) {
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

// The REAL TanStack form owned by the component, exposed by <OForm>.
const getForm = (w: any) => w.findComponent({ name: "OForm" }).vm.form;

// A syntactically valid Slack webhook that passes the config's urlValidator.
const VALID_SLACK = "https://hooks.slack.com/services/T000/B000/xxxxxxxx";

describe("PrebuiltDestinationForm - base rendering", () => {
  it("renders the form wrapper", () => {
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
    expect(
      wrapper.find('[data-test="destination-test-button"]').exists(),
    ).toBe(false);
  });

  it("preview/test buttons emit their events", async () => {
    wrapper = mountComp();
    await wrapper
      .find('[data-test="destination-preview-button"]')
      .trigger("click");
    await wrapper.find('[data-test="destination-test-button"]').trigger("click");
    expect(wrapper.emitted("preview")).toBeTruthy();
    expect(wrapper.emitted("test")).toBeTruthy();
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
      wrapper.find('[data-test="servicenow-username-input"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="servicenow-password-input"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="servicenow-assignment-group-input"]').exists(),
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

describe("PrebuiltDestinationForm - edit prefill from modelValue", () => {
  it("seeds the form values from modelValue", () => {
    wrapper = mountComp({
      destinationType: "slack",
      modelValue: { webhookUrl: VALID_SLACK, channel: "#alerts" },
    });
    const form = getForm(wrapper);
    expect(form.state.values.webhookUrl).toBe(VALID_SLACK);
    expect(form.state.values.channel).toBe("#alerts");
  });

  it("seeds toggle (euRegion) as boolean default false when absent", () => {
    wrapper = mountComp({ destinationType: "opsgenie" });
    expect(getForm(wrapper).state.values.euRegion).toBe(false);
  });
});

// ── Toggle round-trip through STRING metadata ───────────────────────────────
// Credentials are persisted into destination metadata with `String(v)`
// (usePrebuiltDestinations.ts :504/:531/:628/:653), so an edit-prefill hands a
// toggle back as the STRING "true"/"false" — never a boolean. Two things broke:
//   1. `z.boolean()` REJECTED the string → the child never emitted submit → the
//      destination became permanently unsaveable (a rule tighter than
//      pre-migration = Rule ④ break).
//   2. The seed's `as boolean` cast is compile-time only, so the string "false"
//      stayed in the form and read TRUTHY at getPrebuiltUrl → a US Opsgenie
//      instance was routed to the EU endpoint.
describe("PrebuiltDestinationForm - toggle (euRegion) string round-trip", () => {
  const OPSGENIE_KEY = "x".repeat(40);

  it.each([
    ["false", false],
    ["true", true],
    [false, false],
    [true, true],
  ])(
    "seeds metadata euRegion=%o as the boolean %o",
    (stored: any, expected: boolean) => {
      wrapper = mountComp({
        destinationType: "opsgenie",
        modelValue: { apiKey: OPSGENIE_KEY, euRegion: stored },
      });
      const seeded = getForm(wrapper).state.values.euRegion;
      expect(seeded).toBe(expected);
      // Never a string — a string here reroutes US→EU downstream.
      expect(typeof seeded).toBe("boolean");
    },
  );

  it("edits+SAVES an opsgenie destination whose metadata has euRegion:'false' (was blocked)", async () => {
    wrapper = mountComp({
      destinationType: "opsgenie",
      modelValue: { apiKey: OPSGENIE_KEY, euRegion: "false" },
    });
    const form = getForm(wrapper);

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")).toBeTruthy();
    // The emitted credential is a REAL boolean false, not the string "false".
    expect(wrapper.emitted("submit")[0][0].euRegion).toBe(false);
  });

  it("edits+SAVES with metadata euRegion:'true' and emits boolean true", async () => {
    wrapper = mountComp({
      destinationType: "opsgenie",
      modelValue: { apiKey: OPSGENIE_KEY, euRegion: "true" },
    });
    const form = getForm(wrapper);

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")[0][0].euRegion).toBe(true);
  });

  it("a real boolean toggle still round-trips (no regression for fresh forms)", async () => {
    wrapper = mountComp({ destinationType: "opsgenie" });
    const form = getForm(wrapper);
    form.setFieldValue("apiKey", OPSGENIE_KEY);
    form.setFieldValue("euRegion", true);
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")[0][0].euRegion).toBe(true);
  });

  // END-TO-END routing proof: the credentials the form EMITS are what
  // generateDestinationUrl consumes. That read is TRUTHY (`credentials.euRegion
  // ? EU : US`), so a leaked string "false" would silently send a US instance to
  // the EU endpoint. Asserting on the emitted value covers the whole chain.
  it.each([
    ["false", US_OPSGENIE_URL],
    [false, US_OPSGENIE_URL],
    ["true", EU_OPSGENIE_URL],
    [true, EU_OPSGENIE_URL],
  ])(
    "metadata euRegion=%o routes to %s",
    async (stored: any, expectedUrl: string) => {
      wrapper = mountComp({
        destinationType: "opsgenie",
        modelValue: { apiKey: OPSGENIE_KEY, euRegion: stored },
      });
      const form = getForm(wrapper);

      await form.handleSubmit();
      await flushPromises();

      const emitted = wrapper.emitted("submit")[0][0];
      expect(generateDestinationUrl("opsgenie", emitted)).toBe(expectedUrl);
    },
  );
});

describe("PrebuiltDestinationForm - schema gating (real OForm)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks submit and does NOT emit 'submit' when a required field is empty", async () => {
    wrapper = mountComp({ destinationType: "slack" });
    const form = getForm(wrapper);

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(wrapper.emitted("submit")).toBeFalsy();
  });

  it("submits and emits validated credentials when the schema passes", async () => {
    wrapper = mountComp({ destinationType: "slack" });
    const form = getForm(wrapper);
    form.setFieldValue("webhookUrl", VALID_SLACK);
    form.setFieldValue("channel", "#alerts");
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")).toBeTruthy();
    expect(wrapper.emitted("submit")[0][0]).toMatchObject({
      webhookUrl: VALID_SLACK,
      channel: "#alerts",
    });
  });

  it("enforces the per-type validator (invalid Slack webhook URL is blocked)", async () => {
    wrapper = mountComp({ destinationType: "slack" });
    const form = getForm(wrapper);
    form.setFieldValue("webhookUrl", "https://example.com/not-slack");
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(wrapper.emitted("submit")).toBeFalsy();
  });

  it("pagerduty requires a 32-char key and a severity", async () => {
    wrapper = mountComp({ destinationType: "pagerduty" });
    const form = getForm(wrapper);

    form.setFieldValue("integrationKey", "short");
    await nextTick();
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);
    expect(wrapper.emitted("submit")).toBeFalsy();

    form.setFieldValue("integrationKey", "a".repeat(32));
    form.setFieldValue("severity", "critical");
    await nextTick();
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")).toBeTruthy();
  });

  it("email requires valid recipients", async () => {
    wrapper = mountComp({ destinationType: "email" });
    const form = getForm(wrapper);

    // empty → blocked
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);

    // valid email → passes
    form.setFieldValue("recipients", "user@example.com");
    await nextTick();
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")).toBeTruthy();
  });

  it("optional fields do not block submit (opsgenie priority/euRegion)", async () => {
    wrapper = mountComp({ destinationType: "opsgenie" });
    const form = getForm(wrapper);
    form.setFieldValue("apiKey", "x".repeat(40));
    await nextTick();
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(true);
    expect(wrapper.emitted("submit")).toBeTruthy();
  });
});

describe("PrebuiltDestinationForm - egress to parent", () => {
  it("emits update:modelValue as the form values change", async () => {
    wrapper = mountComp({ destinationType: "slack" });
    const form = getForm(wrapper);
    form.setFieldValue("webhookUrl", "typing...");
    await nextTick();

    const events = wrapper.emitted("update:modelValue");
    expect(events).toBeTruthy();
    const last = events[events.length - 1][0];
    expect(last.webhookUrl).toBe("typing...");
  });
});
