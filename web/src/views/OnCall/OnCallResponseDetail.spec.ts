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
import OnCallResponseDetail from "@/views/OnCall/OnCallResponseDetail.vue";

vi.mock("@/services/oncall", () => ({
  default: {
    getResponse: vi.fn(),
    getTeam: vi.fn(),
    listMembers: vi.fn(),
    listTeams: vi.fn(),
    acknowledgeResponse: vi.fn(),
    snoozeResponse: vi.fn(),
    addNote: vi.fn(),
    handoffResponse: vi.fn(),
    resolveResponse: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { responseId: "resp_1" } }),
}));

const service = vi.mocked(oncallService);

const stubs = {
  OPageLayout: { name: "OPageLayout", template: "<div><slot name='actions' /><slot /></div>" },
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OBanner: { name: "OBanner", template: "<div><slot /></div>" },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OnCallTimeline: { name: "OnCallTimeline", template: "<div />" },
  ConfirmDialog: { name: "ConfirmDialog", template: "<div />" },
  OToggleGroup: { name: "OToggleGroup", template: "<div><slot /></div>" },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
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
    service.listTeams.mockResolvedValue({
      data: [
        { id: "team_1", name: "Platform" },
        { id: "team_2", name: "Payments" },
      ],
    } as any);
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

  /// Acknowledging is a claim, not a view state — offering it again on a page
  /// that is already owned invites a second person to think they took it.
  it("hides acknowledge and snooze once someone owns the page", async () => {
    const wrapper = await renderWith({
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

    await wrapper.find('[data-test="oncall-response-snooze-btn"]').trigger("click");
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
});
