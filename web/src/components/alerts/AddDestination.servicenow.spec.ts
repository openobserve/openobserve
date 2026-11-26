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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { query: {} } } }),
  useRoute: () => ({ params: {}, query: {} }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      update: vi.fn().mockResolvedValue({ data: { code: 200 } }),
      test: vi.fn().mockResolvedValue({ data: { success: true } }),
    },
  });
});
vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_system_templates: vi.fn().mockResolvedValue({ data: [] }),
      get_by_name: vi.fn().mockResolvedValue({ data: { body: "{}" } }),
    },
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn(), getRoles: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: { status: vi.fn(), picker: vi.fn(), testSavedDestination: vi.fn(), get: vi.fn() },
  };
});

import AddDestination from "@/components/alerts/AddDestination.vue";
import destinationService from "@/services/alert_destination";
import secrets from "@/services/secrets";
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";

const INSTANCE = "https://acme.service-now.com/api/now/table/incident";
const OLD_BASIC = `Basic ${btoa("o2-integration:hunter2")}`;
const SECRET = (name: string) => ({
  id: `id-${name}`,
  name,
  kind: "secret",
  pin_mode: "hosts",
  private_locations: "off",
  allowed_here: true,
});

const mountComp = (props: Record<string, any> = {}) =>
  mount(AddDestination, {
    props: { templates: [], destination: null, isAlerts: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        PrebuiltDestinationSelector: {
          name: "PrebuiltDestinationSelector",
          emits: ["select", "update:modelValue"],
          template: "<div />",
        },
        DestinationTestResult: {
          name: "DestinationTestResult",
          props: ["result", "isLoading"],
          template: "<div />",
        },
        AddUser: { template: "<div />" },
        DestinationPreview: { template: "<div />" },
        SecretPicker: {
          name: "SecretPicker",
          props: ["consumerType", "consumerId", "open"],
          emits: ["pick"],
          template: "<span />",
        },
      },
    },
  });

const getForm = (w: any) => w.findComponent({ name: "OForm" }).vm.form;
const picker = (w: any, dataTest: string) =>
  w
    .findAllComponents({ name: "SecretPicker" })
    .find((c: any) => c.attributes("data-test") === dataTest);
const pick = async (w: any, dataTest: string, name: string) => {
  picker(w, dataTest).vm.$emit("pick", SECRET(name));
  await flushPromises();
};

const newServiceNow = async (w: any) => {
  await flushPromises();
  const form = getForm(w);
  w.findComponent({ name: "PrebuiltDestinationSelector" }).vm.$emit("select", "servicenow");
  await nextTick();
  form.setFieldValue("name", "acme-servicenow");
  form.setFieldValue("credentials.instanceUrl", INSTANCE);
  await flushPromises();
  return form;
};

const save = async (w: any) => {
  await getForm(w).handleSubmit();
  await flushPromises();
};
const created = () => vi.mocked(destinationService.create).mock.calls[0][0].data;
const updated = () => vi.mocked(destinationService.update).mock.calls[0][0].data;

const saved = (headers: Record<string, string>, metadata: Record<string, string>) => ({
  name: "acme-servicenow",
  url: INSTANCE,
  method: "post",
  type: "http",
  template: "prebuilt_servicenow",
  destination_type_name: "servicenow",
  skip_tls_verify: false,
  headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
  metadata: { prebuilt_type: "servicenow", ...metadata },
});

const storeStatus = (store_ready: boolean, mode = "single_cluster") =>
  vi.mocked(secrets.status).mockResolvedValue({
    data: { mode, region: "", store_ready, fga: "on" },
  } as any);

let wrapper: any;

describe("AddDestination ServiceNow sign-in", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    config.isEnterprise = "true";
    storeStatus(true);
  });
  afterEach(() => {
    wrapper?.unmount();
    config.isEnterprise = "false";
  });

  it.each([
    ["the store is not ready", () => storeStatus(false)],
    ["the store runs in a super cluster", () => storeStatus(true, "super_cluster")],
    [
      "the build is OSS",
      () => {
        config.isEnterprise = "false";
      },
    ],
  ])("keeps today's form and payload when %s", async (_name, setup) => {
    setup();
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    expect(wrapper.find("[data-test='servicenow-auth-method']").exists()).toBe(false);
    expect(wrapper.find("[data-test='servicenow-password-input']").exists()).toBe(true);
    form.setFieldValue("credentials.username", "o2-integration");
    form.setFieldValue("credentials.password", "hunter2");
    await save(wrapper);
    const data = created();
    expect(data.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: OLD_BASIC,
    });
    expect(data.metadata).toEqual({ prebuilt_type: "servicenow" });
  });

  it("saves Username and password as a secret, with no Authorization header", async () => {
    const btoaSpy = vi.spyOn(window, "btoa");
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    expect(wrapper.find("[data-test='servicenow-auth-method']").exists()).toBe(true);
    expect(wrapper.find("[data-test='servicenow-password-input']").exists()).toBe(false);
    form.setFieldValue("credentials.username", "o2-integration");
    await pick(wrapper, "servicenow-password-secret-picker", "SN_PASSWORD");
    expect(
      (
        wrapper.find("[data-test='servicenow-password-secret-input'] input")
          .element as HTMLInputElement
      ).value,
    ).toBe("{{secrets.SN_PASSWORD}}");
    expect(picker(wrapper, "servicenow-password-secret-picker").props("consumerType")).toBe(
      "alert_destination",
    );
    await save(wrapper);
    const data = created();
    expect(data.headers).not.toHaveProperty("Authorization");
    expect(data.metadata).toMatchObject({
      servicenow_auth: "basic",
      servicenow_username: "o2-integration",
      servicenow_password: "{{secrets.SN_PASSWORD}}",
    });
    expect(btoaSpy).not.toHaveBeenCalled();
    btoaSpy.mockRestore();
  });

  it("saves API key as the x-sn-apikey header and nothing of the other method", async () => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2-integration");
    await pick(wrapper, "servicenow-password-secret-picker", "SN_PASSWORD");
    form.setFieldValue("credentials.authMethod", "api_key");
    await flushPromises();
    expect(wrapper.find("[data-test='servicenow-username-input']").exists()).toBe(false);
    await pick(wrapper, "servicenow-api-key-secret-picker", "SN_KEY");
    await save(wrapper);
    const data = created();
    expect(data.headers["x-sn-apikey"]).toBe("{{secrets.SN_KEY}}");
    expect(data.headers).not.toHaveProperty("Authorization");
    expect(data.metadata.servicenow_auth).toBe("api_key");
    expect(data.metadata).not.toHaveProperty("servicenow_username");
    expect(data.metadata).not.toHaveProperty("servicenow_password");
  });

  it("does not save a store method until its secret is picked", async () => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2-integration");
    await save(wrapper);
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Pick a secret.");
  });

  it("saves API key without a username", async () => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.authMethod", "api_key");
    await flushPromises();
    await pick(wrapper, "servicenow-api-key-secret-picker", "SN_KEY");
    await save(wrapper);
    expect(created().metadata.servicenow_auth).toBe("api_key");
  });

  it("refuses a colon in the username of a store method", async () => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2:integration");
    await pick(wrapper, "servicenow-password-secret-picker", "SN_PASSWORD");
    await save(wrapper);
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("The username cannot contain a colon (:).");
  });

  const UNPINNED = (name: string) => ({
    ...SECRET(name),
    pin_mode: "none",
    rights: { manage_access: true },
  });
  const BASIC_SAVED = saved(
    {},
    { servicenow_auth: "basic", servicenow_username: "o2", servicenow_password: "{{secrets.P}}" },
  );
  const bindTo = (name: string) => [
    {
      secret_id: `id-${name}`,
      allow_this_consumer: false,
      pin: ["acme.service-now.com"],
      expected_policy_rev: "rev-1",
    },
  ];

  it.each([
    ["a new basic", null, "basic", "servicenow-password-secret-picker", created],
    ["a new api_key", null, "api_key", "servicenow-api-key-secret-picker", created],
    ["an updated basic", BASIC_SAVED, "basic", "servicenow-password-secret-picker", updated],
  ])(
    "binds a pin-on-first-use secret of %s destination to the instance host",
    async (_name, destination, method, pickerId, sent) => {
      vi.mocked(secrets.get).mockResolvedValue({ data: { policy_rev: "rev-1" } } as any);
      wrapper = mountComp({ destination });
      const form = destination ? getForm(wrapper) : await newServiceNow(wrapper);
      await flushPromises();
      form.setFieldValue("credentials.authMethod", method);
      form.setFieldValue("credentials.username", "o2-integration");
      await flushPromises();
      picker(wrapper, pickerId).vm.$emit("pick", UNPINNED("SN_NEW"));
      await flushPromises();
      expect(wrapper.find("[data-test='secret-bind-box']").exists()).toBe(true);
      await save(wrapper);
      expect(sent().secret_binds).toEqual(bindTo("SN_NEW"));
    },
  );

  it("does not bind the other method's pick after a switch", async () => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2-integration");
    picker(wrapper, "servicenow-password-secret-picker").vm.$emit("pick", UNPINNED("SN_OLD"));
    await flushPromises();
    form.setFieldValue("credentials.authMethod", "api_key");
    await flushPromises();
    await pick(wrapper, "servicenow-api-key-secret-picker", "SN_KEY");
    expect(wrapper.find("[data-test='secret-bind-box']").exists()).toBe(false);
    await save(wrapper);
    expect(created()).not.toHaveProperty("secret_binds");
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it("tells the user when the secret check before save fails", async () => {
    vi.mocked(secrets.get).mockRejectedValue(new Error("Network Error"));
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2-integration");
    picker(wrapper, "servicenow-password-secret-picker").vm.$emit("pick", UNPINNED("SN_NEW"));
    await flushPromises();
    await save(wrapper);
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("shows a secret refusal on update in the form instead of a toast", async () => {
    vi.mocked(destinationService.update).mockRejectedValueOnce({
      response: { status: 409, data: { code: "consumer_not_allowed", secret: "P" } },
    });
    wrapper = mountComp({ destination: BASIC_SAVED });
    await flushPromises();
    await save(wrapper);
    expect(wrapper.find("[data-test='secret-save-refusal-code']").text()).toBe(
      "consumer_not_allowed",
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it.each([
    ["basic", "password"],
    ["api_key", "api-key"],
  ])("opens the %s secret picker from the field itself", async (method, slug) => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.authMethod", method);
    await flushPromises();
    const field = wrapper.find(`[data-test='servicenow-${slug}-secret-input']`);
    const stub = picker(wrapper, `servicenow-${slug}-secret-picker`);
    const help = field.findAll("span").find((s: any) => s.text().startsWith("Pick a secret from"));
    expect(
      stub.element.compareDocumentPosition(help!.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(stub.props("open")).toBe(false);
    await field.find("input").trigger("click");
    expect(stub.props("open")).toBe(true);
  });

  it("shows a secret refusal in the form instead of a toast", async () => {
    vi.mocked(destinationService.create).mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          code: "secret_pin_required",
          message: "pin required",
          secret: "SN_PASSWORD",
          suggested_hosts: ["acme.service-now.com"],
        },
      },
    });
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2-integration");
    await pick(wrapper, "servicenow-password-secret-picker", "SN_PASSWORD");
    await save(wrapper);
    expect(wrapper.find("[data-test='secret-save-refusal-code']").text()).toBe(
      "secret_pin_required",
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("asks for the password on Test when the store is closed", async () => {
    storeStatus(false);
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.username", "o2-integration");
    await flushPromises();
    await wrapper.find("[data-test='destination-test-button']").trigger("click");
    await flushPromises();
    expect(destinationService.test).not.toHaveBeenCalled();
    expect(
      wrapper.findComponent({ name: "DestinationTestResult" }).props("result").error,
    ).toContain("Password is required");
  });

  it("switching an API key destination to Username and password drops the key header", async () => {
    wrapper = mountComp({
      destination: saved({ "x-sn-apikey": "{{secrets.SN_KEY}}" }, { servicenow_auth: "api_key" }),
    });
    await flushPromises();
    const form = getForm(wrapper);
    expect(form.state.values.apiHeaders.map((row: any) => row.key)).not.toContain("x-sn-apikey");
    form.setFieldValue("credentials.authMethod", "basic");
    form.setFieldValue("credentials.username", "o2-integration");
    await flushPromises();
    await pick(wrapper, "servicenow-password-secret-picker", "SN_PASSWORD");
    await save(wrapper);
    const data = updated();
    expect(data.headers).not.toHaveProperty("x-sn-apikey");
    expect(data.metadata.servicenow_auth).toBe("basic");
  });

  it("opens an old destination with a warning and keeps its plain header when nothing is picked", async () => {
    wrapper = mountComp({ destination: saved({ Authorization: OLD_BASIC }, {}) });
    await flushPromises();
    expect(
      (wrapper.find("[data-test='servicenow-username-input'] input").element as HTMLInputElement)
        .value,
    ).toBe("o2-integration");
    expect(wrapper.find("[data-test='servicenow-plain-password-warning']").text()).toBe(
      "The password is stored in plain text. Pick a secret to protect it.",
    );
    expect(wrapper.html()).not.toContain("hunter2");
    await save(wrapper);
    const data = updated();
    expect(data.headers.Authorization).toBe(OLD_BASIC);
    expect(data.metadata).not.toHaveProperty("servicenow_auth");
  });

  it("picking a secret on an old destination replaces the plain header in the same save", async () => {
    wrapper = mountComp({ destination: saved({ Authorization: OLD_BASIC }, {}) });
    await flushPromises();
    await pick(wrapper, "servicenow-password-secret-picker", "SN_PASSWORD");
    expect(wrapper.find("[data-test='servicenow-plain-password-warning']").exists()).toBe(false);
    await save(wrapper);
    const data = updated();
    expect(data.headers).not.toHaveProperty("Authorization");
    expect(data.metadata).toMatchObject({
      servicenow_auth: "basic",
      servicenow_username: "o2-integration",
      servicenow_password: "{{secrets.SN_PASSWORD}}",
    });
  });

  it.each([
    ["basic", "servicenow-password-secret-picker"],
    ["api_key", "servicenow-api-key-secret-picker"],
  ])("does not test a %s draft: Save, then test", async (method, pickerId) => {
    wrapper = mountComp();
    const form = await newServiceNow(wrapper);
    form.setFieldValue("credentials.authMethod", method);
    await flushPromises();
    await pick(wrapper, pickerId, "SN_SECRET");
    const btn = wrapper.find("[data-test='destination-test-button']");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-test='destination-test-save-first']").text()).toBe(
      "Save, then test.",
    );
  });

  it.each([
    [
      "basic",
      { servicenow_auth: "basic", servicenow_username: "o2", servicenow_password: "{{secrets.P}}" },
      {},
    ],
    ["api_key", { servicenow_auth: "api_key" }, { "x-sn-apikey": "{{secrets.K}}" }],
  ])(
    "tests a saved %s destination by name, and not once it is changed",
    async (_m, metadata, headers) => {
      vi.mocked(secrets.testSavedDestination).mockResolvedValue({
        data: { ok: true, status: 201 },
      } as any);
      wrapper = mountComp({ destination: saved(headers, metadata) });
      await flushPromises();
      const btn = wrapper.find("[data-test='destination-test-button']");
      expect(btn.attributes("disabled")).toBeUndefined();
      await btn.trigger("click");
      await flushPromises();
      expect(secrets.testSavedDestination).toHaveBeenCalledWith(
        "default",
        "acme-servicenow",
        "prebuilt_servicenow",
      );
      expect(destinationService.test).not.toHaveBeenCalled();
      getForm(wrapper).setFieldValue("credentials.assignmentGroup", "IT Operations");
      await flushPromises();
      expect(
        wrapper.find("[data-test='destination-test-button']").attributes("disabled"),
      ).toBeDefined();
    },
  );
});
