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
import { createStore } from "vuex";
import i18n from "@/locales";
import slack from "@/services/slack";
import SlackConnectEmpty from "./SlackConnectEmpty.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  fakePopup,
  installationView,
  linkingView,
  makeSlackStore,
  ok,
  postCallback,
  selfHostedSettingsExchange,
} from "@/test/unit/helpers/slack";

vi.mock("@/services/slack", () => ({
  default: {
    installStart: vi.fn(),
    installExchange: vi.fn(),
    connectInstallation: vi.fn(),
    startConnection: vi.fn(),
    confirmConnection: vi.fn(),
    listInstallations: vi.fn(),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(),
}));

const AUTH_URL = "https://slack.com/oauth/v2/authorize?client_id=1&state=signed";
let popup: Window;

const mountEmpty = (props: Record<string, unknown> = {}) =>
  mount(SlackConnectEmpty, {
    props: { isCloud: true, available: [], upgradeCandidates: [], ...props },
    attachTo: document.body,
    global: { plugins: [i18n, makeSlackStore()] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [] }) as any);
  popup = fakePopup();
  vi.spyOn(window, "open").mockReturnValue(popup);
  vi.mocked(slack.installStart).mockReturnValue(ok({ authorization_url: AUTH_URL }) as any);
  vi.mocked(slack.installExchange).mockReturnValue(ok({}) as any);
  vi.mocked(slack.startConnection).mockReturnValue(ok({ url: AUTH_URL }) as any);
  vi.mocked(slack.confirmConnection).mockReturnValue(ok({ connected: true }) as any);
  vi.mocked(slack.connectInstallation).mockReturnValue(
    ok({ connected: true, destination: null, channel_default_set: false }) as any,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SlackConnectEmpty on Cloud (A1)", () => {
  it("AC-12.1 names only what Phase 1 ships, with the consent line and the permission hint", () => {
    const w = mountEmpty();
    const text = w.text();
    expect(text).toContain("Connect a Slack workspace");
    expect(text).toContain("Ask questions; answers use your own permissions");
    expect(text).not.toMatch(/Acknowledge|unfurl|Phase/);
    expect(w.find('[data-test="slack-connect-consent"]').text()).toBe(
      "Two-way Slack also reads your direct messages with OpenObserve and replies in threads it is part of. It never reads other channel history.",
    );
    expect(text).toContain("Needs the Manage Slack permission");
    expect(w.find('[data-test="slack-setup-app"]').exists()).toBe(false);
  });

  it("renders Add to Slack as a button carrying the Slack artwork", () => {
    const button = mountEmpty().find('[data-test="slack-add-to-slack"]');
    expect(button.element.tagName).toBe("BUTTON");
    const img = button.find("img");
    expect(img.attributes("alt")).toBe("Add to Slack");
    expect(img.attributes("srcset")).toContain("2x");
  });

  it("AC-6.2 Add to Slack opens the popup with source settings and redeems the callback", async () => {
    const w = mountEmpty();
    await w.find('[data-test="slack-add-to-slack"]').trigger("click");
    await flushPromises();
    expect(slack.installStart).toHaveBeenCalledWith("acme", { source: "settings" }, undefined);
    expect(popup.location.href).toBe(AUTH_URL);

    postCallback(popup);
    await flushPromises();
    expect(slack.installExchange).toHaveBeenCalledWith("acme", {
      code: "temporary-code",
      state: "signed-state",
    });
  });

  it("a settings exchange with destination null redeems quietly and offers no ticket", async () => {
    vi.mocked(slack.installExchange).mockReturnValue(ok(selfHostedSettingsExchange()) as any);
    const w = mountEmpty();
    await w.find('[data-test="slack-add-to-slack"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(slack.installExchange).toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(w.find('[data-test="slack-already-installed"]').exists()).toBe(false);
    expect(w.text()).not.toContain("null");
  });

  it("W-S9 hands the exchange result on as the post-install confirmation", async () => {
    const linking = linkingView({ source: "mapping", domains: ["acme.com"] });
    const destination = {
      id: "d1",
      name: "slack-sre-prod",
      channel: "#sre-prod",
      channel_id: "C1",
    };
    vi.mocked(slack.installExchange).mockReturnValue(
      ok({
        installation: installationView({ team_name: "Acme Corp" }),
        destination,
        channel_default_set: true,
        linking,
        link_all: { linked: 12, complete: true },
      }) as any,
    );
    const w = mountEmpty();
    await w.find('[data-test="slack-add-to-slack"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(w.emitted("installed")).toEqual([
      [{ team: "Acme Corp", destination, linking, linkAll: { linked: 12, complete: true } }],
    ]);
  });

  it("W-S9 confirms a self-hosted exchange without a destination", async () => {
    vi.mocked(slack.installExchange).mockReturnValue(ok(selfHostedSettingsExchange()) as any);
    const w = mountEmpty();
    await w.find('[data-test="slack-add-to-slack"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(w.emitted("installed")?.[0]?.[0]).toMatchObject({
      team: "Acme Corp",
      destination: null,
    });
  });

  it("W-S9 confirms a ticket connect with the destination it created", async () => {
    const destination = { id: "d2", name: "slack-ops", channel: "ops", channel_id: "C2" };
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
    vi.mocked(slack.connectInstallation).mockReturnValue(
      ok({ connected: true, destination, channel_default_set: true }) as any,
    );
    const w = mountEmpty();
    await w.find('[data-test="slack-add-to-slack"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();
    expect(w.emitted("installed")).toBeUndefined();
    await w.find('[data-test="slack-connect-ticket"]').trigger("click");
    await flushPromises();
    expect(w.emitted("installed")).toEqual([
      [{ team: "Acme Corp", destination, linking: null, linkAll: null }],
    ]);
  });

  it("AC-6.8 offers to connect this org when the workspace is already installed", async () => {
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
    const w = mountEmpty();
    await w.find('[data-test="slack-add-to-slack"]').trigger("click");
    await flushPromises();
    postCallback(popup);
    await flushPromises();

    const banner = w.find('[data-test="slack-already-installed"]');
    expect(banner.text()).toContain("Acme Corp is already installed for another organization");
    await banner.find('[data-test="slack-connect-ticket"]').trigger("click");
    await flushPromises();
    expect(slack.connectInstallation).toHaveBeenCalledWith("acme", "inst-7", {
      connect_ticket: "ticket-1",
    });
  });

  it("AC-6.13 shows the Upgrade banner to a webhook org and runs the popup with source upgrade_banner", async () => {
    const w = mountEmpty({
      upgradeCandidates: [
        {
          team_id: "T1",
          team_name: "Acme Corp",
          destinations: [
            { id: "d1", name: "alerts" },
            { id: "d2", name: "oncall" },
          ],
        },
      ],
    });
    const banner = w.find('[data-test="slack-upgrade-banner"]');
    expect(banner.text()).toContain("Upgrade to two-way Slack");
    expect(banner.text()).toContain("Acme Corp · 2 webhook destinations keep working");
    await banner.find('[data-test="slack-upgrade-button"]').trigger("click");
    await flushPromises();
    expect(slack.installStart).toHaveBeenCalledWith(
      "acme",
      { source: "upgrade_banner" },
      undefined,
    );
  });

  it("shows no Upgrade banner without webhook destinations", () => {
    expect(mountEmpty().find('[data-test="slack-upgrade-banner"]').exists()).toBe(false);
  });
});

describe("SlackConnectEmpty self-hosted (A1)", () => {
  it("offers Set up Slack app instead of Add to Slack", async () => {
    const w = mountEmpty({ isCloud: false });
    expect(w.find('[data-test="slack-add-to-slack"]').exists()).toBe(false);
    await w.find('[data-test="slack-setup-app"]').trigger("click");
    expect(w.emitted("setup")).toHaveLength(1);
  });

  it("AC-12.1 Connect existing proves the admin with Sign in with Slack, then connects", async () => {
    const w = mountEmpty({
      isCloud: false,
      available: [{ installation_id: "inst-9", team_name: "Acme Corp" }],
    });
    const row = w.find('[data-test="slack-available-inst-9"]');
    expect(row.text()).toContain("Acme Corp");
    await row.find("button").trigger("click");
    await flushPromises();
    expect(slack.startConnection).toHaveBeenCalledWith("acme", "inst-9", { purpose: "connect" });
    expect(popup.location.href).toBe(AUTH_URL);

    postCallback(popup);
    await flushPromises();
    expect(slack.confirmConnection).toHaveBeenCalledWith("acme", {
      oidc_code: "temporary-code",
      oidc_state: "signed-state",
    });
    expect(slack.installExchange).not.toHaveBeenCalled();
    expect(w.emitted("installed")).toEqual([
      [{ team: "Acme Corp", destination: null, linking: null, linkAll: null }],
    ]);
  });
});

describe("SlackConnectEmpty for an org the instance workspace does not serve (M4)", () => {
  const writeText = vi.mocked(navigator.clipboard.writeText);
  const labsStore = () =>
    createStore({
      state: {
        selectedOrganization: { identifier: "labs", name: "Labs" },
        userInfo: { email: "lee@acme.example" },
        zoConfig: { slack_enabled: true, meta_org: "_meta" },
      },
    });
  const mountUnserved = async (
    helpContact: string | null,
    available: { installation_id: string; team_name: string }[] = [],
  ) => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({
        installations: [],
        available,
        instance: { installation_id: "inst-i", team_name: "Acme Corp", help_contact: helpContact },
      }) as any,
    );
    const w = mount(SlackConnectEmpty, {
      props: { isCloud: false, available, upgradeCandidates: [] },
      attachTo: document.body,
      global: { plugins: [i18n, labsStore()] },
    });
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
  });

  it("an unserved org sees the not-included banner and Copy request copies the request text", async () => {
    const w = await mountUnserved("#o2-platform");
    const banner = w.find('[data-test="slack-not-included"]');
    expect(banner.text()).toContain(
      "Acme Corp is set up for this server by your instance admin, but labs is not included yet.",
    );
    expect(banner.text()).toContain(
      "Ask #o2-platform to add labs. You don't need to install anything.",
    );
    expect(w.text()).toContain(
      "For a different Slack workspace than Acme Corp · OpenObserve creates your own Slack app from one configuration token",
    );
    await banner.find('[data-test="slack-copy-request"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(
      "Please add the OpenObserve organization Labs (labs) to the Slack workspace Acme Corp, in _meta › Settings › Slack › Organizations.",
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Request copied" }),
    );
  });

  it("the banner without a contact asks the instance admin", async () => {
    const w = await mountUnserved(null);
    expect(w.find('[data-test="slack-not-included"]').text()).toContain(
      "Ask your instance admin to add labs. You don't need to install anything.",
    );
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [] }) as any);
    const served = mountEmpty({ isCloud: false });
    await flushPromises();
    expect(served.find('[data-test="slack-not-included"]').exists()).toBe(false);
    expect(served.text()).toContain(
      "OpenObserve creates your own Slack app from one configuration token",
    );
    expect(served.text()).not.toContain("For a different Slack workspace");
  });

  it("the instance workspace is never offered under Connect existing", async () => {
    const w = await mountUnserved("#o2-platform", [
      { installation_id: "inst-i", team_name: "Acme Corp" },
      { installation_id: "inst-9", team_name: "Acme Labs" },
    ]);
    expect(w.find('[data-test="slack-available-inst-i"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-available-inst-9"]').text()).toContain("Acme Labs");
  });
});
