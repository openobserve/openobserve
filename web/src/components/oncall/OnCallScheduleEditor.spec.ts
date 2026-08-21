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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import i18n from "@/locales";
import oncallService from "@/services/oncall";
import store from "@/test/unit/helpers/store";
import type { OnCallSchedule, OnCallTeamMember } from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({ default: { setSchedule: vi.fn() } }));

const service = vi.mocked(oncallService);

const NOW = 1_700_000_000_000; // ms
const ANCHOR = NOW * 1000;

/// Rotation fields live in a drawer now; open it before asserting on them.
/**
 * A rotation holding one ordinary rule — what almost every team has.
 *
 * The rules used to BE the rotations, which is the confusion the rework
 * removed: two rotations are two people on call, two rules are one person
 * across different hours.
 */
function rota(name: string, rules: any[] = [], over: Record<string, unknown> = {}) {
  return {
    id: `rot_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    shift_rules: rules.length ? rules : [rule({ name })],
    ...over,
  };
}

function rule(over: Record<string, unknown> = {}) {
  return {
    name: "Base",
    members: ["ana@o2.ai"],
    shift_micros: MICROS_PER_WEEK,
    anchor_micros: ANCHOR,
    ...over,
  };
}

async function openRotation(wrapper: any, index = 0) {
  const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
  wrapper.findComponent({ name: "OTable" }).vm.$emit("row-click", rows[index]);
  await flushPromises();
}

const stubs = {
  ODrawer: {
    name: "ODrawer",
    props: ["open", "title"],
    template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  },
  // Renders the real cell slots, so the tests exercise what the page draws.
  OTable: {
    name: "OTable",
    props: ["data", "columns"],
    template: `<div>
      <slot name='toolbar' />
      <div v-for="(row, i) in (data || [])" :key="i" data-test="row">
        <slot v-for="c in (columns || [])" :key="c.id" :name="'cell-' + c.id" :row="row" />
      </div>
      <slot name='empty' />
    </div>`,
  },
  OEmptyState: { name: "OEmptyState", props: ["description"], template: "<div />" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  // Always renders its slot: the fold is a display choice, and these tests are
  // about what the rule stores, not about whether the section is open.
  OCollapsible: { name: "OCollapsible", template: "<div><slot /></div>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    template: `<button :disabled="disabled"><slot /></button>`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "multiple"],
    template: `<select @change="$emit('update:modelValue', multiple ? pick($event) : $event.target.value)">
      <option v-for="o in options" :key="String(o.value)" :value="o.value">{{ o.label }}</option>
    </select>`,
    methods: {
      pick(e: any) {
        return Array.from(e.target.selectedOptions).map((o: any) => o.value);
      },
    },
  },
};

function members(...emails: string[]): OnCallTeamMember[] {
  return emails.map((e) => ({ id: e, team_id: "team_1", user_email: e }));
}

function schedule(rotations: OnCallSchedule["rotations"]): OnCallSchedule {
  return {
    id: "sch_1",
    org_id: "default",
    team_id: "team_1",
    timezone: "UTC",
    rotations,
    created_at: 0,
    updated_at: 0,
  };
}

function render(opts: {
  members?: OnCallTeamMember[];
  schedule?: OnCallSchedule | null;
} = {}) {
  return mount(OnCallScheduleEditor, {
    props: {
      teamId: "team_1",
      timezone: "UTC",
      schedule: opts.schedule ?? null,
      members: opts.members ?? members("ana@o2.ai", "bob@o2.ai"),
    },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallScheduleEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service.setSchedule.mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A rotation can only contain people who are on the team, so sending the
  // user to an editor with nothing to pick would be a dead end.
  it("points at the Members tab when the team has nobody", () => {
    const wrapper = render({ members: [] });
    expect(wrapper.find('[data-test="oncall-schedule-no-members"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-schedule-add-rotation"]').exists()).toBe(false);
  });

  // The preview is the point of the tab: you cannot judge a rotation you
  // cannot see.
  it("previews the upcoming shifts of a rotation", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai"] })])]),
    });
    await flushPromises();
    await openRotation(wrapper);

    const shifts = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]');
    expect(shifts.length).toBeGreaterThan(1);
    expect(shifts[0].text()).toContain("ana@o2.ai");
    expect(shifts[1].text()).toContain("bob@o2.ai");
  });

  // Whoever holds the current shift is the answer to "who do I call now", so
  // exactly one row carries the marker.
  it("marks exactly one shift as current", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai"] })])]),
    });
    await flushPromises();
    await openRotation(wrapper);

    const marked = wrapper
      .findAll('[data-test="oncall-schedule-preview-shift"]')
      .filter((s) => s.text().includes("Now"));
    expect(marked).toHaveLength(1);
    expect(marked[0].text()).toContain("ana@o2.ai");
  });

  // The anchor used to be silently "now", so a rotation created at 14:32
  // handed over at 14:32 forever. It is an explicit field now.
  it("exposes the first handover and keeps the previous value on junk input", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary")]),
    });
    await flushPromises();
    await openRotation(wrapper);

    const field = wrapper.find('[data-test="oncall-schedule-handover-0"]');
    expect(field.exists()).toBe(true);

    const before = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]')[0].text();
    await field.setValue("not-a-date");
    await flushPromises();
    const after = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]')[0].text();
    expect(after).toBe(before);
  });

  /// Dropping the empty one and reporting success is how a rotation somebody
  /// had just emptied looked saved: the server refuses it, so the whole save
  /// has to stop and say which rotation is the problem.
  it("refuses a save that would silently drop an empty rotation", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Primary"),
        rota("Backup", [rule({ members: ["bob@o2.ai"] })]),
      ]),
    });
    await flushPromises();

    // Empty the second rotation the way a user would, through its editor.
    await openRotation(wrapper, 1);
    await wrapper
      .findComponent('[data-test="oncall-schedule-members-0"]')
      .vm.$emit("update:modelValue", []);
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-save"]').trigger("click");
    await flushPromises();

    expect(service.setSchedule).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="oncall-rotation-needs-people-0"]').exists()).toBe(true);
  });

  /// The drawer's Save is the one a new rotation is saved from, and a new
  /// rotation starts with nobody in it — so it has to be out of reach until
  /// somebody is picked, not merely refused after the click.
  it("keeps the drawer save out of reach until somebody is picked", async () => {
    const wrapper = render({ schedule: null });
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
    ).toBeDefined();

    await wrapper
      .findComponent('[data-test="oncall-schedule-members-0"]')
      .vm.$emit("update:modelValue", ["ana@o2.ai"]);
    await flushPromises();

    expect(
      wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
    ).toBeUndefined();
  });

  /// Nothing in this drawer can add a person, so the empty picker has to hand
  /// the reader to the one screen that can.
  it("sends the reader to the roster from inside the drawer", async () => {
    const wrapper = render({ members: [], schedule: null });
    await flushPromises();

    // The bulk table is hidden on a team with nobody, so open the drawer the
    // way the team page does — through an intent.
    await wrapper.setProps({ intent: { mode: "new" } });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-rotation-no-members"]').exists()).toBe(true);
    await wrapper.find('[data-test="oncall-rotation-open-members"]').trigger("click");

    expect(wrapper.emitted("open-members")).toHaveLength(1);
  });

  /// Rotations are named shifts, not slots in a fixed ladder, so there is no
  /// list of remaining levels to pick from and no cap on how many you can add.
  /// A second rotation is for follow-the-sun, not for a "secondary".
  it("adds a named rotation without asking for a level", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary")]),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-schedule-new-level"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(2);
  });

  /// The blocker this pins moved down a level with the data: two RULES of one
  /// rotation both defaulting to priority 0 with no restrictions is what the
  /// server calls "equally in force" and rejects — failing the WHOLE save and
  /// taking the rule that already worked down with the new one.
  it("gives a second shift rule a distinct priority", async () => {
    const wrapper = render({ schedule: schedule([rota("On-call rotation")]) });
    await flushPromises();
    await openRotation(wrapper);

    await wrapper.find('[data-test="oncall-schedule-rule-add"]').trigger("click");
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    const rules = rows[0].shift_rules;
    expect(rules).toHaveLength(2);
    expect(rules[1].priority).not.toBe(rules[0].priority ?? 0);
  });

  /// Two rotations are two positions resolving independently, so an identical
  /// priority across them is not a clash and never was one to the engine.
  /// A second rotation is a second person on call, not a competing layer.
  it("does not renumber priorities when a second rotation is added", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(rows).toHaveLength(2);
    expect(rows[1].shift_rules[0].priority).toBe(0);
    // The position is named on the rotation; the rule underneath is "Base".
    expect(rows[1].shift_rules[0].name).toBe("Base");
    expect(rows[1].name).not.toBe("Base");
  });

  /// The drawer used to survive its own save; the parent then rebuilt `draft`,
  /// detaching the object the drawer was still editing.
  it("closes the editor after saving", async () => {
    service.setSchedule.mockResolvedValue({ data: {} } as any);
    const wrapper = render({
      schedule: schedule([rota("On-call rotation")]),
    });
    await flushPromises();
    await openRotation(wrapper);
    expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(true);

    await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
    await flushPromises();

    expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(false);
  });

  /// `addRotation` pushes the row into the draft before anybody has filled it
  /// in, and the ✕, Esc and the backdrop close through `v-model:open` without
  /// passing Cancel. The abandoned row stayed in the draft and then failed the
  /// NEXT save — naming a rotation that was no longer on screen, and blocking
  /// a rotation somebody had just filled in correctly.
  it("does not let a rotation abandoned through the drawer's ✕ block the next save", async () => {
    const wrapper = render({ schedule: null });
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();
    wrapper.findComponent({ name: "ODrawer" }).vm.$emit("update:open", false);
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(0);

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();
    await wrapper
      .findComponent('[data-test="oncall-schedule-members-0"]')
      .vm.$emit("update:modelValue", ["ana@o2.ai"]);
    await flushPromises();

    await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
    await flushPromises();

    expect(service.setSchedule).toHaveBeenCalledTimes(1);
    expect((service.setSchedule.mock.calls[0][0] as any).data.rotations).toHaveLength(1);
  });

  /// Closing is not undo. A rotation that already exists is edited in the
  /// draft the bulk Save writes, so dismissing the drawer keeps the change —
  /// only the row nobody has finished adding is discarded.
  it("keeps edits to an existing rotation when the drawer is dismissed", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await flushPromises();
    await openRotation(wrapper);

    await wrapper
      .findComponent('[data-test="oncall-schedule-members-0"]')
      .vm.$emit("update:modelValue", ["ana@o2.ai", "bob@o2.ai"]);
    await flushPromises();

    wrapper.findComponent({ name: "ODrawer" }).vm.$emit("update:open", false);
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_rules[0].members).toEqual(["ana@o2.ai", "bob@o2.ai"]);
  });

  /// A layer's *when* was the half the editor could not express: a
  /// follow-the-sun setup was preset-or-API only, and a rotation the API had
  /// restricted rendered here as though it applied always.
  describe("when a shift rule applies", () => {
    const layer = (over: Record<string, unknown> = {}) => rule({ priority: 0, ...over });

    it("round-trips a restriction the API wrote", async () => {
      const wrapper = render({
        schedule: schedule([
          rota("Primary", [
            layer({ restrictions: [{ days: [0, 1, 2], start_minute: 540, end_minute: 1020 }] }),
          ]),
        ]),
      });
      await openRotation(wrapper);

      expect(wrapper.find('[data-test="oncall-schedule-restriction-0-0"]').exists()).toBe(true);
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.shift_rules[0].restrictions).toEqual([
        { days: [0, 1, 2], start_minute: 540, end_minute: 1020 },
      ]);
    });

    /// A window with no days applies on no day, which is a rotation resolving
    /// to nobody — so a new one starts as the working week.
    it("adds a window that already means something", async () => {
      const wrapper = render({ schedule: schedule([rota("Primary", [layer()])]) });
      await openRotation(wrapper);

      await wrapper.find('[data-test="oncall-schedule-restriction-add-0"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.shift_rules[0].restrictions).toEqual([
        { days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 },
      ]);
    });

    it("removes a window", async () => {
      const wrapper = render({
        schedule: schedule([
          rota("Primary", [layer({ restrictions: [{ days: [0], start_minute: 0, end_minute: 60 }] })]),
        ]),
      });
      await openRotation(wrapper);

      await wrapper.find('[data-test="oncall-schedule-restriction-remove-0-0"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      expect(
        (service.setSchedule.mock.calls[0][0] as any).data.rotations[0].shift_rules[0].restrictions,
      ).toEqual([]);
    });

    /// Two rules of ONE rotation equally in force are refused as a WHOLE — the
    /// rotation that works today goes down with the edit — so Save has to be
    /// unreachable rather than the reader learning it from a 400.
    it("blocks a save that would collide with a sibling rule's priority", async () => {
      const wrapper = render({
        schedule: schedule([
          rota("Primary", [layer(), layer({ name: "Weekend", priority: 1 })]),
        ]),
      });
      await openRotation(wrapper);

      wrapper
        .findComponent('[data-test="oncall-schedule-priority-1"]')
        .vm.$emit("update:modelValue", 0);
      await flushPromises();

      expect(wrapper.find('[data-test="oncall-schedule-priority-clash-1"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
      ).toBeDefined();
    });

    /// **Rotations do not compete.** Both resolve at the same instant with
    /// their own people, so an identical priority across two of them is not a
    /// clash — and reading it as one is exactly the conflation the rework
    /// removed.
    it("allows the same priority in a different rotation", async () => {
      const wrapper = render({
        schedule: schedule([
          rota("Primary", [layer()]),
          rota("Backup", [layer({ members: ["bob@o2.ai"] })]),
        ]),
      });
      await openRotation(wrapper, 1);

      expect(wrapper.find('[data-test="oncall-schedule-priority-clash-0"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
      ).toBeUndefined();
    });
  });
});

/// **Retiring a shift rule instead of deleting it.** `ends_at` is how a rule is
/// taken out of service without losing the record of who covered those hours.
/// Deleting was the only way to stop one, so "the weekend rule ran until March"
/// stopped being something the schedule could say the moment somebody tidied
/// up.
describe("OnCallScheduleEditor — retiring a shift rule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service.setSchedule.mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const WEEKEND = rota("Weekend");

  const savedRotations = () => (service.setSchedule.mock.calls.at(-1)![0] as any).data.rotations;

  async function save(wrapper: any) {
    await wrapper.find('[data-test="oncall-schedule-save"]').trigger("click");
    await flushPromises();
  }

  it("writes ends_at when a rule is retired", async () => {
    const wrapper = render({ schedule: schedule([WEEKEND]) });
    await openRotation(wrapper);

    wrapper
      .findComponent('[data-test="oncall-schedule-retire-0"]')
      .vm.$emit("update:modelValue", true);
    await flushPromises();

    await save(wrapper);
    // Defaults to now: "retire this" almost always means "as of today", and a
    // date somebody must fill in first makes the common case two steps.
    expect(savedRotations()[0].shift_rules[0].ends_at).toBe(NOW * 1000);
  });

  it("clears ends_at when the rule is put back into service", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Weekend", [rule({ ends_at: ANCHOR + MICROS_PER_WEEK })]),
      ]),
    });
    await openRotation(wrapper);

    wrapper
      .findComponent('[data-test="oncall-schedule-retire-0"]')
      .vm.$emit("update:modelValue", false);
    await flushPromises();

    await save(wrapper);
    expect(savedRotations()[0].shift_rules[0].ends_at).toBeUndefined();
  });

  /// The date is read and written in the TEAM's zone, which is what the field
  /// says on its label and what every restriction window is evaluated in.
  it("reads the retirement date as the team's wall clock", async () => {
    const wrapper = mount(OnCallScheduleEditor, {
      props: {
        teamId: "team_1",
        timezone: "Asia/Kolkata",
        schedule: schedule([
          rota("Weekend", [rule({ ends_at: Date.UTC(2026, 7, 17, 4, 30) * 1000 })]),
        ]),
        members: members("ana@o2.ai"),
      },
      global: { plugins: [i18n, store], stubs },
    });
    await openRotation(wrapper);

    const field = wrapper.findComponent('[data-test="oncall-schedule-retire-at-0"]');
    expect(field.props("modelValue")).toBe("2026-08-17T10:00");

    field.vm.$emit("update:modelValue", "2026-08-18T10:00");
    await flushPromises();
    await save(wrapper);

    expect(savedRotations()[0].shift_rules[0].ends_at).toBe(Date.UTC(2026, 7, 18, 4, 30) * 1000);
  });

  /// A retired rule stays in the rotation — it still resolves for the past — so
  /// it has to say it is not staffing anything now. Without that, the name it
  /// shows sends somebody looking for a person who is not on call.
  ///
  /// It is marked beside the RULE, not on the rotation row: a rotation is not
  /// retired, one of its rules is, and the others may still be staffing it.
  it("marks a retired rule rather than hiding it", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Weekend", [rule({ name: "Current" }), rule({ name: "Old", ends_at: ANCHOR })]),
      ]),
    });
    await flushPromises();
    await openRotation(wrapper);

    expect(wrapper.find('[data-test="oncall-schedule-retire-at-0"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-schedule-retire-at-1"]').exists()).toBe(true);
  });

  /// A rotation the system staffed is not something somebody designed, and
  /// reading it as a considered choice is how a default goes unreviewed until
  /// it pages the wrong person.
  it("marks a rotation the system staffed", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary", [], { source: "default" }), rota("Extra")]),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-schedule-default-rot_primary"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-schedule-default-rot_extra"]').exists()).toBe(false);
  });
});
