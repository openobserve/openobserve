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
      test: vi.fn().mockResolvedValue({ data: { code: 200 } }),
    },
  });
});
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn(), getRoles: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

const { testCustom, createPrebuilt, updatePrebuilt } = vi.hoisted(() => ({
  testCustom: vi.fn(),
  createPrebuilt: vi.fn(),
  updatePrebuilt: vi.fn(),
}));
vi.mock("@/composables/usePrebuiltDestinations", async () => {
  const { computed } = await import("vue");
  return {
    usePrebuiltDestinations: () => ({
      availableTypes: computed(() => []),
      popularTypes: computed(() => []),
      validateCredentials: vi.fn(),
      testDestination: vi.fn(),
      createDestination: createPrebuilt,
      updateDestination: updatePrebuilt,
      generatePreview: vi.fn(),
      testCustomDestination: testCustom,
      renderTemplateBody: vi.fn(),
      clearTestResult: vi.fn(),
      isTestInProgress: computed(() => false),
      lastTestResult: computed(() => null),
      detectPrebuiltType: vi.fn(),
      getPrebuiltConfig: vi.fn(),
      isPrebuiltType: vi.fn(),
      generateDestinationUrl: vi.fn(),
      generateDestinationHeaders: vi.fn(),
    }),
  };
});

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

const mountComp = (props: Record<string, any> = {}) =>
  mount(AddDestination, {
    props: { templates: [], destination: null, isAlerts: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        PrebuiltDestinationSelector: { template: "<div />" },
        DestinationTestResult: { template: "<div />" },
        AddUser: { template: "<div />" },
        DestinationPreview: { template: "<div />" },
        AppTabs: { template: "<div />" },
        SecretPicker: {
          name: "SecretPicker",
          props: ["consumerType", "consumerId"],
          emits: ["pick"],
          template: "<span data-test='picker-stub' />",
        },
      },
    },
  });

const getForm = (w: any) => w.findComponent({ name: "OForm" }).vm.form;
const toWebhook = async (w: any) => {
  const form = getForm(w);
  form.setFieldValue("destination_type", "custom");
  form.setFieldValue("type", "http");
  await nextTick();
  return form;
};

const SAVED = {
  name: "pd-checkout",
  url: "https://events.pagerduty.com/v2/enqueue",
  method: "post",
  type: "http",
  template: "tmpl1",
  headers: { Authorization: "Token token={{secrets.PD_KEY}}" },
  skip_tls_verify: false,
};

let wrapper: any;

describe("AddDestination with secrets", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    config.isEnterprise = "true";
    vi.mocked(secrets.status).mockResolvedValue({
      data: { mode: "single_cluster", region: "", store_ready: true, fga: "on" },
    } as any);
  });
  afterEach(() => {
    wrapper?.unmount();
    config.isEnterprise = "false";
  });

  it("offers the picker on header values once the store is ready", async () => {
    wrapper = mountComp();
    await toWebhook(wrapper);
    await flushPromises();
    const picker = wrapper.findComponent({ name: "SecretPicker" });
    expect(picker.exists()).toBe(true);
    expect(picker.props("consumerType")).toBe("alert_destination");
  });

  it("keeps the header picker beside the input in a nonwrapping row", async () => {
    wrapper = mountComp();
    await toWebhook(wrapper);
    await flushPromises();

    const cell = wrapper.find("[data-test='add-destination-header-0-value']");
    const picker = cell.findComponent({ name: "SecretPicker" });
    expect(cell.classes()).toEqual(expect.arrayContaining(["flex", "flex-nowrap"]));
    expect(picker.element.parentElement).toBe(cell.element);
    const field = cell.find("[data-test$='-value-input']");
    expect(field.classes()).toContain("min-w-0");
    expect(field.element.parentElement).toBe(cell.element);
  });

  it.each(["create", "update"])(
    "passes first-use secret binds to the prebuilt %s path",
    async (operation) => {
      vi.mocked(secrets.get).mockResolvedValue({ data: { policy_rev: "rev-9" } } as never);
      wrapper = mountComp(operation === "update" ? { destination: SAVED } : {});
      await flushPromises();
      const form = await toWebhook(wrapper);
      form.setFieldValue("name", "ops-notice");
      form.setFieldValue("url", "https://notify.example.com/hooks/ops");
      form.setFieldValue("apiHeaders", [{ key: "Authorization", value: "Bearer " }]);
      await flushPromises();
      wrapper.findComponent({ name: "SecretPicker" }).vm.$emit("pick", {
        id: "s1",
        name: "NOTIFY_TOKEN",
        kind: "secret",
        pin_mode: "none",
        private_locations: "off",
        allowed_here: false,
        rights: { manage: true, manage_access: true },
      });
      form.setFieldValue("destination_type", "slack");
      form.setFieldValue("slack_setup_method", "webhook");
      form.setFieldValue("credentials", {
        webhookUrl: "https://hooks.slack.com/services/T000/B000/token",
      });
      await flushPromises();
      await form.handleSubmit();
      await flushPromises();

      const save = operation === "create" ? createPrebuilt : updatePrebuilt;
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0].at(-1)).toEqual([
        {
          secret_id: "s1",
          allow_this_consumer: true,
          pin: ["notify.example.com"],
          expected_policy_rev: "rev-9",
        },
      ]);
    },
  );

  it.each([
    { operation: "create", failure: "save" },
    { operation: "update", failure: "save" },
    { operation: "create", failure: "bind" },
  ])(
    "shows a secret refusal from prebuilt $operation during $failure",
    async ({ operation, failure }) => {
      const error = {
        response: {
          status: 403,
          data: { code: "secret_use_denied", message: "Use denied", secret: "NOTIFY_TOKEN" },
        },
      };
      const save = operation === "create" ? createPrebuilt : updatePrebuilt;
      if (failure === "save") save.mockRejectedValueOnce(error);
      else vi.mocked(secrets.get).mockRejectedValueOnce(error);
      wrapper = mountComp(operation === "update" ? { destination: SAVED } : {});
      await flushPromises();
      const form = await toWebhook(wrapper);
      form.setFieldValue("name", "ops-notice");
      form.setFieldValue("url", "https://notify.example.com/hooks/ops");
      form.setFieldValue("apiHeaders", [{ key: "Authorization", value: "Bearer " }]);
      await flushPromises();
      wrapper.findComponent({ name: "SecretPicker" }).vm.$emit("pick", {
        id: "s1",
        name: "NOTIFY_TOKEN",
        kind: "secret",
        pin_mode: failure === "bind" ? "none" : "hosts",
        private_locations: "off",
        allowed_here: true,
        rights: { manage: true, manage_access: true },
      });
      form.setFieldValue("destination_type", "slack");
      form.setFieldValue("slack_setup_method", "webhook");
      form.setFieldValue("credentials", {
        webhookUrl: "https://hooks.slack.com/services/T000/B000/token",
      });
      await flushPromises();
      await form.handleSubmit();
      await flushPromises();

      expect(wrapper.find("[data-test='secret-save-refusal-code']").text()).toBe(
        "secret_use_denied",
      );
      expect(wrapper.find("[data-test='secret-save-refusal']").text()).toContain("Use denied");
      expect(wrapper.emitted("refresh:destinations")).toBeUndefined();
    },
  );

  it("uses pipeline_destination for a pipeline destination", async () => {
    wrapper = mountComp({ isAlerts: false });
    await toWebhook(wrapper);
    await flushPromises();
    expect(wrapper.findComponent({ name: "SecretPicker" }).props("consumerType")).toBe(
      "pipeline_destination",
    );
  });

  it("hides the picker while the store is not ready", async () => {
    vi.mocked(secrets.status).mockResolvedValue({
      data: { mode: "single_cluster", region: "", store_ready: false, fga: "on" },
    } as any);
    wrapper = mountComp();
    await toWebhook(wrapper);
    await flushPromises();
    expect(wrapper.findComponent({ name: "SecretPicker" }).exists()).toBe(false);
  });

  it("inserts the picked ref into the header value", async () => {
    wrapper = mountComp();
    const form = await toWebhook(wrapper);
    form.setFieldValue("apiHeaders", [{ key: "Authorization", value: "Token token=" }]);
    await flushPromises();
    wrapper.findComponent({ name: "SecretPicker" }).vm.$emit("pick", {
      id: "s1",
      name: "PD_KEY",
      kind: "secret",
      pin_mode: "hosts",
      private_locations: "off",
      allowed_here: true,
    });
    await flushPromises();
    expect(form.state.values.apiHeaders[0].value).toBe("Token token={{secrets.PD_KEY}}");
  });

  it("keys header inputs by row index, not by the typed name", async () => {
    wrapper = mountComp();
    const form = await toWebhook(wrapper);
    form.setFieldValue("apiHeaders", [{ key: "Authorization", value: "v" }]);
    await flushPromises();
    const key = wrapper.find("[data-test='add-destination-header-0-key'] input");
    expect((key.element as HTMLInputElement).value).toBe("Authorization");
    expect(wrapper.find("[data-test='add-destination-header-0-value'] input").exists()).toBe(true);
    expect(
      wrapper
        .find("[data-test='add-destination-header-0-actions'] [data-test$='-delete-btn']")
        .exists(),
    ).toBe(true);
  });

  it("refuses to test a draft that carries a secret: Save, then test", async () => {
    wrapper = mountComp();
    const form = await toWebhook(wrapper);
    form.setFieldValue("url", "https://events.pagerduty.com/v2/enqueue");
    form.setFieldValue("apiHeaders", [
      { key: "Authorization", value: "Token token={{secrets.PD_KEY}}" },
    ]);
    await flushPromises();
    const btn = wrapper.find("[data-test='destination-test-button']");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-test='destination-test-save-first']").text()).toBe(
      "Save, then test.",
    );
    await btn.trigger("click");
    expect(testCustom).not.toHaveBeenCalled();
    expect(secrets.testSavedDestination).not.toHaveBeenCalled();
  });

  it("tests a saved, unchanged destination and shows only the status", async () => {
    vi.mocked(secrets.testSavedDestination).mockResolvedValue({
      data: { ok: false, status: 401, class: "http_4xx" },
    } as any);
    wrapper = mountComp({ destination: SAVED });
    await flushPromises();
    const btn = wrapper.find("[data-test='destination-test-button']");
    expect(btn.attributes("disabled")).toBeUndefined();
    await btn.trigger("click");
    await flushPromises();
    expect(secrets.testSavedDestination).toHaveBeenCalledWith("default", "pd-checkout", "tmpl1");
    expect(testCustom).not.toHaveBeenCalled();
    expect(wrapper.find("[data-test='destination-test-status-only']").text()).toBe(
      "Failed: http_4xx (401)",
    );
  });

  it("shows a secret_pin_required refusal in context instead of a toast", async () => {
    vi.mocked(destinationService.create).mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          code: "secret_pin_required",
          message: "pin required",
          secret: "SNOW_CHANGES_BASIC",
          suggested_hosts: ["acme.service-now.com"],
        },
      },
    });
    wrapper = mountComp();
    const form = await toWebhook(wrapper);
    form.setFieldValue("name", "snow-changes");
    form.setFieldValue("url", "https://acme.service-now.com/api");
    form.setFieldValue("method", "post");
    form.setFieldValue("template", "tmpl1");
    form.setFieldValue("apiHeaders", [
      { key: "Authorization", value: "Basic {{secrets.SNOW_CHANGES_BASIC}}" },
    ]);
    await nextTick();
    await form.handleSubmit();
    await flushPromises();
    expect(wrapper.find("[data-test='secret-save-refusal']").text()).toContain(
      "SNOW_CHANGES_BASIC has no host pin yet. Ask a manage-access holder to pin it to acme.service-now.com.",
    );
    expect(wrapper.find("[data-test='secret-save-refusal-code']").text()).toBe(
      "secret_pin_required",
    );
  });
});
