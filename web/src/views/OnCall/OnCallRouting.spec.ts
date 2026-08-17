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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallRouting from "@/views/OnCall/OnCallRouting.vue";

vi.mock("@/services/alerts", () => ({
  default: { getSemanticGroups: vi.fn() },
}));
vi.mock("@/services/oncall", () => ({
  default: {
    listTeams: vi.fn(),
    ownershipStats: vi.fn(),
    createOwnershipRule: vi.fn(),
    deleteOwnershipRule: vi.fn(),
    previewRouting: vi.fn(),
    unroutedSignals: vi.fn(),
    dismissUnroutedSignal: vi.fn(),
    testPage: vi.fn(),
    getRoutingConfig: vi.fn(),
    setRoutingConfig: vi.fn(),
  },
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import alertsService from "@/services/alerts";

const service = vi.mocked(oncallService);
const alerts = vi.mocked(alertsService);
const ORG = store.state.selectedOrganization.identifier;

/// The sections are stubbed so this file is about the WIRING between them and
/// the org-level API — each section has its own spec for what it renders.
const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot /></div>" },
  OnCallRoutingSimulator: {
    name: "OnCallRoutingSimulator",
    props: ["preview", "teams", "aliases", "loading", "sending"],
    template: "<div />",
  },
  OnCallOwnershipRules: {
    name: "OnCallOwnershipRules",
    props: ["rules", "aliases", "loading", "showTeam"],
    template: "<div />",
  },
  OnCallUnroutedQueue: {
    name: "OnCallUnroutedQueue",
    props: ["signals", "loading", "teams", "filterable"],
    template: "<div />",
  },
  OnCallDefaultTeamCard: {
    name: "OnCallDefaultTeamCard",
    props: ["teams"],
    template: "<div />",
  },
  OEmptyState: {
    name: "OEmptyState",
    props: ["title", "actionLabel"],
    emits: ["action"],
    template: "<div><slot /></div>",
  },
  ODialog: {
    name: "ODialog",
    props: ["open", "primaryButtonDisabled", "title"],
    template: "<div><slot /></div>",
  },
  ConfirmDialog: { name: "ConfirmDialog", props: ["modelValue"], template: "<div />" },
  OButton: { name: "OButton", props: ["disabled"], template: "<button><slot /></button>" },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select :value="modelValue" />`,
  },
};

const TEAMS = [
  { id: "team_1", org_id: "default", name: "Platform", timezone: "UTC", created_at: 0, updated_at: 0 },
  { id: "team_2", org_id: "default", name: "Payments", timezone: "UTC", created_at: 0, updated_at: 0 },
];

function render() {
  return mount(OnCallRouting, {
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const rulesPanel = (w: Wrapper) => w.findComponent({ name: "OnCallOwnershipRules" });
const unrouted = (w: Wrapper) => w.findComponent({ name: "OnCallUnroutedQueue" });
const dialog = (w: Wrapper) => w.findComponent({ name: "ODialog" });

describe("OnCallRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.listTeams.mockResolvedValue({ data: TEAMS } as any);
    service.ownershipStats.mockResolvedValue({ data: { rules: [], total: 0 } } as any);
    service.unroutedSignals.mockResolvedValue({ data: [] } as any);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as any);
    alerts.getSemanticGroups.mockResolvedValue({ data: [] } as any);
  });

  /// The whole point of the org screen: no team_id, so shadowing is computed
  /// across every team's rules, not one team's slice.
  it("asks for the org-wide rules, not one team's", async () => {
    render();
    await flushPromises();
    expect(service.ownershipStats).toHaveBeenCalledWith({ org_identifier: ORG });
  });

  it("hosts the rules table in team-naming mode", async () => {
    const wrapper = render();
    await flushPromises();
    expect(rulesPanel(wrapper).props("showTeam")).toBe(true);
  });

  /// G4: claiming an unrouted signal opens the rule dialog with the failing
  /// path already filled — the user picks the team and confirms. The evidence
  /// dimensions (a pod name survives neither restart nor redeploy) must not
  /// leak into the rule.
  it("pre-fills a claim with the identity dimensions and asks which team", async () => {
    const signal = {
      id: "s1",
      org_id: "default",
      path: "service=disputes-api",
      dimensions: {
        service: "disputes-api",
        "k8s-namespace": "payments-edge",
        "k8s-pod-name": "disputes-7f9",
      },
      occurrences: 4,
      first_seen_at: 0,
      last_seen_at: 0,
    };
    service.unroutedSignals.mockResolvedValue({ data: [signal] } as any);
    const wrapper = render();
    await flushPromises();

    unrouted(wrapper).vm.$emit("claim", signal);
    await flushPromises();
    expect(dialog(wrapper).props("open")).toBe(true);
    // No team chosen yet — the rule cannot be written.
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(true);

    await wrapper
      .findComponent('[data-test="oncall-routing-rule-team"]')
      .vm.$emit("update:modelValue", "team_2");
    expect(dialog(wrapper).props("primaryButtonDisabled")).toBe(false);

    dialog(wrapper).vm.$emit("click:primary");
    await flushPromises();
    expect(service.createOwnershipRule).toHaveBeenCalledWith({
      org_identifier: ORG,
      data: {
        team_id: "team_2",
        dimensions: { service: "disputes-api", "k8s-namespace": "payments-edge" },
      },
    });
    // Both lists changed: the rule exists, and the path stops being unrouted.
    expect(service.ownershipStats).toHaveBeenCalledTimes(2);
    expect(service.unroutedSignals).toHaveBeenCalledTimes(2);
  });

  /// B8: a transient 500 is not "this org has no rules". The failure gets a
  /// named error state with a way back, never an empty-looking screen.
  it("renders a retryable error when the backbone fails, then recovers", async () => {
    service.ownershipStats.mockRejectedValueOnce(new Error("boom"));
    const wrapper = render();
    await flushPromises();
    const error = wrapper.find('[data-test="oncall-routing-error"]');
    expect(error.exists()).toBe(true);

    service.ownershipStats.mockResolvedValue({ data: { rules: [], total: 0 } } as any);
    wrapper.findComponent('[data-test="oncall-routing-error"]').vm.$emit("action");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-routing-content"]').exists()).toBe(true);
  });

  /// The queue's failure must not read as "everything is routed" — that is
  /// this screen's core claim. The rest of the page keeps working.
  it("shows the queue's own error without taking down the page", async () => {
    service.unroutedSignals.mockRejectedValue(new Error("500"));
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-unrouted-error"]').exists()).toBe(true);
    expect(unrouted(wrapper).exists()).toBe(false);
    expect(rulesPanel(wrapper).exists()).toBe(true);
  });

  /// §G.8.1: 404 = feature flag off, 403 "Not Supported" = OSS build. Both are
  /// a fact about the deployment — never an error state, never a retry, and
  /// the two must be indistinguishable on screen.
  it("renders 404 and 403-Not-Supported as the same calm not-available state", async () => {
    for (const rejection of [
      { response: { status: 404, data: {} } },
      { response: { status: 403, data: { message: "Not Supported" } } },
    ]) {
      service.listTeams.mockRejectedValue(rejection);
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-unavailable"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-routing-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-routing-content"]').exists()).toBe(false);
    }
  });

  /// The same status with the permission message stays an error — a viewer
  /// without the grant must not be told the product does not exist.
  it("keeps 403 Forbidden an error, not an absence", async () => {
    service.listTeams.mockRejectedValue({
      response: { status: 403, data: { message: "Forbidden" } },
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-unavailable"]').exists()).toBe(false);
  });

  /// The queue's filters are the server's — a change refetches with the params
  /// rather than sieving rows the client already has.
  it("refetches the queue with the announced filters", async () => {
    const wrapper = render();
    await flushPromises();

    unrouted(wrapper).vm.$emit("change-filters", {
      landing: "nobody",
      include_dismissed: true,
    });
    await flushPromises();
    expect(service.unroutedSignals).toHaveBeenLastCalledWith({
      org_identifier: ORG,
      landing: "nobody",
      include_dismissed: true,
    });
  });

  /// Reported from the browser: "add rule does nothing — there is no save and
  /// no cancel". Every other test here stubs ODialog, so all of them stayed
  /// green while the real dialog rendered no footer at all: the call site
  /// passed `primary-label`, ODialog declares `primaryButtonLabel`, unknown
  /// props fall through as attributes, and `hasFooter` saw nothing.
  ///
  /// This one mounts the REAL dialog. It is the only assertion in the file
  /// that can fail when the prop NAMES are wrong rather than their values.
  it("opens a real dialog with a working Save and Cancel", async () => {
    const { default: ODialog } = await import("@/lib/overlay/Dialog/ODialog.vue");
    const wrapper = mount(OnCallRouting, {
      global: { plugins: [i18n, store], stubs: { ...stubs, ODialog } },
      attachTo: document.body,
    });
    await flushPromises();

    rulesPanel(wrapper).vm.$emit("add");
    await flushPromises();

    // Teleported to the body, so the assertion has to look there.
    const dialogHtml = document.body.innerHTML;
    expect(dialogHtml).toContain("o-dialog-primary-btn");
    expect(dialogHtml).toContain("o-dialog-secondary-btn");
    expect(dialogHtml).toContain("Save rule");

    wrapper.unmount();
  });

  /// Nothing can own or be paged before a team exists — routing starts there.
  it("points an org with no teams at the Teams screen", async () => {
    service.listTeams.mockResolvedValue({ data: [] } as any);
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-content"]').exists()).toBe(false);
  });
});
