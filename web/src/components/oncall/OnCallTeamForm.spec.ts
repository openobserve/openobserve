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

import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import i18n from "@/locales";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import usersService from "@/services/users";

vi.mock("@/services/oncall", () => ({
  default: {
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    addMembers: vi.fn(),
    getSchedule: vi.fn(),
    setSchedule: vi.fn(),
  },
}));
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn() } }));

const oncall = vi.mocked(oncallService);
const users = vi.mocked(usersService);

const ORG_USERS = [{ email: "ana@o2.ai" }, { email: "bob@o2.ai" }];

const stubs = {
  ODrawer: { name: "ODrawer", props: ["open"], template: "<div v-if='open'><slot /></div>" },
};

function render(team: unknown = null) {
  return mount(OnCallTeamForm, {
    props: { open: true, team: team as any },
    global: { plugins: [i18n, store], stubs },
  });
}

/// Drives the real OForm rather than poking the component: the fields bind by
/// `name=`, so setting values any other way would test a path the drawer does
/// not have.
function setValues(wrapper: any, values: Record<string, unknown>) {
  const form = wrapper.findComponent({ name: "OForm" }).vm.form;
  for (const [key, value] of Object.entries(values)) form.setFieldValue(key, value);
}

/// Submits through the form itself. jsdom will not dispatch a native submit
/// from inside the stubbed drawer — the real Save button lives in the drawer
/// footer and is linked only by `form-id` — so triggering the element would
/// test the stub rather than the handler.
function submit(wrapper: any) {
  return wrapper.findComponent({ name: "OForm" }).vm.form.handleSubmit();
}

describe("OnCallTeamForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    users.orgUsers.mockResolvedValue({ data: { data: ORG_USERS } } as any);
    oncall.createTeam.mockResolvedValue({ data: { id: "team_new" } } as any);
    oncall.addMembers.mockResolvedValue({ data: [] } as any);
    oncall.getSchedule.mockResolvedValue({ data: null } as any);
    oncall.setSchedule.mockResolvedValue({ data: {} } as any);
  });

  /// The design asks for one form (architecture/02 §4): a team that cannot page
  /// anybody is not a created team, and it used to take three more screens.
  it("creates the team, its members and its rotation from one submit", async () => {
    const wrapper = render();
    await flushPromises();

    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai", "bob@o2.ai"],
      first_handover: "2026-08-17T10:00",
    });
    await submit(wrapper);
    await flushPromises();

    expect(oncall.createTeam).toHaveBeenCalledOnce();
    expect(oncall.addMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "team_new",
        data: { user_emails: ["ana@o2.ai", "bob@o2.ai"] },
      }),
    );

    const schedule = oncall.setSchedule.mock.calls[0][0] as any;
    expect(schedule.team_id).toBe("team_new");
    // Selection order IS the paging order, so it must survive verbatim. The
    // roster lives on the shift RULE now — a rotation is a named position and
    // has no roster of its own.
    const [primary] = schedule.data.rotations;
    expect(primary.shift_rules[0].members).toEqual(["ana@o2.ai", "bob@o2.ai"]);
    expect(primary.shift_rules[0].anchor_micros).toBe(Date.parse("2026-08-17T10:00") * 1000);
  });

  /// Adding members auto-staffs the team, and this PUT is a full replace: the
  /// hand-built rotation used to delete the second one the server had written,
  /// so a team created here had one position where the same team created by
  /// curl had two. Every staffed rotation must come back, with only shift and
  /// anchor changed to what the form asked for.
  it("keeps the rotations the server staffed instead of replacing them", async () => {
    oncall.getSchedule.mockResolvedValue({
      data: {
        timezone: "UTC",
        rotations: [
          {
            id: "rot_primary",
            name: "Primary",
            shift_rules: [
              {
                name: "Primary",
                members: ["ana@o2.ai", "bob@o2.ai"],
                shift_micros: 1,
                anchor_micros: 1,
              },
            ],
          },
          {
            id: "rot_secondary",
            name: "Secondary",
            shift_rules: [
              {
                name: "Secondary",
                members: ["ana@o2.ai", "bob@o2.ai"],
                shift_micros: 1,
                anchor_micros: 7,
              },
            ],
          },
        ],
      },
    } as any);

    const wrapper = render();
    await flushPromises();
    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai", "bob@o2.ai"],
      first_handover: "2026-08-17T10:00",
    });
    await submit(wrapper);
    await flushPromises();

    const { rotations } = (oncall.setSchedule.mock.calls[0][0] as any).data;
    expect(rotations.map((r: any) => r.id)).toEqual(["rot_primary", "rot_secondary"]);

    /// **Each rotation keeps its own offset from the form's anchor.** The
    /// second one sits a shift behind, which is the entire mechanism: while the
    /// roster holds two or more people the two can never resolve to the same
    /// person. Stamping the first anchor over every rotation collapsed them
    /// onto one instant, which is the opposite of what a second position is
    /// for.
    const anchor = Date.parse("2026-08-17T10:00") * 1000;
    expect(rotations[0].shift_rules[0].anchor_micros).toBe(anchor);
    expect(rotations[1].shift_rules[0].anchor_micros).toBe(anchor - MICROS_PER_WEEK);
  });

  /// The checkbox has to be able to say no. The backend staffs a second
  /// rotation by default, so leaving it in place when the box is clear would
  /// make the control read as a choice the form quietly overrules.
  it("removes the second rotation when the box is cleared", async () => {
    oncall.getSchedule.mockResolvedValue({
      data: {
        timezone: "UTC",
        rotations: [
          { id: "rot_primary", name: "Primary", shift_rules: [] },
          { id: "rot_secondary", name: "Secondary", shift_rules: [] },
        ],
      },
    } as any);

    const wrapper = render();
    await flushPromises();
    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai", "bob@o2.ai"],
      first_handover: "2026-08-17T10:00",
      create_secondary: false,
    });
    await submit(wrapper);
    await flushPromises();

    const { rotations } = (oncall.setSchedule.mock.calls[0][0] as any).data;
    expect(rotations.map((r: any) => r.id)).toEqual(["rot_primary"]);
  });

  /// `source: "default"` means "the backend staffed this and no human has
  /// touched it", and it drives the team screen's offer to customise. By the
  /// time this PUT is sent a human has chosen a timezone, a cadence and a first
  /// handover, so carrying the marker back would make the product offer to
  /// customise a schedule somebody just customised.
  it("clears the default-staffing marker once the form has set the cadence", async () => {
    oncall.getSchedule.mockResolvedValue({
      data: {
        timezone: "UTC",
        rotations: [
          {
            name: "Primary",
            members: ["ana@o2.ai"],
            shift_micros: 1,
            anchor_micros: 1,
            secondary_slot: "secondary",
            source: "default",
          },
        ],
      },
    } as any);

    const wrapper = render();
    await flushPromises();
    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai"],
      first_handover: "2026-08-17T10:00",
    });
    await submit(wrapper);
    await flushPromises();

    const { rotations } = (oncall.setSchedule.mock.calls[0][0] as any).data;
    expect(rotations[0].source).toBeUndefined();
    // The declared secondary slot is the backend's, not the form's, and it
    // survives: dropping it is what left a UI-created team with one slot while
    // the same team built by curl had two.
    expect(rotations[0].secondary_slot).toBe("secondary");
  });

  /// A server that staffed nothing, or a read that failed, still gets the one
  /// rotation the form describes — which is all such a team would have had.
  /// **The pairing is data, not a rule.** Written here rather than read back,
  /// the second rotation is the same roster with its anchor one shift behind —
  /// nothing links the two, and nothing at resolution time knows they are
  /// related.
  it("writes both rotations itself when the read-back fails", async () => {
    oncall.getSchedule.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();
    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai", "bob@o2.ai"],
      first_handover: "2026-08-17T10:00",
    });
    await submit(wrapper);
    await flushPromises();

    const { rotations } = (oncall.setSchedule.mock.calls[0][0] as any).data;
    expect(rotations).toHaveLength(2);
    expect(rotations.map((r: any) => r.name)).toEqual(["Primary", "Secondary"]);
    // Distinct ids, because a level stores one and two rotations sharing an id
    // would be the same row to every level that names either.
    expect(rotations[0].id).not.toBe(rotations[1].id);

    const anchor = Date.parse("2026-08-17T10:00") * 1000;
    expect(rotations[0].shift_rules[0].anchor_micros).toBe(anchor);
    expect(rotations[1].shift_rules[0].anchor_micros).toBe(anchor - MICROS_PER_WEEK);
  });

  it("writes only the one rotation when the box is cleared and the read-back fails", async () => {
    oncall.getSchedule.mockRejectedValue(new Error("boom"));

    const wrapper = render();
    await flushPromises();
    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai"],
      first_handover: "2026-08-17T10:00",
      create_secondary: false,
    });
    await submit(wrapper);
    await flushPromises();

    const { rotations } = (oncall.setSchedule.mock.calls[0][0] as any).data;
    expect(rotations).toHaveLength(1);
    expect(rotations[0].shift_rules[0].members).toEqual(["ana@o2.ai"]);
  });

  // Nobody picked is a legitimate way to create a team, and an empty rotation
  // would be rejected by the server anyway.
  it("skips both follow-ups when no members were picked", async () => {
    const wrapper = render();
    await flushPromises();

    setValues(wrapper, { name: "Payments" });
    await submit(wrapper);
    await flushPromises();

    expect(oncall.createTeam).toHaveBeenCalledOnce();
    expect(oncall.addMembers).not.toHaveBeenCalled();
    expect(oncall.setSchedule).not.toHaveBeenCalled();
  });

  /// The team exists by the time this can fail, so reporting it as "could not
  /// create the team" would send somebody off to create a second one.
  it("still reports success when only the rotation fails", async () => {
    oncall.setSchedule.mockRejectedValue(new Error("boom"));
    const wrapper = render();
    await flushPromises();

    setValues(wrapper, {
      name: "Payments",
      members: ["ana@o2.ai"],
      first_handover: "2026-08-17T10:00",
    });
    await submit(wrapper);
    await flushPromises();

    expect(oncall.addMembers).toHaveBeenCalledOnce();
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  // Membership and the schedule have screens of their own once a team exists;
  // a second place to edit them is a second place for them to disagree.
  it("offers none of the staffing fields when editing", async () => {
    const wrapper = render({ id: "t1", name: "Payments", timezone: "UTC" });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-team-form-members"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-team-form-handover"]').exists()).toBe(false);
    expect(users.orgUsers).not.toHaveBeenCalled();
  });

  it("fills the picker with the whole org in one click", async () => {
    const wrapper = render();
    await flushPromises();

    await wrapper.find('[data-test="oncall-team-form-add-everyone"]').trigger("click");
    await flushPromises();

    const form = wrapper.findComponent({ name: "OForm" }).vm.form;
    expect(form.state.values.members).toEqual(["ana@o2.ai", "bob@o2.ai"]);
  });
});
