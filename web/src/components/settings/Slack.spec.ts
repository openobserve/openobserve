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
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import config from "@/aws-exports";
import slack from "@/services/slack";
import { queryClient } from "@/composables/query/queryClient";
import { slackInstallationsQuery } from "@/services/slack.queries";
import Slack from "./Slack.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useSlackSavePart } from "./slackSaveBar";
import {
  OTableStub,
  axiosError,
  installationView,
  instanceView,
  linkingView,
  makeSlackStore,
  ok,
} from "@/test/unit/helpers/slack";
import { axiosReply } from "@/test/unit/helpers/mockService";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

vi.mock("@/services/slack", () => ({
  default: {
    listInstallations: vi.fn(),
    getPrerequisites: vi.fn(),
    listOncallUnlinked: vi.fn(),
    getInsightsSettings: vi.fn(),
    getHelpContact: vi.fn(),
    putHelpContact: vi.fn(),
    getLinking: vi.fn(),
    updateLinking: vi.fn(),
  },
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
    template:
      '<div data-test-stub="SlackWorkspaceCard"><slot name="oncall" /><div data-test-stub="card-sections"><slot /></div></div>',
  },
  SlackLinkingSection: stub("SlackLinkingSection", ["installation"]),
  SlackChannelDefaults: stub("SlackChannelDefaults", ["installationId"]),
  SlackUninstallDialog: stub("SlackUninstallDialog", ["open", "mode", "installation"]),
  SlackOrgAccess: stub("SlackOrgAccess", ["installation"]),
  SlackSwitchAllCard: stub("SlackSwitchAllCard", ["installation"]),
  SlackInsightsSection: stub("SlackInsightsSection", ["installations"]),
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
  vi.mocked(slack.listOncallUnlinked).mockResolvedValue(axiosReply({ members: [] }));
  vi.mocked(slack.getInsightsSettings).mockRejectedValue(axiosError(404));
  queryClient.clear();
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

  it("puts the on-call unlinked people in the card's on-call slot, above its other sections", async () => {
    vi.mocked(slack.listInstallations).mockResolvedValue(
      axiosReply({ installations: [installationView()] }),
    );
    vi.mocked(slack.listOncallUnlinked).mockResolvedValue(
      axiosReply({
        members: [
          {
            email: "kim@acme.io",
            team_id: "t1",
            team_name: "Payments",
            next_shift_at: null,
            reminded_at: null,
          },
        ],
      }),
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    const card = w.find('[data-test-stub="SlackWorkspaceCard"]');
    const unlinked = card.find('[data-test="slack-oncall-unlinked"]');
    expect(unlinked.exists()).toBe(true);
    expect(
      card
        .find('[data-test-stub="card-sections"]')
        .find('[data-test="slack-oncall-unlinked"]')
        .exists(),
    ).toBe(false);
    expect(slack.listOncallUnlinked).toHaveBeenCalledWith("acme", "inst-1");
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

  it("keeps the wizard and its steps while the settings for its new install load", async () => {
    let mounts = 0;
    const wizard = {
      name: "SlackSelfHostedWizard",
      props: ["installation"],
      setup: () => ({ step: ref(1) }),
      mounted: () => mounts++,
      template: '<div data-test-stub="SlackSelfHostedWizard" :data-step="step" />',
    };
    vi.mocked(slack.getInsightsSettings).mockReturnValue(new Promise(() => {}) as any);
    const w = mount(Slack, {
      global: {
        plugins: [i18n, makeSlackStore({ slack_enabled: true })],
        stubs: { ...STUBS, SlackSelfHostedWizard: wizard },
      },
    });
    await flushPromises();
    w.findComponent({ name: "SlackConnectEmpty" }).vm.$emit("setup");
    await flushPromises();
    (w.findComponent({ name: "SlackSelfHostedWizard" }).vm as any).step = 3;
    const pending = installationView({ status: "pending" });
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [pending] }) as any);
    await queryClient.refetchQueries({ queryKey: slackInstallationsQuery("acme").queryKey });
    await flushPromises();
    expect(slack.getInsightsSettings).toHaveBeenCalledWith("acme");
    const shown = w.findComponent({ name: "SlackSelfHostedWizard" });
    expect(shown.exists()).toBe(true);
    expect(shown.props("installation")).toEqual(pending);
    expect(shown.attributes("data-step")).toBe("3");
    expect(mounts).toBe(1);
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

  it("a_reader_without_manage_slack_cannot_add_another_workspace", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView()] }) as any,
    );
    vi.mocked(slack.getInsightsSettings).mockReturnValue(ok({ can_edit: false }) as any);
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.find('[data-test="slack-add-workspace"]').attributes("disabled")).toBeDefined();
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

describe("Slack settings: General and AutoObserve sections (S7)", () => {
  const oneWorkspace = () =>
    vi
      .mocked(slack.listInstallations)
      .mockReturnValue(ok({ installations: [installationView()] }) as any);
  const settingsOn = () =>
    vi.mocked(slack.getInsightsSettings).mockReturnValue(
      ok({
        channel: null,
        digest_time: "09:00",
        digest_time_zone: null,
        post_trial_findings: false,
        revision: 0,
      }) as any,
    );
  const sections = (w: ReturnType<typeof mountSlack>) => ({
    bar: w.find('[data-test="slack-section-bar"]'),
    autoobserve: w.find('[data-test="slack-section-autoobserve-heading"]'),
    insights: w.find('[data-test-stub="SlackInsightsSection"]'),
  });

  it("shows the section bar and AutoObserve as its own card after the workspace", async () => {
    oneWorkspace();
    settingsOn();
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    const { bar, autoobserve, insights } = sections(w);
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain("On this page");
    expect(bar.findAll("button").map((b) => b.text())).toEqual(["General", "AutoObserve"]);
    expect(autoobserve.text()).toContain("AutoObserve");
    expect(insights.exists()).toBe(true);
    const html = w.html();
    expect(html.indexOf("SlackWorkspaceCard")).toBeLessThan(html.indexOf("SlackInsightsSection"));
    expect(slack.getInsightsSettings).toHaveBeenCalledWith("acme");
  });

  it("is today's page when the server answers that insights are off", async () => {
    oneWorkspace();
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    const { bar, autoobserve, insights } = sections(w);
    expect(bar.exists()).toBe(false);
    expect(autoobserve.exists()).toBe(false);
    expect(insights.exists()).toBe(false);
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(true);
  });

  it("is today's page in an OSS build and never asks for the settings", async () => {
    config.isEnterprise = "false";
    oneWorkspace();
    settingsOn();
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(sections(w).bar.exists()).toBe(false);
    expect(sections(w).insights.exists()).toBe(false);
    expect(slack.getInsightsSettings).not.toHaveBeenCalled();
  });

  it("adds nothing with no workspace connected (D8)", async () => {
    settingsOn();
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.find('[data-test-stub="SlackConnectEmpty"]').exists()).toBe(true);
    expect(sections(w).bar.exists()).toBe(false);
    expect(slack.getInsightsSettings).not.toHaveBeenCalled();
  });

  it("keeps the AutoObserve section, with its own load error, when the read fails", async () => {
    oneWorkspace();
    vi.mocked(slack.getInsightsSettings).mockRejectedValue(axiosError(400));
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(sections(w).bar.exists()).toBe(true);
    expect(sections(w).insights.exists()).toBe(true);
  });

  it("holds the page loader until the settings answer, so nothing moves in", async () => {
    oneWorkspace();
    let answer: (value: unknown) => void = () => {};
    vi.mocked(slack.getInsightsSettings).mockReturnValue(
      new Promise((resolve) => (answer = resolve)) as any,
    );
    const w = mountSlack({ slack_enabled: true });
    await flushPromises();
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(false);
    answer({
      data: { channel: null, digest_time: "09:00", post_trial_findings: false, revision: 0 },
    });
    await flushPromises();
    expect(w.find('[data-test-stub="SlackWorkspaceCard"]').exists()).toBe(true);
    expect(sections(w).bar.exists()).toBe(true);
  });

  it("puts the sections' unsaved settings in one pinned bar that saves, discards and guards leaving", async () => {
    const part = {
      changes: () => 2,
      errors: () => 1,
      save: vi.fn(async () => true),
      discard: vi.fn(),
    };
    const linking = defineComponent({
      name: "SlackLinkingSection",
      props: ["installation"],
      setup() {
        useSlackSavePart(part);
        return () => h("div");
      },
    });
    oneWorkspace();
    const w = mount(Slack, {
      global: {
        plugins: [i18n, makeSlackStore({ slack_enabled: true })],
        stubs: { ...STUBS, SlackLinkingSection: linking },
      },
    });
    await flushPromises();
    expect(w.find('[data-test="slack-save-bar-status"]').text()).toContain("2");
    expect(w.find('[data-test="slack-save-bar-fix"]').exists()).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await w.find('[data-test="slack-save-bar-save"]').trigger("click");
    await flushPromises();
    expect(part.save).toHaveBeenCalledTimes(1);
    await w.find('[data-test="slack-save-bar-discard"]').trigger("click");
    expect(part.discard).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it.each([
    {
      name: "Add another workspace",
      go: (w: ReturnType<typeof mountSlack>) =>
        w.find('[data-test="slack-add-workspace"]').trigger("click"),
    },
    {
      name: "another workspace's tab",
      go: (w: ReturnType<typeof mountSlack>) =>
        w.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "inst-2"),
    },
    {
      name: "Go to Reinstall in another workspace",
      go: (w: ReturnType<typeof mountSlack>) =>
        w.findComponent({ name: "SlackInsightsSection" }).vm.$emit("reinstall", "inst-2"),
    },
  ])("asks before $name replaces a workspace's unsaved settings", async ({ go }) => {
    const dirty = ref(true);
    const linking = defineComponent({
      name: "SlackLinkingSection",
      props: ["installation"],
      setup() {
        useSlackSavePart({
          changes: () => Number(dirty.value),
          errors: () => 0,
          save: async () => true,
          discard: () => (dirty.value = false),
        });
        return () => h("div");
      },
    });
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView(), installationView({ id: "inst-2" })] }) as any,
    );
    settingsOn();
    Element.prototype.scrollIntoView = vi.fn();
    const w = mount(Slack, {
      global: {
        plugins: [i18n, makeSlackStore({ slack_enabled: true })],
        stubs: { ...STUBS, SlackLinkingSection: linking },
      },
    });
    await flushPromises();
    const dialog = useConfirmDialog();
    const shown = () => {
      const card = w.findComponent({ name: "SlackWorkspaceCard" });
      return card.exists() ? card.props("installation").id : null;
    };

    await go(w);
    await flushPromises();
    expect(dialog.currentDialog.value).not.toBeNull();
    dialog.handleCancel();
    await flushPromises();
    expect([shown(), dirty.value]).toEqual(["inst-1", true]);

    await go(w);
    await flushPromises();
    dialog.handleConfirm();
    await flushPromises();
    expect([shown() === "inst-1", dirty.value]).toEqual([false, false]);
    w.unmount();
  });

  it.each([
    {
      form: "help contact",
      real: "SlackWorkspaceCard" as const,
      edit: (w: ReturnType<typeof mountSlack>, value: string) =>
        w.find('[data-test="slack-help-contact"] input').setValue(value),
      values: ["#first", "#o2-help"],
      sent: () => slack.putHelpContact,
    },
    {
      form: "linking",
      real: "SlackLinkingSection" as const,
      edit: (w: ReturnType<typeof mountSlack>) =>
        w.find('[data-test="slack-linking-switch"] button').trigger("click"),
      values: ["off", "on"],
      sent: () => slack.updateLinking,
    },
  ])(
    "asks before leaving a $form draft put back to its old value after the save, while the refresh is still out",
    async ({ real, edit, values, sent }) => {
      oneWorkspace();
      settingsOn();
      vi.mocked(slack.getHelpContact).mockReturnValue(ok({ help_contact: "#o2-help" }) as any);
      vi.mocked(slack.getLinking).mockReturnValue(ok(linkingView({ source: "manual" })) as any);
      vi.mocked(slack.putHelpContact).mockReturnValue(ok({}) as any);
      vi.mocked(slack.updateLinking).mockReturnValue(ok({}) as any);
      const { [real]: _real, ...stubs } = STUBS;
      const w = mount(Slack, {
        attachTo: document.body,
        global: {
          plugins: [i18n, makeSlackStore({ slack_enabled: true })],
          stubs: { ...stubs, OTable: OTableStub, SlackCredentialsDialog: true },
        },
      });
      await flushPromises();
      const dialog = useConfirmDialog();

      await edit(w, values[0]);
      const never = new Promise(() => {});
      vi.mocked(slack.getHelpContact).mockReturnValue(never as any);
      vi.mocked(slack.getLinking).mockReturnValue(never as any);
      await w.find('[data-test="slack-save-bar-save"]').trigger("click");
      await vi.waitFor(() => expect(sent()).toHaveBeenCalledTimes(1));
      await flushPromises();
      await edit(w, values[1]);
      await flushPromises();

      expect(w.find('[data-test="slack-save-bar"]').attributes("data-state")).toBe("changed");
      await w.find('[data-test="slack-add-workspace"]').trigger("click");
      await flushPromises();
      expect(dialog.currentDialog.value).not.toBeNull();
      dialog.handleCancel();
      await flushPromises();
      w.unmount();
    },
  );

  it("a save still open in a workspace that was left does not hold Save in the next workspace", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(
      ok({ installations: [installationView(), installationView({ id: "inst-2" })] }) as any,
    );
    settingsOn();
    vi.mocked(slack.getHelpContact).mockReturnValue(ok({ help_contact: "#o2-help" }) as any);
    vi.mocked(slack.putHelpContact).mockReturnValueOnce(new Promise(() => {}) as any);
    vi.mocked(slack.putHelpContact).mockReturnValue(ok({}) as any);
    const { SlackWorkspaceCard: _real, ...stubs } = STUBS;
    const w = mount(Slack, {
      attachTo: document.body,
      global: {
        plugins: [i18n, makeSlackStore({ slack_enabled: true })],
        stubs: { ...stubs, OTable: OTableStub, SlackCredentialsDialog: true },
      },
    });
    await flushPromises();
    const dialog = useConfirmDialog();
    const edit = (value: string) =>
      w.find('[data-test="slack-help-contact"] input').setValue(value);
    const save = () => w.find('[data-test="slack-save-bar-save"]').trigger("click");

    await edit("#first");
    await save();
    await vi.waitFor(() => expect(slack.putHelpContact).toHaveBeenCalledTimes(1));
    w.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "inst-2");
    await flushPromises();
    dialog.handleConfirm();
    await flushPromises();
    await edit("#second");
    await save();
    await flushPromises();

    expect(vi.mocked(slack.putHelpContact).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ["acme", "inst-1", { help_contact: "#first" }],
      ["acme", "inst-2", { help_contact: "#second" }],
    ]);
    w.unmount();
  });

  describe("Go to Reinstall (F3)", () => {
    const card = {
      name: "SlackWorkspaceCard",
      props: ["installation", "isCloud"],
      template: `<div data-test-stub="SlackWorkspaceCard" :data-installation="installation.id">
        <button v-if="!installation.credentials_readable" data-test="slack-credentials-reinstall" />
        <button v-if="!installation.managed" data-test="slack-reinstall" />
      </div>`,
    };
    const mountWith = async (installations: ReturnType<typeof installationView>[]) => {
      vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations }) as any);
      settingsOn();
      const w = mount(Slack, {
        attachTo: document.body,
        global: {
          plugins: [i18n, makeSlackStore({ slack_enabled: true })],
          stubs: { ...STUBS, SlackWorkspaceCard: card },
        },
      });
      await flushPromises();
      return w;
    };
    const goTo = async (w: Awaited<ReturnType<typeof mountWith>>, id: string) => {
      w.findComponent({ name: "SlackInsightsSection" }).vm.$emit("reinstall", id);
      await flushPromises();
    };
    const focused = () => document.activeElement?.getAttribute("data-test");
    const shown = (w: Awaited<ReturnType<typeof mountWith>>) =>
      w.find('[data-test-stub="SlackWorkspaceCard"]').attributes("data-installation");

    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("switches to the affected workspace and focuses its Reinstall", async () => {
      const w = await mountWith([
        installationView({ team_name: "demo-workspace" }),
        installationView({ id: "inst-2", team_name: "demo-workspace-eu", status: "revoked" }),
      ]);
      const before = shown(w);
      await goTo(w, "inst-2");
      expect(before).not.toBe("inst-2");
      expect(shown(w)).toBe("inst-2");
      expect(focused()).toBe("slack-reinstall");
      w.unmount();
    });

    it("focuses the credentials Reinstall when Cloud cannot read the credentials", async () => {
      const w = await mountWith([
        installationView({ status: "revoked", credentials_readable: false }),
      ]);
      await goTo(w, "inst-1");
      expect(focused()).toBe("slack-credentials-reinstall");
      w.unmount();
    });
  });
});
