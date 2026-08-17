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
  },
}));

vi.mock("@/services/alerts", () => ({
  default: { get_by_alert_id: vi.fn() },
}));

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
  OTabs: { name: "OTabs", template: "<div><slot /></div>" },
  OTab: { name: "OTab", props: ["name", "label"], template: "<button />" },
  // Panels render regardless of the active tab: the tests are about what the
  // page can do, not about the tab widget's own behaviour.
  OTabPanels: { name: "OTabPanels", template: "<div><slot /></div>" },
  OTabPanel: { name: "OTabPanel", props: ["name"], template: "<div><slot /></div>" },
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

    expect(wrapper.find('[data-test="oncall-response-routing-reason"]').text()).toBe(
      "routed to tm_pay by ownership rule k8s-namespace=payments",
    );
  });

  // No decision recorded must leave the row out rather than render an empty one.
  it("omits the routing row when no decision was recorded", async () => {
    const wrapper = await renderWith();
    expect(wrapper.find('[data-test="oncall-response-routing-reason"]').exists()).toBe(false);
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

    const link = wrapper.find('[data-test="oncall-response-subject-link"]');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe("checkout_error_ratio");
    expect(wrapper.find('[data-test="oncall-response-subject-stream"]').text()).toBe(
      "default (logs)",
    );
  });

  /// A page outlives the rule it came from, and the record — not the alert —
  /// is the authority on what happened.
  it("still renders when the alert has since been deleted", async () => {
    alerts.get_by_alert_id.mockRejectedValue({ response: { status: 404 } });
    const wrapper = await renderWith();

    expect(wrapper.find('[data-test="oncall-response-subject-link"]').text()).toBe("al_ckt");
    expect(wrapper.find('[data-test="oncall-response-subject-stream"]').exists()).toBe(false);
  });

  // A synthetic has no alert to open, so it must not render a dead link.
  it("does not link a subject that is not an alert", async () => {
    const wrapper = await renderWith({
      subject: { subject_type: "synthetic", source_id: "sy_login", firing: 1 },
    });

    expect(wrapper.find('[data-test="oncall-response-subject-link"]').exists()).toBe(false);
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
      expect(wrapper.find('[data-test="oncall-response-incident-link"]').exists()).toBe(true);
    });

    /// A firing is routinely recognised as part of something larger after it
    /// was closed, and the server does not gate the verb by state.
    it("still offers the promotion on a closed record", async () => {
      const wrapper = await renderWith({ state: "resolved", closed_at: 1_700_000_100_000_000 });
      expect(wrapper.find('[data-test="oncall-response-promote-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oncall-response-resolve-btn"]').exists()).toBe(false);
    });
  });
});
