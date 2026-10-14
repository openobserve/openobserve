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
import i18n from "@/locales";
import slack from "@/services/slack";
import SlackWorkspaceCard from "./SlackWorkspaceCard.vue";
import {
  ConfirmDialogStub,
  OTableStub,
  fakePopup,
  installationView,
  makeSlackStore,
  ok,
  postCallback,
  selfHostedSettingsExchange,
} from "@/test/unit/helpers/slack";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { InstallationView } from "@/types/slack";

vi.mock("@/services/slack", () => ({
  default: {
    testInstallation: vi.fn(),
    getHelpContact: vi.fn(),
    putHelpContact: vi.fn(),
    updateCredentials: vi.fn(),
    getInstallUrl: vi.fn(),
    installStart: vi.fn(),
    installExchange: vi.fn(),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(),
}));

const AUTH_URL = "https://slack.com/oauth/v2/authorize?client_id=1&state=signed";
let popup: Window;

const CredentialsStub = {
  name: "SlackCredentialsDialog",
  props: ["open", "installation"],
  template: '<div data-test-stub="credentials" :data-open="open" />',
};

const mountCard = (installation: InstallationView = installationView(), isCloud = false) =>
  mount(SlackWorkspaceCard, {
    props: { installation, isCloud },
    attachTo: document.body,
    global: {
      plugins: [i18n, makeSlackStore()],
      stubs: {
        OTable: OTableStub,
        ConfirmDialog: ConfirmDialogStub,
        SlackCredentialsDialog: CredentialsStub,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  popup = fakePopup();
  vi.spyOn(window, "open").mockReturnValue(popup);
  vi.mocked(slack.getHelpContact).mockReturnValue(ok({ help_contact: "#o2-help" }) as any);
  vi.mocked(slack.putHelpContact).mockReturnValue(ok({ help_contact: "#ops" }) as any);
  vi.mocked(slack.updateCredentials).mockReturnValue(ok(installationView()) as any);
  vi.mocked(slack.getInstallUrl).mockReturnValue(ok({ authorize_url: AUTH_URL }) as any);
  vi.mocked(slack.installStart).mockReturnValue(ok({ authorization_url: AUTH_URL }) as any);
  vi.mocked(slack.installExchange).mockReturnValue(ok({}) as any);
  vi.mocked(slack.testInstallation).mockReturnValue(
    ok({
      checks: [
        { id: "auth_test", status: "pass", detail: "Bot token works" },
        { id: "sockets", status: "fail", detail: "0 of 2 sockets open" },
      ],
      test_post: { status: "pass", detail: "Posted to #sre-prod" },
    }) as any,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SlackWorkspaceCard (A3)", () => {
  it("AC-12.4 shows the workspace with its slackInstallStatus badge", () => {
    const w = mountCard(installationView({ status: "degraded" }));
    expect(w.find('[data-test="slack-workspace-name"]').text()).toBe("Acme Corp");
    expect(w.find('[data-test="slack-workspace-status"]').text()).toBe("Degraded");
    expect(w.find('[data-test="slack-workspace-meta"]').text()).toContain(
      "Socket Mode · connected by ana@acme.example",
    );
  });

  it("shows socket health as of the local health record, and none in HTTP mode", () => {
    expect(mountCard().find('[data-test="slack-workspace-sockets"]').text()).toContain(
      "2 of 2 sockets · as of",
    );
    expect(
      mountCard(installationView({ mode: "http" }))
        .find('[data-test="slack-workspace-sockets"]')
        .exists(),
    ).toBe(false);
  });

  it("AC-12.1 credentials unreadable: says so and opens Update credentials", async () => {
    const w = mountCard(installationView({ credentials_readable: false }));
    const banner = w.find('[data-test="slack-credentials-unreadable"]');
    expect(banner.text()).toContain("Credentials unreadable — re-enter tokens");
    await banner.find("button").trigger("click");
    expect(w.find('[data-test-stub="credentials"]').attributes("data-open")).toBe("true");
  });

  it("AC-12.1 Update credentials is self-hosted only", async () => {
    const w = mountCard();
    await w.find('[data-test="slack-update-credentials"]').trigger("click");
    expect(w.find('[data-test-stub="credentials"]').attributes("data-open")).toBe("true");
    expect(
      mountCard(installationView(), true).find('[data-test="slack-update-credentials"]').exists(),
    ).toBe(false);
  });

  it("AC-12.1 Test runs row 10 and lists each check and the test post", async () => {
    const w = mountCard();
    await w.find('[data-test="slack-test-connection"]').trigger("click");
    await flushPromises();
    expect(slack.testInstallation).toHaveBeenCalledWith("acme", "inst-1", {});
    const results = w.find('[data-test="slack-test-results"]').text();
    expect(results).toContain("Bot token works");
    expect(results).toContain("0 of 2 sockets open");
    expect(results).toContain("Posted to #sre-prod");
  });

  it("AC-12.1 help contact loads row 23 and saves it", async () => {
    const w = mountCard();
    await flushPromises();
    const input = w.find('[data-test="slack-help-contact"] input');
    expect((input.element as HTMLInputElement).value).toBe("#o2-help");
    await input.setValue("#ops");
    await w.find('[data-test="slack-help-contact-form"]').trigger("submit");
    await vi.waitFor(() =>
      expect(slack.putHelpContact).toHaveBeenCalledWith("acme", "inst-1", { help_contact: "#ops" }),
    );
  });

  it("AC-12.2 lists this org and only a count of other connected orgs", () => {
    const w = mountCard(installationView({ other_connected_orgs: 3 }));
    const orgs = w.find('[data-test="slack-connected-orgs"]').text();
    expect(orgs).toContain("acme (this org)");
    expect(orgs).toContain("4");
    expect(orgs).toContain("3 other orgs");
  });

  it("AC-7.6 Forget clears only OpenObserve's copy of the refresh token after a confirm", async () => {
    const w = mountCard();
    expect(w.find('[data-test="slack-refresh-token"]').text()).toContain(
      "Configuration refresh token kept",
    );
    await w.find('[data-test="slack-forget-token"]').trigger("click");
    expect(w.find('[data-test-stub="confirm-message"]').text()).toContain(
      "Slack does not revoke the token",
    );
    await w.find('[data-test-stub="confirm-ok"]').trigger("click");
    await flushPromises();
    expect(slack.updateCredentials).toHaveBeenCalledWith("acme", "inst-1", {
      config_refresh_token: null,
    });
  });

  it("hides Forget when no refresh token is kept, and on Cloud", () => {
    expect(
      mountCard(installationView({ has_config_refresh_token: false }))
        .find('[data-test="slack-refresh-token"]')
        .exists(),
    ).toBe(false);
    expect(
      mountCard(installationView(), true).find('[data-test="slack-refresh-token"]').exists(),
    ).toBe(false);
  });

  it("Reinstall on self-hosted opens O2's install URL and redeems the callback", async () => {
    const w = mountCard();
    await w.find('[data-test="slack-reinstall"]').trigger("click");
    await flushPromises();
    expect(slack.getInstallUrl).toHaveBeenCalledWith("acme", "inst-1");
    expect(popup.location.href).toBe(AUTH_URL);
    postCallback(popup);
    await flushPromises();
    expect(slack.installExchange).toHaveBeenCalledWith("acme", {
      code: "temporary-code",
      state: "signed-state",
    });
  });

  it("decision 6: Reinstall takes the self-hosted exchange's null destination without an error", async () => {
    vi.mocked(slack.installExchange).mockReturnValue(ok(selfHostedSettingsExchange()) as any);
    const w = mountCard();
    await w.find('[data-test="slack-reinstall"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(slack.installExchange).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(w.text()).toContain("Acme Corp");
    expect(w.text()).not.toContain("null");
  });

  it("Reinstall on Cloud runs the Cloud popup from settings", async () => {
    const w = mountCard(installationView(), true);
    await w.find('[data-test="slack-reinstall"]').trigger("click");
    await flushPromises();
    expect(slack.installStart).toHaveBeenCalledWith("acme", { source: "settings" }, undefined);
  });

  it("AC-12.2 Disconnect this org and Uninstall are separate; Uninstall is hidden on Cloud", async () => {
    const w = mountCard();
    await w.find('[data-test="slack-disconnect-org"]').trigger("click");
    await w.find('[data-test="slack-uninstall"]').trigger("click");
    expect(w.emitted("disconnect")).toHaveLength(1);
    expect(w.emitted("uninstall")).toHaveLength(1);

    const cloud = mountCard(installationView(), true);
    expect(cloud.find('[data-test="slack-disconnect-org"]').exists()).toBe(true);
    expect(cloud.find('[data-test="slack-uninstall"]').exists()).toBe(false);
  });

  it("reminds self-hosted admins to add a second app collaborator", () => {
    const link = mountCard().find('[data-test="slack-collaborators"]');
    expect(link.attributes("href")).toBe("https://api.slack.com/apps/A0SAMPLE01/collaborators");
    expect(
      mountCard(installationView(), true).find('[data-test="slack-collaborators"]').exists(),
    ).toBe(false);
  });
});
