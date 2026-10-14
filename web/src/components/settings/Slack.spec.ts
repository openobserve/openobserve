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
import Slack from "./Slack.vue";
import { axiosError, installationView, makeSlackStore, ok } from "@/test/unit/helpers/slack";

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
  SlackPrerequisites: stub("SlackPrerequisites", ["checks"]),
};

const prereqs = {
  checks: [
    {
      id: "master_key",
      status: "fail",
      detail: "Not set",
      variable: "O2_MASTER_ENCRYPTION_KEY",
      fix: null,
    },
  ],
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
  vi.mocked(slack.getPrerequisites).mockReturnValue(ok(prereqs) as any);
  vi.mocked(slack.listInstallations).mockReturnValue(
    ok({ installations: [], available: [] }) as any,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Slack settings: disabled screens (self-hosted enterprise)", () => {
  it("AC-1.5 names O2_SLACK_ENABLED and shows only text outside the _meta org", async () => {
    const w = mountSlack(disabled("flag", { meta_org: "_meta" }));
    await flushPromises();
    expect(w.find('[data-test="slack-disabled"]').text()).toContain("O2_SLACK_ENABLED");
    expect(slack.getPrerequisites).not.toHaveBeenCalled();
    expect(w.find('[data-test-stub="SlackPrerequisites"]').exists()).toBe(false);
    expect(slack.listInstallations).not.toHaveBeenCalled();
  });

  it("AC-1.5 shows Step 0 inline to a _meta Admin when the flag is off", async () => {
    const store = makeSlackStore(disabled("flag", { meta_org: "_meta" }));
    store.state.selectedOrganization.identifier = "_meta";
    const w = mount(Slack, { global: { plugins: [i18n, store], stubs: STUBS } });
    await flushPromises();
    expect(slack.getPrerequisites).toHaveBeenCalledWith("_meta", { silentForbidden: true });
    expect(w.find('[data-test-stub="SlackPrerequisites"]').exists()).toBe(true);
  });

  it("AC-1.5 keeps text only for a _meta member the server refuses", async () => {
    vi.mocked(slack.getPrerequisites).mockRejectedValue(axiosError(403));
    const store = makeSlackStore(disabled("flag", { meta_org: "_meta" }));
    store.state.selectedOrganization.identifier = "_meta";
    const w = mount(Slack, { global: { plugins: [i18n, store], stubs: STUBS } });
    await flushPromises();
    expect(w.find('[data-test-stub="SlackPrerequisites"]').exists()).toBe(false);
    expect(w.find('[data-test="slack-disabled"]').text()).toContain("O2_SLACK_ENABLED");
  });

  it("AC-1.5 names O2_MASTER_ENCRYPTION_KEY and shows Step 0 to org Admins", async () => {
    const w = mountSlack(disabled("master_key"));
    await flushPromises();
    expect(w.find('[data-test="slack-disabled"]').text()).toContain("O2_MASTER_ENCRYPTION_KEY");
    expect(slack.getPrerequisites).toHaveBeenCalledWith("acme", { silentForbidden: true });
    expect(w.find('[data-test-stub="SlackPrerequisites"]').exists()).toBe(true);
  });

  it("AC-1.5 keeps text only with master_key for a non-admin", async () => {
    vi.mocked(slack.getPrerequisites).mockRejectedValue(axiosError(403));
    const w = mountSlack(disabled("master_key"));
    await flushPromises();
    expect(w.find('[data-test-stub="SlackPrerequisites"]').exists()).toBe(false);
  });

  it("AC-3.3 home_region_unset names O2_SLACK_HOME_REGION", async () => {
    const w = mountSlack(disabled("home_region_unset"));
    await flushPromises();
    expect(w.find('[data-test="slack-disabled"]').text()).toContain("O2_SLACK_HOME_REGION");
    expect(slack.getPrerequisites).not.toHaveBeenCalled();
  });

  it("AC-3.3 other_region names the region that owns Slack", async () => {
    const w = mountSlack(disabled("other_region", { slack_home_region: "us-west" }));
    await flushPromises();
    const text = w.find('[data-test="slack-other-region"]').text();
    expect(text).toContain("us-west");
    expect(text).toContain("Open OpenObserve in that region");
  });

  it("AC-1.4 AC-3.3 shows nothing on Cloud while Slack is disabled", async () => {
    config.isCloud = "true";
    for (const reason of ["flag", "other_region", "allowlist"]) {
      const w = mountSlack(disabled(reason, { slack_home_region: "us-west" }));
      await flushPromises();
      expect(w.find('[data-test="slack-disabled"]').exists()).toBe(false);
      expect(w.find('[data-test="slack-other-region"]').exists()).toBe(false);
      w.unmount();
    }
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
});
