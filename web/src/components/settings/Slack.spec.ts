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
import config from "@/aws-exports";
import slack from "@/services/slack";
import { queryClient } from "@/composables/query/queryClient";
import { slackInstallationsQuery } from "@/services/slack.queries";
import Slack from "./Slack.vue";
import {
  axiosError,
  installationView,
  instanceView,
  linkingView,
  makeSlackStore,
  ok,
} from "@/test/unit/helpers/slack";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

vi.mock("@/services/slack", () => ({
  default: { listInstallations: vi.fn(), getPrerequisites: vi.fn() },
}));

const stub = (name: string, props: string[] = []) => ({
  name,
  props,
  template: `<div data-test-stub="${name}" />`,
});

const STUBS = {
  SlackConnectEmpty: stub("SlackConnectEmpty", ["isCloud", "available", "upgradeCandidates"]),
  SlackSelfHostedWizard: stub("SlackSelfHostedWizard", ["installation"]),
  SlackWorkspaceCard: {
    name: "SlackWorkspaceCard",
    props: ["installation", "isCloud"],
    template: '<div data-test-stub="SlackWorkspaceCard"><slot /></div>',
  },
  SlackLinkingSection: stub("SlackLinkingSection", ["installation"]),
  SlackChannelDefaults: stub("SlackChannelDefaults", ["installationId"]),
  SlackUninstallDialog: stub("SlackUninstallDialog", ["open", "mode", "installation"]),
  SlackOrgAccess: stub("SlackOrgAccess", ["installation"]),
  SlackSwitchAllCard: stub("SlackSwitchAllCard", ["installation"]),
};

const switchOrg = async (store: ReturnType<typeof makeSlackStore>, identifier: string) => {
  store.state.selectedOrganization = { identifier, name: identifier };
  await flushPromises();
};

const mountSlack = (zoConfig: Record<string, unknown>) =>
  mount(Slack, {
    global: { plugins: [i18n, makeSlackStore(zoConfig)], stubs: STUBS },
  });

const disabled = (reason: string, extra: Record<string, unknown> = {}) => ({
  slack_enabled: false,
  slack_disabled_reason: reason,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  config.isEnterprise = "true";
  config.isCloud = "false";
  vi.mocked(slack.listInstallations).mockReturnValue(
    ok({ installations: [], available: [] }) as any,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Slack settings: disabled", () => {
  it("AC-1.4 AC-1.5 renders nothing and calls no Slack API for any disabled reason", async () => {
    for (const isCloud of ["false", "true"]) {
      config.isCloud = isCloud;
      for (const reason of ["flag", "master_key", "super_cluster", "edition"]) {
        const w = mountSlack(disabled(reason, { meta_org: "_meta" }));
        await flushPromises();
        expect(w.find('[data-test="slack-settings"]').text()).toBe("");
        expect(w.find('[data-test-stub="SlackConnectEmpty"]').exists()).toBe(false);
        w.unmount();
      }
    }
    expect(slack.getPrerequisites).not.toHaveBeenCalled();
    expect(slack.listInstallations).not.toHaveBeenCalled();
  });
});

describe("Slack settings: enabled", () => {
  it("AC-1.11 shows the no-access state from a 403, with no toast suppression trick", async () => {
    vi.mocked(slack.listInstallations).mockRejectedValue(axiosError(403));
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(slack.listInstallations).toHaveBeenCalledWith("acme", undefined);
    expect(w.find('[data-test="slack-no-access"]').exists()).toBe(true);
    expect(w.find('[data-test-stub="SlackConnectEmpty"]').exists()).toBe(false);
  });

  it("puts the switch-all card for the shown workspace above its card (MK-6b)", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView()] }) as any,
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    const card = w.findComponent({ name: "SlackSwitchAllCard" });
    expect(card.exists()).toBe(true);
    expect(card.props("installation")).toMatchObject({ id: "inst-1" });
    const html = w.html();
    expect(html.indexOf("SlackSwitchAllCard")).toBeLessThan(html.indexOf("SlackWorkspaceCard"));
  });

  it("shows a retryable load error for any other failure", async () => {
    vi.mocked(slack.listInstallations).mockRejectedValue(axiosError(500));
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.find('[data-test="slack-load-error"]').exists()).toBe(true);
  });

  it("A1 on Cloud: the connect screen gets the Cloud flag and upgrade candidates", async () => {
    config.isCloud = "true";
    const candidates = [
      { team_id: "T1", team_name: "Acme Corp", destinations: [{ id: "d1", name: "alerts" }] },
    ];
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [], upgrade_candidates: candidates }) as any,
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    const empty = w.findComponent({ name: "SlackConnectEmpty" });
    expect(empty.props("isCloud")).toBe(true);
    expect(empty.props("upgradeCandidates")).toEqual(candidates);
  });

  it("A1 self-hosted: Set up Slack app opens the wizard", async () => {
    const available = [{ installation_id: "i9", team_name: "Other WS" }];
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [], available }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    const empty = w.findComponent({ name: "SlackConnectEmpty" });
    expect(empty.props("isCloud")).toBe(false);
    expect(empty.props("available")).toEqual(available);
    empty.vm.$emit("setup");
    await flushPromises();
    expect(w.find('[data-test-stub="SlackSelfHostedWizard"]').exists()).toBe(true);
  });

  it("A2 pending install: the wizard resumes with the pending installation", async () => {
    const pending = installationView({ status: "pending" });
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [pending] }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.findComponent({ name: "SlackSelfHostedWizard" }).props("installation")).toEqual(
      pending,
    );
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(false);
  });

  it("keeps the wizard open after the pending install finishes, until it reports done", async () => {
    const pending = installationView({ status: "pending" });
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [pending] }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView()] }) as any,
    );
    await queryClient.refetchQueries();
    await flushPromises();
    const wizard = w.findComponent({ name: "SlackSelfHostedWizard" });
    expect(wizard.exists()).toBe(true);
    wizard.vm.$emit("done");
    await flushPromises();
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(true);
  });

  it("A3: a connected workspace shows the card, linking and channel defaults", async () => {
    const inst = installationView();
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [inst] }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.findComponent({ name: "SlackWorkspaceCard" }).props("installation")).toEqual(inst);
    expect(w.findComponent({ name: "SlackLinkingSection" }).props("installation")).toEqual(inst);
    expect(w.findComponent({ name: "SlackChannelDefaults" }).props("installationId")).toBe(
      "inst-1",
    );
  });

  it("opens the uninstall dialog from the card and keeps it after the workspace is gone", async () => {
    const inst = installationView();
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [inst] }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    w.findComponent({ name: "SlackWorkspaceCard" }).vm.$emit("uninstall");
    await flushPromises();
    let dialog = w.findComponent({ name: "SlackUninstallDialog" });
    expect(dialog.props()).toMatchObject({ open: true, mode: "uninstall", installation: inst });

    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [] }) as any);
    await queryClient.refetchQueries();
    await flushPromises();
    dialog = w.findComponent({ name: "SlackUninstallDialog" });
    expect(dialog.props("installation")).toEqual(inst);
  });

  it("opens the same dialog in disconnect mode", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView()] }) as any,
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    w.findComponent({ name: "SlackWorkspaceCard" }).vm.$emit("disconnect");
    await flushPromises();
    expect(w.findComponent({ name: "SlackUninstallDialog" }).props("mode")).toBe("disconnect");
  });

  it("W-S4 switching org mid-wizard closes the wizard and remounts the screen for the new org", async () => {
    vi.mocked(slack.listInstallations).mockImplementation(
      (org: string) => ok({ installations: [], available: [], org }) as any,
    );
    const store = makeSlackStore({ slack_enabled: true });
    const w = mount(Slack, { global: { plugins: [i18n, store], stubs: STUBS } });
    await flushPromises();
    w.findComponent({ name: "SlackConnectEmpty" }).vm.$emit("setup");
    await flushPromises();
    expect(w.find('[data-test-stub="SlackSelfHostedWizard"]').exists()).toBe(true);

    await switchOrg(store, "beta");
    expect(slack.listInstallations).toHaveBeenCalledWith("beta", undefined);
    expect(w.find('[data-test-stub="SlackSelfHostedWizard"]').exists()).toBe(false);
    expect(w.find('[data-test-stub="SlackConnectEmpty"]').exists()).toBe(true);
  });

  it("W-S4 a pending install in both orgs gets a fresh wizard after the switch", async () => {
    vi.mocked(slack.listInstallations).mockImplementation(
      (org: string) =>
        ok({
          installations: [installationView({ id: `pending-${org}`, status: "pending" })],
        }) as any,
    );
    const store = makeSlackStore({ slack_enabled: true });
    const w = mount(Slack, { global: { plugins: [i18n, store], stubs: STUBS } });
    await flushPromises();
    const first = w.findComponent({ name: "SlackSelfHostedWizard" });
    expect(first.props("installation").id).toBe("pending-acme");

    await queryClient.prefetchQuery(slackInstallationsQuery("beta"));
    await switchOrg(store, "beta");
    const second = w.findComponent({ name: "SlackSelfHostedWizard" });
    expect(second.props("installation").id).toBe("pending-beta");
    expect(second.vm).not.toBe(first.vm);
  });

  it("W-S4 switching org drops the dialog opened for the other org's workspace", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView()] }) as any,
    );
    const store = makeSlackStore({ slack_enabled: true });
    const w = mount(Slack, { global: { plugins: [i18n, store], stubs: STUBS } });
    await flushPromises();
    w.findComponent({ name: "SlackWorkspaceCard" }).vm.$emit("uninstall");
    await flushPromises();
    expect(w.findComponent({ name: "SlackUninstallDialog" }).exists()).toBe(true);

    await switchOrg(store, "beta");
    expect(w.findComponent({ name: "SlackUninstallDialog" }).exists()).toBe(false);
  });

  it("W-S9 shows the post-install confirmation before the workspace card, then continues to it", async () => {
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    w.findComponent({ name: "SlackConnectEmpty" }).vm.$emit("installed", {
      team: "Acme Corp",
      destination: { id: "d1", name: "sre-prod", channel: "sre-prod", channel_id: "C1" },
      linking: linkingView({ source: "mapping", domains: ["acme.com"] }),
      linkAll: null,
    });
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView()] }) as any,
    );
    await queryClient.refetchQueries();
    await flushPromises();

    const confirmation = w.find('[data-test="slack-install-confirmation"]');
    expect(confirmation.text()).toContain("Connected to Acme Corp");
    expect(confirmation.text()).toContain("Automatic for acme.com");
    expect(confirmation.text()).toContain("Alerts post to #sre-prod");
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(false);

    await w.find('[data-test="slack-install-continue"]').trigger("click");
    expect(w.find('[data-test="slack-install-confirmation"]').exists()).toBe(false);
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(true);
  });

  it("W-S9 leaves out the alert line when a self-hosted install created no destination", async () => {
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    w.findComponent({ name: "SlackConnectEmpty" }).vm.$emit("installed", {
      team: "Acme Corp",
      destination: null,
      linking: null,
      linkAll: null,
    });
    await flushPromises();
    const confirmation = w.find('[data-test="slack-install-confirmation"]');
    expect(confirmation.text()).toContain("Connected to Acme Corp");
    expect(confirmation.text()).not.toContain("Alerts post to");
    expect(confirmation.text()).not.toContain("null");
  });
});

describe("Slack settings: several workspaces (R-89)", () => {
  const labs = installationView({
    id: "inst-labs",
    team_name: "Acme Labs",
    created_at: 1_750_000_000_000_000,
  });
  const instance = instanceView({
    id: "inst-acme",
    team_name: "Acme Corp",
    managed: true,
    created_at: 1_760_000_000_000_000,
  });
  const tabs = (w: ReturnType<typeof mountSlack>) => w.findAll('[data-test="slack-workspace-tab"]');

  it("renders one tab per workspace with the instance workspace first", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [labs, instance] }) as any,
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(tabs(w).map((tab) => tab.text())).toEqual(["Acme Corp Instance", "Acme Labs"]);
    expect(w.findComponent({ name: "SlackWorkspaceCard" }).props("installation")).toEqual(instance);

    await tabs(w)[1].trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(w.findComponent({ name: "SlackWorkspaceCard" }).props("installation")).toEqual(labs);
    expect(w.findComponent({ name: "SlackLinkingSection" }).props("installation")).toEqual(labs);
    expect(w.findComponent({ name: "SlackChannelDefaults" }).props("installationId")).toBe(
      "inst-labs",
    );
  });

  it("shows no tabs with one workspace", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [instance] }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.find('[data-test="slack-workspace-tabs"]').exists()).toBe(false);
    expect(w.findComponent({ name: "SlackWorkspaceCard" }).props("installation")).toEqual(instance);
  });

  it("Add another workspace opens the setup for another team", async () => {
    const available = [{ installation_id: "i9", team_name: "Other WS" }];
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [instance], available }) as any,
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.find('[data-test-stub="SlackConnectEmpty"]').exists()).toBe(false);

    await w.find('[data-test="slack-add-workspace"]').trigger("click");
    await flushPromises();
    const empty = w.findComponent({ name: "SlackConnectEmpty" });
    expect(empty.props("available")).toEqual(available);
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(false);

    empty.vm.$emit("setup");
    await flushPromises();
    expect(w.findComponent({ name: "SlackSelfHostedWizard" }).props("installation")).toBe(null);

    w.findComponent({ name: "SlackSelfHostedWizard" }).vm.$emit("cancel");
    await flushPromises();
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(true);
  });

  it("shows the org access card only in _meta for an instance workspace", async () => {
    const meta = instanceView({ id: "inst-acme", team_name: "Acme Corp" });
    vi.mocked(slack.listInstallations).mockImplementation(
      (org: string) => ok({ installations: org === "_meta" ? [meta, labs] : [instance] }) as any,
    );
    const store = makeSlackStore({ slack_enabled: true, meta_org: "_meta" });
    store.state.selectedOrganization.identifier = "_meta";
    const w = mount(Slack, { global: { plugins: [i18n, store], stubs: STUBS } });
    await flushPromises();
    expect(w.findComponent({ name: "SlackOrgAccess" }).props("installation")).toEqual(meta);

    await w.findAll('[data-test="slack-workspace-tab"]')[1].trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(w.findComponent({ name: "SlackOrgAccess" }).exists()).toBe(false);

    const outside = mountSlack({ slack_enabled: true, meta_org: "_meta" });
    await flushPromises();
    expect(outside.findComponent({ name: "SlackWorkspaceCard" }).props("installation")).toEqual(
      instance,
    );
    expect(outside.findComponent({ name: "SlackOrgAccess" }).exists()).toBe(false);
  });
});
