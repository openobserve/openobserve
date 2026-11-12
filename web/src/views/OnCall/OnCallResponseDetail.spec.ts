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

import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import alertsService from "@/services/alerts";
import { alertKeys } from "@/services/alerts.querykeys";
import oncallService from "@/services/oncall";
import { responseProgressQuery } from "@/services/oncall.queries";
import { oncallKeys } from "@/services/oncall.querykeys";
import store from "@/test/unit/helpers/store";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import { formatOnCallInstant } from "@/utils/oncall";
import OnCallResponseDetail from "@/views/OnCall/OnCallResponseDetail.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    getResponse: vi.fn(),
    getTeam: vi.fn(),
    listMembers: vi.fn(),
    listTeams: vi.fn(),
    priorCauses: vi.fn(),
    responseHistory: vi.fn(),
    acknowledgeResponse: vi.fn(),
    unacknowledgeResponse: vi.fn(),
    confirmRecovery: vi.fn(),
    snoozeResponse: vi.fn(),
    unsnoozeResponse: vi.fn(),
    addNote: vi.fn(),
    handoffResponse: vi.fn(),
    resolveResponse: vi.fn(),
    promoteResponse: vi.fn(),
    escalationProgress: vi.fn(),
    listDeliveries: vi.fn(),
    whoIsOnCall: vi.fn(),
    getPolicy: vi.fn(),
    teamReachability: vi.fn(),
    resolvedSchedule: vi.fn(),
    responseReport: vi.fn(),
    escalateNow: vi.fn(),
  },
}));

vi.mock("@/services/incidents", () => ({ default: { get: vi.fn() } }));
import incidentsService from "@/services/incidents";
const incidentsGet = vi.mocked(incidentsService).get;

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
import analytics from "@/services/product_analytics";
import { axiosReply, deferredReply } from "@/test/unit/helpers/mockService";

/// The view state a few tests read or seed directly.
type DetailVm = {
  response: { id: string } | null;
  escalation: unknown;
  teamName: string;
  refreshRecord: () => Promise<void>;
  deliveries: { id: string }[];
  deliveriesLoading: boolean;
};

vi.mock("@/services/alerts", () => ({
  default: { get_by_alert_id: vi.fn(), listByFolderId: vi.fn() },
}));

/// Escalate's whole point is what it reports back, and the report is a toast.
const toastSpy = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

const push = vi.fn();
// Reactive, because the origin and history links change the id on THIS
// instance; a plain object could never exercise that path.
const routeState = vi.hoisted(() => ({
  params: { responseId: "resp_1" } as Record<string, string>,
}));
vi.mock("vue-router", async () => {
  const { reactive } = await import("vue");
  return {
    useRoute: () => reactive(routeState),
    useRouter: () => ({ push }),
  };
});

// Mutable per case, so the tablet and phone tests can switch while every other test stays desktop.
const mockViewport = vi.hoisted(() => ({ mdUp: true, lgUp: true }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !mockViewport.mdUp),
      isTablet: computed(() => mockViewport.mdUp && !mockViewport.lgUp),
      isDesktop: computed(() => mockViewport.lgUp),
      mdUp: computed(() => mockViewport.mdUp),
      lgUp: computed(() => mockViewport.lgUp),
    }),
  };
});

const service = vi.mocked(oncallService);
const alerts = vi.mocked(alertsService);

const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    // `title-trail` carries the state tags and `subtitle` the team/firing/
    // opened line, both of which are assertions of their own.
    template:
      "<div><div data-test='stub-subtitle'><slot name='subtitle' /></div><div data-test='stub-title-trail'><slot name='title-trail' /></div><slot name='actions' /><div data-test='stub-header-tabs'><slot name='header-tabs' /></div><slot /></div>",
  },
  OTooltip: {
    name: "OTooltip",
    props: ["content"],
    template: "<span>{{ content }}<slot name='content' /></span>",
  },
  RouterLink: { name: "RouterLink", props: ["to"], template: "<a><slot /></a>" },
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OnCallTimeline: { name: "OnCallTimeline", template: "<div />" },
  // `open`, not `modelValue`: ODialog has no `modelValue`, so a stub that
  // declares one turns every assertion about this dialog into a claim about a
  // prop the real component ignores — which is exactly how three dialogs
  // shipped with no visible buttons.
  ODialog: {
    name: "ODialog",
    props: ["open"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  OnCallPriorCauses: {
    name: "OnCallPriorCauses",
    props: ["groups"],
    template: "<div />",
  },
  OnCallWhatFired: {
    name: "OnCallWhatFired",
    props: ["alert"],
    template: "<div />",
  },
  OStatStrip: {
    name: "OStatStrip",
    props: ["items"],
    template: "<div />",
  },
  OContent: { name: "OContent", template: "<div><slot /></div>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
  // Every panel renders regardless of which tab is "active": the tests are
  // about what each panel holds, not about the tab-switching mechanic.
  OTabs: { name: "OTabs", template: "<div><slot /></div>" },
  OTab: { name: "OTab", props: ["name", "label"], template: "<button>{{ label }}</button>" },
  OTabPanels: { name: "OTabPanels", template: "<div><slot /></div>" },
  OTabPanel: { name: "OTabPanel", props: ["name"], template: "<div><slot /></div>" },
  OnCallFiringHistory: {
    name: "OnCallFiringHistory",
    props: ["firings"],
    template: "<div />",
  },
  OnCallDeliveryLedger: {
    name: "OnCallDeliveryLedger",
    props: ["records", "total", "loading"],
    template: "<div />",
  },
  OnCallVerdictCard: { name: "OnCallVerdictCard", props: ["events"], template: "<div />" },
  OnCallReachAlarm: {
    name: "OnCallReachAlarm",
    props: [
      "state",
      "deliveries",
      "deliveriesTotal",
      "progress",
      "smtpConfigured",
      "noTeam",
      "escalatable",
    ],
    template: "<div />",
  },
  OnCallWhoIsOn: {
    name: "OnCallWhoIsOn",
    props: [
      "positions",
      "deliveries",
      "handoverAt",
      "handoverTo",
      "closedAt",
      "ackedBy",
      "teamDeleted",
      "loading",
    ],
    template: "<div />",
  },
  OnCallAboutPage: {
    name: "OnCallAboutPage",
    props: [
      "orgId",
      "teamId",
      "teamName",
      "subjectType",
      "sourceId",
      "routingReason",
      "subjectStream",
      "incidentId",
      "incidentTitle",
      "incidentLoading",
      "cause",
      "causeNote",
      "teamDeleted",
    ],
    template: "<div />",
  },
  ODrawer: {
    name: "ODrawer",
    props: ["open", "title"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["disabled"],
    emits: ["select"],
    template: `<button :disabled="disabled" @click="$emit('select')"><slot /></button>`,
  },
  // The compact header's menu uses both; unstubbed they need a reka-ui menu root the ODropdown stub does not provide.
  ODropdownGroup: { name: "ODropdownGroup", props: ["label"], template: "<div><slot /></div>" },
  ODropdownSeparator: { name: "ODropdownSeparator", template: "<hr />" },
  OToggleGroup: { name: "OToggleGroup", template: "<div><slot /></div>" },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OTextarea: {
    name: "OTextarea",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)" />`,
  },
  // `emits` matters: without it the click listener also falls through to the
  // native button, so every handler runs twice and a toggle lands back where
  // it started.
  OButton: {
    name: "OButton",
    props: ["disabled"],
    emits: ["click"],
    template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`,
  },
};

const HOUR_MICROS = 3_600_000_000;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_1",
    org_id: "default",
    subject: { subject_type: "alert", source_id: "al_ckt", firing: 2 },
    team_id: "team_1",
    priority: 1,
    state: "triggered",
    opened_at: 1_700_000_000_000_000,
    acked_by: null,
    acked_at: null,
    closed_at: null,
    ...overrides,
  };
}

function render() {
  return mount(OnCallResponseDetail, { global: { plugins: [i18n, store], stubs } });
}

async function renderWith(overrides: Record<string, unknown> = {}) {
  service.getResponse.mockResolvedValue(axiosReply({ response: record(overrides), events: [] }));
  const wrapper = render();
  await flushPromises();
  return wrapper;
}

// Every test mounts the full response page; on a loaded CI runner one mount can exceed the 5s default.
vi.setConfig({ testTimeout: 20000 });

// Every page watches the shared route, so a page left mounted reloads on each later route change and slows those tests.
enableAutoUnmount(afterEach);

describe("OnCallResponseDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getTeam.mockResolvedValue(axiosReply({ name: "Platform" }));
    service.listMembers.mockResolvedValue(
      axiosReply([{ user_email: "engineer@example.com" }, { user_email: "other@example.com" }]),
    );
    service.priorCauses.mockResolvedValue(axiosReply([]));
    service.responseHistory.mockResolvedValue(axiosReply([]));
    alerts.get_by_alert_id.mockResolvedValue(
      axiosReply({ name: "checkout_error_ratio", stream_name: "default", stream_type: "logs" }),
    );
    service.listTeams.mockResolvedValue(
      axiosReply([
        { id: "team_1", name: "Platform" },
        { id: "team_2", name: "Payments" },
      ]),
    );
    service.listDeliveries.mockResolvedValue(axiosReply({ total: 0, deliveries: [] }));
    service.escalationProgress.mockResolvedValue(axiosReply(null));
    service.whoIsOnCall.mockResolvedValue(axiosReply([]));
    service.getPolicy.mockResolvedValue(axiosReply(null));
    service.teamReachability.mockResolvedValue(axiosReply({ smtp_configured: true }));
    service.resolvedSchedule.mockResolvedValue(axiosReply([]));
  });

  /// "Why did this page me" was answerable only by scrolling the timeline.
  it("shows the routing decision on the overview", async () => {
    service.getResponse.mockResolvedValue(
      axiosReply({
        response: record(),
        events: [
          { kind: "sys", at: 1, actor: "o2-engine", body: "opened for alert al_ckt: x" },
          {
            kind: "sys",
            at: 1,
            actor: "o2-engine",
            body: "routed to tm_pay by ownership rule k8s-namespace=payments",
          },
        ],
      }),
    );
    const wrapper = render();
    await flushPromises();

    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("routingReason")).toBe(
      "routed to tm_pay by ownership rule k8s-namespace=payments",
    );
  });

  // `fetchResponse`'s own force reaches the record alone, so Refresh has to expire the rest first.
  it("re-reads every read on the page on Refresh, and keeps the page on screen", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = await renderWith();
    const reads = [
      service.getResponse,
      service.listMembers,
      service.listTeams,
      service.priorCauses,
      service.responseHistory,
      service.escalationProgress,
      service.listDeliveries,
      service.whoIsOnCall,
      service.getPolicy,
      service.teamReachability,
      service.resolvedSchedule,
      alerts.get_by_alert_id,
    ];
    for (const read of reads) expect(read).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-test="oncall-response-refresh"]').trigger("click");
    await flushPromises();

    expect(spy).toHaveBeenCalledWith({ queryKey: oncallKeys.all("default"), refetchType: "none" });
    for (const read of reads) expect(read).toHaveBeenCalledTimes(2);
    // The team list already names the team, so its own read is never needed.
    expect(service.getTeam).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).exists()).toBe(true);
    spy.mockRestore();
  });

  // No decision recorded must leave the row out rather than render an empty one.
  it("omits the routing row when no decision was recorded", async () => {
    const wrapper = await renderWith();
    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("routingReason")).toBe(null);
  });

  /// Back to a record already read answers from the cache at once, so the
  /// slower record for the id just left lands last — and must not be shown
  /// under the other id's URL, where every action would act on the wrong page.
  it("ignores a slower record for an id the route has already left", async () => {
    const { reactive } = await import("vue");
    const wrapper = await renderWith({ id: "resp_1", title: "First page" });
    const answerSecond = deferredReply();
    service.getResponse.mockImplementationOnce(() => answerSecond.promise);

    reactive(routeState).params.responseId = "resp_2";
    await flushPromises();
    reactive(routeState).params.responseId = "resp_1";
    await flushPromises();
    answerSecond.answer({ response: record({ id: "resp_2", title: "Second page" }), events: [] });
    await flushPromises();

    expect((wrapper.vm as unknown as DetailVm).response?.id).toBe("resp_1");
  });

  /// The context reads run alongside each other, so a slow one for a page already left must not land on the current page.
  it("ignores a slower context read for a page the route has already left", async () => {
    const { reactive } = await import("vue");
    const wrapper = await renderWith({ id: "resp_1" });
    const slow = deferredReply();
    service.listDeliveries.mockImplementation(({ response_id }) =>
      response_id === "resp_2"
        ? slow.promise
        : Promise.resolve(axiosReply({ total: 1, deliveries: [{ id: "d_current" }] })),
    );

    reactive(routeState).params.responseId = "resp_2";
    await flushPromises();
    reactive(routeState).params.responseId = "resp_3";
    await flushPromises();
    slow.answer({ total: 1, deliveries: [{ id: "d_left" }] });
    await flushPromises();

    const vm = wrapper.vm as unknown as DetailVm;
    expect(vm.deliveries.map((d) => d.id)).toEqual(["d_current"]);
    expect(vm.deliveriesLoading).toBe(false);
    reactive(routeState).params.responseId = "resp_1";
  });

  it("loads the past firings alongside the causes", async () => {
    service.responseHistory.mockResolvedValue(
      axiosReply([{ id: "resp_0", state: "resolved", opened_at: 1, acked_by: null, cause: null }]),
    );
    const wrapper = await renderWith();

    expect(service.responseHistory).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
      response_id: "resp_1",
    });
    expect(wrapper.findComponent({ name: "OnCallFiringHistory" }).props("firings")).toHaveLength(1);
  });

  /// The history route is absent on servers that predate it, and the causes
  /// beside it must still render — the two are fetched independently.
  it("still shows the causes when the history route is missing", async () => {
    service.priorCauses.mockResolvedValue(
      axiosReply([{ cause: "noisy_threshold", count: 3, last_response_id: "resp_0" }]),
    );
    service.responseHistory.mockRejectedValue({ response: { status: 404 } });
    const wrapper = await renderWith();

    expect(wrapper.findComponent({ name: "OnCallPriorCauses" }).props("groups")).toHaveLength(1);
    expect(wrapper.findComponent({ name: "OnCallFiringHistory" }).props("firings")).toEqual([]);
  });

  /// The subject alert is still fetched for the stream it names — the only
  /// place left that reads it since the What-fired card was removed.
  it("resolves the subject alert's stream onto the routing rail", async () => {
    const wrapper = await renderWith();

    expect(alerts.get_by_alert_id).toHaveBeenCalled();
    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("subjectStream")).toBe(
      "default (logs)",
    );
  });

  /// A page outlives the rule it came from, and the record — not the alert —
  /// is the authority on what happened.
  it("still renders when the alert has since been deleted", async () => {
    alerts.get_by_alert_id.mockRejectedValue({ response: { status: 404 } });
    const wrapper = await renderWith();

    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("subjectStream")).toBe(null);
  });

  // An incident subject names no alert, so nothing is fetched for it.
  it("does not fetch an alert for a subject that is not one", async () => {
    await renderWith({
      subject: { subject_type: "incident", source_id: "inc_login", firing: 1 },
    });

    expect(alerts.get_by_alert_id).not.toHaveBeenCalled();
  });

  it("acknowledges the page and reloads it", async () => {
    const wrapper = await renderWith();
    service.acknowledgeResponse.mockResolvedValue(axiosReply({}));

    await wrapper.find('[data-test="oncall-response-ack-btn"]').trigger("click");
    await flushPromises();

    expect(service.acknowledgeResponse).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
      response_id: "resp_1",
    });
    // Two loads: mount, then the refresh that shows the new state.
    expect(service.getResponse).toHaveBeenCalledTimes(2);
    expect(analytics.track).toHaveBeenCalledWith("oncall_page_acknowledged", { count: 1 });
  });

  it("hints that Acknowledge stops paging the team and shows on the alert", async () => {
    const wrapper = await renderWith();
    const ack = wrapper.find('[data-test="oncall-response-ack-btn"]');
    expect(ack.findComponent({ name: "OTooltip" }).props("content")).toBe(
      "Stops paging Platform. Shows as acknowledged on the alert.",
    );
  });

  it.each([
    [{ team_id: null }, "Shows as acknowledged on the alert."],
    [
      { subject: { subject_type: "incident", source_id: "inc_1", firing: 1 } },
      "Stops paging Platform. Shows as acknowledged on the incident.",
    ],
  ])("words the Acknowledge hint for a teamless or incident page %#", async (over, hint) => {
    const wrapper = await renderWith(over);
    const ack = wrapper.find('[data-test="oncall-response-ack-btn"]');
    expect(ack.findComponent({ name: "OTooltip" }).props("content")).toBe(hint);
  });

  it("offers Unacknowledge and Take over on a page someone else acknowledged", async () => {
    const wrapper = await renderWith({ state: "acknowledged", acked_by: "ana@acme.io" });
    expect(wrapper.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(false);
    service.unacknowledgeResponse.mockResolvedValue(axiosReply({}));
    service.acknowledgeResponse.mockResolvedValue(axiosReply({}));

    await wrapper.find('[data-test="oncall-response-take-over-btn"]').trigger("click");
    await flushPromises();
    expect(service.acknowledgeResponse).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
      response_id: "resp_1",
      take_over: true,
    });

    await wrapper.find('[data-test="oncall-response-unack-btn"]').trigger("click");
    await flushPromises();
    expect(service.unacknowledgeResponse).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
      response_id: "resp_1",
    });
  });

  it("says the page is already resolved when Acknowledge found it closed", async () => {
    const wrapper = await renderWith();
    service.acknowledgeResponse.mockResolvedValue(
      axiosReply({ ...record({ state: "resolved", closed_at: 1 }), ack: { changed: false } }),
    );
    await wrapper.find('[data-test="oncall-response-ack-btn"]').trigger("click");
    await flushPromises();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toEqual({
      variant: "info",
      message: "This page is already resolved",
    });
  });

  it("says the page is already resolved when Unacknowledge found it closed", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: store.state.userInfo.email,
    });
    service.unacknowledgeResponse.mockResolvedValue(
      axiosReply({ ...record({ state: "resolved", closed_at: 1 }), ack: { changed: false } }),
    );
    await wrapper.find('[data-test="oncall-response-unack-btn"]').trigger("click");
    await flushPromises();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toEqual({
      variant: "info",
      message: "This page is already resolved",
    });
  });

  it("says who was faster when Acknowledge changed nothing", async () => {
    const wrapper = await renderWith();
    service.acknowledgeResponse.mockResolvedValue(
      axiosReply({
        ...record({ state: "acknowledged", acked_by: "ana@acme.io" }),
        ack: { changed: false },
      }),
    );
    await wrapper.find('[data-test="oncall-response-ack-btn"]').trigger("click");
    await flushPromises();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toEqual({
      variant: "info",
      message: "Already acknowledged by ana@acme.io",
    });
  });

  it("says nothing was acknowledged when Unacknowledge changed nothing", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: store.state.userInfo.email,
      title: "checkout down",
    });
    service.unacknowledgeResponse.mockResolvedValue(
      axiosReply({ ...record({ title: "checkout down" }), ack: { changed: false } }),
    );
    await wrapper.find('[data-test="oncall-response-unack-btn"]').trigger("click");
    await flushPromises();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toEqual({
      variant: "info",
      message: "checkout down was not acknowledged",
    });
  });

  // Engine bookkeeping is folded by default; the toggle names how much it hides and appears only when there is some.
  it("folds system activity until asked for", async () => {
    service.getResponse.mockResolvedValue(
      axiosReply({
        response: record(),
        events: [
          { kind: "sys", at: 1, actor: "o2-engine", body: "this signal carries no service" },
          { kind: "note", at: 2, actor: "ana@acme.io", body: "looking" },
        ],
      }),
    );
    const wrapper = render();
    await flushPromises();
    const toggle = wrapper.find('[data-test="oncall-response-activity-toggle-all"]');
    expect(toggle.text()).toContain("1");
    expect(wrapper.findComponent({ name: "OnCallActivityTimeline" }).props("showAll")).toBe(false);
  });

  it("offers no system toggle when there is no system activity", async () => {
    const wrapper = await renderWith();
    expect(wrapper.find('[data-test="oncall-response-activity-toggle-all"]').exists()).toBe(false);
  });

  /// A long single-token alert name must ellipsise rather than run under the state chips beside it.
  it("cuts a long title and keeps the state chips at full width", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: "ana@acme.io",
      title: "composite_clone_child_a_muv1p0nee7qa",
    });
    const layout = wrapper.findComponent({ name: "OPageLayout" });
    expect(layout.attributes("title")).toBe("composite_clone_child_a_muv1p0nee7qa");
    // "visible" lets the h1 overflow instead of ellipsising, which is what ran the title under the chips.
    expect(layout.attributes("title-overflow")).toBeUndefined();
    expect(wrapper.find('[data-test="oncall-response-state-tag"]').classes()).toContain("shrink-0");
  });

  /// Who holds the page reads with team and time, so the title row keeps its width for the title.
  it("names the holder of an acknowledged page in the subtitle, not beside the title", async () => {
    const wrapper = await renderWith({ state: "acknowledged", acked_by: "ana@acme.io" });
    expect(wrapper.find('[data-test="oncall-response-phrase"]').exists()).toBe(false);
    const acked = wrapper.find('[data-test="oncall-response-acked-by"]');
    expect(acked.text()).toContain("Acknowledged by");
    expect(acked.findComponent({ name: "OnCallPersonName" }).props("email")).toBe("ana@acme.io");
  });

  /// A long ladder line beside the title ran under the header actions, so it reads on the subtitle line.
  it("says how far the page has climbed on the subtitle line, not beside the title", async () => {
    const wrapper = await renderWith();
    const phrase = wrapper.find('[data-test="stub-subtitle"] [data-test="oncall-response-phrase"]');
    expect(phrase.exists()).toBe(true);
    expect(phrase.classes()).toContain("min-w-0");
    expect(
      wrapper.find('[data-test="stub-title-trail"] [data-test="oncall-response-phrase"]').exists(),
    ).toBe(false);
  });

  /// The title row holds only state and priority; an exhausted ladder is said in words on the subtitle line.
  it("says nobody answered on the subtitle line, not as a chip beside the title", async () => {
    service.escalationProgress.mockResolvedValue(
      axiosReply({
        fired: [{ after_micros: 0, at: 1, targets: ["ana@acme.io"], reached: ["ana@acme.io"] }],
        next_targets: [],
        next_at: null,
        exhausted: true,
      }),
    );
    const wrapper = await renderWith();
    const words = wrapper.find(
      '[data-test="stub-subtitle"] [data-test="oncall-response-phrase-exhausted"]',
    );
    expect(words.text()).toContain("Nobody answered");
    const trail = wrapper.find('[data-test="stub-title-trail"]');
    expect(trail.findAllComponents({ name: "OTag" })).toHaveLength(2);
    expect(trail.find('[data-test="oncall-response-title-trail"]').classes()).toContain(
      "overflow-hidden",
    );
  });

  describe("an Unacknowledge the server cannot apply", () => {
    const held = () => ({
      state: "acknowledged",
      acked_by: store.state.userInfo.email,
      title: "checkout down",
    });
    const unackBtn = (wrapper: VueWrapper) =>
      wrapper.findComponent('[data-test="oncall-response-unack-btn"]');

    it("warns instead of claiming the page was never acknowledged, then turns the button off", async () => {
      const wrapper = await renderWith(held());
      service.unacknowledgeResponse.mockResolvedValue(
        axiosReply({ ...record(held()), ack: { changed: false } }),
      );
      await unackBtn(wrapper).trigger("click");
      await flushPromises();

      expect(toastSpy.mock.calls.at(-1)?.[0]).toEqual({
        variant: "warning",
        message: "Couldn't unacknowledge this page",
      });
      expect(unackBtn(wrapper).props("disabled")).toBe(true);
      expect(unackBtn(wrapper).findComponent({ name: "OTooltip" }).props("content")).toBe(
        "Couldn't unacknowledge this page",
      );
    });

    it("blames the deleted alert when the lookup said it is gone", async () => {
      alerts.get_by_alert_id.mockRejectedValue({ response: { status: 404 } });
      const wrapper = await renderWith(held());

      expect(unackBtn(wrapper).props("disabled")).toBe(true);
      expect(unackBtn(wrapper).findComponent({ name: "OTooltip" }).props("content")).toBe(
        "Can't unacknowledge: this page's alert was deleted",
      );
    });

    /// A cached org-wide list filled after the page opened settles it with no request at all.
    it("learns the alert is gone from an already cached alert list", async () => {
      queryClient.setQueryData(
        alertKeys.dependencies(store.state.selectedOrganization.identifier),
        [{ alert_id: "al_other" }],
      );
      const wrapper = await renderWith(held());

      expect(alerts.get_by_alert_id).not.toHaveBeenCalled();
      expect(alerts.listByFolderId).not.toHaveBeenCalled();
      expect(unackBtn(wrapper).findComponent({ name: "OTooltip" }).props("content")).toBe(
        "Can't unacknowledge: this page's alert was deleted",
      );
      queryClient.removeQueries({
        queryKey: alertKeys.dependencies(store.state.selectedOrganization.identifier),
      });
    });

    it("asks for the alert itself when no list is cached", async () => {
      alerts.get_by_alert_id.mockResolvedValue(axiosReply({}));
      const wrapper = await renderWith(held());

      expect(alerts.listByFolderId).not.toHaveBeenCalled();
      expect(alerts.get_by_alert_id).toHaveBeenCalledWith(expect.any(String), "al_ckt");
      expect(unackBtn(wrapper).props("disabled")).toBe(false);
    });

    it("keeps the button on when the alert lookup failed for another reason", async () => {
      alerts.get_by_alert_id.mockRejectedValue({ response: { status: 500 } });
      const wrapper = await renderWith(held());

      expect(unackBtn(wrapper).props("disabled")).toBe(false);
    });
  });

  it("does not offer to take over one's own acknowledgement", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: store.state.userInfo.email,
    });
    expect(wrapper.find('[data-test="oncall-response-take-over-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-response-unack-btn"]').exists()).toBe(true);
  });

  it("does not track an acknowledgement the server refused", async () => {
    const wrapper = await renderWith();
    service.acknowledgeResponse.mockRejectedValue({ response: { data: { message: "no" } } });
    vi.mocked(analytics.track).mockClear();

    await wrapper.find('[data-test="oncall-response-ack-btn"]').trigger("click");
    await flushPromises();

    expect(analytics.track).not.toHaveBeenCalled();
  });

  /// The bug this pins: the backend sets state to `acknowledged`, and every
  /// action was gated on a predicate that excluded it. Acking a page therefore
  /// removed the only means of closing it. The earlier version of this test
  /// left state as `triggered`, a combination the backend never produces, so
  /// it passed while the product was broken.
  it("can still be resolved and handed off after it is acknowledged", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: "engineer@example.com",
      acked_at: 1_700_000_060_000_000,
    });

    expect(wrapper.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-response-handoff-btn"]').exists()).toBe(true);
    // Claiming it twice is not a thing, so those two do go away.
    expect(wrapper.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-response-snooze-btn"]').exists()).toBe(false);
  });

  /// Acknowledging is a claim, not a view state — offering it again on a page
  /// that is already owned invites a second person to think they took it.
  it("hides acknowledge and snooze once someone owns the page", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: "engineer@example.com",
      acked_at: 1_700_000_060_000_000,
    });

    expect(wrapper.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-response-snooze-btn"]').exists()).toBe(false);
    // Handing off and resolving still apply to a page somebody owns.
    expect(wrapper.find('[data-test="oncall-response-handoff-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(true);
  });

  it("snoozes for the chosen duration", async () => {
    const wrapper = await renderWith();
    service.snoozeResponse.mockResolvedValue(axiosReply({}));

    await wrapper.find('[data-test="oncall-response-snooze-30"]').trigger("click");
    await flushPromises();

    expect(service.snoozeResponse).toHaveBeenCalledWith(
      expect.objectContaining({ response_id: "resp_1", minutes: 30 }),
    );
  });

  /// A snoozed page is quiet but still nobody's. The banner is the only thing
  /// on screen saying so, so it has to be there — and has to go once the
  /// snooze lapses and the ladder is running again.
  it("says a snoozed page is still unassigned, and only while it lasts", async () => {
    const future = (Date.now() + 30 * 60_000) * 1000;
    const active = await renderWith({ snoozed_until: future });
    const banner = active.find('[data-test="oncall-response-snoozed-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("unassigned");
    expect(banner.text()).toContain(formatOnCallInstant(future, Date.now() * 1000, "UTC"));

    // A second mount of the same id is served from cache, so the lapsed record
    // only reaches the page on a fresh load.
    queryClient.clear();
    const lapsed = await renderWith({ snoozed_until: (Date.now() - 60_000) * 1000 });
    expect(lapsed.find('[data-test="oncall-response-snoozed-banner"]').exists()).toBe(false);
  });

  /// Snooze means paused, then continues; while it is paused the same control continues it now.
  it("swaps Snooze for Unsnooze while snoozed, and the banner offers it too", async () => {
    const wrapper = await renderWith({ snoozed_until: (Date.now() + 30 * 60_000) * 1000 });
    service.unsnoozeResponse.mockResolvedValue(axiosReply({}));

    expect(wrapper.find('[data-test="oncall-response-snooze-btn"]').exists()).toBe(false);
    for (const button of [
      "oncall-response-unsnooze-btn",
      "oncall-response-snoozed-banner-unsnooze",
    ]) {
      service.unsnoozeResponse.mockClear();
      toastSpy.mockClear();
      await wrapper.find(`[data-test="${button}"]`).trigger("click");
      await flushPromises();
      expect(service.unsnoozeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Snooze ended · paging continues" }),
      );
    }
  });

  it("adds a note and clears the box", async () => {
    const wrapper = await renderWith();
    service.addNote.mockResolvedValue(axiosReply({}));

    const box = wrapper.find('[data-test="oncall-response-note-input"]');
    await box.setValue("  restarted the pool  ");
    await wrapper.find('[data-test="oncall-response-note-submit"]').trigger("click");
    await flushPromises();

    expect(service.addNote).toHaveBeenCalledWith(
      expect.objectContaining({ response_id: "resp_1", body: "restarted the pool" }),
    );
    expect((box.element as HTMLTextAreaElement).value).toBe("");
  });

  it("will not post an empty note", async () => {
    const wrapper = await renderWith();
    const submit = wrapper.find('[data-test="oncall-response-note-submit"]');

    expect((submit.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find('[data-test="oncall-response-note-input"]').setValue("   ");
    expect((submit.element as HTMLButtonElement).disabled).toBe(true);
    expect(service.addNote).not.toHaveBeenCalled();
  });

  /// The two handoff modes are not interchangeable, and sending both targets
  /// would leave the server to guess which one was meant.
  it("sends only the target for the chosen handoff mode", async () => {
    const wrapper = await renderWith();
    service.handoffResponse.mockResolvedValue(axiosReply({}));

    await wrapper.find('[data-test="oncall-response-handoff-btn"]').trigger("click");
    // Emitted rather than setValue: a bare <select> stub has no <option>
    // elements, so jsdom refuses a value it cannot find.
    await wrapper
      .findComponent('[data-test="oncall-handoff-person-select"]')
      .vm.$emit("update:modelValue", "other@example.com");
    await wrapper.find('[data-test="oncall-handoff-note"]').setValue("going off shift");
    await wrapper.find('[data-test="oncall-handoff-submit"]').trigger("click");
    await flushPromises();

    expect(service.handoffResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "other@example.com",
        to_team_id: undefined,
        note: "going off shift",
      }),
    );
  });

  it("offers only other teams as a handoff target", async () => {
    const wrapper = await renderWith();
    await wrapper.find('[data-test="oncall-response-handoff-btn"]').trigger("click");
    await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "team");
    await flushPromises();

    const select = wrapper.findComponent('[data-test="oncall-handoff-team-select"]');
    const values = (select.props("options") as { value: string }[]).map((o) => o.value);

    expect(values).toContain("team_2");
    // The page already belongs to team_1; "hand off to yourselves" is not a
    // move, and offering it only invites a confusing no-op.
    expect(values).not.toContain("team_1");
  });

  /// Handing a page to another team clears the ack and re-arms the ladder, so
  /// the difference has to be visible before the click, not after the page.
  it("warns that a team handoff re-opens the page", async () => {
    const wrapper = await renderWith();
    await wrapper.find('[data-test="oncall-response-handoff-btn"]').trigger("click");
    await wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "team");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-handoff-hint"]').text()).toContain("cleared");
  });

  it("cannot hand off without a target", async () => {
    const wrapper = await renderWith();
    await wrapper.find('[data-test="oncall-response-handoff-btn"]').trigger("click");

    const submit = wrapper.find('[data-test="oncall-handoff-submit"]');
    expect((submit.element as HTMLButtonElement).disabled).toBe(true);
    expect(service.handoffResponse).not.toHaveBeenCalled();
  });

  /// A closed record is a historical document. Offering actions on it would
  /// produce errors at best and a page nobody expected at worst.
  it("offers no actions on a resolved page", async () => {
    const wrapper = await renderWith({
      state: "resolved",
      closed_at: 1_700_000_000_000_000 + HOUR_MICROS,
    });

    for (const action of ["ack", "snooze", "handoff", "resolve"]) {
      expect(wrapper.find(`[data-test="oncall-response-${action}-btn"]`).exists()).toBe(false);
    }
  });

  /// Handoff targets are a convenience; the page is the thing on fire.
  it("still renders when the handoff targets cannot be loaded", async () => {
    service.listMembers.mockRejectedValue(new Error("boom"));
    service.listTeams.mockRejectedValue(new Error("boom"));

    const wrapper = await renderWith();

    expect(wrapper.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-response-note-submit"]').exists()).toBe(true);
  });

  /// The cause is the only input the prior-causes panel has. Collected at
  /// resolve or never collected at all.
  describe("recording the cause", () => {
    async function openResolve() {
      const wrapper = await renderWith();
      service.resolveResponse.mockResolvedValue(axiosReply({}));
      await wrapper.find('[data-test="oncall-response-resolve-btn"]').trigger("click");
      return wrapper;
    }

    it("sends the chosen cause and note", async () => {
      const wrapper = await openResolve();

      await wrapper
        .findComponent('[data-test="oncall-resolve-cause"]')
        .vm.$emit("update:modelValue", "config_change_or_deploy");
      await wrapper
        .find('[data-test="oncall-resolve-cause-note"]')
        .setValue("  rolled back the 14:02 deploy  ");
      await wrapper.find('[data-test="oncall-resolve-confirm"]').trigger("click");
      await flushPromises();

      expect(service.resolveResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: "config_change_or_deploy",
          cause_note: "rolled back the 14:02 deploy",
        }),
      );
      expect(analytics.track).toHaveBeenCalledWith("oncall_page_resolved", {
        cause: "config_change_or_deploy",
        count: 1,
      });
    });

    /// Resolving must never be blocked on knowing why — a responder who cannot
    /// say would otherwise leave the record open, which is worse.
    it("resolves without a cause", async () => {
      const wrapper = await openResolve();

      await wrapper.find('[data-test="oncall-resolve-confirm"]').trigger("click");
      await flushPromises();

      expect(service.resolveResponse).toHaveBeenCalledWith(
        expect.objectContaining({ cause: undefined, cause_note: undefined }),
      );
      expect(analytics.track).toHaveBeenCalledWith("oncall_page_resolved", {
        cause: "none",
        count: 1,
      });
    });

    it("offers every cause in the taxonomy", async () => {
      const wrapper = await openResolve();
      const options = wrapper
        .findComponent('[data-test="oncall-resolve-cause"]')
        .props("options") as { value: string }[];

      expect(options).toHaveLength(RESOLUTION_CAUSES.length);
      // "Still unknown" has to be offered, or the honest answer is unavailable
      // and someone picks a plausible-looking cause instead.
      expect(options.map((o) => o.value)).toContain("still_unknown");
    });
  });

  describe("prior causes", () => {
    it("passes what previous firings turned out to be", async () => {
      service.priorCauses.mockResolvedValue(
        axiosReply([
          {
            cause: "config_change_or_deploy",
            count: 3,
            note: "deploy rollback",
            last_response_id: "resp_0",
          },
        ]),
      );

      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallPriorCauses" }).props("groups")).toHaveLength(1);
    });

    /// History is context. Losing it must not stop someone acting on the page
    /// in front of them.
    /// The panel links to the firing that had that cause; a count with no way
    /// to read the actual record is trivia.
    it("navigates to the firing behind a cause", async () => {
      service.priorCauses.mockResolvedValue(
        axiosReply([{ cause: "genuine_defect", count: 2, last_response_id: "resp_0" }]),
      );
      const wrapper = await renderWith();

      wrapper.findComponent({ name: "OnCallPriorCauses" }).vm.$emit("open", "resp_0");
      await flushPromises();

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({ params: { responseId: "resp_0" } }),
      );
    });

    it("still renders the page when history cannot be loaded", async () => {
      service.priorCauses.mockRejectedValue(new Error("boom"));
      const wrapper = await renderWith();

      expect(wrapper.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallPriorCauses" }).props("groups")).toEqual([]);
    });
  });
  /// B11. An impacted record closes through ITS verb: a plain resolve would
  /// skip the sibling check that closes the owner, so the owner waits forever
  /// on a confirmation that can no longer arrive — and every future firing of
  /// that alert is then refused as a duplicate.
  describe("confirm recovery", () => {
    it("offers confirm-recovery instead of resolve on an impacted record", async () => {
      const wrapper = await renderWith({ origin_response_id: "resp_owner" });
      expect(wrapper.find('[data-test="oncall-response-confirm-recovery-btn"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(false);
    });

    it("offers resolve, not confirm-recovery, on an owner record", async () => {
      const wrapper = await renderWith({ origin_response_id: null });
      expect(wrapper.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-confirm-recovery-btn"]').exists()).toBe(
        false,
      );
    });

    it("posts the confirmation with its note and refetches", async () => {
      service.confirmRecovery.mockResolvedValue(axiosReply(record()));
      const wrapper = await renderWith({ origin_response_id: "resp_owner" });

      await wrapper.find('[data-test="oncall-response-confirm-recovery-btn"]').trigger("click");
      await wrapper
        .find('[data-test="oncall-confirm-recovery-note"]')
        .setValue("replayed the buffered writes");
      const before = service.getResponse.mock.calls.length;
      await wrapper.find('[data-test="oncall-confirm-recovery-confirm"]').trigger("click");
      await flushPromises();

      expect(service.confirmRecovery).toHaveBeenCalledWith(
        expect.objectContaining({
          response_id: "resp_1",
          data: { note: "replayed the buffered writes" },
        }),
      );
      expect(service.getResponse.mock.calls.length).toBeGreaterThan(before);
    });
  });

  /// D8/D-21. `ResponderRole` was typed and rendered nowhere, so a team paged
  /// to contain somebody else's blast radius saw a page indistinguishable from
  /// one it owned — and a two-rung ladder that stopped read as broken.
  describe("liaison seat", () => {
    it("says why this team was paged and links the owning team's record", async () => {
      const wrapper = await renderWith({
        responder_role: "impacted",
        origin_response_id: "resp_owner",
      });

      expect(wrapper.find('[data-test="oncall-response-liaison-tag"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-liaison-banner"]').text()).toContain(
        "another team's failure reaches your service",
      );
      expect(wrapper.find('[data-test="oncall-response-origin-link"]').exists()).toBe(true);
    });

    /// The ladder-shape explanation used to sit as a paragraph inside the
    /// escalation card; it now rides the "Liaison seat" tag itself as a
    /// tooltip, next to the title where the tag is seen first.
    it("explains the truncated ladder as a tooltip on the liaison tag", async () => {
      const wrapper = await renderWith({
        responder_role: "impacted",
        origin_response_id: "resp_owner",
      });

      const tag = wrapper.find('[data-test="oncall-response-liaison-tag"]');
      expect(tag.text()).toContain("one chase");
    });

    it("leaves an owner record with no liaison language at all", async () => {
      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [],
          next_targets: [],
          next_at: null,
          exhausted: false,
          stopped_because: null,
        }),
      );
      const wrapper = await renderWith({ responder_role: "owner" });

      expect(wrapper.find('[data-test="oncall-response-liaison-banner"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-liaison-tag"]').exists()).toBe(false);
    });
  });

  /// D5. `incident_id` could only ever be set by the path that opened the
  /// record, so a responder who worked a page for ten minutes and realised it
  /// was bigger than an alert had no way to say so.
  describe("promote", () => {
    it("promotes with the record's own title and severity by default", async () => {
      service.promoteResponse.mockResolvedValue(
        axiosReply({ incident_id: "inc_9", severity: "P1", response: record() }),
      );
      const wrapper = await renderWith({ priority: 1, title: "checkout down" });

      await wrapper.find('[data-test="oncall-response-promote-btn"]').trigger("click");
      const before = service.getResponse.mock.calls.length;
      await wrapper.find('[data-test="oncall-promote-confirm"]').trigger("click");
      await flushPromises();

      expect(service.promoteResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          response_id: "resp_1",
          data: { title: "checkout down", severity: "P1" },
        }),
      );
      expect(service.getResponse.mock.calls.length).toBeGreaterThan(before);
    });

    /// The handler states the raise-never-lower invariant and enforces none of
    /// it — it takes whatever severity string it is sent — so offering P3 on a
    /// P2 page would quietly downgrade what already woke somebody.
    it("offers no severity below the one that already woke somebody", async () => {
      const wrapper = await renderWith({ priority: 2 });
      await wrapper.find('[data-test="oncall-response-promote-btn"]').trigger("click");

      const select = wrapper
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === "oncall-promote-severity");
      expect((select?.props("options") as { value: string }[]).map((o) => o.value)).toEqual([
        "P1",
        "P2",
      ]);
    });

    /// Two responders clicking at once must not end up looking at two
    /// incidents for one firing: the server refuses the second with a 409, and
    /// the refetch is what puts the winning incident in front of the loser.
    it("refetches on a conflict so the incident that won is the one shown", async () => {
      service.promoteResponse.mockRejectedValue({
        response: {
          status: 409,
          data: { message: "this record is already part of incident inc_9" },
        },
      });
      const wrapper = await renderWith();

      await wrapper.find('[data-test="oncall-response-promote-btn"]').trigger("click");
      const before = service.getResponse.mock.calls.length;
      await wrapper.find('[data-test="oncall-promote-confirm"]').trigger("click");
      await flushPromises();

      expect(service.getResponse.mock.calls.length).toBeGreaterThan(before);
    });

    it("stops offering the promotion once the record has an incident", async () => {
      const wrapper = await renderWith({ incident_id: "inc_9" });
      expect(wrapper.find('[data-test="oncall-response-promote-btn"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("incidentId")).toBe("inc_9");
    });

    /// A firing is routinely recognised as part of something larger after it
    /// was closed, and the server does not gate the verb by state.
    it("still offers the promotion on a closed record", async () => {
      const wrapper = await renderWith({ state: "resolved", closed_at: 1_700_000_100_000_000 });
      expect(wrapper.find('[data-test="oncall-response-promote-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(false);
    });
  });

  /// §E.10 rated the missing verbs the costliest gap in the product. `escalate`
  /// has existed server-side since the ladder did and nothing in `web/src`
  /// called it: the only way to wake the next rung early was to wait.
  describe("escalate now", () => {
    it("wakes the next rung without moving ownership", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue(axiosReply({}));

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      expect(service.escalateNow).toHaveBeenCalledWith({
        org_identifier: store.state.selectedOrganization.identifier,
        response_id: "resp_1",
      });
      // The refetch is the point: the new rung has to appear on the ladder.
      expect(service.getResponse).toHaveBeenCalledTimes(2);
    });

    /// A ladder with no rungs left has nothing to escalate to, and the server
    /// answers a 400. Refusing at the button is cheaper than a toast.
    it("is disabled once the ladder is exhausted", async () => {
      service.escalationProgress.mockResolvedValue(
        axiosReply({ fired: [], next_targets: [], next_at: null, exhausted: true }),
      );
      const wrapper = await renderWith();

      expect(
        wrapper.find('[data-test="oncall-response-escalate-btn"]').attributes("disabled"),
      ).toBeDefined();
    });

    /// A disabled button that does not say why is a dead end.
    it("explains why escalate is disabled once the ladder is exhausted", async () => {
      service.escalationProgress.mockResolvedValue(
        axiosReply({ fired: [], next_targets: [], next_at: null, exhausted: true }),
      );
      const wrapper = await renderWith();

      expect(wrapper.text()).toContain("The ladder is finished");
    });

    it("keeps an exhausted Escalate focusable and describes it by its reason", async () => {
      service.escalationProgress.mockResolvedValue(
        axiosReply({ fired: [], next_targets: [], next_at: null, exhausted: true }),
      );
      service.getResponse.mockResolvedValue(axiosReply({ response: record(), events: [] }));
      const wrapper = mount(OnCallResponseDetail, {
        global: { plugins: [i18n, store], stubs: { ...stubs, OButton: false } },
      });
      await flushPromises();

      const escalate = wrapper.find('[data-test="oncall-response-escalate-btn"]');
      expect(escalate.attributes("disabled")).toBeUndefined();
      expect(escalate.attributes("aria-disabled")).toBe("true");
      const reason = wrapper.find(`[id="${escalate.attributes("aria-describedby")}"]`);
      expect(reason.text()).toBe(String(i18n.global.t("oncall.ladderExhausted")));
      await escalate.trigger("click");
      expect(service.escalateNow).not.toHaveBeenCalled();
    });
  });

  /// The tagline: team, which firing this is, and when it opened — read once,
  /// under the title, instead of being spread across a metadata grid.
  describe("the tagline", () => {
    it("links the team name to its detail page", async () => {
      const wrapper = await renderWith();
      const link = wrapper
        .findAllComponents({ name: "RouterLink" })
        .find((c) => c.attributes("data-test") === "oncall-response-team-link");

      expect(link?.text()).toBe("Platform");
      expect(link?.props("to")).toEqual({
        name: "onCallTeamDetail",
        params: { teamId: "team_1", tab: "overview" },
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });

    /// How often the alert fired before is a stat-strip fact, not tagline copy.
    it("keeps the firing number out of the tagline", async () => {
      const wrapper = await renderWith();
      expect(wrapper.find('[data-test="oncall-response-firing"]').exists()).toBe(false);
    });

    /// The elapsed duration already rides the title tags — "opened" repeats it
    /// as a clock time rather than a second "N ago".
    it("shows the clock time the page opened, not how long ago", async () => {
      const wrapper = await renderWith();
      const opened = wrapper.find('[data-test="oncall-response-opened"]');

      expect(opened.text()).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe("top stats and what fired", () => {
    it("says how often it fired before, and only when it did", async () => {
      const first = await renderWith();
      const none = first.findComponent({ name: "OStatStrip" });
      expect(
        none.exists()
          ? none.props("items").some((s: { key: string }) => s.key === "firing")
          : false,
      ).toBe(false);
      first.unmount();

      queryClient.clear();
      service.responseHistory.mockResolvedValue(
        axiosReply([
          { id: "resp_0", state: "resolved", opened_at: 1, acked_by: null, cause: null },
        ]),
      );
      const wrapper = await renderWith();
      const stats = wrapper.findComponent({ name: "OStatStrip" }).props("items");
      expect(stats.find((s: { key: string }) => s.key === "firing").value).toBe("1 time");
    });

    /// The escalation panel used to live in this rail; the section is gone
    /// now, not just its data.
    it("no longer renders a dedicated escalation panel", async () => {
      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallEscalation" }).exists()).toBe(false);
    });

    /// The alert fetched for the subject is the same one "what fired" reads
    /// its condition from.
    it("hands the fetched alert to the what-fired card", async () => {
      alerts.get_by_alert_id.mockResolvedValue(
        axiosReply({ name: "checkout_error_ratio", query_condition: { sql: "count(*) > 10" } }),
      );
      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallWhatFired" }).props("alert")).toEqual(
        expect.objectContaining({ name: "checkout_error_ratio" }),
      );
    });

    /// A manually-opened page has no alert rule behind it — nothing "fired".
    it("has no what-fired card for a non-alert subject", async () => {
      const wrapper = await renderWith({
        subject: { subject_type: "manual", source_id: "m1", firing: 1 },
      });

      expect(wrapper.findComponent({ name: "OnCallWhatFired" }).exists()).toBe(false);
    });
  });

  /// The rail's four answers. Each is context: the record has to render when
  /// every one of them fails, which is what these pin.
  describe("team context", () => {
    it("passes who is on call and the transport verdict to the rail", async () => {
      service.whoIsOnCall.mockResolvedValue(
        axiosReply([
          {
            rotation_id: "rot_primary",
            rotation_name: "Primary",
            rule: "weekly",
            user_email: "ana@o2.ai",
          },
        ]),
      );
      service.teamReachability.mockResolvedValue(axiosReply({ smtp_configured: false }));
      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("positions")).toHaveLength(1);
      expect(wrapper.findComponent({ name: "OnCallReachAlarm" }).props("smtpConfigured")).toBe(
        false,
      );
    });

    /// `null` is "the check did not answer", which is not the same fact as a
    /// working transport and must never be rendered as a cause.
    it("leaves the transport verdict unknown when the check fails", async () => {
      service.teamReachability.mockRejectedValue(new Error("boom"));
      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallReachAlarm" }).props("smtpConfigured")).toBe(
        null,
      );
      expect(wrapper.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(true);
    });

    /// The on-call payload names who is next but not when. A page still open
    /// at handover is one somebody inherits without being told.
    it("derives the handover from the resolved schedule", async () => {
      const now = Date.now() * 1000;
      service.resolvedSchedule.mockResolvedValue(
        axiosReply([
          {
            from: now - 1_000_000,
            to: now + 1_000_000,
            rotation: "weekly",
            user_email: "ana@o2.ai",
          },
          {
            from: now + 1_000_000,
            to: now + 9_000_000,
            rotation: "weekly",
            user_email: "bo@o2.ai",
          },
        ]),
      );
      const wrapper = await renderWith();

      const who = wrapper.findComponent({ name: "OnCallWhoIsOn" });
      expect(who.props("handoverAt")).toBe(now + 1_000_000);
      expect(who.props("handoverTo")).toBe("bo@o2.ai");
    });

    /// D4: a cover running across a roster handover is one holder, so the handover is where it ends.
    it("hands over where the holder changes, not where the roster under a cover does", async () => {
      const now = Date.now() * 1000;
      const cover = { rotation: "weekly", user_email: "cy@o2.ai", override_id: "ov" };
      service.resolvedSchedule.mockResolvedValue(
        axiosReply([
          { ...cover, from: now - 1_000_000, to: now + 1_000_000, scheduled_email: "ana@o2.ai" },
          { ...cover, from: now + 1_000_000, to: now + 5_000_000, scheduled_email: "bo@o2.ai" },
          {
            from: now + 5_000_000,
            to: now + 9_000_000,
            rotation: "weekly",
            user_email: "bo@o2.ai",
          },
        ]),
      );
      const wrapper = await renderWith();

      const who = wrapper.findComponent({ name: "OnCallWhoIsOn" });
      expect(who.props("handoverAt")).toBe(now + 5_000_000);
      expect(who.props("handoverTo")).toBe("bo@o2.ai");
    });

    /// A gap after the current shift is a real answer — the pager goes to
    /// nobody — so the row must not skip forward to the next staffed span.
    it("says nobody inherits when the next span is a gap", async () => {
      const now = Date.now() * 1000;
      service.resolvedSchedule.mockResolvedValue(
        axiosReply([
          {
            from: now - 1_000_000,
            to: now + 1_000_000,
            rotation: "weekly",
            user_email: "ana@o2.ai",
          },
          { from: now + 1_000_000, to: now + 9_000_000, rotation: "weekly" },
        ]),
      );
      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("handoverTo")).toBe(null);
    });

    /// Hours after a page closes the pager has moved on, and the rail named
    /// whoever holds it now as though they had been the one woken. The
    /// schedule answers as of any instant, so a closed record asks about its
    /// own last moment instead of about this one.
    it("resolves the roster as of the moment a closed record closed", async () => {
      const closedAt = 1_700_000_000_000_000 + HOUR_MICROS;
      const wrapper = await renderWith({ state: "resolved", closed_at: closedAt });

      expect(service.whoIsOnCall).toHaveBeenCalledWith(expect.objectContaining({ at: closedAt }));
      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("closedAt")).toBe(closedAt);
    });

    /// Who inherits the pager next is advice for a page somebody still has to
    /// carry; on a closed one it is a fact about next week's rota.
    it("asks for no handover once the record is closed", async () => {
      await renderWith({ state: "resolved", closed_at: 1_700_000_000_000_000 + HOUR_MICROS });

      expect(service.resolvedSchedule).not.toHaveBeenCalled();
    });

    /// An open record keeps asking about now — `at` unset is the live rotation.
    it("keeps asking about now while the page is open", async () => {
      await renderWith();

      expect(service.whoIsOnCall).toHaveBeenCalledWith(expect.objectContaining({ at: undefined }));
    });
  });

  /// An open page counts how long it has waited; the time it has been open already rides the title.
  it("says what the clock is doing instead of a dash", async () => {
    const wrapper = await renderWith();
    const stats = wrapper.findComponent({ name: "OStatStrip" }).props("items");
    const ack = stats.find((s: { key: string }) => s.key === "ack");

    expect(ack.label).toBe("Unacknowledged for");
    expect(ack.value).not.toBe("—");
    expect(stats.some((s: { key: string }) => s.key === "resolve")).toBe(false);
  });

  it("freezes into the time it took once the page is answered", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: "engineer@example.com",
      acked_at: 1_700_000_000_000_000 + HOUR_MICROS,
    });
    const ack = wrapper
      .findComponent({ name: "OStatStrip" })
      .props("items")
      .find((s: { key: string }) => s.key === "ack");

    expect(ack.label).toBe("Acknowledged in");
    expect(ack.value).toContain("1h");
    expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("ackedBy")).toBe(
      "engineer@example.com",
    );
  });

  /// Both halves of the cache contract in one place: reopening a page inside
  /// the stale window must cost nothing, and the ladder's countdown — which
  /// lapses while the entry is still fresh — must still reach the server,
  /// which only a forced re-read does.
  it("serves a remount from cache, and still forces the lapsed countdown", async () => {
    const first = await renderWith();
    const before = {
      response: service.getResponse.mock.calls.length,
      team: service.getTeam.mock.calls.length,
      members: service.listMembers.mock.calls.length,
      teams: service.listTeams.mock.calls.length,
      causes: service.priorCauses.mock.calls.length,
      deliveries: service.listDeliveries.mock.calls.length,
      onCall: service.whoIsOnCall.mock.calls.length,
      progress: service.escalationProgress.mock.calls.length,
    };
    expect(before.response).toBe(1);
    first.unmount();

    await renderWith();

    expect(service.getResponse.mock.calls.length).toBe(before.response);
    expect(service.getTeam.mock.calls.length).toBe(before.team);
    expect(service.listMembers.mock.calls.length).toBe(before.members);
    expect(service.listTeams.mock.calls.length).toBe(before.teams);
    expect(service.priorCauses.mock.calls.length).toBe(before.causes);
    expect(service.listDeliveries.mock.calls.length).toBe(before.deliveries);
    expect(service.whoIsOnCall.mock.calls.length).toBe(before.onCall);
    expect(service.escalationProgress.mock.calls.length).toBe(before.progress);

    // Seeded, not fetched: the entry is fresh, so an unforced re-read would be
    // served from it and the countdown would never learn anything new.
    queryClient.setQueryData(
      responseProgressQuery(store.state.selectedOrganization.identifier, "resp_1").queryKey,
      { fired: [], next_targets: [], next_at: Date.now() * 1000 - 1_000_000, exhausted: false },
    );
    await renderWith();

    expect(service.escalationProgress.mock.calls.length).toBe(before.progress + 1);
  });
});

/// §L.2 — three facts already in payloads this page fetches and rendered
/// nowhere. None of them needs a request.
describe("OnCallResponseDetail — what the payload already knew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getTeam.mockResolvedValue(axiosReply({ name: "Platform" }));
    service.listMembers.mockResolvedValue(axiosReply([]));
    service.priorCauses.mockResolvedValue(axiosReply([]));
    service.responseHistory.mockResolvedValue(axiosReply([]));
    // The page's own team exists: an empty list would make it a deleted team, which hides Escalate.
    service.listTeams.mockResolvedValue(axiosReply([{ id: "team_1", name: "Platform" }]));
    service.escalationProgress.mockResolvedValue(
      axiosReply({ fired: [], next_targets: [], next_at: null, exhausted: false }),
    );
    service.listDeliveries.mockResolvedValue(axiosReply({ total: 0, deliveries: [] }));
    service.getPolicy.mockResolvedValue(axiosReply(null));
    service.whoIsOnCall.mockResolvedValue(axiosReply([]));
    alerts.get_by_alert_id.mockResolvedValue(axiosReply({}));
  });

  /// The escalation phrase in the header already says how far the ladder got, so no step counter repeats it.
  it("states no ladder-step tile, even when the step is known", async () => {
    service.getPolicy.mockResolvedValue(
      axiosReply({
        rungs: [
          {
            priority: 2,
            channels: ["email"],
            steps: [
              { after_micros: 0, targets: [{ kind: "on_call_now" }] },
              { after_micros: 300_000_000, targets: [{ kind: "next_on_call" }] },
            ],
          },
        ],
      }),
    );
    const wrapper = await renderWith({ priority: 2, reached_rung_micros: 300_000_000 });
    const strip = wrapper.findComponent({ name: "OStatStrip" });
    const items = strip.exists() ? (strip.props("items") as { key: string }[]) : [];
    expect(items.some((item) => item.key === "rung")).toBe(false);
    expect(wrapper.text()).not.toContain("Paged up to");
  });

  /// "Escalated" alone is a claim. The person who pressed it wants to know
  /// which phone is ringing, and the 200 body says.
  describe("what Escalate reports back", () => {
    it("names who the rung reached", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue(
        axiosReply({
          escalated_to: "rung",
          rung_micros: 300_000_000,
          recipients: ["ana@o2.ai"],
          chased: true,
          deduplicated: false,
          response: {},
        }),
      );

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      const message = String(toastSpy.mock.calls.at(-1)![0].message);
      expect(message).toContain("ana@o2.ai");
    });

    /// A rung that resolved to nobody is a real outcome, and the one worth
    /// saying loudest: the ladder moved and no phone rang.
    it("says so when the rung reached nobody", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue(
        axiosReply({
          escalated_to: "rung",
          rung_micros: 0,
          recipients: [],
          chased: false,
          deduplicated: true,
          response: {},
        }),
      );

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      expect(String(toastSpy.mock.calls.at(-1)![0].message)).toContain("reached nobody");
    });

    /// `ladder_exhausted` is a 200 on purpose — "there is nobody above you" is
    /// an answer, not a failure. Reporting it as an error reads as though the
    /// press failed and invites a second one — but it isn't a success either,
    /// since nothing advanced, so it gets its own `info` treatment rather than
    /// the green checkmark a real escalation earns.
    it("reports an exhausted ladder as an answer, not a success or a failure", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue(
        axiosReply({ escalated_to: "ladder_exhausted", response: {} }),
      );

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      const call = toastSpy.mock.calls.at(-1)![0];
      expect(call.variant).toBe("info");
      expect(String(call.message)).toContain("last step");
    });
  });

  /// On the subtitle line the phrase gives way after team and time; in the body it keeps a readable floor; the title keeps its floor.
  it("keeps the escalation phrase readable and the title floored", async () => {
    for (const lgUp of [true, false]) {
      mockViewport.lgUp = lgUp;
      const wrapper = await renderWith();
      const classes = wrapper.find('[data-test="oncall-response-phrase"]').classes();
      expect(classes, `lg ${lgUp}`).toEqual(
        expect.arrayContaining(lgUp ? ["min-w-0", "shrink-[100]"] : ["min-w-32", "truncate"]),
      );
      expect(wrapper.findComponent({ name: "OPageLayout" }).attributes()).toHaveProperty(
        "title-min-width",
      );
      wrapper.unmount();
    }
    mockViewport.lgUp = true;
  });

  /// Seven header buttons wrap to three rows on a tablet or phone, so everything but claiming and closing shares one menu.
  describe("below the laptop breakpoint", () => {
    beforeEach(() => {
      mockViewport.lgUp = false;
    });

    afterEach(() => {
      mockViewport.mdUp = true;
      mockViewport.lgUp = true;
    });

    it("keeps acknowledge and resolve on the row and folds the rest into one menu", async () => {
      const wrapper = await renderWith();

      for (const kept of ["ack-btn", "resolve-btn", "more-btn"]) {
        expect(wrapper.find(`[data-test="oncall-response-${kept}"]`).exists()).toBe(true);
      }
      for (const folded of ["escalate-btn", "handoff-btn", "promote-btn"]) {
        expect(wrapper.find(`[data-test="oncall-response-${folded}"]`).exists()).toBe(false);
        expect(wrapper.find(`[data-test="oncall-response-${folded}-menu"]`).exists()).toBe(true);
      }
      expect(wrapper.find('[data-test="oncall-response-snooze-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-snooze-30-menu"]').exists()).toBe(true);
    });

    it("snoozes from the menu", async () => {
      const wrapper = await renderWith();
      service.snoozeResponse.mockResolvedValue(axiosReply({}));

      await wrapper.find('[data-test="oncall-response-snooze-30-menu"]').trigger("click");
      await flushPromises();

      expect(service.snoozeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
    });

    it("unsnoozes from the menu while snoozed", async () => {
      const wrapper = await renderWith({ snoozed_until: (Date.now() + 30 * 60_000) * 1000 });
      service.unsnoozeResponse.mockResolvedValue(axiosReply({}));

      expect(wrapper.find('[data-test="oncall-response-snooze-30-menu"]').exists()).toBe(false);
      await wrapper.find('[data-test="oncall-response-unsnooze-btn-menu"]').trigger("click");
      await flushPromises();

      expect(service.unsnoozeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ response_id: "resp_1" }),
      );
    });

    it("opens the hand-off drawer from the menu", async () => {
      const wrapper = await renderWith();

      await wrapper.find('[data-test="oncall-response-handoff-btn-menu"]').trigger("click");

      expect(wrapper.find('[data-test="oncall-handoff-submit"]').exists()).toBe(true);
    });

    /// A greyed-out verb has no tooltip to explain it on touch, so the reason is printed on the item.
    it("says on the item why escalate is unavailable", async () => {
      service.escalationProgress.mockResolvedValue(
        axiosReply({ fired: [], next_targets: [], next_at: null, exhausted: true }),
      );
      const wrapper = await renderWith();

      const item = wrapper.find('[data-test="oncall-response-escalate-btn-menu"]');
      expect(item.attributes("disabled")).toBeDefined();
      expect(item.text()).toContain("nobody left to page");
    });

    it("drops the menu when a closed page is already tied to an incident", async () => {
      const wrapper = await renderWith({
        state: "resolved",
        closed_at: 1_700_000_100_000_000,
        incident_id: "inc_9",
      });

      expect(wrapper.find('[data-test="oncall-response-more-btn"]').exists()).toBe(false);
    });

    it("applies on a phone too", async () => {
      mockViewport.mdUp = false;
      const wrapper = await renderWith();

      expect(wrapper.find('[data-test="oncall-response-more-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-meta"]').exists()).toBe(true);
    });
  });
});

/// Responding to a page (#3090): what the screen says when the ladder ran out,
/// while triage holds the first page, and when it cannot load.
describe("OnCallResponseDetail — responding", () => {
  const NOW = () => Date.now() * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    service.getTeam.mockResolvedValue(axiosReply({ name: "Platform" }));
    service.listMembers.mockResolvedValue(axiosReply([]));
    service.priorCauses.mockResolvedValue(axiosReply([]));
    service.responseHistory.mockResolvedValue(axiosReply([]));
    service.listTeams.mockResolvedValue(axiosReply([{ id: "team_1", name: "Platform" }]));
    service.listDeliveries.mockResolvedValue(axiosReply({ total: 0, deliveries: [] }));
    service.escalationProgress.mockResolvedValue(
      axiosReply({ fired: [], next_targets: [], next_at: null, exhausted: false }),
    );
    service.whoIsOnCall.mockResolvedValue(axiosReply([]));
    service.getPolicy.mockResolvedValue(axiosReply(null));
    service.teamReachability.mockResolvedValue(axiosReply({ smtp_configured: true }));
    service.resolvedSchedule.mockResolvedValue(axiosReply([]));
    alerts.get_by_alert_id.mockResolvedValue(axiosReply({}));
  });

  describe("a page nobody answered", () => {
    /// The ladder's own progress decides it, the same signal the Pages list reads.
    const ranOut = (lastAt: number) =>
      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [
            { after_micros: 0, at: lastAt - 300_000_000, targets: [], reached: ["a@o2.ai"] },
            { after_micros: 300_000_000, at: lastAt, targets: [], reached: ["b@o2.ai"] },
          ],
          next_targets: [],
          next_at: null,
          exhausted: true,
        }),
      );

    it("tags it and says when the last step ran, before the record's flag lands", async () => {
      ranOut(1_700_000_000_000_000 + HOUR_MICROS);
      const wrapper = await renderWith({ exhausted_at: null });

      expect(
        wrapper
          .find(
            '[data-test="oncall-response-phrase"] [data-test="oncall-response-phrase-exhausted"]',
          )
          .text(),
      ).toContain("Nobody answered");
      const banner = wrapper.find('[data-test="oncall-response-exhausted-banner"]');
      expect(banner.text()).toMatch(
        /^Nobody answered\. Every step ran by [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}\. Acknowledge to take it, or hand it off\.$/,
      );
      expect(wrapper.text()).not.toContain("Triggered");
    });

    it("drops the date when the ladder ran out today", async () => {
      ranOut(NOW() - 60_000_000);
      const wrapper = await renderWith();

      expect(wrapper.find('[data-test="oncall-response-exhausted-banner"]').text()).toMatch(
        /^Nobody answered\. Every step ran by \d{2}:\d{2}\. Acknowledge/,
      );
    });

    it("says nothing of the sort once somebody owns it", async () => {
      ranOut(NOW());
      const wrapper = await renderWith({
        state: "acknowledged",
        acked_by: "engineer@example.com",
        acked_at: 1_700_000_000_000_000 + HOUR_MICROS,
        exhausted_at: 1_700_000_000_000_000,
      });

      expect(wrapper.find('[data-test="oncall-response-acked-by"]').text()).toContain(
        "Acknowledged by",
      );
      expect(wrapper.find('[data-test="oncall-response-exhausted-banner"]').exists()).toBe(false);
    });
  });

  /// R14: a restarted ladder's due first rung is not "Not paged yet", and shows once sent.
  describe("a rung that is due", () => {
    const due = () =>
      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [],
          next_targets: ["engineer@example.com"],
          next_at: Date.now() * 1000 - 1_000_000,
          exhausted: false,
        }),
      );
    const phrase = (wrapper: VueWrapper) =>
      wrapper
        .find('[data-test="oncall-response-phrase"] [data-test="oncall-escalation-cell-level"]')
        .text();

    afterEach(() => vi.useRealTimers());

    it("reads as paging step 1, and re-reads until the rung is sent", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      due();
      const wrapper = await renderWith();
      expect(phrase(wrapper)).toMatch(/^Paging step 1 /);

      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [{ after_micros: 0, at: Date.now() * 1000, targets: [], reached: ["ana@o2.ai"] }],
          next_targets: [],
          next_at: null,
          exhausted: false,
        }),
      );
      vi.advanceTimersByTime(10_000);
      await flushPromises();
      expect(phrase(wrapper)).toMatch(/^Paging step 1 · ana@o2\.ai/);

      const reads = service.escalationProgress.mock.calls.length;
      for (let tick = 0; tick < 6; tick++) {
        vi.advanceTimersByTime(10_000);
        await flushPromises();
      }
      expect(service.escalationProgress.mock.calls.length, "stops once the rung appears").toBe(
        reads,
      );
      wrapper.unmount();
    });

    /// Once the re-read sees the rung sent, the activity reads the record again.
    it("re-reads the record when the rung is sent, so the activity agrees", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      due();
      const wrapper = await renderWith();

      const sentAt = Date.now() * 1000;
      service.getResponse.mockResolvedValue(
        axiosReply({
          response: record({ reached_rung_micros: 0 }),
          events: [
            {
              kind: "page",
              at: sentAt,
              actor: "system",
              body: "paged ana@o2.ai",
              rung_micros: 0,
              ladder_run: 2,
            },
          ],
        }),
      );
      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [{ after_micros: 0, at: sentAt, targets: [], reached: ["ana@o2.ai"] }],
          next_targets: [],
          next_at: null,
          exhausted: false,
        }),
      );
      vi.advanceTimersByTime(10_000);
      await flushPromises();

      expect(wrapper.findComponent({ name: "OnCallActivityTimeline" }).props("events")).toEqual([
        expect.objectContaining({ kind: "page", ladder_run: 2 }),
      ]);
      wrapper.unmount();
    });

    const sent = (at: number) => ({ after_micros: 0, at, targets: [], reached: ["ana@o2.ai"] });
    const sentProgress = (at: number) =>
      service.escalationProgress.mockResolvedValue(
        axiosReply({ fired: [sent(at)], next_targets: [], next_at: null, exhausted: false }),
      );

    /// F1: a rung of a new ladder run is new even when the run has fewer rungs than the last one.
    it("re-reads the record for a rung sent in a new ladder run", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const now = Date.now() * 1000;
      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [
            sent(now - 600_000_000),
            { ...sent(now - 300_000_000), after_micros: 300_000_000 },
          ],
          next_targets: ["engineer@example.com"],
          next_at: now - 1_000_000,
          exhausted: false,
        }),
      );
      const wrapper = await renderWith();
      const reads = service.getResponse.mock.calls.length;

      sentProgress(now);
      vi.advanceTimersByTime(10_000);
      await flushPromises();

      expect(service.getResponse.mock.calls.length).toBeGreaterThan(reads);
      wrapper.unmount();
    });

    /// F2: a failed re-read of the record says so, as the view's other read failures do.
    it("says so when the record cannot be re-read after a rung is sent", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      due();
      const wrapper = await renderWith();
      toastSpy.mockClear();

      service.getResponse.mockRejectedValue({ response: { status: 500, data: {} } });
      sentProgress(Date.now() * 1000);
      vi.advanceTimersByTime(10_000);
      await flushPromises();

      expect(toastSpy.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ variant: "error" }),
      );
      wrapper.unmount();
    });

    /// F3: a background re-read of the record keeps what is typed into the open Promote dialog.
    it("keeps the Promote dialog's typed title through a background re-read", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      due();
      const wrapper = await renderWith({ title: "checkout down" });
      await wrapper.find('[data-test="oncall-response-promote-btn"]').trigger("click");
      await wrapper.find('[data-test="oncall-promote-title"]').setValue("payments outage");

      service.getResponse.mockResolvedValue(
        axiosReply({
          response: record({ title: "checkout down", reached_rung_micros: 0 }),
          events: [],
        }),
      );
      sentProgress(Date.now() * 1000);
      vi.advanceTimersByTime(10_000);
      await flushPromises();

      expect(service.getResponse).toHaveBeenCalledTimes(2);
      expect(
        (wrapper.find('[data-test="oncall-promote-title"]').element as HTMLInputElement).value,
      ).toBe("payments outage");
      wrapper.unmount();
    });

    it("stops re-reading a rung that never appears after a bounded number of tries", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      due();
      const wrapper = await renderWith();
      const reads = service.escalationProgress.mock.calls.length;

      for (let tick = 0; tick < 10; tick++) {
        vi.advanceTimersByTime(10_000);
        await flushPromises();
      }

      expect(service.escalationProgress.mock.calls.length).toBe(reads + 6);
      expect(phrase(wrapper)).not.toContain("Not paged yet");
      wrapper.unmount();
    });
  });

  describe("the AI triage hold", () => {
    const held = (heldUntil: number | null) =>
      service.escalationProgress.mockResolvedValue(
        axiosReply({
          fired: [],
          next_targets: [],
          next_at: null,
          exhausted: false,
          held_until_micros: heldUntil,
        }),
      );

    it("counts down to the first page and offers to page now", async () => {
      held(NOW() + 54_500_000);
      const wrapper = await renderWith();

      const banner = wrapper.find('[data-test="oncall-response-hold-banner"]');
      expect(banner.text()).toMatch(/^AI triage is checking first · paging within \d+s Page now$/);
    });

    it("pages rung 1 through the existing escalate action", async () => {
      held(NOW() + 54_000_000);
      service.escalateNow.mockResolvedValue(
        axiosReply({ escalated_to: "rung", recipients: ["engineer@example.com"] }),
      );
      const wrapper = await renderWith();

      await wrapper.find('[data-test="oncall-response-hold-page-now"]').trigger("click");
      await flushPromises();

      expect(service.escalateNow).toHaveBeenCalledTimes(1);
    });

    /// Triage can answer before the deadline, so the banner must not outlive the page it promised.
    it("re-reads the progress while held, and drops the banner once paging started", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      held(NOW() + 80_000_000);
      const wrapper = await renderWith();
      expect(wrapper.find('[data-test="oncall-response-hold-banner"]').exists()).toBe(true);
      const reads = service.escalationProgress.mock.calls.length;

      held(null);
      vi.advanceTimersByTime(10_000);
      await flushPromises();

      expect(service.escalationProgress.mock.calls.length).toBe(reads + 1);
      expect(wrapper.find('[data-test="oncall-response-hold-banner"]').exists()).toBe(false);
      wrapper.unmount();
      vi.useRealTimers();
    });

    /// A failed re-read is not the hold ending: the last good progress stays and the next tick retries.
    it("keeps the banner and retries when a re-read while held fails", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      held(NOW() + 80_000_000);
      const wrapper = await renderWith();
      const reads = service.escalationProgress.mock.calls.length;

      service.escalationProgress.mockRejectedValueOnce({ response: { status: 500, data: {} } });
      vi.advanceTimersByTime(10_000);
      await flushPromises();
      expect(wrapper.find('[data-test="oncall-response-hold-banner"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-hold-page-now"]').exists()).toBe(true);

      held(null);
      vi.advanceTimersByTime(10_000);
      await flushPromises();

      expect(service.escalationProgress.mock.calls.length).toBe(reads + 2);
      expect(wrapper.find('[data-test="oncall-response-hold-banner"]').exists()).toBe(false);
      wrapper.unmount();
      vi.useRealTimers();
    });

    it("is gone once the deadline has passed or the field is absent", async () => {
      held(NOW() - 1_000_000);
      const lapsed = await renderWith();
      expect(lapsed.find('[data-test="oncall-response-hold-banner"]').exists()).toBe(false);
      lapsed.unmount();

      queryClient.clear();
      held(null);
      const absent = await renderWith();
      expect(absent.find('[data-test="oncall-response-hold-banner"]').exists()).toBe(false);
    });
  });

  describe("a page that cannot be loaded", () => {
    it("shows the error with a retry instead of an empty page", async () => {
      service.getResponse.mockRejectedValueOnce({ response: { status: 500, data: {} } });
      service.getResponse.mockResolvedValue(axiosReply({ response: record(), events: [] }));
      const wrapper = render();
      await flushPromises();

      const error = wrapper.find('[data-test="oncall-response-detail-error"]');
      expect(error.exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-detail-empty"]').exists()).toBe(false);

      wrapper.findComponent('[data-test="oncall-response-detail-error"]').vm.$emit("action");
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-response-detail-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-stats"]').exists()).toBe(true);
    });

    describe("a license denial", () => {
      const DENIAL = {
        response: {
          status: 403,
          data: {
            code: 40001,
            message: "Features not included in your license: oncall",
            error_detail: "oncall",
          },
        },
      };

      function expectLocked(wrapper: ReturnType<typeof render>) {
        const lock = wrapper.findComponent(LicenseDeniedState);
        expect(lock.props("features")).toEqual(["oncall"]);
        expect(lock.attributes("data-test")).toBe("oncall-response-detail-license-denied");
        for (const gone of [
          "oncall-response-detail-error",
          "oncall-response-detail-not-found",
          "oncall-response-stats",
          "oncall-response-refresh",
        ]) {
          expect(wrapper.find(`[data-test="${gone}"]`).exists()).toBe(false);
        }
      }

      it("replaces the body when the first load is denied", async () => {
        service.getResponse.mockRejectedValueOnce(DENIAL);
        const wrapper = render();
        await flushPromises();

        expectLocked(wrapper);
      });

      it("replaces a loaded page, with no error toast, when a refresh is denied", async () => {
        const wrapper = await renderWith();
        expect(wrapper.find('[data-test="oncall-response-stats"]').exists()).toBe(true);
        toastSpy.mockClear();

        service.getResponse.mockRejectedValueOnce(DENIAL);
        await wrapper.find('[data-test="oncall-response-refresh"]').trigger("click");
        await flushPromises();

        expectLocked(wrapper);
        expect(toastSpy).not.toHaveBeenCalled();
      });

      /// These forms sit outside the record's own `v-if`, so the lock has to close them.
      it.each([
        ["handoff", "oncall-response-handoff-btn", "oncall-handoff-submit", {}],
        [
          "confirm recovery",
          "oncall-response-confirm-recovery-btn",
          "oncall-confirm-recovery-confirm",
          { origin_response_id: "resp_owner" },
        ],
        ["promote", "oncall-response-promote-btn", "oncall-promote-confirm", {}],
        ["resolve", "oncall-response-resolve-btn", "oncall-resolve-confirm", {}],
      ])(
        "closes the %s form when a denial lands under it",
        async (_form, opener, confirm, over) => {
          const wrapper = await renderWith(over);
          await wrapper.find(`[data-test="${opener}"]`).trigger("click");
          expect(wrapper.find(`[data-test="${confirm}"]`).exists()).toBe(true);

          service.getResponse.mockRejectedValueOnce(DENIAL);
          await wrapper.find('[data-test="oncall-response-refresh"]').trigger("click");
          await flushPromises();

          expectLocked(wrapper);
          expect(wrapper.find(`[data-test="${confirm}"]`).exists()).toBe(false);
        },
      );

      /// The record can come from cache while a context read is the first to reach the server.
      it.each([
        "listMembers",
        "listTeams",
        "priorCauses",
        "responseHistory",
        "responseReport",
        "escalationProgress",
        "listDeliveries",
        "whoIsOnCall",
        "getPolicy",
        "teamReachability",
        "resolvedSchedule",
      ] as const)("replaces the body when only %s is denied", async (read) => {
        queryClient.clear();
        service[read].mockRejectedValueOnce(DENIAL);
        const wrapper = await renderWith();

        expectLocked(wrapper);
        expect(toastSpy).not.toHaveBeenCalled();
      });

      /// The team's own read only happens once the list could not name it.
      it("replaces the body when only getTeam is denied", async () => {
        queryClient.clear();
        service.listTeams.mockRejectedValueOnce({ response: { status: 500, data: {} } });
        service.getTeam.mockRejectedValueOnce(DENIAL);
        const wrapper = await renderWith();

        expectLocked(wrapper);
        expect(toastSpy).not.toHaveBeenCalled();
      });

      /// The reads run together, so the slowest must not hold the lock back or bring the page back when it lands.
      it("locks while a sibling read is still out, and stays locked when it lands", async () => {
        queryClient.clear();
        const slow = deferredReply();
        service.listDeliveries.mockReturnValueOnce(slow.promise as never);
        service.priorCauses.mockRejectedValueOnce(DENIAL);
        const wrapper = await renderWith();
        expectLocked(wrapper);

        slow.answer({ deliveries: [], total: 0 });
        await flushPromises();

        expectLocked(wrapper);
      });

      /// Incidents is its own license feature, and the rail falls back to the id.
      it("leaves the page up when only the incident title read is denied", async () => {
        queryClient.clear();
        incidentsGet.mockRejectedValueOnce(DENIAL);
        const wrapper = await renderWith({ incident_id: "inc_1" });

        expect(incidentsGet).toHaveBeenCalled();
        expect(wrapper.find('[data-test="oncall-response-stats"]').exists()).toBe(true);
        expect(wrapper.findComponent(LicenseDeniedState).exists()).toBe(false);
      });

      it("leaves the page up when a context read fails for another reason", async () => {
        queryClient.clear();
        service.listDeliveries.mockRejectedValueOnce({ response: { status: 500, data: {} } });
        const wrapper = await renderWith();

        expect(wrapper.find('[data-test="oncall-response-stats"]').exists()).toBe(true);
        expect(wrapper.findComponent(LicenseDeniedState).exists()).toBe(false);
      });

      /// The alert only decorates the page, and its route is not an on-call one.
      it("leaves the page up when only the subject alert read is denied", async () => {
        queryClient.clear();
        alerts.get_by_alert_id.mockRejectedValueOnce(DENIAL);
        const wrapper = await renderWith();

        expect(wrapper.find('[data-test="oncall-response-stats"]').exists()).toBe(true);
        expect(wrapper.findComponent(LicenseDeniedState).exists()).toBe(false);
      });

      it("stops reading once the team list, which runs first, is denied", async () => {
        queryClient.clear();
        service.listTeams.mockRejectedValueOnce(DENIAL);
        await renderWith();

        expect(service.listDeliveries).not.toHaveBeenCalled();
        expect(service.whoIsOnCall).not.toHaveBeenCalled();
      });

      it("skips the handover read once who is on call is denied", async () => {
        queryClient.clear();
        service.whoIsOnCall.mockRejectedValueOnce(DENIAL);
        await renderWith();

        expect(service.resolvedSchedule).not.toHaveBeenCalled();
      });

      it("locks, with no error toast, when the re-read after a sent rung is denied", async () => {
        queryClient.clear();
        const wrapper = await renderWith();
        const progress = { next_targets: [], next_at: null, exhausted: false };
        (wrapper.vm as any).escalation = { ...progress, fired: [{ at: 1 }] };
        await flushPromises();
        toastSpy.mockClear();

        service.getResponse.mockRejectedValueOnce(DENIAL);
        (wrapper.vm as any).escalation = { ...progress, fired: [{ at: 2 }] };
        await flushPromises();

        expectLocked(wrapper);
        expect(toastSpy).not.toHaveBeenCalled();
      });

      it("stops the hold's progress rechecks when one is denied", async () => {
        vi.useFakeTimers();
        try {
          queryClient.clear();
          service.escalationProgress.mockResolvedValue({
            data: {
              fired: [],
              next_targets: [],
              next_at: null,
              exhausted: false,
              held_until_micros: Date.now() * 1000 + 600_000_000,
            },
          } as any);
          const wrapper = await renderWith();
          service.escalationProgress.mockClear();
          service.escalationProgress.mockRejectedValue(DENIAL);

          await vi.advanceTimersByTimeAsync(60_000);

          expectLocked(wrapper);
          expect(service.escalationProgress).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it("says a deleted page no longer exists, and links to Pages", async () => {
      service.getResponse.mockRejectedValue({ response: { status: 404, data: {} } });
      const wrapper = render();
      await flushPromises();

      const gone = wrapper.findComponent('[data-test="oncall-response-detail-not-found"]');
      expect(gone.attributes("title")).toBe("This page no longer exists");
      gone.vm.$emit("action");

      expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "onCallResponses" }));
    });

    it("drops the previous page's ladder and team while a linked page loads", async () => {
      const { reactive } = await import("vue");
      const wrapper = await renderWith({ id: "resp_1", title: "First page" });
      (wrapper.vm as unknown as DetailVm).escalation = {
        fired: [],
        next_targets: [],
        exhausted: true,
      };
      (wrapper.vm as unknown as DetailVm).teamName = "Platform";
      service.getResponse.mockImplementationOnce(() => new Promise(() => {}));

      reactive(routeState).params.responseId = "resp_next";
      await flushPromises();

      expect((wrapper.vm as unknown as DetailVm).escalation).toBe(null);
      expect((wrapper.vm as unknown as DetailVm).teamName).toBe("");
      reactive(routeState).params.responseId = "resp_1";
      await flushPromises();
    });

    /// N2: a linked page closes the Promote dialog, so its submit cannot promote the new page with the old title.
    it("closes the Promote dialog when the view moves to a linked page", async () => {
      const { reactive } = await import("vue");
      const wrapper = await renderWith({ id: "resp_1", title: "First page" });
      await wrapper.find('[data-test="oncall-response-promote-btn"]').trigger("click");
      expect(wrapper.find('[data-test="oncall-promote-title"]').exists()).toBe(true);
      service.getResponse.mockImplementationOnce(() => new Promise(() => {}));

      reactive(routeState).params.responseId = "resp_next";
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-promote-title"]').exists()).toBe(false);
      reactive(routeState).params.responseId = "resp_1";
      await flushPromises();
    });

    /// N1: a record re-read that fails after the view moved on says nothing on the new page.
    it("drops a failed re-read of the page the view has left", async () => {
      const { reactive } = await import("vue");
      const wrapper = await renderWith({ id: "resp_1", title: "First page" });
      let fail: (e: unknown) => void = () => {};
      service.getResponse.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
      const pending = (wrapper.vm as unknown as DetailVm).refreshRecord();
      service.getResponse.mockImplementationOnce(() => new Promise(() => {}));
      reactive(routeState).params.responseId = "resp_next";
      await flushPromises();
      toastSpy.mockClear();

      fail({ response: { status: 500, data: {} } });
      await pending;
      await flushPromises();

      expect(toastSpy).not.toHaveBeenCalled();
      reactive(routeState).params.responseId = "resp_1";
      await flushPromises();
    });

    it("says a linked page is gone instead of keeping the page it came from", async () => {
      const { reactive } = await import("vue");
      const wrapper = await renderWith({ id: "resp_1", title: "First page" });
      service.getResponse.mockRejectedValue({ response: { status: 404, data: {} } });

      reactive(routeState).params.responseId = "resp_gone";
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-response-detail-not-found"]').exists()).toBe(true);
      reactive(routeState).params.responseId = "resp_1";
      await flushPromises();
    });
  });

  it("puts the activity, deliveries and causes tabs in the header", async () => {
    const wrapper = await renderWith();
    const header = wrapper.find('[data-test="stub-header-tabs"]');

    expect(header.find('[data-test="oncall-response-tab-activity"]').exists()).toBe(true);
    expect(header.find('[data-test="oncall-response-tab-deliveries"]').exists()).toBe(true);
    expect(header.find('[data-test="oncall-response-tab-causes"]').exists()).toBe(true);
  });

  it("names the incident by its title in the rail", async () => {
    incidentsGet.mockResolvedValue(axiosReply({ title: "Checkout outage" }));
    const wrapper = await renderWith({ incident_id: "inc_9" });

    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("incidentTitle")).toBe(
      "Checkout outage",
    );
  });

  /// A raw id is the one thing a responder cannot read, so the rail waits rather than flashing it.
  it("skeletons the incident row until its title answers, never the id", async () => {
    const answer = deferredReply();
    incidentsGet.mockReturnValue(answer.promise);
    const wrapper = await renderWith({ incident_id: "inc_9" });
    const about = () => wrapper.findComponent({ name: "OnCallAboutPage" });

    expect(about().props("incidentLoading")).toBe(true);

    answer.answer({ title: "Checkout outage" });
    await flushPromises();
    expect(about().props("incidentLoading")).toBe(false);
    expect(about().props("incidentTitle")).toBe("Checkout outage");
  });

  /// The step a rung belongs to comes from the policy, so the feed waits for it instead of growing "(step 1)" later.
  it("holds the timeline until the team's policy has answered", async () => {
    const answer = deferredReply();
    service.getPolicy.mockReturnValue(answer.promise);
    const wrapper = await renderWith();

    expect(wrapper.find('[data-test="oncall-response-activity-pending"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OnCallActivityTimeline" }).exists()).toBe(false);

    answer.answer(null);
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-response-activity-pending"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OnCallActivityTimeline" }).exists()).toBe(true);
  });

  /// The tab panel renders a fragment, so the hook sits on an element the panel always renders.
  it("puts the activity hook on a rendered element", async () => {
    const wrapper = await renderWith();
    expect(wrapper.find('[data-test="oncall-response-activity"]').exists()).toBe(true);
  });

  describe("a team that was deleted", () => {
    /// A deleted team's ladder has no rotations to reach; Hand off is the next step, and Snooze still works.
    it("offers no Escalate for a deleted team, but keeps Snooze", async () => {
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_2", name: "Payments" }]));
      const wrapper = await renderWith();

      expect(wrapper.find('[data-test="oncall-response-escalate-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-snooze-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-handoff-btn"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallReachAlarm" }).props("escalatable")).toBe(false);
    });

    it("says so instead of the id, without a link", async () => {
      service.getTeam.mockRejectedValue({ response: { status: 404 } });
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_2", name: "Payments" }]));
      const wrapper = await renderWith();

      expect(wrapper.find('[data-test="oncall-response-team-link"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-team-deleted"]').text()).toBe(
        "Deleted team",
      );
      expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("teamDeleted")).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("teamDeleted")).toBe(true);
      expect(wrapper.findComponent({ name: "OnCallReachAlarm" }).props("noTeam")).toBe(true);
    });

    /// The list already said the team is gone, so the team and members reads would only 404.
    it("reads neither the team nor its members once the list says it is gone", async () => {
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_2", name: "Payments" }]));
      await renderWith();

      expect(service.getTeam).not.toHaveBeenCalled();
      expect(service.listMembers).not.toHaveBeenCalled();
    });

    /// A deleted team's roster can never load, so the card is not left waiting on a read that only 404s.
    it("does not ask who is on call for a team that no longer exists", async () => {
      service.listTeams.mockResolvedValue(axiosReply([{ id: "team_2", name: "Payments" }]));
      service.whoIsOnCall.mockClear();
      const wrapper = await renderWith();

      expect(service.whoIsOnCall).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("loading")).toBe(false);
    });

    /// An unrouted page has no team at all, which is a routing fact, not a deleted team.
    it.each([
      ["present", "team_1", [{ id: "team_1", name: "Platform" }], false],
      ["team list unavailable", "team_1", null, false],
    ] as const)(
      "does not call a %s page's team deleted",
      async (_name, teamId, teams, expected) => {
        if (teams) service.listTeams.mockResolvedValue(axiosReply(teams));
        else service.listTeams.mockRejectedValue(new Error("down"));
        const wrapper = await renderWith({ team_id: teamId });

        expect(wrapper.find('[data-test="oncall-response-team-deleted"]').exists()).toBe(expected);
        for (const name of ["OnCallAboutPage", "OnCallWhoIsOn"]) {
          expect(wrapper.findComponent({ name }).props("teamDeleted"), name).toBe(expected);
        }
        expect(wrapper.findComponent({ name: "OnCallReachAlarm" }).props("noTeam")).toBe(expected);
      },
    );
  });

  /// A closed page's state tag says it once; the escalation phrase would only repeat it.
  it("tags a resolved page's state beside its priority, without the ladder phrase", async () => {
    const wrapper = await renderWith({ state: "resolved", closed_at: 1_700_000_300_000_000 });

    const state = wrapper.find('[data-test="oncall-response-state-tag"]');
    expect(state.exists()).toBe(true);
    expect(state.findComponent({ name: "OTag" }).attributes("value")).toBe("resolved");
    expect(wrapper.find('[data-test="oncall-response-phrase"]').exists()).toBe(false);
  });

  it("keeps the ladder phrase beside the state tag while the page is open", async () => {
    const wrapper = await renderWith();

    expect(wrapper.find('[data-test="oncall-response-state-tag"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-response-phrase"]').exists()).toBe(true);
  });

  /// The header must not say "Not paged yet" before the ladder's progress has answered.
  it("makes no paging claim in the header while the progress is still loading", async () => {
    service.escalationProgress.mockReturnValue(new Promise<never>(() => {}));
    const wrapper = await renderWith({ reached_rung_micros: 300_000_000 });

    const phrase = wrapper.find(
      '[data-test="oncall-response-phrase"] [data-test="oncall-escalation-cell-level"]',
    );
    expect(phrase.text()).toBe("");
  });

  /// An empty 200 body is not an answer either.
  it("makes no paging claim in the header when the progress came back empty", async () => {
    service.escalationProgress.mockResolvedValue(axiosReply(null));
    const wrapper = await renderWith();

    const phrase = wrapper.find(
      '[data-test="oncall-response-phrase"] [data-test="oncall-escalation-cell-level"]',
    );
    expect(phrase.text()).toBe("");
  });

  /// An unrouted page has `team_id: null` on the wire (04-responses R6.1); there is no team to ask about or link to.
  describe("a page with no team", () => {
    /// The server refuses Escalate and Snooze on a page with no team (AK-4); Acknowledge, Resolve and Hand off stay.
    it.each([
      [
        "desktop",
        true,
        "oncall-response-escalate-btn",
        "oncall-response-snooze-btn",
        "oncall-response-handoff-btn",
      ],
      [
        "phone",
        false,
        "oncall-response-escalate-btn-menu",
        "oncall-response-snooze-15-menu",
        "oncall-response-handoff-btn-menu",
      ],
    ] as const)(
      "offers Hand off but not Escalate or Snooze on %s",
      async (_name, lgUp, escalate, snooze, handoff) => {
        mockViewport.lgUp = lgUp;
        mockViewport.mdUp = lgUp;
        try {
          service.escalationProgress.mockResolvedValue(
            axiosReply({
              fired: [],
              next_targets: [],
              next_at: null,
              exhausted: false,
              held_until_micros: Date.now() * 1000 + 60_000_000,
            }),
          );
          const teamless = await renderWith({ team_id: null });
          expect(teamless.find(`[data-test="${escalate}"]`).exists()).toBe(false);
          expect(teamless.find(`[data-test="${handoff}"]`).exists()).toBe(true);
          expect(teamless.find(`[data-test="${snooze}"]`).exists()).toBe(false);
          expect(teamless.find('[data-test="oncall-response-ack-btn"]').exists()).toBe(true);
          expect(teamless.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(true);
          expect(teamless.find('[data-test="oncall-response-hold-page-now"]').exists()).toBe(false);
          expect(teamless.findComponent({ name: "OnCallReachAlarm" }).props("escalatable")).toBe(
            false,
          );
          teamless.unmount();

          queryClient.clear();
          const routed = await renderWith();
          expect(routed.find(`[data-test="${escalate}"]`).exists()).toBe(true);
          expect(routed.find(`[data-test="${snooze}"]`).exists()).toBe(true);
          expect(routed.find('[data-test="oncall-response-hold-page-now"]').exists()).toBe(true);
          expect(routed.findComponent({ name: "OnCallReachAlarm" }).props("escalatable")).toBe(
            true,
          );
        } finally {
          mockViewport.lgUp = true;
          mockViewport.mdUp = true;
        }
      },
    );

    it("asks no team endpoint, links nowhere, and draws no who-is-on card", async () => {
      const wrapper = await renderWith({ team_id: null });

      for (const call of [
        service.getTeam,
        service.listMembers,
        service.whoIsOnCall,
        service.getPolicy,
        service.teamReachability,
        service.resolvedSchedule,
      ]) {
        expect(call).not.toHaveBeenCalled();
      }
      // Hand-off to a team still needs the team list.
      expect(service.listTeams).toHaveBeenCalled();
      expect(wrapper.find('[data-test="oncall-response-team-none"]').text()).toBe("Unrouted");
      expect(wrapper.find('[data-test="oncall-response-team-link"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-team-deleted"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("teamId")).toBeNull();
      expect(wrapper.findComponent({ name: "OnCallReachAlarm" }).props("noTeam")).toBe(true);
      for (const link of wrapper.findAllComponents({ name: "RouterLink" })) {
        const to = link.props("to") as { name?: string; params: { teamId?: string } } | undefined;
        if (to?.name === "onCallTeamDetail") expect(to.params.teamId).toBeTruthy();
      }
    });
  });
});
