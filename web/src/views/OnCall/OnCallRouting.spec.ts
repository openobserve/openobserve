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

import { resetOnCallPermissions } from "@/composables/useOnCallPermissions";
import { __resetOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import OnCallRouting from "@/views/OnCall/OnCallRouting.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

// The queries call these through the default export, so that is what is mocked.
vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: vi.fn(),
    getServicesList: vi.fn(),
    getDimensionAnalytics: vi.fn(),
  },
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
    whoIsOnCall: vi.fn(),
  },
}));
// Hoisted so every useRouter() call shares ONE spy — a fresh vi.fn() per call
// records the navigation onto an object the test can no longer see.
const push = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push, resolve: () => ({ href: "" }) }),
  useRoute: () => ({ query: routeQuery.value }),
}));

import { queryClient } from "@/composables/query/queryClient";
import { oncallKeys } from "@/services/oncall.querykeys";
import serviceStreamsService from "@/services/service_streams";
import { axiosReply } from "@/test/unit/helpers/mockService";

const service = vi.mocked(oncallService);
const correlation = vi.mocked(serviceStreamsService);
const correlationReads = () => [
  correlation.getSemanticGroups,
  correlation.getServicesList,
  correlation.getDimensionAnalytics,
];
const ORG = store.state.selectedOrganization.identifier;

/// The sections are stubbed so this file is about the WIRING between them and
/// the org-level API — each section has its own spec for what it renders.
const openDefaultDialog = vi.fn();

const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    template: "<div><slot name='actions' /><slot /></div>",
  },
  OnCallRoutingSimulator: {
    name: "OnCallRoutingSimulator",
    props: [
      "preview",
      "teams",
      "aliases",
      "signals",
      "rules",
      "seed",
      "loading",
      "sending",
      "canConfigure",
      "testResult",
    ],
    template: "<div />",
  },
  OnCallOwnershipRules: {
    name: "OnCallOwnershipRules",
    props: [
      "rules",
      "teams",
      "aliases",
      "teamId",
      "defaultTeamId",
      "loading",
      "search",
      "editable",
    ],
    template: "<div><slot name='toolbar' /><slot name='toolbar-trailing' /></div>",
  },
  OnCallRuleEditor: {
    name: "OnCallRuleEditor",
    props: [
      "open",
      "rule",
      "initialDimensions",
      "teams",
      "aliases",
      "catalogue",
      "services",
      "signals",
      "saving",
      "conflict",
    ],
    template: "<div />",
  },
  OnCallUnroutedQueue: {
    name: "OnCallUnroutedQueue",
    props: ["signals", "loading", "teams", "search", "error"],
    template: "<div><slot name='toolbar' /><slot name='toolbar-trailing' /></div>",
  },
  OnCallDefaultTeamCard: {
    name: "OnCallDefaultTeamCard",
    props: ["teams", "dialog", "showTrigger"],
    methods: { openDialog: openDefaultDialog },
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
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "okVariant", "okLabel", "messageKeypath", "messageName"],
    template: "<div />",
  },
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
  OCheckbox: {
    name: "OCheckbox",
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
  w.findAllComponents({ name: "OToggleGroup" })
    .find((c) => c.attributes("data-test") === "oncall-routing-tabs")!
    .vm.$emit("update:modelValue", "signals");
  await flushPromises();
}

describe("OnCallRouting", () => {
  beforeEach(() => {
    // The catch-all is cached module-wide so one screen reads it once;
    // without this it survives into the next test.
    __resetOnCallRoutingConfig();
    resetOnCallPermissions();
    vi.clearAllMocks();
    routeQuery.value = {};
    service.getRoutingConfig.mockResolvedValue({
      data: { org_id: "default", default_team_id: "team_2", updated_at: 0 },
    } as never);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as never);
    service.listTeams.mockResolvedValue({ data: TEAMS } as any);
    service.ownershipStats.mockResolvedValue({ data: { rules: [], total: 0 } } as any);
    service.unroutedSignals.mockResolvedValue({ data: [] } as any);
    service.createOwnershipRule.mockResolvedValue({ data: {} } as any);
    service.updateOwnershipRule.mockResolvedValue({ data: {} } as any);
    // Defined data, or nothing is cached and a remount re-reads anyway.
    correlation.getSemanticGroups.mockResolvedValue({ data: [] } as any);
    correlation.getServicesList.mockResolvedValue({ data: [] } as any);
    correlation.getDimensionAnalytics.mockResolvedValue({ data: { dimensions: [] } } as any);
  });

  /// Mounts the real page layout so the tag is proven to reach the rendered header.
  it("tags the page title as Beta", async () => {
    const wrapper = mount(OnCallRouting, {
      global: { plugins: [i18n, store], stubs: { ...stubs, OPageLayout: false } },
    });
    await flushPromises();
    const badge = wrapper.find('[data-test="beta-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe(String(i18n.global.t("common.beta")));
  });

  /// The whole point of the org screen: no team_id, so shadowing is computed
  /// across every team's rules, not one team's slice.
  it("asks for the org-wide rules, not one team's", async () => {
    render();
    await flushPromises();
    expect(service.ownershipStats).toHaveBeenCalledWith({ org_identifier: ORG });
  });

  it("hosts the shared rules list org-wide, with the catch-all team pinned", async () => {
    const wrapper = render();
    await flushPromises();
    expect(rulesPanel(wrapper).props("teamId")).toBeUndefined();
    expect(rulesPanel(wrapper).props("defaultTeamId")).toBe("team_2");
  });

  it("puts the precedence sentence behind an info icon, not a subtitle", () => {
    const wrapper = mount(OnCallRouting, {
      global: {
        plugins: [i18n, store],
        stubs: {
          ...stubs,
          OPageLayout: {
            name: "OPageLayout",
            props: ["subtitle"],
            template:
              "<div><span class='sub'>{{ subtitle }}</span><slot name='title-trail' /><slot /></div>",
          },
        },
      },
    });
    expect(wrapper.find(".sub").text()).toBe("");
    const info = wrapper.find('[data-test="oncall-routing-precedence-info"]');
    const precedence = String(i18n.global.t("oncall.routingPrecedence"));
    expect(info.attributes("tabindex")).toBe("0");
    expect(info.attributes("aria-label")).toBe(precedence);
    expect(
      wrapper
        .findAllComponents({ name: "OTooltip" })
        .some((c) => c.props("content") === precedence),
    ).toBe(true);
  });

  it("opens on the queue when linked there from a team's tab", async () => {
    routeQuery.value = { tab: "signals" };
    const wrapper = render();
    await flushPromises();
    expect(unrouted(wrapper).exists()).toBe(true);
  });

  it("asks to remove a rule with a destructive confirm button", async () => {
    const wrapper = render();
    await flushPromises();
    rulesPanel(wrapper).vm.$emit("remove", { rule_id: "r9", dimensions: { service: "cart" } });
    await wrapper.vm.$nextTick();
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    expect(dialog.props("modelValue")).toBe(true);
    expect(dialog.props("okVariant")).toBe("destructive");
    expect(dialog.props("okLabel")).toBe("Remove rule");
    expect(dialog.attributes("focus-cancel")).toBeDefined();
    expect(dialog.props("messageName")).toBe("Service cart");
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

  it("opens Test routing pre-filled from the signal that fell through most", async () => {
    service.unroutedSignals.mockResolvedValue({
      data: [
        { id: "s1", dimensions: { service: "rare" }, occurrences: 1 },
        { id: "s2", dimensions: { service: "noisy", "k8s-pod-name": "p" }, occurrences: 9 },
      ],
    } as never);
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-test-signal"]').trigger("click");
    expect(simulator(wrapper).props("seed")).toEqual({ service: "noisy" });
  });

  it("opens Test routing from a rule with that rule's conditions", async () => {
    const wrapper = render();
    await flushPromises();
    rulesPanel(wrapper).vm.$emit("test", { rule_id: "r1", dimensions: { service: "cart" } });
    await flushPromises();
    expect(simulator(wrapper).props("seed")).toEqual({ service: "cart" });
  });

  it("keeps the newest dry-run answer when an earlier one returns later", async () => {
    let resolveSlow!: (value: unknown) => void;
    service.previewRouting
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)) as never)
      .mockResolvedValueOnce({ data: { team_id: "team_2" } } as never);
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-test-signal"]').trigger("click");

    simulator(wrapper).vm.$emit("run", { dimensions: { service: "old" } });
    simulator(wrapper).vm.$emit("run", { dimensions: { service: "new" } });
    await flushPromises();
    expect(simulator(wrapper).props("preview")).toEqual({ team_id: "team_2" });
    expect(simulator(wrapper).props("loading")).toBe(false);

    resolveSlow({ data: { team_id: "team_1" } });
    await flushPromises();
    expect(simulator(wrapper).props("preview")).toEqual({ team_id: "team_2" });
    expect(simulator(wrapper).props("loading")).toBe(false);
  });

  it("keeps the conflict for the newest draft when an earlier preview returns later", async () => {
    let resolveSlow!: (value: unknown) => void;
    service.previewRouting
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)) as never)
      .mockResolvedValueOnce({ data: { team_id: "team_2" } } as never);
    const wrapper = render();
    await flushPromises();

    editor(wrapper).vm.$emit("preview", { service: "old" });
    editor(wrapper).vm.$emit("preview", { service: "new" });
    await flushPromises();
    resolveSlow({ data: { team_id: "team_1" } });
    await flushPromises();
    expect(editor(wrapper).props("conflict")).toEqual({ team_id: "team_2" });
  });

  /// A10: Send test page renders for everyone; the server's 403 is what closes it for the org.
  it("latches Send test page disabled after a 403 on the test page", async () => {
    service.testPage.mockRejectedValue({ response: { status: 403, data: {} } });
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-test-signal"]').trigger("click");
    expect(simulator(wrapper).props("canConfigure")).toBe(true);

    simulator(wrapper).vm.$emit("send-test", { team_id: "team_1", priority: "P1" });
    await flushPromises();

    expect(service.testPage).toHaveBeenCalled();
    expect(simulator(wrapper).props("canConfigure")).toBe(false);
  });

  /// The result stays in the simulator card, one row per attempt, rather than a toast that is gone in five seconds.
  it("hands the test page result to the simulator instead of a toast", async () => {
    const result = {
      reached_anyone: false,
      not_sent_because: null,
      channels: ["sms"],
      attempts: [
        {
          channel: "sms",
          recipient: "ana@o2.ai",
          reason: "on call now",
          delivered: false,
          detail: "Twilio 401: authenticate",
        },
      ],
    };
    service.testPage.mockResolvedValue({ data: result } as any);
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-test-signal"]').trigger("click");

    simulator(wrapper).vm.$emit("send-test", { team_id: "team_1", priority: "P1" });
    await flushPromises();

    expect(simulator(wrapper).props("testResult")).toEqual(result);
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  /// A failed send must not leave the previous send's result looking like this one's.
  it("clears the previous test page result when a new send starts", async () => {
    service.testPage.mockResolvedValueOnce({
      data: { reached_anyone: true, channels: ["email"], attempts: [] },
    } as any);
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="oncall-routing-test-signal"]').trigger("click");
    simulator(wrapper).vm.$emit("send-test", { team_id: "team_1", priority: "P1" });
    await flushPromises();
    expect(simulator(wrapper).props("testResult")).not.toBeNull();

    service.testPage.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    simulator(wrapper).vm.$emit("send-test", { team_id: "team_1", priority: "P2" });
    await flushPromises();

    expect(simulator(wrapper).props("testResult")).toBeNull();
  });

  it("changes the catch-all from the pinned row, not a header button", async () => {
    const wrapper = render();
    await flushPromises();
    const card = wrapper.findComponent({ name: "OnCallDefaultTeamCard" });
    expect(card.props("showTrigger")).toBe(false);

    rulesPanel(wrapper).vm.$emit("change-default");
    expect(openDefaultDialog).toHaveBeenCalledTimes(1);
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

  it("claims every unowned path for one team, once per path, after naming the outcome", async () => {
    const signal = (id: string, dimensions: Record<string, string>) => ({
      id,
      org_id: "default",
      path: "",
      dimensions,
      occurrences: 1,
    });
    service.ownershipStats.mockResolvedValue({
      data: { rules: [{ rule_id: "r1", team_id: "team_1", dimensions: { service: "owned" } }] },
    } as any);
    service.unroutedSignals.mockResolvedValue({
      data: [
        signal("s1", { service: "cart", "k8s-pod-name": "pod-1" }),
        signal("s2", { service: "cart", "k8s-pod-name": "pod-2" }),
        signal("s3", { service: "owned" }),
        signal("s4", { service: "search" }),
      ],
    } as never);
    const wrapper = render();
    await flushPromises();
    await showSignals(wrapper);
    expect(wrapper.find('[data-test="oncall-routing-add-rule"]').exists()).toBe(false);
    await wrapper.find('[data-test="oncall-routing-claim-all"]').trigger("click");

    const dialog = wrapper
      .findAllComponents({ name: "ODialog" })
      .find((c) => c.attributes("data-test") === "oncall-routing-claim-all-dialog")!;
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("primaryButtonDisabled")).toBe(true);
    wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "oncall-routing-claim-all-team")!
      .vm.$emit("update:modelValue", "team_2");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-claim-all-outcome"]').text()).toBe(
      "Future alerts like these go to Payments",
    );

    dialog.vm.$emit("click:primary");
    await flushPromises();
    const written = service.createOwnershipRule.mock.calls.map(
      (call) => (call[0] as { data: unknown }).data,
    );
    expect(written).toEqual([
      { team_id: "team_2", dimensions: { service: "cart" } },
      { team_id: "team_2", dimensions: { service: "search" } },
    ]);
    expect(toast).toHaveBeenCalledWith({
      variant: "success",
      message: "3 signals now go to Payments",
    });
  });

  it("counts claimable signals on the button and names the paths that failed", async () => {
    const signal = (id: string, dimensions: Record<string, string>) => ({
      id,
      org_id: "default",
      path: "",
      dimensions,
      occurrences: 1,
    });
    service.ownershipStats.mockResolvedValue({
      data: { rules: [{ rule_id: "r1", team_id: "team_1", dimensions: { service: "owned" } }] },
    } as never);
    service.unroutedSignals.mockResolvedValue({
      data: [
        signal("s1", { service: "cart", "k8s-pod-name": "pod-1" }),
        signal("s2", { service: "cart", "k8s-pod-name": "pod-2" }),
        signal("s3", { service: "owned" }),
        signal("s4", { service: "search" }),
      ],
    } as never);
    service.createOwnershipRule
      .mockResolvedValueOnce(axiosReply({}))
      .mockRejectedValueOnce({ response: { status: 500, data: {} } });
    const wrapper = render();
    await flushPromises();
    await showSignals(wrapper);
    expect(wrapper.find('[data-test="oncall-routing-claim-all"]').text()).toBe("Claim all 3");
    await wrapper.find('[data-test="oncall-routing-claim-all"]').trigger("click");
    wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "oncall-routing-claim-all-team")!
      .vm.$emit("update:modelValue", "team_2");
    await flushPromises();
    wrapper
      .findAllComponents({ name: "ODialog" })
      .find((c) => c.attributes("data-test") === "oncall-routing-claim-all-dialog")!
      .vm.$emit("click:primary");
    await flushPromises();

    expect(toast).toHaveBeenCalledWith({
      variant: "warning",
      message: expect.stringMatching(
        /^2 of 3 signals now go to Payments; could not claim .*search/,
      ),
    });
  });

  it("names every path in the error when no claim lands", async () => {
    service.unroutedSignals.mockResolvedValue({
      data: [
        { id: "s1", org_id: "default", path: "", dimensions: { service: "cart" }, occurrences: 1 },
      ],
    } as never);
    service.createOwnershipRule.mockRejectedValue({ response: { status: 500, data: {} } });
    const wrapper = render();
    await flushPromises();
    await showSignals(wrapper);
    await wrapper.find('[data-test="oncall-routing-claim-all"]').trigger("click");
    wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "oncall-routing-claim-all-team")!
      .vm.$emit("update:modelValue", "team_2");
    await flushPromises();
    wrapper
      .findAllComponents({ name: "ODialog" })
      .find((c) => c.attributes("data-test") === "oncall-routing-claim-all-dialog")!
      .vm.$emit("click:primary");
    await flushPromises();

    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: expect.stringMatching(/^Could not claim .*cart/),
    });
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

  it("shows the license empty state, not an error with the server text, for a license denial", async () => {
    service.listTeams.mockRejectedValueOnce({
      response: {
        status: 403,
        data: { code: 40001, message: "Features not included", error_detail: "oncall" },
      },
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-license-denied"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-error"]').exists()).toBe(false);
  });

  it("skips the correlation reads while correlation is license-locked", async () => {
    queryClient.clear();
    store.state.zoConfig.features = { correlation: "locked" };
    try {
      const wrapper = render();
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-routing-content"]').exists()).toBe(true);
      expect(correlation.getServicesList).not.toHaveBeenCalled();
      expect(correlation.getDimensionAnalytics).not.toHaveBeenCalled();
    } finally {
      delete store.state.zoConfig.features;
    }
  });

  it("reads the correlation catalogue while correlation is enabled", async () => {
    queryClient.clear();
    render();
    await flushPromises();
    expect(correlation.getServicesList).toHaveBeenCalled();
    expect(correlation.getDimensionAnalytics).toHaveBeenCalled();
  });

  /// A revisit pays for none of the three org reads; only the reader's Retry reaches the server.
  it("serves a revisit from the cache and forces on retry", async () => {
    service.ownershipStats.mockRejectedValueOnce(new Error("boom"));
    const first = render();
    await flushPromises();
    expect(service.listTeams).toHaveBeenCalledTimes(1);
    expect(service.ownershipStats).toHaveBeenCalledTimes(1);
    expect(service.unroutedSignals).toHaveBeenCalledTimes(1);

    for (const read of correlationReads()) expect(read).toHaveBeenCalledTimes(1);

    // Forced, so the reads that SUCCEEDED are asked again rather than served.
    first.findComponent('[data-test="oncall-routing-error"]').vm.$emit("action");
    await flushPromises();
    expect(service.listTeams).toHaveBeenCalledTimes(2);
    expect(service.ownershipStats).toHaveBeenCalledTimes(2);
    expect(service.unroutedSignals).toHaveBeenCalledTimes(2);
    for (const read of correlationReads()) expect(read).toHaveBeenCalledTimes(2);
    first.unmount();

    const second = render();
    await flushPromises();
    expect(second.find('[data-test="oncall-routing-content"]').exists()).toBe(true);
    expect(service.listTeams).toHaveBeenCalledTimes(2);
    expect(service.ownershipStats).toHaveBeenCalledTimes(2);
    expect(service.unroutedSignals).toHaveBeenCalledTimes(2);
    for (const read of correlationReads()) expect(read).toHaveBeenCalledTimes(2);
  });

  // The page's Refresh reaches the server for everything it shows, including the header card's own read.
  it("forces every read on Refresh and remounts the default-team card", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = render();
    await flushPromises();
    const cardBefore = wrapper.findComponent({ name: "OnCallDefaultTeamCard" }).vm;

    await wrapper.find('[data-test="oncall-routing-refresh"]').trigger("click");
    await flushPromises();

    expect(spy).toHaveBeenCalledWith({ queryKey: oncallKeys.all(ORG), refetchType: "none" });
    expect(service.listTeams).toHaveBeenCalledTimes(2);
    expect(service.ownershipStats).toHaveBeenCalledTimes(2);
    expect(service.unroutedSignals).toHaveBeenCalledTimes(2);
    for (const read of correlationReads()) expect(read).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent({ name: "OnCallDefaultTeamCard" }).vm).not.toBe(cardBefore);
    spy.mockRestore();
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
    // Inside the queue, so its toolbar — and the way back to the rules — stays up.
    expect(unrouted(wrapper).props("error")).toBeTruthy();
    expect(wrapper.find('[data-test="oncall-routing-tabs"]').exists()).toBe(true);

    service.unroutedSignals.mockResolvedValue({ data: [] } as any);
    const before = service.unroutedSignals.mock.calls.length;
    unrouted(wrapper).vm.$emit("retry");
    await flushPromises();
    expect(service.unroutedSignals.mock.calls.length).toBe(before + 1);
    expect(unrouted(wrapper).props("error")).toBeFalsy();
  });

  it("switches tables from the real toolbar toggle and shows each list's count", async () => {
    service.unroutedSignals.mockResolvedValue(
      axiosReply([
        { id: "s1", dimensions: { service: "api" } },
        { id: "s2", dimensions: { service: "web" } },
      ]),
    );
    const { OToggleGroup: _g, OToggleGroupItem: _i, OTag: _t, ...rest } = stubs;
    const wrapper = mount(OnCallRouting, { global: { plugins: [i18n, store], stubs: rest } });
    await flushPromises();

    const signalsTab = wrapper.find('[data-test="oncall-routing-tab-signals"]');
    expect(wrapper.find('[data-test="oncall-routing-tab-rules"]').attributes("data-state")).toBe(
      "on",
    );
    expect(wrapper.find('[data-test="oncall-routing-tab-signals-count"]').text()).toBe("2");

    await signalsTab.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-tab-signals"]').attributes("data-state")).toBe(
      "on",
    );
    expect(unrouted(wrapper).exists()).toBe(true);
    expect(rulesPanel(wrapper).exists()).toBe(false);
  });

  // One search box per tab; switching tabs clears it, since a rules query means nothing against the queue.
  it("hands the toolbar search to the open table, and clears it when the tab changes", async () => {
    const wrapper = render();
    await flushPromises();

    const search = wrapper.findComponent({ name: "OSearchInput" });
    expect(search.exists()).toBe(true);
    await search.vm.$emit("update:modelValue", "payments");
    expect(rulesPanel(wrapper).props("search")).toBe("payments");

    await showSignals(wrapper);
    expect(unrouted(wrapper).props("search")).toBe("");
  });

  // The tables' Clear filters asks the page, which owns the search box.
  it("empties the search box when either table asks to clear it", async () => {
    const wrapper = render();
    await flushPromises();
    const search = () => wrapper.findComponent({ name: "OSearchInput" });

    await search().vm.$emit("update:modelValue", "nothing");
    rulesPanel(wrapper).vm.$emit("clear-search");
    await flushPromises();
    expect(search().props("modelValue")).toBe("");

    await showSignals(wrapper);
    await search().vm.$emit("update:modelValue", "nothing");
    unrouted(wrapper).vm.$emit("clear-search");
    await flushPromises();
    expect(search().props("modelValue")).toBe("");
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

  /// The queue's filters are the server's: a change refetches with the params.
  it("refetches the queue with the announced filters", async () => {
    const wrapper = render();
    await flushPromises();
    await showSignals(wrapper);

    wrapper.findAllComponents({ name: "OToggleGroup" })[1].vm.$emit("update:modelValue", "nobody");
    await flushPromises();

    wrapper.findComponent({ name: "OCheckbox" }).vm.$emit("update:modelValue", true);
    await flushPromises();

    expect(service.unroutedSignals).toHaveBeenLastCalledWith({
      org_identifier: ORG,
      landing: "nobody",
      include_dismissed: true,
    });
  });

  /// The filter the reader returns to answers from the cache at once, so the
  /// slower answer for the one they left lands last and must be ignored.
  it("ignores a slower queue answer for a filter the reader has already left", async () => {
    const wrapper = render();
    await flushPromises();
    await showSignals(wrapper);
    let answerNobody: (value: unknown) => void = () => {};
    service.unroutedSignals.mockImplementationOnce(
      () => new Promise((resolve) => (answerNobody = resolve)),
    );
    const landing = wrapper.findAllComponents({ name: "OToggleGroup" })[1];

    landing.vm.$emit("update:modelValue", "nobody");
    await flushPromises();
    landing.vm.$emit("update:modelValue", "both");
    await flushPromises();
    answerNobody({ data: [{ id: "sig_late", landing: "nobody", dimensions: {} }] });
    await flushPromises();

    expect(unrouted(wrapper).props("signals")).toEqual([]);
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
    const { default: OnCallRuleEditor } = await import("@/components/oncall/OnCallRuleEditor.vue");
    const wrapper = mount(OnCallRouting, {
      global: { plugins: [i18n, store], stubs: { ...stubs, ODialog, OnCallRuleEditor } },
      attachTo: document.body,
    });
    await flushPromises();

    rulesPanel(wrapper).vm.$emit("add");
    await flushPromises();

    // Teleported to the body, so the assertion has to look there.
    const dialogHtml = document.body.innerHTML;
    expect(dialogHtml).toContain("o-dialog-primary-btn");
    expect(dialogHtml).toContain("o-dialog-secondary-btn");
    expect(dialogHtml).toContain(">Save<");

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
