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
import alertsService from "@/services/alerts";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
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
    confirmRecovery: vi.fn(),
    snoozeResponse: vi.fn(),
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
    escalateNow: vi.fn(),
  },
}));

vi.mock("@/services/alerts", () => ({
  default: { get_by_alert_id: vi.fn(), getHistory: vi.fn() },
}));

/// Escalate's whole point is what it reports back, and the report is a toast.
const toastSpy = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { responseId: "resp_1" } }),
  useRouter: () => ({ push }),
}));

const service = vi.mocked(oncallService);
const alerts = vi.mocked(alertsService);

const stubs = {
  OPageLayout: {
    name: "OPageLayout",
    // `title-trail` carries the state tags, which are assertions of their own.
    template: "<div><slot name='title-trail' /><slot name='actions' /><slot /></div>",
  },
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OBanner: { name: "OBanner", template: "<div><slot /></div>" },
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
  OnCallEscalation: {
    name: "OnCallEscalation",
    props: ["progress", "events", "responderRole"],
    template: "<div />",
  },
  OContent: { name: "OContent", template: "<div><slot /></div>" },
  OStatStrip: { name: "OStatStrip", props: ["items"], template: "<div />" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
  // Always open: the tests are about what the page holds, not about whether
  // the disclosure widget animates.
  OCollapsible: { name: "OCollapsible", props: ["label"], template: "<div><slot /></div>" },
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
    props: ["state", "deliveries", "deliveriesTotal", "progress", "smtpConfigured"],
    template: "<div />",
  },
  OnCallWhatFired: {
    name: "OnCallWhatFired",
    props: ["orgId", "subjectType", "sourceId", "alert", "runbookUrl", "observed", "openedAt"],
    template: "<div />",
  },
  OnCallWhoIsOn: {
    name: "OnCallWhoIsOn",
    props: ["slots", "deliveries", "handoverAt", "handoverTo", "closedAt"],
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
      "openedAt",
      "routingReason",
      "subjectStream",
      "ackedBy",
      "incidentId",
      "cause",
      "causeNote",
      "priorCauses",
      "priorFirings",
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
    emits: ["select"],
    template: `<button @click="$emit('select')"><slot /></button>`,
  },
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
  service.getResponse.mockResolvedValue({ data: { response: record(overrides), events: [] } } as any);
  const wrapper = render();
  await flushPromises();
  return wrapper;
}

describe("OnCallResponseDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getTeam.mockResolvedValue({ data: { name: "Platform" } } as any);
    service.listMembers.mockResolvedValue({
      data: [{ user_email: "engineer@example.com" }, { user_email: "other@example.com" }],
    } as any);
    service.priorCauses.mockResolvedValue({ data: [] } as any);
    service.responseHistory.mockResolvedValue({ data: [] } as any);
    alerts.get_by_alert_id.mockResolvedValue({
      data: { name: "checkout_error_ratio", stream_name: "default", stream_type: "logs" },
    } as any);
    service.listTeams.mockResolvedValue({
      data: [
        { id: "team_1", name: "Platform" },
        { id: "team_2", name: "Payments" },
      ],
    } as any);
    service.listDeliveries.mockResolvedValue({ data: { total: 0, deliveries: [] } } as any);
    service.escalationProgress.mockResolvedValue({ data: null } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    service.getPolicy.mockResolvedValue({ data: null } as any);
    service.teamReachability.mockResolvedValue({ data: { smtp_configured: true } } as any);
    service.resolvedSchedule.mockResolvedValue({ data: [] } as any);
    alerts.getHistory.mockResolvedValue({ data: { hits: [] } } as any);
  });

  /// "Why did this page me" was answerable only by scrolling the timeline.
  it("shows the routing decision on the overview", async () => {
    service.getResponse.mockResolvedValue({
      data: {
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
      },
    } as any);
    const wrapper = render();
    await flushPromises();

    expect(
      wrapper.findComponent({ name: "OnCallAboutPage" }).props("routingReason"),
    ).toBe("routed to tm_pay by ownership rule k8s-namespace=payments");
  });

  // No decision recorded must leave the row out rather than render an empty one.
  it("omits the routing row when no decision was recorded", async () => {
    const wrapper = await renderWith();
    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("routingReason")).toBe(
      null,
    );
  });

  it("loads the past firings alongside the causes", async () => {
    service.responseHistory.mockResolvedValue({
      data: [{ id: "resp_0", state: "resolved", opened_at: 1, acked_by: null, cause: null }],
    } as any);
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
    service.priorCauses.mockResolvedValue({
      data: [{ cause: "noisy_threshold", count: 3, last_response_id: "resp_0" }],
    } as any);
    service.responseHistory.mockRejectedValue({ response: { status: 404 } });
    const wrapper = await renderWith();

    expect(wrapper.findComponent({ name: "OnCallPriorCauses" }).props("groups")).toHaveLength(1);
    expect(wrapper.findComponent({ name: "OnCallFiringHistory" }).props("firings")).toEqual([]);
  });

  /// The subject row was an unclickable ksuid, so the rule that fired — the
  /// first thing anybody wants to open — was reachable only by searching for it.
  it("links the subject to the alert that fired", async () => {
    const wrapper = await renderWith();

    const fired = wrapper.findComponent({ name: "OnCallWhatFired" });
    expect(fired.props("subjectType")).toBe("alert");
    expect(fired.props("sourceId")).toBe("al_ckt");
    expect(fired.props("alert")).toMatchObject({ name: "checkout_error_ratio" });
    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("subjectStream")).toBe(
      "default (logs)",
    );
  });

  /// A page outlives the rule it came from, and the record — not the alert —
  /// is the authority on what happened.
  it("still renders when the alert has since been deleted", async () => {
    alerts.get_by_alert_id.mockRejectedValue({ response: { status: 404 } });
    const wrapper = await renderWith();

    expect(wrapper.findComponent({ name: "OnCallWhatFired" }).props("alert")).toBe(null);
    expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("subjectStream")).toBe(
      null,
    );
  });

  // A synthetic has no alert to open, so it must not render a dead link.
  it("does not link a subject that is not an alert", async () => {
    const wrapper = await renderWith({
      subject: { subject_type: "synthetic", source_id: "sy_login", firing: 1 },
    });

    expect(wrapper.findComponent({ name: "OnCallWhatFired" }).props("subjectType")).toBe(
      "synthetic",
    );
    expect(alerts.get_by_alert_id).not.toHaveBeenCalled();
  });

  it("acknowledges the page and reloads it", async () => {
    const wrapper = await renderWith();
    service.acknowledgeResponse.mockResolvedValue({ data: {} } as any);

    await wrapper.find('[data-test="oncall-response-ack-btn"]').trigger("click");
    await flushPromises();

    expect(service.acknowledgeResponse).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
      response_id: "resp_1",
    });
    // Two loads: mount, then the refresh that shows the new state.
    expect(service.getResponse).toHaveBeenCalledTimes(2);
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
    service.snoozeResponse.mockResolvedValue({ data: {} } as any);

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

    const lapsed = await renderWith({ snoozed_until: (Date.now() - 60_000) * 1000 });
    expect(lapsed.find('[data-test="oncall-response-snoozed-banner"]').exists()).toBe(false);
  });

  it("adds a note and clears the box", async () => {
    const wrapper = await renderWith();
    service.addNote.mockResolvedValue({ data: {} } as any);

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
    service.handoffResponse.mockResolvedValue({ data: {} } as any);

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
      service.resolveResponse.mockResolvedValue({ data: {} } as any);
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
      service.priorCauses.mockResolvedValue({
        data: [
          {
            cause: "config_change_or_deploy",
            count: 3,
            note: "deploy rollback",
            last_response_id: "resp_0",
          },
        ],
      } as any);

      const wrapper = await renderWith();

      expect(
        wrapper.findComponent({ name: "OnCallPriorCauses" }).props("groups"),
      ).toHaveLength(1);
    });

    /// History is context. Losing it must not stop someone acting on the page
    /// in front of them.
    /// The panel links to the firing that had that cause; a count with no way
    /// to read the actual record is trivia.
    it("navigates to the firing behind a cause", async () => {
      service.priorCauses.mockResolvedValue({
        data: [{ cause: "genuine_defect", count: 2, last_response_id: "resp_0" }],
      } as any);
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
      expect(wrapper.find('[data-test="oncall-response-confirm-recovery-btn"]').exists()).toBe(true);
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
      service.confirmRecovery.mockResolvedValue({ data: record() } as any);
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

    /// The role is what the ladder is truncated by, so it is what the ladder
    /// panel is told — not a guess made from the ladder's own shape.
    it("tells the ladder panel which seat this is", async () => {
      service.escalationProgress.mockResolvedValue({
        data: { fired: [], next_targets: [], next_at: null, exhausted: true, stopped_because: null },
      } as any);
      const wrapper = await renderWith({ responder_role: "impacted" });

      expect(wrapper.findComponent({ name: "OnCallEscalation" }).props("responderRole")).toBe(
        "impacted",
      );
    });

    it("leaves an owner record with no liaison language at all", async () => {
      service.escalationProgress.mockResolvedValue({
        data: { fired: [], next_targets: [], next_at: null, exhausted: false, stopped_because: null },
      } as any);
      const wrapper = await renderWith({ responder_role: "owner" });

      expect(wrapper.find('[data-test="oncall-response-liaison-banner"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="oncall-response-liaison-tag"]').exists()).toBe(false);
      expect(wrapper.findComponent({ name: "OnCallEscalation" }).props("responderRole")).toBe(
        "owner",
      );
    });
  });

  /// D5. `incident_id` could only ever be set by the path that opened the
  /// record, so a responder who worked a page for ten minutes and realised it
  /// was bigger than an alert had no way to say so.
  describe("promote", () => {
    it("promotes with the record's own title and severity by default", async () => {
      service.promoteResponse.mockResolvedValue({
        data: { incident_id: "inc_9", severity: "P1", response: record() },
      } as any);
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
      expect(
        (select?.props("options") as { value: string }[]).map((o) => o.value),
      ).toEqual(["P1", "P2"]);
    });

    /// Two responders clicking at once must not end up looking at two
    /// incidents for one firing: the server refuses the second with a 409, and
    /// the refetch is what puts the winning incident in front of the loser.
    it("refetches on a conflict so the incident that won is the one shown", async () => {
      service.promoteResponse.mockRejectedValue({
        response: { status: 409, data: { message: "this record is already part of incident inc_9" } },
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
      expect(wrapper.findComponent({ name: "OnCallAboutPage" }).props("incidentId")).toBe(
        "inc_9",
      );
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
      service.escalateNow.mockResolvedValue({ data: {} } as any);

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
      service.escalationProgress.mockResolvedValue({
        data: { fired: [], next_targets: [], next_at: null, exhausted: true },
      } as any);
      const wrapper = await renderWith();

      expect(
        wrapper.find('[data-test="oncall-response-escalate-btn"]').attributes("disabled"),
      ).toBeDefined();
    });
  });

  /// The rail's four answers. Each is context: the record has to render when
  /// every one of them fails, which is what these pin.
  describe("team context", () => {
    it("passes who is on call and the transport verdict to the rail", async () => {
      service.whoIsOnCall.mockResolvedValue({
        data: [{ slot: "primary", rotation: "weekly", user_email: "ana@o2.ai" }],
      } as any);
      service.teamReachability.mockResolvedValue({ data: { smtp_configured: false } } as any);
      const wrapper = await renderWith();

      expect(wrapper.findComponent({ name: "OnCallWhoIsOn" }).props("slots")).toHaveLength(1);
      expect(
        wrapper.findComponent({ name: "OnCallReachAlarm" }).props("smtpConfigured"),
      ).toBe(false);
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
      service.resolvedSchedule.mockResolvedValue({
        data: [
          { from: now - 1_000_000, to: now + 1_000_000, rotation: "weekly", user_email: "ana@o2.ai" },
          { from: now + 1_000_000, to: now + 9_000_000, rotation: "weekly", user_email: "bo@o2.ai" },
        ],
      } as any);
      const wrapper = await renderWith();

      const who = wrapper.findComponent({ name: "OnCallWhoIsOn" });
      expect(who.props("handoverAt")).toBe(now + 1_000_000);
      expect(who.props("handoverTo")).toBe("bo@o2.ai");
    });

    /// A gap after the current shift is a real answer — the pager goes to
    /// nobody — so the row must not skip forward to the next staffed span.
    it("says nobody inherits when the next span is a gap", async () => {
      const now = Date.now() * 1000;
      service.resolvedSchedule.mockResolvedValue({
        data: [
          { from: now - 1_000_000, to: now + 1_000_000, rotation: "weekly", user_email: "ana@o2.ai" },
          { from: now + 1_000_000, to: now + 9_000_000, rotation: "weekly" },
        ],
      } as any);
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

      expect(service.whoIsOnCall).toHaveBeenCalledWith(
        expect.objectContaining({ at: closedAt }),
      );
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

      expect(service.whoIsOnCall).toHaveBeenCalledWith(
        expect.objectContaining({ at: undefined }),
      );
    });
  });

  /// `runbook_url` is hoisted onto the record by the API precisely so this
  /// screen can show it, and it was read by nothing in `web/src`.
  it("hands the runbook the API hoisted onto the record to the What-fired card", async () => {
    const wrapper = await renderWith({ runbook_url: "https://wiki/checkout" });
    expect(wrapper.findComponent({ name: "OnCallWhatFired" }).props("runbookUrl")).toBe(
      "https://wiki/checkout",
    );
  });

  /// The value that crossed the threshold lives on the alert's own history and
  /// nowhere on the record, so it is fetched around the firing rather than
  /// around now — by the time somebody opens this, now is not when it happened.
  it("fetches the evaluation around the firing, not around now", async () => {
    alerts.getHistory.mockResolvedValue({ data: { hits: [{ actual_value: 7.4 }] } } as any);
    const wrapper = await renderWith();

    expect(alerts.getHistory).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      expect.objectContaining({ alert_id: "al_ckt", end_time: 1_700_000_060_000_000 }),
    );
    expect(wrapper.findComponent({ name: "OnCallWhatFired" }).props("observed")).toEqual({
      actual_value: 7.4,
    });
  });
  /// The strip read "— — —" on exactly the page that needs it: an open record
  /// has no ack or resolve duration yet, and an exhausted ladder has no next
  /// rung. Each tile now says its own version of what is actually true.
  it("says what the clocks are doing instead of three dashes", async () => {
    const wrapper = await renderWith();
    const items = wrapper.findComponent({ name: "OStatStrip" }).props("items") as {
      key: string;
      label: string;
      value: string;
    }[];

    const ack = items.find((i) => i.key === "ack")!;
    expect(ack.label).toBe("Unacked for");
    expect(ack.value).not.toBe("—");

    const resolve = items.find((i) => i.key === "resolve")!;
    expect(resolve.label).toBe("Open for");
    expect(resolve.value).not.toBe("—");
  });

  /// A ladder with nowhere left to go is the loudest fact on the page; a dash
  /// under "escalates in" read as one still counting down.
  it("says nobody is left rather than dashing the escalation tile", async () => {
    service.escalationProgress.mockResolvedValue({
      data: {
        fired: [],
        next_targets: [],
        next_at: null,
        exhausted: true,
        stopped_because: "the ladder is exhausted — nobody acknowledged",
      },
    } as any);

    const wrapper = await renderWith();
    const items = wrapper.findComponent({ name: "OStatStrip" }).props("items") as {
      key: string;
      value: string;
      tone: string;
    }[];

    const escalates = items.find((i) => i.key === "escalatesIn")!;
    expect(escalates.value).toBe("Nobody left");
    expect(escalates.tone).toBe("error");
  });

  /// Once it is answered the tile freezes into the metric it was always
  /// labelled as — the running clock belongs to the open state only.
  it("reverts to the settled durations once the page is answered", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: "engineer@example.com",
      acked_at: 1_700_000_000_000_000 + HOUR_MICROS,
    });
    const items = wrapper.findComponent({ name: "OStatStrip" }).props("items") as {
      key: string;
      label: string;
      value: string;
    }[];

    const ack = items.find((i) => i.key === "ack")!;
    expect(ack.label).toBe("Time to ack");
    expect(ack.value).toContain("1h");
  });

  /// The state tag sits beside the page title. A tile whose whole reading is
  /// that same word spends a fifth of the strip repeating what is already on
  /// screen, so it stands down and leaves the four measurements.
  it("drops the escalation tile once its reading is the state tag over again", async () => {
    const wrapper = await renderWith({
      state: "acknowledged",
      acked_by: "engineer@example.com",
      acked_at: 1_700_000_000_000_000 + HOUR_MICROS,
    });
    const items = wrapper.findComponent({ name: "OStatStrip" }).props("items") as {
      key: string;
    }[];

    expect(items.find((i) => i.key === "escalatesIn")).toBeUndefined();
    expect(items.map((i) => i.key)).toEqual(["ack", "resolve", "reachedRung", "firing"]);
  });
});

/// §L.2 — three facts already in payloads this page fetches and rendered
/// nowhere. None of them needs a request.
describe("OnCallResponseDetail — what the payload already knew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getTeam.mockResolvedValue({ data: { name: "Platform" } } as any);
    service.listMembers.mockResolvedValue({ data: [] } as any);
    service.priorCauses.mockResolvedValue({ data: [] } as any);
    service.responseHistory.mockResolvedValue({ data: [] } as any);
    service.listTeams.mockResolvedValue({ data: [] } as any);
    service.escalationProgress.mockResolvedValue({
      data: { fired: [], next_targets: [], next_at: null, exhausted: false },
    } as any);
    service.listDeliveries.mockResolvedValue({ data: { total: 0, deliveries: [] } } as any);
    service.getPolicy.mockResolvedValue({ data: null } as any);
    service.whoIsOnCall.mockResolvedValue({ data: [] } as any);
    alerts.get_by_alert_id.mockResolvedValue({ data: {} } as any);
  });

  const stat = async (wrapper: any, key: string) =>
    (wrapper.findComponent({ name: "OStatStrip" }).props("items") as { key: string; value: unknown }[])
      .find((i) => i.key === key)?.value;

  /// **`0` is a real and common value** — it means the page never left the
  /// first rung — so `if (micros)` is a bug here. The absent case is the one
  /// that reads as a dash: no page went out at all.
  describe("the rung the ladder reached", () => {
    it("says which rung of how many, matched against the team's own ladder", async () => {
      service.getPolicy.mockResolvedValue({
        data: {
          rungs: [
            {
              priority: 2,
              channels: ["email"],
              steps: [
                { after_micros: 0, targets: [{ kind: "on_call_now" }] },
                { after_micros: 300_000_000, targets: [{ kind: "next_on_call" }] },
                { after_micros: 900_000_000, targets: [{ kind: "whole_team" }] },
              ],
            },
          ],
        },
      } as any);

      const wrapper = await renderWith({ priority: 2, reached_rung_micros: 300_000_000 });
      expect(await stat(wrapper, "reachedRung")).toBe("2 of 3");
    });

    it("treats never leaving the first rung as a rung, not as nothing", async () => {
      service.getPolicy.mockResolvedValue({
        data: {
          rungs: [
            {
              priority: 2,
              channels: ["email"],
              steps: [{ after_micros: 0, targets: [{ kind: "on_call_now" }] }],
            },
          ],
        },
      } as any);

      const wrapper = await renderWith({ priority: 2, reached_rung_micros: 0 });
      expect(await stat(wrapper, "reachedRung")).toBe("1 of 1");
    });

    it("reads a dash only when no page went out at all", async () => {
      const wrapper = await renderWith({ priority: 2 });
      expect(await stat(wrapper, "reachedRung")).toBe("—");
    });

    /// With no policy to match against, the delay is still more honest than
    /// nothing — the reader learns the ladder got 5m deep.
    it("falls back to the delay when the ladder cannot be matched", async () => {
      const wrapper = await renderWith({ priority: 2, reached_rung_micros: 300_000_000 });
      expect(await stat(wrapper, "reachedRung")).toBe("+5m");
    });
  });

  /// "Escalated" alone is a claim. The person who pressed it wants to know
  /// which phone is ringing, and the 200 body says.
  describe("what Escalate reports back", () => {
    it("names who the rung reached", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue({
        data: {
          escalated_to: "rung",
          rung_micros: 300_000_000,
          recipients: ["ana@o2.ai"],
          chased: ["bo@o2.ai"],
          deduplicated: [],
          response: {},
        },
      } as any);

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      const message = String(toastSpy.mock.calls.at(-1)![0].message);
      expect(message).toContain("ana@o2.ai");
      // Chased counts as reached: a second page landed on them.
      expect(message).toContain("bo@o2.ai");
    });

    /// A rung that resolved to nobody is a real outcome, and the one worth
    /// saying loudest: the ladder moved and no phone rang.
    it("says so when the rung reached nobody", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue({
        data: {
          escalated_to: "rung",
          rung_micros: 0,
          recipients: [],
          chased: [],
          deduplicated: ["ana@o2.ai"],
          response: {},
        },
      } as any);

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      expect(String(toastSpy.mock.calls.at(-1)![0].message)).toContain("reached nobody");
    });

    /// `ladder_exhausted` is a 200 on purpose — "there is nobody above you" is
    /// an answer, not a failure. Reporting it as an error reads as though the
    /// press failed and invites a second one.
    it("reports an exhausted ladder as an answer, not a failure", async () => {
      const wrapper = await renderWith();
      service.escalateNow.mockResolvedValue({
        data: { escalated_to: "ladder_exhausted", response: {} },
      } as any);

      await wrapper.find('[data-test="oncall-response-escalate-btn"]').trigger("click");
      await flushPromises();

      const call = toastSpy.mock.calls.at(-1)![0];
      expect(call.variant).toBe("success");
      expect(String(call.message)).toContain("last step");
    });
  });
});
