// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import i18n from "@/locales";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import destinationService from "@/services/alert_destination";
import {
  addDestinationDefaults,
  makeAddDestinationSchema,
  type AddDestinationForm,
} from "./AddDestination.schema";
import SlackDestinationSetup from "./SlackDestinationSetup.vue";
import { buildSlackManifest, buildSlackManifestUrl } from "@/utils/slackManifest";

vi.mock("@/services/alert_destination", () => ({
  default: {
    startSlackOAuth: vi.fn(),
    exchangeSlackOAuth: vi.fn(),
  },
}));

const authorizationUrl =
  "https://slack.com/oauth/v2/authorize?client_id=123&scope=incoming-webhook&state=signed";
const oauthMessage = {
  type: "openobserve:slack-oauth",
  code: "temporary-code",
  state: "signed-state",
};

const Host = defineComponent({
  components: { OForm, SlackDestinationSetup },
  props: {
    isCloud: {
      type: Boolean,
      default: true,
    },
  },
  setup(props) {
    const form = useOForm({
      defaultValues: {
        ...addDestinationDefaults(),
        destination_type: "slack",
        name: "slack-alerts",
        slack_setup_method: props.isCloud ? "oauth" : "manifest",
        credentials: { webhookUrl: "", channel: "" },
      },
      schema: makeAddDestinationSchema((key: string) => key, true),
      onSubmit: (_value: AddDestinationForm) => undefined,
    });

    return { form };
  },
  template: `
    <OForm :form="form">
      <SlackDestinationSetup org-identifier="acme" :is-cloud="isCloud" />
    </OForm>
  `,
});

const makePopup = (): Window =>
  ({
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    location: { href: "about:blank" },
  }) as unknown as Window;

const mountSetup = (isCloud = true) =>
  mount(Host, {
    props: { isCloud },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });

let wrapper: ReturnType<typeof mountSetup> | null = null;
let popup: Window;

beforeEach(() => {
  vi.clearAllMocks();
  popup = makePopup();
  vi.spyOn(window, "open").mockReturnValue(popup);
  vi.mocked(destinationService.startSlackOAuth).mockResolvedValue({
    data: { authorizationUrl },
  });
  vi.mocked(destinationService.exchangeSlackOAuth).mockResolvedValue({
    data: {
      webhookUrl: "https://hooks.slack.com/services/T123/C123/secret",
      channel: "alerts",
      channelId: "C123",
      teamId: "T123",
      teamName: "Acme",
    },
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SlackDestinationSetup OAuth flow", () => {
  it("defaults to OAuth without asking for a webhook URL", () => {
    wrapper = mountSetup();

    expect(wrapper.vm.form.state.values.slack_setup_method).toBe("oauth");
    expect(wrapper.find('[data-test="add-destination-name-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-oauth-connect-button"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-setup-method-manifest"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-manifest-stepper"]').exists()).toBe(false);
  });

  it("uses radio semantics and keeps the existing-webhook fallback", async () => {
    wrapper = mountSetup();
    const radios = wrapper.findAll('[role="radio"]');

    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true);
    expect(radios).toHaveLength(2);
    expect(radios[0].attributes("aria-checked")).toBe("true");

    await radios[1].trigger("click");

    expect(wrapper.vm.form.state.values.slack_setup_method).toBe("webhook");
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-channel-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-webhook-url-input"] input').attributes("type")).toBe(
      "password",
    );
  });

  it("opens a popup synchronously and navigates it to the backend authorization URL", async () => {
    wrapper = mountSetup();

    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");

    expect(window.open).toHaveBeenCalledWith(
      "",
      "openobserve-slack-oauth",
      expect.stringContaining("popup"),
    );
    expect(destinationService.startSlackOAuth).toHaveBeenCalledWith({
      org_identifier: "acme",
    });
    await flushPromises();
    expect(popup.location.href).toBe(authorizationUrl);
  });

  it("does not start OAuth when the browser blocks the popup", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    wrapper = mountSetup();

    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");

    expect(destinationService.startSlackOAuth).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);
  });

  it("accepts the callback only from the popup and exact origin", async () => {
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://attacker.example.com",
        source: popup,
        data: oauthMessage,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: makePopup(),
        data: oauthMessage,
      }),
    );
    await flushPromises();

    expect(destinationService.exchangeSlackOAuth).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data: oauthMessage,
      }),
    );
    await flushPromises();

    expect(destinationService.exchangeSlackOAuth).toHaveBeenCalledWith({
      org_identifier: "acme",
      code: "temporary-code",
      state: "signed-state",
    });
  });

  it.each([
    ["wrong type", { ...oauthMessage, type: "other" }],
    ["blank code", { ...oauthMessage, code: "" }],
    ["missing code", { type: oauthMessage.type, state: oauthMessage.state }],
    ["blank state", { ...oauthMessage, state: "" }],
    ["missing state", { type: oauthMessage.type, code: oauthMessage.code }],
  ])("ignores a same-origin popup message with %s", async (_case, data) => {
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data,
      }),
    );
    await flushPromises();

    expect(destinationService.exchangeSlackOAuth).not.toHaveBeenCalled();
  });

  it("populates the secret in form memory and displays only workspace and channel", async () => {
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data: oauthMessage,
      }),
    );
    await flushPromises();
    await nextTick();

    expect(wrapper.vm.form.state.values.credentials).toEqual({
      webhookUrl: "https://hooks.slack.com/services/T123/C123/secret",
      channel: "alerts",
    });
    expect(wrapper.vm.form.state.values.slack_team_id).toBe("T123");
    expect(wrapper.vm.form.state.values.slack_team_name).toBe("Acme");
    expect(wrapper.vm.form.state.values.slack_channel_id).toBe("C123");
    expect(wrapper.find('[data-test="slack-oauth-connected"]').text()).toContain("Acme");
    expect(wrapper.find('[data-test="slack-oauth-connected"]').text()).toContain("alerts");
    expect(wrapper.text()).not.toContain("hooks.slack.com");
    expect(wrapper.find('[data-test="slack-oauth-reconnect-button"]').exists()).toBe(true);
  });

  it("clears a connected OAuth credential and workspace metadata when switching methods", async () => {
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data: oauthMessage,
      }),
    );
    await flushPromises();

    await wrapper.find('[data-test="slack-setup-method-webhook"]').trigger("click");

    expect(wrapper.vm.form.state.values.credentials).toEqual({ webhookUrl: "", channel: "" });
    expect(wrapper.vm.form.state.values.slack_team_id).toBe("");
    expect(wrapper.vm.form.state.values.slack_team_name).toBe("");
    expect(wrapper.vm.form.state.values.slack_channel_id).toBe("");
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);
  });

  it("does not exchange a denied authorization", async () => {
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data: {
          type: "openobserve:slack-oauth",
          error: "access_denied",
        },
      }),
    );
    await flushPromises();

    expect(destinationService.exchangeSlackOAuth).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);
    expect(popup.close).toHaveBeenCalled();
  });

  it("returns to disconnected state when the user closes the popup", async () => {
    vi.useFakeTimers();
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();

    Object.assign(popup, { closed: true });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(destinationService.exchangeSlackOAuth).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="slack-oauth-connect-button"]').attributes("data-loading"),
    ).not.toBe("true");
  });

  it("accepts a queued callback after the popup closes but before the close grace expires", async () => {
    vi.useFakeTimers();
    wrapper = mountSetup();
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();

    Object.assign(popup, { closed: true });
    await vi.advanceTimersByTimeAsync(500);
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data: oauthMessage,
      }),
    );
    await flushPromises();

    expect(destinationService.exchangeSlackOAuth).toHaveBeenCalledWith({
      org_identifier: "acme",
      code: "temporary-code",
      state: "signed-state",
    });
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(true);
  });

  it("closes the popup and stays disconnected when start or exchange fails", async () => {
    vi.mocked(destinationService.startSlackOAuth).mockRejectedValueOnce(new Error("unconfigured"));
    wrapper = mountSetup();

    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();
    expect(popup.close).toHaveBeenCalled();
    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);

    popup = makePopup();
    vi.mocked(window.open).mockReturnValue(popup);
    vi.mocked(destinationService.exchangeSlackOAuth).mockRejectedValueOnce(new Error("bad code"));
    await wrapper.find('[data-test="slack-oauth-connect-button"]').trigger("click");
    await flushPromises();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: popup,
        data: oauthMessage,
      }),
    );
    await flushPromises();

    expect(wrapper.find('[data-test="slack-oauth-connected"]').exists()).toBe(false);
  });
});

describe("SlackDestinationSetup self-hosted manifest flow", () => {
  it("defaults to manifest and never renders the Cloud OAuth action", () => {
    wrapper = mountSetup(false);

    expect(wrapper.vm.form.state.values.slack_setup_method).toBe("manifest");
    expect(wrapper.find('[data-test="slack-setup-method-manifest"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-setup-method-oauth"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-oauth-connect-button"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="slack-manifest-stepper"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-app-name-input"]').exists()).toBe(true);
    expect(wrapper.vm.form.state.values.slack_app_name).toBe("OpenObserve Alerts");
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
    expect(destinationService.startSlackOAuth).not.toHaveBeenCalled();
    expect(destinationService.exchangeSlackOAuth).not.toHaveBeenCalled();
  });

  it("does not generate a manifest for a blank or overlong Slack app name", async () => {
    wrapper = mountSetup(false);
    const continueButton = () => wrapper?.find('[data-test="slack-manifest-continue-button"]');

    wrapper.vm.form.setFieldValue("slack_app_name", "");
    await nextTick();
    expect(continueButton()?.attributes("disabled")).toBeDefined();

    wrapper.vm.form.setFieldValue("name", "");
    wrapper.vm.form.setFieldValue("slack_app_name", "Operations Alerts");
    await nextTick();
    expect(continueButton()?.attributes("disabled")).toBeDefined();

    wrapper.vm.form.setFieldValue("name", "slack-alerts");

    wrapper.vm.form.setFieldValue("slack_app_name", "x".repeat(36));
    await nextTick();
    expect(continueButton()?.attributes("disabled")).toBeDefined();

    wrapper.vm.form.setFieldValue("slack_app_name", "   ");
    await nextTick();
    expect(continueButton()?.attributes("disabled")).toBeDefined();

    wrapper.vm.form.setFieldValue("slack_app_name", `  ${"x".repeat(35)}  `);
    await nextTick();
    expect(continueButton()?.attributes("disabled")).toBeUndefined();

    wrapper.vm.form.setFieldValue("slack_app_name", "Operations Alerts");
    await nextTick();
    expect(continueButton()?.attributes("disabled")).toBeUndefined();
  });

  it("moves forward and back without losing the Slack app name", async () => {
    wrapper = mountSetup(false);
    wrapper.vm.form.setFieldValue("name", "operations-slack");
    wrapper.vm.form.setFieldValue("slack_app_name", "Operations Alerts");
    await nextTick();

    await wrapper.find('[data-test="slack-manifest-continue-button"]').trigger("click");
    expect(wrapper.find('[data-test="slack-manifest-code"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-manifest-code"]').text()).toContain("Operations Alerts");

    await wrapper.find('[data-test="slack-manifest-back-button"]').trigger("click");
    expect(wrapper.find('[data-test="slack-app-name-input"]').exists()).toBe(true);
    expect(wrapper.vm.form.state.values.slack_app_name).toBe("Operations Alerts");
    expect(wrapper.vm.form.state.values.name).toBe("operations-slack");
  });

  it("opens the exact Slack manifest link and advances to the masked webhook handoff", async () => {
    wrapper = mountSetup(false);
    wrapper.vm.form.setFieldValue("slack_app_name", "Operations Alerts");
    await nextTick();
    await wrapper.find('[data-test="slack-manifest-continue-button"]').trigger("click");
    const openSlack = wrapper.find('[data-test="slack-manifest-open-slack"]');
    const url = new URL(openSlack.attributes("href"));

    expect(`${url.origin}${url.pathname}`).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect([...url.searchParams.keys()].sort()).toEqual(["manifest_json", "new_app"]);
    expect(JSON.parse(url.searchParams.get("manifest_json") ?? "")).toEqual(
      buildSlackManifest("Operations Alerts"),
    );
    expect(openSlack.attributes("href")).toBe(buildSlackManifestUrl("Operations Alerts"));

    await openSlack.trigger("click");
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-webhook-url-input"] input').attributes("type")).toBe(
      "password",
    );
    expect(wrapper.find('[data-test="slack-manifest-where-to-find"]').text()).toContain(
      "Incoming Webhooks",
    );
    expect(openSlack.attributes("target")).toBe("_blank");
    expect(openSlack.attributes("rel")).toContain("noopener");

    await wrapper.find('[data-test="slack-manifest-back-button"]').trigger("click");
    expect(wrapper.find('[data-test="slack-manifest-code"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
  });

  it("keeps the existing-webhook fallback and returns to a fresh manifest flow", async () => {
    wrapper = mountSetup(false);
    await wrapper.find('[data-test="slack-manifest-continue-button"]').trigger("click");
    await wrapper.find('[data-test="slack-manifest-open-slack"]').trigger("click");
    wrapper.vm.form.setFieldValue(
      "credentials.webhookUrl",
      "https://hooks.slack.com/services/T000/B000/secret",
    );
    await wrapper.find('[data-test="slack-setup-method-webhook"]').trigger("click");

    expect(wrapper.vm.form.state.values.slack_setup_method).toBe("webhook");
    expect(wrapper.vm.form.state.values.credentials.webhookUrl).toBe("");
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(true);

    await wrapper.find('[data-test="slack-setup-method-manifest"]').trigger("click");
    expect(wrapper.vm.form.state.values.slack_setup_method).toBe("manifest");
    expect(wrapper.find('[data-test="slack-app-name-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slack-webhook-url-input"]').exists()).toBe(false);
    expect(destinationService.startSlackOAuth).not.toHaveBeenCalled();
    expect(destinationService.exchangeSlackOAuth).not.toHaveBeenCalled();
  });
});
