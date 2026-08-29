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

// Behavior-first spec for the OForm + Zod migration of AddDestination.
// Drives the REAL parent <OForm> (schema-gated custom/pipeline save) + proves
// the apiHeaders field-array delete keeps the RENDERED inputs aligned, and the
// prebuilt coupling (child form @submit → composable save).

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const hoisted = vi.hoisted(() => ({
  mockCreatePrebuilt: vi.fn(),
  mockUpdatePrebuilt: vi.fn(),
  mockTestPrebuilt: vi.fn(),
  mockGeneratePreview: vi.fn(),
  mockClearTestResult: vi.fn(),
  mockTrack: vi.fn(),
  mockLastTestResult: null as null | {
    success: boolean;
    statusCode: number;
    responseBody?: string;
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: {}, query: {} }),
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    test: vi.fn().mockResolvedValue({ data: { code: 200 } }),
  },
}));

vi.mock("@/services/users", () => ({
  default: {
    orgUsers: vi.fn(),
    getRoles: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: hoisted.mockTrack }),
}));

vi.mock("@/composables/usePrebuiltDestinations", async () => {
  const { ref, computed } = await import("vue");
  return {
    usePrebuiltDestinations: () => ({
      availableTypes: computed(() => [{ id: "slack", name: "Slack" }]),
      popularTypes: computed(() => []),
      validateCredentials: vi.fn(),
      testDestination: hoisted.mockTestPrebuilt,
      createDestination: hoisted.mockCreatePrebuilt,
      updateDestination: hoisted.mockUpdatePrebuilt,
      generatePreview: hoisted.mockGeneratePreview,
      clearTestResult: hoisted.mockClearTestResult,
      isTestInProgress: ref(false),
      lastTestResult: computed(() => hoisted.mockLastTestResult),
      detectPrebuiltType: vi.fn(),
      getPrebuiltConfig: vi.fn(),
      isPrebuiltType: vi.fn(),
      generateDestinationUrl: vi.fn(),
      generateDestinationHeaders: vi.fn(),
    }),
  };
});

import AddDestination from "@/components/alerts/AddDestination.vue";
import destinationService from "@/services/alert_destination";
import usersService from "@/services/users";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import config from "@/aws-exports";

let wrapper: any = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  config.isCloud = "false";
  vi.restoreAllMocks();
});

function mountComp(props: Record<string, any> = {}) {
  return mount(AddDestination, {
    props: { templates: [], destination: null, isAlerts: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        PrebuiltDestinationSelector: {
          template: '<div data-test="prebuilt-destination-selector-stub"></div>',
          props: ["modelValue", "searchQuery"],
          emits: ["update:modelValue", "select", "update:searchQuery"],
        },
        DestinationTestResult: {
          name: "DestinationTestResult",
          template: '<div data-test="destination-test-result-stub"></div>',
          props: ["result", "showSuccessResponseBody"],
        },
        AddUser: {
          name: "AddUser",
          props: ["open", "container", "roles", "userRole", "isCloud"],
          emits: ["update:open", "updated"],
          template: '<div data-test="add-user-stub"></div>',
        },
        DestinationPreview: {
          name: "DestinationPreview",
          template: '<div data-test="destination-preview-stub"></div>',
          props: ["type", "templateContent"],
        },
        AppTabs: {
          template: '<div data-test="app-tabs-stub"></div>',
          props: ["tabs", "activeTab"],
          emits: ["update:activeTab"],
        },
      },
    },
  });
}

// The REAL parent TanStack form (the first OForm — the child prebuilt form is
// only mounted for prebuilt types).
const getForm = (w: any) => w.findComponent({ name: "OForm" }).vm.form;

// Put the parent form into the CUSTOM (alerts) http branch.
async function toCustomHttp(w: any) {
  const form = getForm(w);
  form.setFieldValue("destination_type", "custom");
  form.setFieldValue("type", "http");
  await nextTick();
  return form;
}

describe("AddDestination - rendering", () => {
  it("renders the title (create mode)", () => {
    wrapper = mountComp({ destination: null });
    expect(wrapper.find('[data-test="add-destination-title"]').exists()).toBe(true);
  });

  it("renders url/method/cancel in custom mode", async () => {
    wrapper = mountComp();
    await toCustomHttp(wrapper);
    expect(wrapper.find('[data-test="add-destination-url-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="add-destination-method-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="add-destination-cancel-btn"]').exists()).toBe(true);
  });

  it("Save button stays enabled (R3 — no :disabled)", async () => {
    wrapper = mountComp();
    await toCustomHttp(wrapper);
    const save = wrapper.find('[data-test="add-destination-submit-btn"]');
    expect(save.attributes("disabled")).toBeUndefined();
  });

  it("clicking cancel emits cancel:hideform", async () => {
    wrapper = mountComp();
    await toCustomHttp(wrapper);
    await wrapper.find('[data-test="add-destination-cancel-btn"]').trigger("click");
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });
});

describe("AddDestination - custom path schema gating + payload parity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks submit and does NOT call the service when required fields are empty", async () => {
    wrapper = mountComp();
    const form = await toCustomHttp(wrapper);

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();
  });

  it("submits an exact custom HTTP (alerts) payload when valid", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = await toCustomHttp(wrapper);
    form.setFieldValue("name", "dest1");
    form.setFieldValue("url", "https://example.com/webhook");
    form.setFieldValue("method", "post");
    form.setFieldValue("template", "tmpl1");
    form.setFieldValue("apiHeaders", [{ key: "H1", value: "V1" }]);
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(destinationService.create).toHaveBeenCalledTimes(1);
    expect(destinationService.create).toHaveBeenCalledWith({
      org_identifier: "default",
      destination_name: "dest1",
      data: {
        url: "https://example.com/webhook",
        method: "post",
        skip_tls_verify: false,
        template: "tmpl1",
        headers: { H1: "V1" },
        name: "dest1",
      },
    });
  });

  it("email branch: no recipients blocked; picked users → array payload with type=email", async () => {
    // Recipients are org users chosen from a list, so the only invalid state is
    // an empty selection — there is no free text left to mistype.
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "custom");
    form.setFieldValue("type", "email");
    form.setFieldValue("name", "dest-email");
    form.setFieldValue("template", "tmpl1");
    form.setFieldValue("emails", []);
    await nextTick();

    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();

    form.setFieldValue("emails", ["a@b.com", "c@d.com"]);
    await nextTick();
    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    const payload = (destinationService.create as any).mock.calls[0][0].data;
    expect(payload.type).toBe("email");
    expect(payload.emails).toEqual(["a@b.com", "c@d.com"]);
    expect(payload.name).toBe("dest-email");
  });

  it("template is required for custom alert destinations", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = await toCustomHttp(wrapper);
    form.setFieldValue("name", "dest1");
    form.setFieldValue("url", "https://example.com");
    form.setFieldValue("method", "post");
    // template left empty
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();
  });

  it("rejects a name with invalid resource characters", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = await toCustomHttp(wrapper);
    form.setFieldValue("name", "bad name?");
    form.setFieldValue("url", "https://example.com");
    form.setFieldValue("method", "post");
    form.setFieldValue("template", "tmpl1");
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();
  });
});

describe("AddDestination - pipeline (!isAlerts) branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires output_format and ships it (with empty template) in the payload", async () => {
    wrapper = mountComp({ isAlerts: false });
    const form = getForm(wrapper);
    // pipeline default type is http; destination_type stays "".
    form.setFieldValue("name", "pipe-dest");
    form.setFieldValue("url", "https://pipe.example.com");
    form.setFieldValue("method", "post");
    form.setFieldValue("output_format", "");
    await nextTick();

    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();

    form.setFieldValue("output_format", "ndjson");
    await nextTick();
    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    const payload = (destinationService.create as any).mock.calls[0][0].data;
    expect(payload.output_format).toBe("ndjson");
    expect(payload.template).toBe("");
    expect(payload.name).toBe("pipe-dest");
    expect(payload.url).toBe("https://pipe.example.com");
  });
});

describe("AddDestination - apiHeaders field array (Rule ①)", () => {
  it("deleting a NON-last row keeps the RENDERED inputs aligned (index :key)", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = await toCustomHttp(wrapper);
    form.setFieldValue("apiHeaders", [
      { key: "ka", value: "va" },
      { key: "kb", value: "vb" },
      { key: "kc", value: "vc" },
    ]);
    await nextTick();

    // Delete the MIDDLE row (index 1 → key "kb").
    await wrapper.find('[data-test="add-destination-header-kb-delete-btn"]').trigger("click");
    await nextTick();

    // Read the RENDERED key inputs (OFormInput → OInput model-value), not the
    // form.state.values — a stable-id :key bug leaves the data correct but the
    // inputs shifted/blank.
    const renderedKeys = wrapper
      .findAllComponents(OFormInput)
      .filter((c: any) => /^apiHeaders\[\d+\]\.key$/.test(String(c.props("name"))))
      .map((c: any) => c.findComponent(OInput).props("modelValue"));
    const renderedValues = wrapper
      .findAllComponents(OFormInput)
      .filter((c: any) => /^apiHeaders\[\d+\]\.value$/.test(String(c.props("name"))))
      .map((c: any) => c.findComponent(OInput).props("modelValue"));

    expect(renderedKeys).toEqual(["ka", "kc"]);
    expect(renderedValues).toEqual(["va", "vc"]);
  });

  it("deleting the only row backfills a blank row", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = await toCustomHttp(wrapper);
    form.setFieldValue("apiHeaders", [{ key: "only", value: "v" }]);
    await nextTick();

    await wrapper.find('[data-test="add-destination-header-only-delete-btn"]').trigger("click");
    await nextTick();

    const rows = form.getFieldValue("apiHeaders");
    expect(rows).toEqual([{ key: "", value: "" }]);
  });
});

// Prebuilt destinations now live in the SAME single <OForm> (no nested child
// form): the credential inputs are `credentials.*` fields on the parent form, the
// parent schema validates them, and Enter/Save submit the ONE form. These tests
// drive that end-to-end path (the previously-untested submit wiring).
describe("AddDestination - prebuilt (single form, no nested <form>)", () => {
  const VALID_SLACK = "https://hooks.slack.com/services/T000/B000/xxxxxxxx";

  beforeEach(() => {
    vi.clearAllMocks();
    config.isCloud = "true";
    hoisted.mockCreatePrebuilt.mockResolvedValue(undefined);
    hoisted.mockUpdatePrebuilt.mockResolvedValue(undefined);
  });

  // Put the ONE form into a prebuilt (slack) branch with valid credentials.
  async function toValidSlack(w: any, name = "my-slack") {
    const form = getForm(w);
    form.setFieldValue("destination_type", "slack");
    form.setFieldValue("type", "http");
    form.setFieldValue("name", name);
    form.setFieldValue("skip_tls_verify", true);
    form.setFieldValue("slack_setup_method", "oauth");
    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "alerts" });
    form.setFieldValue("slack_team_id", "T000");
    form.setFieldValue("slack_team_name", "Acme");
    form.setFieldValue("slack_channel_id", "B000");
    await nextTick();
    return form;
  }

  it("renders the credential fields inside the ONE form (no nested form)", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "slack");
    form.setFieldValue("slack_setup_method", "webhook");
    form.setFieldValue("credentials", { webhookUrl: "", channel: "" });
    await nextTick();
    expect(wrapper.find('[data-test="slack-destination-setup"]').exists()).toBe(true);
    // The credential input renders (it injected the parent form context).
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);
    // Exactly ONE <form> element — the nested prebuilt form is gone.
    expect(wrapper.findAll("form").length).toBe(1);
  });

  it("Save targets the ONE parent form for prebuilt types too", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "slack");
    form.setFieldValue("slack_setup_method", "webhook");
    await nextTick();
    const save = wrapper.find('[data-test="add-destination-submit-btn"]');
    expect(save.attributes("form")).toBe("add-destination-form");
  });

  it("blocks the save when a required credential is empty (schema gates it)", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "slack");
    form.setFieldValue("name", "my-slack");
    form.setFieldValue("slack_setup_method", "oauth");
    form.setFieldValue("credentials", { webhookUrl: "", channel: "" });
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(hoisted.mockCreatePrebuilt).not.toHaveBeenCalled();
  });

  it("saves via createDestination when credentials + name are valid", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = await toValidSlack(wrapper);

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(hoisted.mockCreatePrebuilt).toHaveBeenCalledTimes(1);
    expect(hoisted.mockCreatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "my-slack",
      { webhookUrl: VALID_SLACK, channel: "alerts" },
      {},
      true,
      undefined,
      {
        setup_method: "oauth",
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      },
    );
    expect(wrapper.emitted("get:destinations")).toBeTruthy();
    expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
  });

  it("EDIT mode: prefills credentials from a saved prebuilt destination and updates it", async () => {
    const existingSlack: any = {
      name: "old-slack",
      url: VALID_SLACK,
      type: "http",
      method: "post",
      template: "prebuilt_slack",
      skip_tls_verify: false,
      headers: {},
      // prebuilt_type drives type resolution (Priority 1); credential_* metadata
      // + the url are restored by extractPrebuiltCredentials.
      metadata: {
        prebuilt_type: "slack",
        credential_channel: "#ops",
        setup_method: "oauth",
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();
    const form = getForm(wrapper);

    // Prefill landed in the ONE form's credentials sub-object.
    expect(form.state.values.destination_type).toBe("slack");
    expect(form.state.values.credentials.webhookUrl).toBe(VALID_SLACK);
    expect(form.state.values.credentials.channel).toBe("#ops");
    expect(wrapper.find('[data-test="slack-destination-setup"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-webhook-url-input"] input').attributes("type")).toBe(
      "password",
    );

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    expect(hoisted.mockUpdatePrebuilt).toHaveBeenCalledTimes(1);
    expect(hoisted.mockUpdatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "old-slack", // original name
      "old-slack", // (possibly new) name
      { webhookUrl: VALID_SLACK, channel: "#ops" },
      {},
      false,
      "prebuilt_slack",
      {
        setup_method: "oauth",
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      },
    );
    expect(hoisted.mockCreatePrebuilt).not.toHaveBeenCalled();
  });

  it("restores PagerDuty severity from its substitution metadata on edit", async () => {
    const existingPagerDuty = {
      name: "pagerduty-alerts",
      url: "https://events.pagerduty.com/v2/enqueue",
      type: "http",
      method: "post",
      template: "prebuilt_pagerduty",
      skip_tls_verify: false,
      headers: {},
      metadata: {
        prebuilt_type: "pagerduty",
        routing_key: "x".repeat(32),
        severity: "critical",
        source: "openobserve",
      },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingPagerDuty });
    await flushPromises();

    const credentials = getForm(wrapper).state.values.credentials;
    expect(credentials.integrationKey).toBe("x".repeat(32));
    expect(credentials.severity).toBe("critical");
  });

  // The DOM wiring that makes Enter-in-any-field AND the footer Save submit the
  // ONE form: the single credential-bearing <form> carries the OForm id, the Save
  // button is type=submit associated to that same id, and there is no second form
  // to steal the submit. (The submit→save behavior itself is proven deterministically
  // by the handleSubmit test above; dispatching the native submit event is
  // fire-and-forget/flaky per the playbook, so we assert the association instead.)
  it("Enter/Save wiring: one <form id=add-destination-form> + a submit button bound to it", async () => {
    wrapper = mountComp({ isAlerts: true });
    await toValidSlack(wrapper);

    const forms = wrapper.findAll("form");
    expect(forms.length).toBe(1);
    expect(forms[0].attributes("id")).toBe("add-destination-form");

    const save = wrapper.find('[data-test="add-destination-submit-btn"]');
    expect(save.attributes("type")).toBe("submit");
    expect(save.attributes("form")).toBe("add-destination-form");
  });
});

describe("AddDestination - Slack setup flow", () => {
  const VALID_SLACK = "https://hooks.slack.com/services/T000/B000/xxxxxxxx";

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockCreatePrebuilt.mockResolvedValue(undefined);
    hoisted.mockUpdatePrebuilt.mockResolvedValue(undefined);
    hoisted.mockGeneratePreview.mockResolvedValue("preview");
    hoisted.mockLastTestResult = null;
  });

  const selectSlack = async (isCloud = true) => {
    config.isCloud = isCloud ? "true" : "false";
    wrapper = mountComp({ isAlerts: true });
    wrapper.vm.selectDestinationType("slack");
    await nextTick();
    return getForm(wrapper);
  };

  it("defaults a newly selected Slack destination to disconnected OAuth", async () => {
    const form = await selectSlack();

    expect(form.state.values.slack_setup_method).toBe("oauth");
    expect(wrapper.find('[data-test="slack-destination-setup"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-oauth-connect-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(false);
  });

  it("defaults self-hosted Slack to manifest and never renders Connect Slack", async () => {
    const form = await selectSlack(false);

    expect(form.state.values.slack_setup_method).toBe("manifest");
    expect(wrapper.find('[data-test="slack-setup-method-manifest"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-oauth-connect-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-manifest-stepper"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(false);
  });

  it("reveals self-hosted final actions only at the manifest webhook step", async () => {
    const form = await selectSlack(false);
    form.setFieldValue("name", "self-hosted-slack");
    await nextTick();

    await wrapper.find('[data-test="slack-manifest-continue-button"]').trigger("click");
    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(false);

    await wrapper.find('[data-test="slack-manifest-open-slack"]').trigger("click");
    await nextTick();

    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(true);
  });

  it("saves manifest setup metadata without including the webhook secret", async () => {
    const form = await selectSlack(false);
    form.setFieldValue("name", "self-hosted-slack");
    await nextTick();
    await wrapper.find('[data-test="slack-manifest-continue-button"]').trigger("click");
    await wrapper.find('[data-test="slack-manifest-open-slack"]').trigger("click");
    form.setFieldValue("slack_app_name", "Operations Alerts");
    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "" });
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(hoisted.mockCreatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "self-hosted-slack",
      { webhookUrl: VALID_SLACK, channel: "" },
      {},
      false,
      undefined,
      {
        setup_method: "manifest",
        slack_app_name: "Operations Alerts",
      },
    );
    const serializedCall = JSON.stringify(hoisted.mockCreatePrebuilt.mock.calls[0]);
    expect(serializedCall.split(VALID_SLACK)).toHaveLength(2);
  });

  it("blocks manifest creation until its webhook is valid", async () => {
    const form = await selectSlack(false);
    form.setFieldValue("name", "self-hosted-slack");
    await nextTick();
    await wrapper.find('[data-test="slack-manifest-continue-button"]').trigger("click");
    await wrapper.find('[data-test="slack-manifest-open-slack"]').trigger("click");
    form.setFieldValue("credentials", { webhookUrl: "https://example.com/not-slack", channel: "" });

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(hoisted.mockCreatePrebuilt).not.toHaveBeenCalled();
  });

  it("reveals final actions only after OAuth has connected", async () => {
    const form = await selectSlack();
    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(false);

    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "alerts" });
    await nextTick();
    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(false);

    form.setFieldValue("slack_team_id", "T000");
    form.setFieldValue("slack_team_name", "Acme");
    form.setFieldValue("slack_channel_id", "B000");
    await nextTick();

    expect(wrapper.find('[data-test="destination-preview-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="destination-test-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="add-destination-submit-btn"]').exists()).toBe(true);
  });

  it("switches to one direct-webhook form and clears stale test state", async () => {
    const form = await selectSlack();

    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "alerts" });
    form.setFieldValue("slack_team_id", "T000");
    form.setFieldValue("slack_team_name", "Acme");
    form.setFieldValue("slack_channel_id", "B000");
    await nextTick();

    hoisted.mockClearTestResult.mockClear();
    await wrapper.find('[data-test="slack-setup-method-webhook"]').trigger("click");
    await nextTick();

    expect(form.state.values.slack_setup_method).toBe("webhook");
    expect(wrapper.findAll('[data-test="add-destination-name-input"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-test="slack-webhook-url-input"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="slack-channel-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="prebuilt-additional-settings"]').exists()).toBe(true);
    expect(hoisted.mockClearTestResult).toHaveBeenCalledTimes(1);
    expect(form.state.values.credentials).toEqual({ webhookUrl: "", channel: "" });
    expect(form.state.values.slack_team_id).toBe("");
    expect(form.state.values.slack_team_name).toBe("");
    expect(form.state.values.slack_channel_id).toBe("");

    hoisted.mockClearTestResult.mockClear();
    await wrapper.find('[data-test="slack-setup-method-oauth"]').trigger("click");
    expect(form.state.values.slack_setup_method).toBe("oauth");
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
    expect(hoisted.mockClearTestResult).toHaveBeenCalledTimes(1);
  });

  it("submits existing-webhook setup without entering OAuth", async () => {
    const form = await selectSlack();
    await wrapper.find('[data-test="slack-setup-method-webhook"]').trigger("click");
    form.setFieldValue("name", "slack-webhook");
    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "#operations" });
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(hoisted.mockCreatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "slack-webhook",
      { webhookUrl: VALID_SLACK, channel: "#operations" },
      {},
      false,
      undefined,
      { setup_method: "webhook" },
    );
  });

  it("opts Slack into displaying the observed HTTP 200 response body", async () => {
    hoisted.mockLastTestResult = { success: true, statusCode: 200, responseBody: "ok" };
    await selectSlack();
    await nextTick();

    const result = wrapper.findComponent({ name: "DestinationTestResult" });
    expect(result.props("showSuccessResponseBody")).toBe(true);
    expect(result.props("result")).toEqual({
      success: true,
      statusCode: 200,
      responseBody: "ok",
    });
    expect(JSON.stringify(result.props())).not.toMatch(/workspace|channel/i);
  });

  it("clears a successful test result when the webhook credentials change", async () => {
    hoisted.mockLastTestResult = { success: true, statusCode: 200, responseBody: "ok" };
    const form = await selectSlack();
    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "" });
    await nextTick();

    hoisted.mockClearTestResult.mockClear();
    form.setFieldValue(
      "credentials.webhookUrl",
      "https://hooks.slack.com/services/T000/B000/replacement",
    );
    await nextTick();

    expect(hoisted.mockClearTestResult).toHaveBeenCalledTimes(1);
  });

  it("never sends the Slack workspace, channel, or webhook to analytics", async () => {
    const workspace = "Private Operations Workspace";
    const channel = "#private-operations";
    const secret = "https://hooks.slack.com/services/T000/B000/private-analytics-secret";
    hoisted.mockTestPrebuilt.mockResolvedValue({
      success: true,
      statusCode: 200,
      responseBody: "ok",
    });
    const form = await selectSlack();
    form.setFieldValue("name", "slack-private");
    form.setFieldValue("slack_team_id", "T000");
    form.setFieldValue("slack_team_name", workspace);
    form.setFieldValue("slack_channel_id", "B000");
    form.setFieldValue("credentials", { webhookUrl: secret, channel });
    await nextTick();

    await wrapper.find('[data-test="destination-preview-button"]').trigger("click");
    await wrapper.find('[data-test="destination-test-button"]').trigger("click");
    await form.handleSubmit();
    await flushPromises();

    const analyticsPayload = JSON.stringify(hoisted.mockTrack.mock.calls);
    expect(analyticsPayload).not.toContain(workspace);
    expect(analyticsPayload).not.toContain(channel);
    expect(analyticsPayload).not.toContain(secret);
  });

  it("treats legacy Slack edits as webhook setup and never renders the wizard", async () => {
    const existingSlack = {
      name: "legacy-slack",
      url: VALID_SLACK,
      type: "http",
      method: "post",
      template: "prebuilt_slack",
      skip_tls_verify: false,
      headers: {},
      metadata: { prebuilt_type: "slack" },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();
    const form = getForm(wrapper);

    expect(form.state.values.slack_setup_method).toBe("webhook");
    expect(wrapper.find('[data-test="slack-destination-setup"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="prebuilt-form"]').exists()).toBe(true);

    await form.handleSubmit();
    await flushPromises();
    expect(hoisted.mockUpdatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "legacy-slack",
      "legacy-slack",
      { webhookUrl: VALID_SLACK, channel: "" },
      {},
      false,
      "prebuilt_slack",
      { setup_method: "webhook" },
    );
  });

  it("recognizes an explicitly saved webhook setup during edit", async () => {
    const existingSlack = {
      name: "saved-webhook-slack",
      url: VALID_SLACK,
      type: "http",
      method: "post",
      template: "prebuilt_slack",
      skip_tls_verify: false,
      headers: {},
      metadata: { prebuilt_type: "slack", setup_method: "webhook" },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();

    expect(getForm(wrapper).state.values.slack_setup_method).toBe("webhook");
    expect(wrapper.find('[data-test="slack-destination-setup"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-webhook-url-input"] input').attributes("type")).toBe(
      "password",
    );
  });

  it("preserves manifest metadata while editing through the direct webhook form", async () => {
    const existingSlack = {
      name: "manifest-slack",
      url: VALID_SLACK,
      type: "http",
      method: "post",
      template: "prebuilt_slack",
      skip_tls_verify: false,
      headers: {},
      metadata: {
        prebuilt_type: "slack",
        setup_method: "manifest",
        slack_app_name: "Operations Alerts",
      },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();
    const form = getForm(wrapper);

    expect(form.state.values.slack_setup_method).toBe("manifest");
    expect(form.state.values.slack_app_name).toBe("Operations Alerts");
    expect(wrapper.find('[data-test="slack-destination-setup"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-webhook-url-input"] input').attributes("type")).toBe(
      "password",
    );

    await form.handleSubmit();
    await flushPromises();

    expect(hoisted.mockUpdatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "manifest-slack",
      "manifest-slack",
      { webhookUrl: VALID_SLACK, channel: "" },
      {},
      false,
      "prebuilt_slack",
      {
        setup_method: "manifest",
        slack_app_name: "Operations Alerts",
      },
    );
  });

  it("downgrades OAuth metadata when its webhook is replaced during edit", async () => {
    const existingSlack = {
      name: "oauth-slack",
      url: VALID_SLACK,
      type: "http",
      method: "post",
      template: "prebuilt_slack",
      skip_tls_verify: false,
      headers: {},
      metadata: {
        prebuilt_type: "slack",
        credential_channel: "#ops",
        setup_method: "oauth",
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();
    const form = getForm(wrapper);
    const replacement = "https://hooks.slack.com/services/T111/B111/replacement";

    form.setFieldValue("credentials.webhookUrl", replacement);
    await form.handleSubmit();
    await flushPromises();

    expect(hoisted.mockUpdatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "oauth-slack",
      "oauth-slack",
      { webhookUrl: replacement, channel: "#ops" },
      {},
      false,
      "prebuilt_slack",
      { setup_method: "webhook" },
    );
  });

  it("downgrades manifest metadata when its webhook is replaced during edit", async () => {
    const existingSlack = {
      name: "manifest-slack",
      url: VALID_SLACK,
      type: "http",
      method: "post",
      template: "prebuilt_slack",
      skip_tls_verify: false,
      headers: {},
      metadata: {
        prebuilt_type: "slack",
        setup_method: "manifest",
        slack_app_name: "Operations Alerts",
      },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();
    const form = getForm(wrapper);
    const replacement = "https://hooks.slack.com/services/T222/B222/replacement";

    form.setFieldValue("credentials.webhookUrl", replacement);
    await form.handleSubmit();
    await flushPromises();

    expect(hoisted.mockUpdatePrebuilt).toHaveBeenCalledWith(
      "slack",
      "manifest-slack",
      "manifest-slack",
      { webhookUrl: replacement, channel: "" },
      {},
      false,
      "prebuilt_slack",
      { setup_method: "webhook" },
    );
  });

  it("does not log a rejected save error containing the webhook", async () => {
    const secret = "https://hooks.slack.com/services/T000/B000/private";
    const error = Object.assign(new Error("save failed"), {
      config: { data: JSON.stringify({ url: secret }) },
    });
    hoisted.mockCreatePrebuilt.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const form = await selectSlack();
    form.setFieldValue("name", "slack-alerts");
    form.setFieldValue("slack_setup_method", "webhook");
    form.setFieldValue("credentials", { webhookUrl: secret, channel: "" });

    await form.handleSubmit();
    await flushPromises();

    expect(hoisted.mockCreatePrebuilt).toHaveBeenCalledTimes(1);

    const logged = consoleError.mock.calls
      .flat()
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");
    expect(consoleError.mock.calls.flat()).not.toContain(error);
    expect(logged).not.toContain(secret);
    consoleError.mockRestore();
  });
});

describe("AddDestination — email recipients are org users", () => {
  const ORG_USERS = [
    { email: "alice@acme.io", role: "admin" },
    { email: "bob@acme.io", role: "member" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usersService.orgUsers).mockResolvedValue({ data: { data: ORG_USERS } } as any);
    vi.mocked(usersService.getRoles).mockResolvedValue({
      data: [{ label: "Admin", value: "admin" }],
    } as any);
  });

  const mountEmailForm = async () => {
    const wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "custom");
    form.setFieldValue("type", "email");
    await flushPromises();
    await nextTick();
    return { wrapper, form };
  };

  it("offers the organization's users as recipient options", async () => {
    const { wrapper } = await mountEmailForm();

    expect(usersService.orgUsers).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);

    const select = wrapper.find('[data-test="add-destination-emails-select"]');
    expect(select.exists()).toBe(true);
    expect(wrapper.vm.orgUserOptions).toEqual([
      { label: "alice@acme.io", value: "alice@acme.io" },
      { label: "bob@acme.io", value: "bob@acme.io" },
    ]);
  });

  it("leaves the picker empty rather than breaking the form when the fetch fails", async () => {
    vi.mocked(usersService.orgUsers).mockRejectedValue(new Error("403"));

    const { wrapper } = await mountEmailForm();

    expect(wrapper.vm.orgUserOptions).toEqual([]);
    expect(wrapper.find('[data-test="add-destination-emails-select"]').exists()).toBe(true);
  });

  it("opens the create-user drawer from the action under the options", async () => {
    const { wrapper } = await mountEmailForm();

    expect(wrapper.vm.showCreateUser).toBe(false);
    wrapper.vm.openCreateUser();
    await nextTick();

    const addUser = wrapper.findComponent({ name: "AddUser" });
    expect(addUser.props("open")).toBe(true);
    // A sidebar, not a dialog stacked on the destination form.
    expect(addUser.props("container")).toBe("drawer");
  });

  it("refreshes the list and selects the user that was just created", async () => {
    const { wrapper, form } = await mountEmailForm();
    wrapper.vm.openCreateUser();

    vi.mocked(usersService.orgUsers).mockResolvedValue({
      data: { data: [...ORG_USERS, { email: "carol@acme.io", role: "member" }] },
    } as any);

    await wrapper
      .findComponent({ name: "AddUser" })
      .vm.$emit("updated", { email: "carol@acme.io" });
    await flushPromises();

    // The round trip ends where the user was heading: a recipient chosen.
    expect(wrapper.vm.orgUserOptions).toHaveLength(3);
    expect(form.state.values.emails).toContain("carol@acme.io");
    expect(wrapper.vm.showCreateUser).toBe(false);
  });

  it("infers the new user when the event carries no email", async () => {
    const { wrapper, form } = await mountEmailForm();

    vi.mocked(usersService.orgUsers).mockResolvedValue({
      data: { data: [...ORG_USERS, { email: "dan@acme.io", role: "member" }] },
    } as any);

    await wrapper.findComponent({ name: "AddUser" }).vm.$emit("updated");
    await flushPromises();

    expect(form.state.values.emails).toContain("dan@acme.io");
  });

  it("does not duplicate a recipient that is already selected", async () => {
    const { wrapper, form } = await mountEmailForm();
    form.setFieldValue("emails", ["alice@acme.io"]);

    await wrapper
      .findComponent({ name: "AddUser" })
      .vm.$emit("updated", { email: "alice@acme.io" });
    await flushPromises();

    expect(form.state.values.emails).toEqual(["alice@acme.io"]);
  });

  it("passes the org's own roles to the create-user drawer", async () => {
    const { wrapper } = await mountEmailForm();

    expect(usersService.getRoles).toHaveBeenCalled();
    expect(wrapper.findComponent({ name: "AddUser" }).props("roles")).toEqual([
      { label: "Admin", value: "admin" },
    ]);
  });
});
