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

import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
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
    updateOwnershipRule: vi.fn(),
    deleteOwnershipRule: vi.fn(),
    previewRouting: vi.fn(),
    unroutedSignals: vi.fn(),
    dismissUnroutedSignal: vi.fn(),
    testPage: vi.fn(),
    getRoutingConfig: vi.fn(),
    setRoutingConfig: vi.fn(),
  },
}));
// Hoisted so every useRouter() call shares ONE spy — a fresh vi.fn() per call
// records the navigation onto an object the test can no longer see.
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

import alertsService from "@/services/alerts";

const service = vi.mocked(oncallService);
const alerts = vi.mocked(alertsService);
const ORG = store.state.selectedOrganization.identifier;

/// The sections are stubbed so this file is about the WIRING between them and
/// the org-level API — each section has its own spec for what it renders.
const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    template: "<div><slot name='actions' /><slot /></div>",
  },
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
  OnCallRuleEditor: {
    name: "OnCallRuleEditor",
    props: ["open", "rule", "initialDimensions", "teams", "aliases", "catalogue", "services", "signals", "saving"],
    template: "<div />",
  },
  OnCallUnroutedQueue: {
    name: "OnCallUnroutedQueue",
    props: ["signals", "loading", "teams"],
    template: "<div />",
  },
  OnCallDefaultTeamCard: {
    name: "OnCallDefaultTeamCard",
    props: ["teams", "dialog"],
    template: "<div />",
  },
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: "<button><slot /></button>",
  },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
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
  OButton: {
    name: "OButton",
    props: ["disabled", "active"],
    template: "<button><slot /></button>",
  },
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
  OSwitch: {
    name: "OSwitch",
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    template: "<button />",
  },
};

const TEAMS = [
  {
    id: "team_1",
    org_id: "default",
    name: "Platform",
    timezone: "UTC",
    created_at: 0,
    updated_at: 0,
  },
  {
    id: "team_2",
    org_id: "default",
    name: "Payments",
    timezone: "UTC",
    created_at: 0,
    updated_at: 0,
  },
];

function render() {
  return mount(OnCallRouting, {
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const rulesPanel = (w: Wrapper) => w.findComponent({ name: "OnCallOwnershipRules" });
const unrouted = (w: Wrapper) => w.findComponent({ name: "OnCallUnroutedQueue" });
/// The rule form is a shared component, not this view's own dialog. Asserting
/// against the editor rather than reaching through it to an ODialog is what
/// keeps this test honest when the editor's internals change — and the page
/// carried a near-duplicate of that dialog until 2026-08-21, which is exactly
/// the drift a test pointed at the contract would have caught.
const editor = (w: Wrapper) => w.findComponent({ name: "OnCallRuleEditor" });
const simulator = (w: Wrapper) => w.findComponent({ name: "OnCallRoutingSimulator" });

/// The queue lives behind the second tab, so a test about it starts by asking
/// for that list.
async function showSignals(w: Wrapper) {
  w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "signals");
  await flushPromises();
}

describe("OnCallRouting", () => {
  beforeEach(() => {
    // The catch-all is cached module-wide so one screen reads it once;
    // without this it survives into the next test.
    __resetOnCallRoutingConfig();
    vi.clearAllMocks();
    service.listTeams.mockResolvedValue({ data: TEAMS } as any);
    service.ownershipStats.mockResolvedValue({ data: { rules: [], total: 0 } } as any);
    service.unroutedSignals.mockResolvedValue({ data: [] } as any);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as any);
    service.updateOwnershipRule.mockResolvedValue({ data: {} } as any);
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
    await showSignals(wrapper);

    unrouted(wrapper).vm.$emit("claim", signal);
    await flushPromises();
    expect(editor(wrapper).props("open")).toBe(true);
    // The evidence dimensions are dropped before the editor ever sees them: a
    // pod name survives neither a restart nor a redeploy.
    expect(editor(wrapper).props("initialDimensions")).toEqual({
      service: "disputes-api",
      "k8s-namespace": "payments-edge",
    });

    editor(wrapper).vm.$emit("save", {
      team_id: "team_2",
      dimensions: { service: "disputes-api", "k8s-namespace": "payments-edge" },
    });
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

  /// The tester answers a hypothetical; the rules answer what is configured.
  /// Shipping it open costs the reader the top of the page every visit.
  it("keeps the tester closed until the header asks for it", async () => {
    const wrapper = render();
    await flushPromises();
    expect(simulator(wrapper).exists()).toBe(false);

    await wrapper.find('[data-test="oncall-routing-test-signal"]').trigger("click");
    expect(simulator(wrapper).exists()).toBe(true);
    // In a drawer, so opening it does not push the lists down the page.
    expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(true);
  });

  /// Nominating a catch-all is a one-time act, but whether one exists is a
  /// standing fact — so the trigger is in the header on both tabs.
  it("carries the catch-all trigger on both tabs", async () => {
    const wrapper = render();
    await flushPromises();
    const card = () => wrapper.findComponent({ name: "OnCallDefaultTeamCard" });
    expect(card().props("dialog")).toBe(true);

    await showSignals(wrapper);
    expect(card().exists()).toBe(true);
  });

  /// Add rule writes a rule, so it belongs to the tab that lists them — on the
  /// queue the row's own "write the rule" is the pre-filled version of it.
  it("offers Add rule on the rules list only, and opens the dialog", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-add-rule"]').exists()).toBe(true);

    await wrapper.find('[data-test="oncall-routing-add-rule"]').trigger("click");
    expect(editor(wrapper).props("open")).toBe(true);

    await showSignals(wrapper);
    expect(wrapper.find('[data-test="oncall-routing-add-rule"]').exists()).toBe(false);
  });

  /// One list at a time: rules are what the org owns, the queue is what it
  /// does not.
  it("switches between the rules and the queue", async () => {
    const wrapper = render();
    await flushPromises();
    expect(rulesPanel(wrapper).exists()).toBe(true);
    expect(unrouted(wrapper).exists()).toBe(false);

    await showSignals(wrapper);
    expect(rulesPanel(wrapper).exists()).toBe(false);
    expect(unrouted(wrapper).exists()).toBe(true);
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
    // The rules tab is what opens; the failure is on the list it names.
    expect(rulesPanel(wrapper).exists()).toBe(true);

    await showSignals(wrapper);
    expect(wrapper.find('[data-test="oncall-unrouted-error"]').exists()).toBe(true);
    expect(unrouted(wrapper).exists()).toBe(false);
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
  /// rather than sieving rows the client already has. They live in the page's
  /// own toolbar now, next to the tabs, so the tabs' OToggleGroup is index 0
  /// and the landing filter's is index 1.
  it("refetches the queue with the announced filters", async () => {
    const wrapper = render();
    await flushPromises();
    await showSignals(wrapper);

    wrapper
      .findAllComponents({ name: "OToggleGroup" })[1]
      .vm.$emit("update:modelValue", "nobody");
    await flushPromises();

    wrapper.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
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

  /// Reported from the browser: neither header button appeared. Every other
  /// test here stubs OPageLayout, so all of them stayed green while the real
  /// one rendered nothing — a `v-if` ON the `<template #actions>` makes the
  /// slot absent at first render, and OPageLayout's `useSlots()` check never
  /// sees it arrive. The condition belongs INSIDE the slot.
  it("renders the header actions through the real page layout", async () => {
    const { OPageLayout: _stubbedLayout, ...realLayout } = stubs;
    const wrapper = mount(OnCallRouting, {
      global: { plugins: [i18n, store], stubs: realLayout },
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-routing-test-signal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-add-rule"]').exists()).toBe(true);
  });
});
