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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import slack from "@/services/slack";
import SlackSelfHostedWizard from "./SlackSelfHostedWizard.vue";
import {
  ConfirmDialogStub,
  OTableStub,
  axiosError,
  fakePopup,
  installationView,
  linkingView,
  makeSlackStore,
  ok,
  postCallback,
  selfHostedSettingsExchange,
} from "@/test/unit/helpers/slack";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { InstallationView } from "@/types/slack";

vi.mock("@/services/slack", () => ({
  default: {
    getPrerequisites: vi.fn(),
    checkConnectivity: vi.fn(),
    getManifest: vi.fn(),
    createInstallation: vi.fn(),
    getInstallUrl: vi.fn(),
    installExchange: vi.fn(),
    updateCredentials: vi.fn(),
    uninstallInstallation: vi.fn(),
    testInstallation: vi.fn(),
    startConnection: vi.fn(),
    confirmConnection: vi.fn(),
    getLinking: vi.fn(),
    updateLinking: vi.fn(),
    linkAll: vi.fn(),
    connectInstallation: vi.fn(),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(),
}));

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize?client_id=1.2&scope=chat:write&state=s";
const pending = installationView({ status: "pending", app_token_state: "missing" });
let popup: Window;

const passing = [
  {
    id: "master_key",
    status: "pass",
    detail: "Set",
    variable: "O2_MASTER_ENCRYPTION_KEY",
    fix: null,
  },
  {
    id: "web_url",
    status: "warn",
    detail: "Is http://localhost:5080",
    variable: "ZO_WEB_URL",
    fix: null,
  },
];

const errorHandler = vi.fn();

const mountWizard = async (
  installation: InstallationView | null = null,
  email = "ana@acme.example",
) => {
  const w = mount(SlackSelfHostedWizard, {
    props: { installation },
    attachTo: document.body,
    global: {
      plugins: [i18n, makeSlackStore({ slack_enabled: true }, email)],
      config: { errorHandler },
      stubs: { OTable: OTableStub, ConfirmDialog: ConfirmDialogStub },
    },
  });
  await flushPromises();
  return w;
};

const next = async (w: VueWrapper) => {
  await w.find('[data-test="slack-wizard-next"]').trigger("click");
  await flushPromises();
};

const step = (w: VueWrapper) => w.find('[data-test="slack-wizard"]').attributes("data-step");

beforeEach(() => {
  vi.clearAllMocks();
  popup = fakePopup();
  vi.spyOn(window, "open").mockReturnValue(popup);
  vi.mocked(slack.getPrerequisites).mockReturnValue(ok({ checks: passing }) as any);
  vi.mocked(slack.checkConnectivity).mockReturnValue(
    ok({
      checks: [{ host: "slack.com", status: "pass", detail: "Reached through proxy" }],
      proxy: "http://proxy.internal:3128",
      ca_bundle: null,
      socket_url_host: "wss-primary.slack.com",
    }) as any,
  );
  vi.mocked(slack.getManifest).mockReturnValue(
    ok({
      display_information: { name: "OpenObserve" },
      settings: { socket_mode_enabled: true },
    }) as any,
  );
  vi.mocked(slack.createInstallation).mockReturnValue(
    ok({
      installation: pending,
      authorize_url: AUTHORIZE_URL,
      app_settings_url: "https://api.slack.com/apps/A0SAMPLE01/general",
    }) as any,
  );
  vi.mocked(slack.getInstallUrl).mockReturnValue(ok({ authorize_url: AUTHORIZE_URL }) as any);
  vi.mocked(slack.installExchange).mockReturnValue(
    ok({
      installation: installationView({ app_token_state: "missing" }),
      destination: null,
      channel_default_set: false,
      linking: linkingView(),
      link_all: null,
    }) as any,
  );
  vi.mocked(slack.updateCredentials).mockReturnValue(ok(installationView()) as any);
  vi.mocked(slack.uninstallInstallation).mockReturnValue(
    ok({ revoked: true, affected: { orgs: 1, destinations: [], links_revoked: 0 } }) as any,
  );
  vi.mocked(slack.testInstallation).mockReturnValue(
    ok({
      checks: [{ id: "auth_test", status: "pass", detail: "Bot token works" }],
      test_post: null,
    }) as any,
  );
  vi.mocked(slack.startConnection).mockReturnValue(ok({ url: AUTHORIZE_URL }) as any);
  vi.mocked(slack.confirmConnection).mockReturnValue(ok({ test: "pass" }) as any);
  vi.mocked(slack.getLinking).mockReturnValue(
    ok(linkingView({ enabled: false, domains: [] })) as any,
  );
  vi.mocked(slack.updateLinking).mockReturnValue(ok(linkingView()) as any);
  vi.mocked(slack.linkAll).mockReturnValue(ok({ linked: 4, complete: true }) as any);
  vi.mocked(slack.connectInstallation).mockReturnValue(
    ok({ connected: true, destination: null, channel_default_set: false }) as any,
  );
});

const lastToast = () => vi.mocked(toast).mock.calls.at(-1)?.[0];

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SlackSelfHostedWizard Step 0", () => {
  it("W-S6 shows a retryable load error when the checks cannot be read", async () => {
    vi.mocked(slack.getPrerequisites).mockReturnValue(Promise.reject(axiosError(500)) as any);
    const w = await mountWizard();
    const error = w.find('[data-test="slack-wizard-prereq-error"]');
    expect(error.text()).toContain("The prerequisite checks could not run.");
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeDefined();

    vi.mocked(slack.getPrerequisites).mockReturnValue(ok({ checks: passing }) as any);
    await error.find("button").trigger("click");
    await flushPromises();
    expect(slack.getPrerequisites).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test="slack-wizard-prereq-error"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeUndefined();
  });

  it("AC-7.1 runs the prerequisite checks and lets a warning through", async () => {
    const w = await mountWizard();
    expect(step(w)).toBe("0");
    expect(slack.getPrerequisites).toHaveBeenCalledWith("acme", undefined);
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeUndefined();
  });

  it("R-37 the no-Helm hint names only the master key, never a super-cluster key", async () => {
    const w = await mountWizard();
    expect(w.text()).toContain(
      "Installed without Helm? Set O2_MASTER_ENCRYPTION_KEY, restart, then Re-check.",
    );
    expect(w.text()).not.toMatch(/super.cluster|replicat|O2_SUPER_CLUSTER_SECRET_KEY/i);
  });

  it("AC-7.1 blocks Next while a check fails", async () => {
    vi.mocked(slack.getPrerequisites).mockReturnValue(
      ok({
        checks: [
          {
            id: "master_key",
            status: "fail",
            detail: "Not set",
            variable: "O2_MASTER_ENCRYPTION_KEY",
            fix: "openssl rand -base64 64",
          },
        ],
      }) as any,
    );
    const w = await mountWizard();
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeDefined();
  });

  it("cancels back to the connect screen", async () => {
    const w = await mountWizard();
    await w.find('[data-test="slack-wizard-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toHaveLength(1);
  });
});

describe("SlackSelfHostedWizard Step 1", () => {
  it("checks connectivity from the server and names the proxy and socket host", async () => {
    const w = await mountWizard();
    await next(w);
    expect(step(w)).toBe("1");
    expect(slack.checkConnectivity).toHaveBeenCalledWith("acme", {});
    const text = w.find('[data-test="slack-wizard-connectivity"]').text();
    expect(text).toContain("slack.com");
    expect(text).toContain("http://proxy.internal:3128");
    expect(text).toContain("wss-primary.slack.com");
  });

  it("blocks Next while a host is unreachable", async () => {
    vi.mocked(slack.checkConnectivity).mockReturnValue(
      ok({
        checks: [{ host: "slack.com", status: "fail", detail: "Timed out" }],
        proxy: null,
        ca_bundle: null,
        socket_url_host: null,
      }) as any,
    );
    const w = await mountWizard();
    await next(w);
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeDefined();
  });
});

describe("SlackSelfHostedWizard Step 2", () => {
  const toStep2 = async () => {
    const w = await mountWizard();
    await next(w);
    await next(w);
    return w;
  };

  it("AC-7.9 the main path asks for one configuration token and never for a bot token, client ID or secrets", async () => {
    const w = await toStep2();
    expect(step(w)).toBe("2");
    expect(w.find('[data-test="slack-wizard-config-token"]').exists()).toBe(true);
    for (const field of [
      "client-id",
      "client-secret",
      "signing-secret",
      "app-token",
      "bot-token",
    ]) {
      expect(w.find(`[data-test="slack-wizard-${field}"]`).exists()).toBe(false);
    }
    expect(w.text()).not.toMatch(/xoxb/);
  });

  it("AC-7.3 creates the app from the configuration token and moves to Install", async () => {
    const w = await toStep2();
    await w.find('[data-test="slack-wizard-config-token"] input').setValue("xoxe-1-sample");
    await w.find('[data-test="slack-wizard-create-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.createInstallation).toHaveBeenCalledWith("acme", {
        mode: "socket",
        config_refresh_token: "xoxe-1-sample",
        channel_history: true,
      }),
    );
    await flushPromises();
    expect(step(w)).toBe("3");
    expect(w.text()).toContain("App created · A0SAMPLE01");
  });

  it("AC-7.9 Set up manually asks for the client ID and secret and links the prefilled manifest", async () => {
    const w = await toStep2();
    await w.find('[data-test="slack-wizard-manual"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="slack-wizard-config-token"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-wizard-client-id"]').exists()).toBe(true);
    expect(w.find('[data-test="slack-wizard-client-secret"]').exists()).toBe(true);
    expect(w.find('[data-test="slack-wizard-app-token"]').exists()).toBe(true);
    expect(slack.getManifest).toHaveBeenCalledWith("acme", {
      mode: "socket",
      channel_history: true,
    });
    expect(w.find('[data-test="slack-wizard-open-manifest"]').attributes("href")).toMatch(
      /^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_json=/,
    );

    await w.find('[data-test="slack-wizard-client-id"] input').setValue("1.2");
    await w.find('[data-test="slack-wizard-client-secret"] input').setValue("sec");
    await w.find('[data-test="slack-wizard-create-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.createInstallation).toHaveBeenCalledWith("acme", {
        mode: "socket",
        client_id: "1.2",
        client_secret: "sec",
      }),
    );
  });

  it("refuses a manual HTTP app without its signing secret", async () => {
    const w = await toStep2();
    await w.find('[data-test="slack-wizard-mode-http"]').trigger("click");
    await w.find('[data-test="slack-wizard-manual"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="slack-wizard-client-id"] input').setValue("1.2");
    await w.find('[data-test="slack-wizard-client-secret"] input').setValue("sec");
    await w.find('[data-test="slack-wizard-create-form"]').trigger("submit");
    await vi.waitFor(() => expect(w.text()).toContain("HTTP mode needs the signing secret"));
    expect(slack.createInstallation).not.toHaveBeenCalled();
  });

  it("swaps the consent line when the bot may not read thread replies", async () => {
    const w = await toStep2();
    expect(w.find('[data-test="slack-wizard-consent"]').text()).toContain(
      "never reads other channel history",
    );
    await w.find('[data-test="slack-wizard-channel-history"] button').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="slack-wizard-consent"]').text()).toContain(
      "only when you mention @OpenObserve",
    );
  });
});

describe("SlackSelfHostedWizard Step 1 failures", () => {
  it("NIT-7 a connectivity check that fails to run blocks Next without an unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    vi.mocked(slack.checkConnectivity).mockImplementation(() => Promise.reject(axiosError(500)));
    try {
      const w = await mountWizard();
      await next(w);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(step(w)).toBe("1");
      expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeDefined();
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(rejections).toEqual([]);
  });
});

describe("SlackSelfHostedWizard Step 3", () => {
  it("W-S5 an already-installed workspace connects with the ticket and removes the pending app", async () => {
    vi.mocked(slack.installExchange).mockReturnValue(
      ok({
        already_installed: {
          installation_id: "inst-7",
          team_name: "Acme Corp",
          this_org_connected: false,
        },
        connect_ticket: "ticket-1",
      }) as any,
    );
    const w = await mountWizard(pending);
    await w.find('[data-test="slack-wizard-allow"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();

    expect(w.find('[data-test="slack-wizard-installed"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeDefined();
    const banner = w.find('[data-test="slack-wizard-already-installed"]');
    expect(banner.text()).toContain("Acme Corp is already installed for another organization");

    await banner.find('[data-test="slack-wizard-connect-ticket"]').trigger("click");
    await flushPromises();
    expect(slack.connectInstallation).toHaveBeenCalledWith("acme", "inst-7", {
      connect_ticket: "ticket-1",
    });
    expect(slack.uninstallInstallation).toHaveBeenCalledWith("acme", "inst-1");
    expect(w.emitted("done")).toHaveLength(1);
  });

  it("NIT-13 shows the server's reason when Slack refuses the install", async () => {
    vi.mocked(slack.installExchange).mockReturnValue(
      Promise.reject(axiosError(409, "These credentials belong to another Slack app")) as any,
    );
    const w = await mountWizard(pending);
    await w.find('[data-test="slack-wizard-allow"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(lastToast()).toMatchObject({
      variant: "error",
      message: "These credentials belong to another Slack app",
    });
  });

  it("AC-7.8 resumes a pending install with Finish install", async () => {
    const w = await mountWizard(pending);
    expect(step(w)).toBe("3");
    expect(w.find('[data-test="slack-wizard-pending"]').text()).toContain("Install not finished");
    await w.find('[data-test="slack-wizard-allow"]').trigger("click");
    await flushPromises();
    expect(slack.getInstallUrl).toHaveBeenCalledWith("acme", "inst-1");
    expect(popup.location.href).toBe(AUTHORIZE_URL);
    postCallback(popup);
    await flushPromises();
    expect(slack.installExchange).toHaveBeenCalledWith("acme", {
      code: "temporary-code",
      state: "signed-state",
    });
    expect(w.text()).toContain("Installed in Acme Corp");
  });

  it("AC-7.8 Start over removes the pending app and returns to Create the app", async () => {
    const w = await mountWizard(pending);
    await w.find('[data-test="slack-wizard-start-over"]').trigger("click");
    expect(w.find('[data-test-stub="confirm-message"]').text()).toContain("A0SAMPLE01");
    await w.find('[data-test-stub="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(slack.uninstallInstallation).toHaveBeenCalledWith("acme", "inst-1");
    expect(step(w)).toBe("2");
  });

  it("asks Socket Mode for the app-level token after Allow, then allows Next", async () => {
    const w = await mountWizard(pending);
    await w.find('[data-test="slack-wizard-allow"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-test="slack-wizard-basic-info"]').attributes("href")).toBe(
      "https://api.slack.com/apps/A0SAMPLE01/general",
    );
    await w.find('[data-test="slack-wizard-app-token-field"] input').setValue("xapp-1-sample");
    await w.find('[data-test="slack-wizard-app-token-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.updateCredentials).toHaveBeenCalledWith("acme", "inst-1", {
        app_token: "xapp-1-sample",
      }),
    );
    await flushPromises();
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeUndefined();
  });

  it("decision 6: the self-hosted exchange's null destination installs, says nothing of a destination, and reaches Step 4", async () => {
    vi.mocked(slack.installExchange).mockReturnValue(
      ok(selfHostedSettingsExchange({ mode: "http", app_token_state: "not_applicable" })) as any,
    );
    const w = await mountWizard(
      installationView({ status: "pending", mode: "http", app_token_state: "not_applicable" }),
    );
    await w.find('[data-test="slack-wizard-allow"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
    expect(w.find('[data-test="slack-wizard-installed"]').text()).toContain(
      "Installed in Acme Corp",
    );
    expect(w.text()).not.toMatch(/destination|null/i);
    await next(w);
    expect(step(w)).toBe("4");
  });

  it("links HTTP mode to the App Manifest page for the Verify click instead", async () => {
    const w = await mountWizard(
      installationView({ status: "pending", mode: "http", app_token_state: "not_applicable" }),
    );
    await w.find('[data-test="slack-wizard-allow"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(w.find('[data-test="slack-wizard-app-token-form"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-wizard-verify"]').attributes("href")).toBe(
      "https://api.slack.com/apps/A0SAMPLE01/app-manifest",
    );
    expect(w.find('[data-test="slack-wizard-next"]').attributes("disabled")).toBeUndefined();
  });
});

describe("SlackSelfHostedWizard Step 4", () => {
  const installed = installationView();

  it("runs the health checks and the Sign in with Slack test", async () => {
    const w = await mountWizard(installed);
    expect(step(w)).toBe("4");
    await w.find('[data-test="slack-wizard-run-checks"]').trigger("click");
    await flushPromises();
    expect(slack.testInstallation).toHaveBeenCalledWith("acme", "inst-1", {});
    expect(w.text()).toContain("Bot token works");

    await w.find('[data-test="slack-wizard-signin-test"]').trigger("click");
    await flushPromises();
    expect(slack.startConnection).toHaveBeenCalledWith("acme", "inst-1", { purpose: "test" });
    postCallback(popup);
    await flushPromises();
    expect(slack.confirmConnection).toHaveBeenCalledWith("acme", {
      oidc_code: "temporary-code",
      oidc_state: "signed-state",
    });
    expect(w.text()).toContain("Sign in with Slack works");
  });

  it("NIT-6 a failed second Sign in with Slack test clears the earlier pass", async () => {
    const w = await mountWizard(installed);
    await w.find('[data-test="slack-wizard-signin-test"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(w.text()).toContain("Sign in with Slack works");

    vi.mocked(slack.confirmConnection).mockReturnValue(
      Promise.reject(axiosError(502, "invalid_code")) as any,
    );
    await w.find('[data-test="slack-wizard-signin-test"]').trigger("click");
    await flushPromises();
    expect(w.text()).not.toContain("Sign in with Slack works");
    postCallback(popup);
    await flushPromises();
    expect(w.text()).not.toContain("Sign in with Slack works");
    expect(lastToast()).toMatchObject({ variant: "error", message: "invalid_code" });
  });

  it("EC-S20 the Step 4 checks link the Verify page when Slack needs one", async () => {
    vi.mocked(slack.testInstallation).mockReturnValue(
      ok({
        checks: [{ id: "last_event", status: "warn", detail: "No event yet" }],
        test_post: null,
        verify_url: "https://api.slack.com/apps/A0SAMPLE01/app-manifest",
      }) as any,
    );
    const w = await mountWizard(installed);
    await w.find('[data-test="slack-wizard-run-checks"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="slack-wizard-test-verify"]').attributes("href")).toBe(
      "https://api.slack.com/apps/A0SAMPLE01/app-manifest",
    );
  });

  it("NIT-7 a health check that fails to run leaves no unhandled rejection", async () => {
    vi.mocked(slack.testInstallation).mockReturnValue(Promise.reject(axiosError(502)) as any);
    const w = await mountWizard(installed);
    await w.find('[data-test="slack-wizard-run-checks"]').trigger("click");
    await flushPromises();
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it("prefills linking with the admin's company domain and saves it on Finish", async () => {
    const w = await mountWizard(installed);
    const chips = w.findAll('[data-test="slack-wizard-domains"] [data-test^="tag-chip-"]');
    expect(chips.map((c) => c.text())).toEqual(["acme.example"]);
    await w.find('[data-test="slack-wizard-linking-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.updateLinking).toHaveBeenCalledWith("acme", "inst-1", {
        enabled: true,
        domains: ["acme.example"],
      }),
    );
    await flushPromises();
    expect(w.emitted("done")).toHaveLength(1);
  });

  it("never prefills a public email domain and starts unchecked", async () => {
    const w = await mountWizard(installed, "ana@gmail.com");
    expect(w.findAll('[data-test="slack-wizard-domains"] [data-test^="tag-chip-"]')).toHaveLength(
      0,
    );
    await w.find('[data-test="slack-wizard-linking-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.updateLinking).toHaveBeenCalledWith("acme", "inst-1", {
        enabled: false,
        domains: [],
      }),
    );
  });

  it("offers Link all matches with the waiting count", async () => {
    vi.mocked(slack.getLinking).mockReturnValue(ok(linkingView()) as any);
    const w = await mountWizard(installed);
    const button = w.find('[data-test="slack-wizard-link-all"]');
    expect(button.text()).toBe("Link all matches (4)");
    await button.trigger("click");
    await flushPromises();
    expect(slack.linkAll).toHaveBeenCalledWith("acme", "inst-1");
  });
});
