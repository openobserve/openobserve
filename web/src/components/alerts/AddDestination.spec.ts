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

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

vi.mock("@/composables/useActions", () => ({
  default: () => ({ getAllActions: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/composables/usePrebuiltDestinations", async () => {
  const { ref, computed } = await import("vue");
  return {
    usePrebuiltDestinations: () => ({
      availableTypes: computed(() => [{ id: "slack", name: "Slack" }]),
      popularTypes: computed(() => []),
      validateCredentials: vi.fn(),
      testDestination: vi.fn(),
      createDestination: hoisted.mockCreatePrebuilt,
      updateDestination: hoisted.mockUpdatePrebuilt,
      generatePreview: vi.fn(),
      isTestInProgress: ref(false),
      lastTestResult: ref(null),
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
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

let wrapper: any = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
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
          template: '<div data-test="destination-test-result-stub"></div>',
          props: ["result"],
        },
        DestinationPreview: {
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
    expect(wrapper.find('[data-test="add-destination-title"]').exists()).toBe(
      true,
    );
  });

  it("renders url/method/cancel in custom mode", async () => {
    wrapper = mountComp();
    await toCustomHttp(wrapper);
    expect(wrapper.find('[data-test="add-destination-url-input"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-test="add-destination-method-select"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-test="add-destination-cancel-btn"]').exists(),
    ).toBe(true);
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

  it("email branch: invalid emails blocked; valid emails → array payload with type=email", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "custom");
    form.setFieldValue("type", "email");
    form.setFieldValue("name", "dest-email");
    form.setFieldValue("template", "tmpl1");
    form.setFieldValue("emails", "not-an-email");
    await nextTick();

    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();

    form.setFieldValue("emails", "a@b.com, c@d.com");
    await nextTick();
    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(true);
    const payload = (destinationService.create as any).mock.calls[0][0].data;
    expect(payload.type).toBe("email");
    expect(payload.emails).toEqual(["a@b.com", "c@d.com"]);
    expect(payload.name).toBe("dest-email");
  });

  it("action branch: missing action_id blocks the save", async () => {
    // Enable the action tab for this org.
    (store.state.zoConfig as any).actions_enabled = true;
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "custom");
    form.setFieldValue("type", "action");
    form.setFieldValue("name", "dest-action");
    form.setFieldValue("template", "tmpl1");
    await nextTick();

    await form.handleSubmit();
    await flushPromises();

    expect(form.state.isValid).toBe(false);
    expect(destinationService.create).not.toHaveBeenCalled();
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
    await wrapper
      .find('[data-test="add-destination-header-kb-delete-btn"]')
      .trigger("click");
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

    await wrapper
      .find('[data-test="add-destination-header-only-delete-btn"]')
      .trigger("click");
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
    form.setFieldValue("credentials", { webhookUrl: VALID_SLACK, channel: "" });
    await nextTick();
    return form;
  }

  it("renders the credential fields inside the ONE form (no nested form)", async () => {
    wrapper = mountComp({ isAlerts: true });
    getForm(wrapper).setFieldValue("destination_type", "slack");
    await nextTick();
    expect(wrapper.find('[data-test="prebuilt-form"]').exists()).toBe(true);
    // The credential input renders (it injected the parent form context).
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(
      true,
    );
    // Exactly ONE <form> element — the nested prebuilt form is gone.
    expect(wrapper.findAll("form").length).toBe(1);
  });

  it("Save targets the ONE parent form for prebuilt types too", async () => {
    wrapper = mountComp({ isAlerts: true });
    getForm(wrapper).setFieldValue("destination_type", "slack");
    await nextTick();
    const save = wrapper.find('[data-test="add-destination-submit-btn"]');
    expect(save.attributes("form")).toBe("add-destination-form");
  });

  it("blocks the save when a required credential is empty (schema gates it)", async () => {
    wrapper = mountComp({ isAlerts: true });
    const form = getForm(wrapper);
    form.setFieldValue("destination_type", "slack");
    form.setFieldValue("name", "my-slack");
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
      { webhookUrl: VALID_SLACK, channel: "" },
      {},
      true,
      undefined,
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
      metadata: { prebuilt_type: "slack", credential_channel: "#ops" },
    };
    wrapper = mountComp({ isAlerts: true, destination: existingSlack });
    await flushPromises();
    const form = getForm(wrapper);

    // Prefill landed in the ONE form's credentials sub-object.
    expect(form.state.values.destination_type).toBe("slack");
    expect(form.state.values.credentials.webhookUrl).toBe(VALID_SLACK);
    expect(form.state.values.credentials.channel).toBe("#ops");

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
    );
    expect(hoisted.mockCreatePrebuilt).not.toHaveBeenCalled();
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
