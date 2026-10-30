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
import type {
  OnCallSchedule,
  OnCallTeamMember,
  ScheduleEditorIntent,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

vi.mock("@/services/oncall", () => ({
  default: { setSchedule: vi.fn(), listUnavailability: vi.fn(), previewResolvedSchedule: vi.fn() },
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
// Names for the drawer's labels; an empty roster leaves every label as the email.
vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn(() => Promise.resolve({ data: { data: [] } })) },
}));
import analytics from "@/services/product_analytics";

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

/// The People list opens with Edit; a rule nobody is in already shows it.
async function addPerson(wrapper: any, ruleIndex: number, email: string) {
  const edit = wrapper.find(`[data-test="oncall-rule-people-edit-${ruleIndex}"]`);
  if (edit.exists()) await edit.trigger("click");
  await wrapper
    .findComponent(`[data-test="oncall-rule-people-add-${ruleIndex}"]`)
    .vm.$emit("update:modelValue", email);
  await flushPromises();
}

async function removePerson(wrapper: any, ruleIndex: number, position: number) {
  const edit = wrapper.find(`[data-test="oncall-rule-people-edit-${ruleIndex}"]`);
  if (edit.exists()) await edit.trigger("click");
  await wrapper
    .find(`[data-test="oncall-rule-person-remove-${ruleIndex}-${position}"]`)
    .trigger("click");
  await flushPromises();
}

/// The editor has two confirms, told apart by their data-test.
function confirmFor(wrapper: any, dataTest: string) {
  const found = wrapper
    .findAllComponents({ name: "ConfirmDialog" })
    .find(
      (c: any) => c.attributes("data-test") === dataTest || c.vm.$attrs["data-test"] === dataTest,
    );
  if (!found) throw new Error(`no ConfirmDialog ${dataTest}`);
  return found;
}

const drawerRules = (wrapper: any) =>
  (wrapper.findComponent({ name: "OTable" }).props("data") as any[])[0].shift_rules;

async function showList(wrapper: any) {
  await wrapper.find('[data-test="oncall-draft-preview-list"]').trigger("click");
  await flushPromises();
}

const stubs = {
  ODrawer: {
    name: "ODrawer",
    props: ["open", "title", "persistent"],
    template: "<div v-if='open'><slot name='header-right' /><slot /><slot name='footer' /></div>",
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
  ConfirmDialog: {
    name: "ConfirmDialog",
    props: ["modelValue", "title", "message", "messageKeypath", "messageName", "okVariant"],
    emits: ["update:ok", "update:cancel", "update:modelValue"],
    template: "<div v-if='modelValue'>{{ title }} {{ message }}</div>",
  },
  OnCallRemoveRotationDialog: {
    name: "OnCallRemoveRotationDialog",
    props: ["open", "rotationId", "rotations", "holders", "policy"],
    emits: ["confirm", "update:open", "open-policy"],
    template: "<div v-if='open' />",
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
  ODate: {
    name: "ODate",
    props: ["modelValue"],
    template: `<div :data-test="$attrs['data-test']"><input type="date" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></div>`,
  },
  OTime: {
    name: "OTime",
    props: ["modelValue"],
    template: `<div :data-test="$attrs['data-test']"><input type="time" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></div>`,
  },
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div :data-selected='modelValue'><slot /></div>",
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: `<button @click="$parent.$emit('update:modelValue', value)"><slot /></button>`,
  },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["disabled"],
    emits: ["select"],
    template: `<button :disabled="disabled" @click="$emit('select')"><slot /></button>`,
  },
  ODropdownSeparator: { name: "ODropdownSeparator", template: "<hr />" },
  OPopover: {
    name: "OPopover",
    props: ["open"],
    template: "<div><slot name='trigger' /><div v-if='open'><slot /></div></div>",
  },
  ORadioGroup: { name: "ORadioGroup", props: ["modelValue"], template: "<div><slot /></div>" },
  ORadio: {
    name: "ORadio",
    props: ["value"],
    template: `<button @click="$parent.$emit('update:modelValue', value)"><slot name="label" /></button>`,
  },
  VueDraggableNext: {
    name: "VueDraggableNext",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
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

function render(
  opts: {
    members?: OnCallTeamMember[];
    schedule?: OnCallSchedule | null;
    timezone?: string;
    drawerOnly?: boolean;
    intent?: ScheduleEditorIntent | null;
  } = {},
) {
  return mount(OnCallScheduleEditor, {
    props: {
      teamId: "team_1",
      timezone: opts.timezone ?? "UTC",
      schedule: opts.schedule ?? null,
      members: opts.members ?? members("ana@o2.ai", "bob@o2.ai"),
      drawerOnly: opts.drawerOnly,
      intent: opts.intent ?? null,
    },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallScheduleEditor", () => {
  beforeEach(() => {
    // A draft one test leaves behind would open the restore dialog on the next open.
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service.setSchedule.mockResolvedValue({ data: {} } as any);
    service.listUnavailability.mockResolvedValue({ data: [] } as any);
    service.previewResolvedSchedule.mockResolvedValue({ data: [] } as any);
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

  // A3: the drawer asks the server, over 14 days from the TEAM's midnight, for the draft as it stands.
  it("asks the server to resolve the open draft from the team's midnight", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary")]),
      timezone: "Asia/Kolkata",
    });
    await flushPromises();
    expect(service.previewResolvedSchedule).not.toHaveBeenCalled();

    await openRotation(wrapper);

    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(1);
    const [args] = service.previewResolvedSchedule.mock.calls[0];
    // NOW is 03:43 on 15 Nov in Kolkata, so its day began at 18:30 UTC the day before.
    expect(args.from).toBe(Date.UTC(2023, 10, 14, 18, 30) * 1000);
    expect(args.to).toBe(Date.UTC(2023, 10, 28, 18, 30) * 1000);
    expect(args.team_id).toBe("team_1");
    expect(args.rotation.id).toBe("rot_primary");
  });

  // A3: one request once typing stops, not one per keystroke.
  it("sends one request for a burst of edits, after they settle", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    const name = wrapper.find('[data-test="oncall-schedule-name"]');
    for (const typed of ["P", "Pa", "Pag"]) {
      await name.setValue(typed);
      vi.advanceTimersByTime(100);
    }
    await flushPromises();
    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(400);
    await flushPromises();
    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(2);
    expect(service.previewResolvedSchedule.mock.calls[1][0].rotation.name).toBe("Pag");
  });

  // A3: rows are the server's segments; edges where the fetch stopped read as open.
  it("lists the server's segments, current one marked, cut edges open", async () => {
    const from = Date.UTC(2023, 10, 14) * 1000;
    const to = Date.UTC(2023, 10, 28) * 1000;
    const hour = 3_600_000_000;
    const at = (micros: number) => ({ rotation_id: "rot_primary", rotation: "Base", from: micros });
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        { ...at(from), to: ANCHOR - hour, user_email: "carol@o2.ai" },
        { ...at(ANCHOR - hour), to: ANCHOR + hour, user_email: "ana@o2.ai" },
        { ...at(ANCHOR + hour), to: ANCHOR + 5 * hour, rotation: undefined },
        { ...at(ANCHOR + 5 * hour), to, user_email: "bob@o2.ai" },
      ],
    } as any);
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    await showList(wrapper);

    const rows = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]');
    expect(rows.map((r) => r.attributes("data-user"))).toEqual(["ana@o2.ai", "", "bob@o2.ai"]);
    expect(rows[0].text()).toContain("Now");
    expect(rows[0].text()).toContain("—");
    expect(rows[1].text()).toContain("Nobody is on call");
    expect(rows[2].text()).toContain("From");
    expect(rows.filter((r) => r.text().includes("Now"))).toHaveLength(1);
  });

  // B1: the rules come first; the picture of their result follows them.
  it("puts the shift rules above the who's-on-call picture", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    const html = wrapper.html();
    expect(html.indexOf('data-test="oncall-schedule-rule-add"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-test="oncall-schedule-rule-add"')).toBeLessThan(
      html.indexOf('data-test="oncall-draft-preview"'),
    );
  });

  // B1: paging moves a week with one request; switching Picture/List asks nothing.
  it("pages the preview with one request and toggles views with none", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(1);

    await showList(wrapper);
    await wrapper.find('[data-test="oncall-draft-preview-picture"]').trigger("click");
    await flushPromises();
    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(1);

    await wrapper.find('[data-test="oncall-draft-preview-next"]').trigger("click");
    await flushPromises();
    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(2);
    const [first, second] = service.previewResolvedSchedule.mock.calls.map(([args]) => args);
    expect(second.from).toBe(first.from + 7 * 86_400_000_000);
    expect(second.to - second.from).toBe(first.to - first.from);
  });

  // B1: one row per team day for a week; the open tab's rule is solid, other rules soft, gaps a gap.
  it("draws the picture one day per row with the open rule in full colour", async () => {
    const day = 86_400_000_000;
    const from = Date.UTC(2023, 10, 14) * 1000;
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_primary",
          rotation: "Base",
          from,
          to: from + day / 2,
          user_email: "ana@o2.ai",
        },
        {
          rotation_id: "rot_primary",
          rotation: "Office",
          from: from + day / 2,
          to: from + 1.5 * day,
          user_email: "bob@o2.ai",
        },
        { rotation_id: "rot_primary", from: from + 1.5 * day, to: from + 14 * day },
      ],
    } as any);
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ name: "Base" }), rule({ name: "Office", priority: 1 })]),
      ]),
    });
    await openRotation(wrapper);

    const tracks = wrapper.findComponent({ name: "OScheduleTimeline" }).props("tracks") as any[];
    expect(tracks).toHaveLength(7);
    expect(wrapper.find('[data-test="oncall-draft-preview-zone"]').text()).toContain("Mon, Nov 20");
    expect(tracks[0].bands.map((b: any) => [b.variant, b.tone])).toEqual([
      ["solid", 1],
      ["soft", 2],
    ]);
    expect(tracks[1].bands.map((b: any) => b.tone)).toEqual([2, "gap"]);
    expect(String(tracks[0].bands[0].ariaLabel)).toContain("Base");
  });

  // D5: bands sit on the wall-clock scale of the axis, so local noon is under 12:00 on a 25-hour day.
  it("places bands by local wall clock on a day the clocks go back", async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 1, 15));
    const midnight = Date.UTC(2026, 10, 1, 4) * 1000;
    const noon = Date.UTC(2026, 10, 1, 17) * 1000;
    const at = { rotation_id: "rot_primary", rotation: "Primary" };
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        { ...at, from: midnight, to: noon, user_email: "ana@o2.ai" },
        { ...at, from: noon, to: midnight + 14 * 86_400_000_000, user_email: "bob@o2.ai" },
      ],
    } as any);
    const wrapper = render({ schedule: schedule([rota("Primary")]), timezone: "America/New_York" });
    await openRotation(wrapper);

    const tracks = wrapper.findComponent({ name: "OScheduleTimeline" }).props("tracks") as any[];
    expect(tracks[0].bands.map((b: any) => [b.offset, b.width])).toEqual([
      [0, 0.5],
      [0.5, 0.5],
    ]);
  });

  // A3: a refusal is said where the rows would be, not swallowed into an empty list.
  it("shows the endpoint's refusal in the list area", async () => {
    service.previewResolvedSchedule.mockRejectedValue({
      response: { data: { message: "window too long" } },
    });
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);

    expect(wrapper.find('[data-test="oncall-schedule-preview-error"]').text()).toBe(
      "window too long",
    );
  });

  // B3: weekday and time move the first shift within its own team-local week.
  it("moves the first shift with the handover weekday and time", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);

    // ANCHOR is Tue 14 Nov 2023 22:13 UTC.
    await wrapper
      .findComponent('[data-test="oncall-schedule-handover-0-time"]')
      .vm.$emit("update:modelValue", 540);
    await flushPromises();
    expect(drawerRules(wrapper)[0].anchor_micros).toBe(Date.UTC(2023, 10, 14, 9) * 1000);

    await wrapper
      .findComponent('[data-test="oncall-schedule-handover-0-weekday"]')
      .vm.$emit("update:modelValue", 0);
    await flushPromises();
    expect(drawerRules(wrapper)[0].anchor_micros).toBe(Date.UTC(2023, 10, 13, 9) * 1000);
  });

  // E1: each option reads as a whole phrase, so no standalone "every" sits before the select.
  it("offers the handover length as whole phrases with no loose every", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    const row = wrapper.find('[data-test="oncall-schedule-handover-0"]');
    const length = wrapper.findComponent('[data-test="oncall-schedule-handover-0-length"]');
    expect((length.props("options") as any[]).map((o) => o.label)).toEqual([
      "Every 8 hours",
      "Every 12 hours",
      "Every day",
      "Every week",
      "Every 2 weeks",
    ]);
    const words = row.findAll("span").map((s) => s.text());
    expect(words).not.toContain("every");
  });

  it("asks no weekday of a daily handover", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary", [rule({ shift_micros: 86_400_000_000 })])]),
    });
    await openRotation(wrapper);
    expect(wrapper.find('[data-test="oncall-schedule-handover-0-weekday"]').exists()).toBe(false);
  });

  /// Dropping the empty one and reporting success is how a rotation somebody
  /// had just emptied looked saved: the server refuses it, so the whole save
  /// has to stop and say which rotation is the problem.
  it("refuses a save that would silently drop an empty rotation", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary"), rota("Backup", [rule({ members: ["bob@o2.ai"] })])]),
    });
    await flushPromises();

    // Empty the second rotation the way a user would, through its editor.
    await openRotation(wrapper, 1);
    await removePerson(wrapper, 0, 0);

    await wrapper.find('[data-test="oncall-schedule-save"]').trigger("click");
    await flushPromises();

    expect(service.setSchedule).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="oncall-rotation-needs-people-0"]').exists()).toBe(true);
  });

  // People edited on one rotation never reach another, even its form-made pair.
  it("removing somebody from one rotation leaves its pair alone", async () => {
    const pair = ["ana@o2.ai", "bob@o2.ai"];
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ members: [...pair] })]),
        rota("Secondary", [rule({ members: [...pair], anchor_micros: ANCHOR - MICROS_PER_WEEK })]),
      ]),
    });
    await flushPromises();

    await openRotation(wrapper, 1);
    await removePerson(wrapper, 0, 0);
    await wrapper.find('[data-test="oncall-schedule-save"]').trigger("click");
    await flushPromises();

    const sent = (service.setSchedule.mock.calls.at(-1)![0] as any).data.rotations;
    expect(sent[0].shift_rules[0].members).toEqual(pair);
    expect(sent[1].shift_rules[0].members).toHaveLength(1);
  });

  /// The drawer's Save is the one a new rotation is saved from, and a new
  /// rotation starts with nobody in it — so it has to be out of reach until
  /// somebody is picked, not merely refused after the click.
  it("keeps the drawer save out of reach until somebody is picked", async () => {
    const wrapper = render({ schedule: null });
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled")).toBeDefined();

    await addPerson(wrapper, 0, "ana@o2.ai");

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

  it("tracks oncall_schedule_saved from the editor once the schedule is saved", async () => {
    service.setSchedule.mockResolvedValue({ data: {} } as any);
    vi.mocked(analytics.track).mockClear();
    const wrapper = render({ schedule: schedule([rota("On-call rotation")]) });
    await flushPromises();
    await openRotation(wrapper);

    await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
    await flushPromises();

    expect(analytics.track).toHaveBeenCalledWith("oncall_schedule_saved", {
      source: "editor",
      rotation_count: 1,
    });
  });

  it("does not track oncall_schedule_saved when the save is refused", async () => {
    service.setSchedule.mockRejectedValue({ response: { data: { message: "no" } } });
    vi.mocked(analytics.track).mockClear();
    const wrapper = render({ schedule: schedule([rota("On-call rotation")]) });
    await flushPromises();
    await openRotation(wrapper);

    await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
    await flushPromises();

    expect(service.setSchedule).toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
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
    await addPerson(wrapper, 0, "ana@o2.ai");

    await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
    await flushPromises();

    expect(service.setSchedule).toHaveBeenCalledTimes(1);
    expect((service.setSchedule.mock.calls[0][0] as any).data.rotations).toHaveLength(1);
  });

  // R11-1: the away line uses the team's clock, like the roster chip (tests pin TZ=UTC).
  it("dates an away clash in the team's zone", async () => {
    const from = Date.UTC(2023, 10, 15, 20, 0) * 1000;
    const to = Date.UTC(2023, 10, 16, 20, 0) * 1000;
    service.listUnavailability.mockResolvedValue({
      data: [
        {
          id: "u1",
          org_id: "default",
          user_email: "ana@o2.ai",
          start_at: from,
          end_at: to,
          created_by: "ana@o2.ai",
          created_at: 0,
        },
      ],
    } as any);
    const wrapper = render({ schedule: schedule([rota("Primary")]), timezone: "Asia/Kolkata" });
    await flushPromises();
    await openRotation(wrapper);

    const day = (micros: number) =>
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(micros / 1000));
    expect(wrapper.text()).toContain(`ana@o2.ai is away ${day(from)} – ${day(to)}.`);
  });

  /// The absence horizon is anchored on the clock, so an unbucketed key would
  /// miss on every open and make a drawer somebody flicks in and out of cost a
  /// request each time.
  it("serves a reopened drawer's absences from the cache", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await flushPromises();

    await openRotation(wrapper);
    expect(service.listUnavailability).toHaveBeenCalledTimes(1);

    wrapper.findComponent({ name: "ODrawer" }).vm.$emit("update:open", false);
    await flushPromises();
    await openRotation(wrapper);

    expect(service.listUnavailability).toHaveBeenCalledTimes(1);
  });

  /// Closing is not undo. A rotation that already exists is edited in the
  /// draft the bulk Save writes, so dismissing the drawer keeps the change —
  /// only the row nobody has finished adding is discarded.
  it("keeps edits to an existing rotation when the drawer is dismissed", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await flushPromises();
    await openRotation(wrapper);

    await addPerson(wrapper, 0, "bob@o2.ai");

    wrapper.findComponent({ name: "ODrawer" }).vm.$emit("update:open", false);
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_rules[0].members).toEqual(["ana@o2.ai", "bob@o2.ai"]);
  });

  // The row's icon button is named what the drawer button says.
  it("names the row delete button Delete rotation", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await flushPromises();

    expect(
      wrapper
        .find(`[data-test="oncall-schedule-remove-${rota("Primary").id}"]`)
        .attributes("aria-label"),
    ).toBe("Delete rotation");
  });

  // A schedule a human saved is no longer the untouched default, or the server keeps re-adding what they removed.
  describe("the default-staffing marker", () => {
    const defaults = () =>
      schedule([
        rota("Primary", [], { source: "default" }),
        rota("Secondary", [], { source: "default" }),
      ]);

    it("is cleared from every rotation a drawer save writes", async () => {
      const wrapper = render({ schedule: defaults() });
      await flushPromises();
      await openRotation(wrapper);
      await addPerson(wrapper, 0, "bob@o2.ai");
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations;
      expect(sent.map((r: any) => r.source)).toEqual([undefined, undefined]);
    });

    it("is cleared from what is left when a rotation is deleted", async () => {
      const wrapper = render({ schedule: defaults() });
      await flushPromises();
      await openRotation(wrapper, 1);
      await wrapper.find('[data-test="oncall-rotation-delete"]').trigger("click");
      wrapper.findComponent({ name: "OnCallRemoveRotationDialog" }).vm.$emit("confirm");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations;
      expect(sent.map((r: any) => [r.name, r.source])).toEqual([["Primary", undefined]]);
    });
  });

  // C2: removing saves at once for everyone, so it is confirmed first.
  describe("removing a rotation", () => {
    async function askToRemove() {
      const wrapper = render({ schedule: schedule([rota("Primary"), rota("Secondary")]) });
      await flushPromises();
      await openRotation(wrapper);
      await wrapper.find('[data-test="oncall-rotation-delete"]').trigger("click");
      await flushPromises();
      return wrapper;
    }

    const removeDialog = (wrapper: any) =>
      wrapper.findComponent({ name: "OnCallRemoveRotationDialog" });

    it("asks first, naming the rotation, and writes nothing on cancel", async () => {
      const wrapper = await askToRemove();
      const confirm = removeDialog(wrapper);
      expect(confirm.props("open")).toBe(true);
      expect(confirm.props("rotationId")).toBe(rota("Primary").id);
      // The dialog names rotations and holders itself; it is handed every rotation and who holds each now.
      expect(confirm.props("rotations").map((r: any) => r.name)).toEqual(["Primary", "Secondary"]);
      expect(confirm.props("holders")).toEqual([
        { rotation_id: rota("Primary").id, name: "ana@o2.ai" },
        { rotation_id: rota("Secondary").id, name: "ana@o2.ai" },
      ]);

      confirm.vm.$emit("update:open", false);
      await flushPromises();

      expect(service.setSchedule).not.toHaveBeenCalled();
      expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(true);
    });

    // S11: the dialog's link to a hand-edited policy closes this drawer and hands over.
    it("closes the drawer and asks for the policy when the dialog sends there", async () => {
      const wrapper = await askToRemove();
      removeDialog(wrapper).vm.$emit("open-policy");
      await flushPromises();

      expect(wrapper.emitted("open-policy")).toHaveLength(1);
      expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(false);
      expect(service.setSchedule).not.toHaveBeenCalled();
    });

    it("writes the schedule without the rotation once confirmed", async () => {
      const wrapper = await askToRemove();
      expect(service.setSchedule).not.toHaveBeenCalled();

      removeDialog(wrapper).vm.$emit("confirm");
      await flushPromises();

      expect(service.setSchedule).toHaveBeenCalledTimes(1);
      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations;
      expect(sent.map((r: any) => r.name)).toEqual(["Secondary"]);
    });
  });

  // C1: a close that would throw edits away asks first; one that would not closes at once.
  describe("closing with unsaved edits", () => {
    const drawer = (wrapper: any) => wrapper.findComponent({ name: "ODrawer" });
    const discardConfirm = (wrapper: any) => confirmFor(wrapper, "oncall-rotation-discard-confirm");
    const leaveDialog = () =>
      document.body.querySelector('[data-test="editor-draft-leave-dialog"]');
    const leaveChoice = async (dataTest: "o-dialog-neutral-btn" | "o-dialog-close-btn") => {
      leaveDialog()!.querySelector<HTMLElement>(`[data-test="${dataTest}"]`)!.click();
      await flushPromises();
    };
    // The draft baseline is taken on the user's first pointer or key input, which emitted stub events skip.
    const touch = () => window.dispatchEvent(new Event("pointerdown"));

    const exits: Record<string, (wrapper: any) => Promise<void>> = {
      "Esc or backdrop (update:open)": async (wrapper) => {
        drawer(wrapper).vm.$emit("update:open", false);
      },
      "the drawer's ✕": async (wrapper) => {
        await wrapper.find('[data-test="o-drawer-close-btn"]').trigger("click");
      },
      "the footer Cancel": async (wrapper) => {
        const cancel = drawer(wrapper)
          .findAll("button")
          .find((b: any) => b.text() === "Cancel");
        await cancel.trigger("click");
      },
    };

    async function openDrawerOnly() {
      const wrapper = render({
        schedule: schedule([rota("Primary")]),
        drawerOnly: true,
        intent: { mode: "edit", id: "rot_primary" },
      });
      await flushPromises();
      return wrapper;
    }

    for (const [exit, close] of Object.entries(exits)) {
      it(`drawer-only, unedited: ${exit} closes at once`, async () => {
        const wrapper = await openDrawerOnly();
        expect(drawer(wrapper).props("persistent")).toBe(false);

        await close(wrapper);
        await flushPromises();

        expect(drawer(wrapper).props("open")).toBe(false);
        expect(discardConfirm(wrapper).props("modelValue")).toBe(false);
      });

      it(`drawer-only, edited: ${exit} asks through the leave dialog`, async () => {
        const wrapper = await openDrawerOnly();
        touch();
        await addPerson(wrapper, 0, "bob@o2.ai");

        await close(wrapper);
        await flushPromises();

        expect(drawer(wrapper).props("open")).toBe(true);
        expect(leaveDialog()).not.toBeNull();
        expect(discardConfirm(wrapper).props("modelValue")).toBe(false);
        await leaveChoice("o-dialog-neutral-btn");
      });
    }

    it("asks before dropping an edited new rotation in the bulk editor", async () => {
      const wrapper = render({ schedule: null });
      await flushPromises();
      await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
      await flushPromises();
      await addPerson(wrapper, 0, "ana@o2.ai");

      await exits["the footer Cancel"](wrapper);
      await flushPromises();

      expect(drawer(wrapper).props("open")).toBe(true);
      expect(discardConfirm(wrapper).props("modelValue")).toBe(true);
    });

    it("closes an unedited new rotation in the bulk editor at once", async () => {
      const wrapper = render({ schedule: null });
      await flushPromises();
      await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
      await flushPromises();

      await exits["the footer Cancel"](wrapper);
      await flushPromises();

      expect(drawer(wrapper).props("open")).toBe(false);
      expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(0);
    });

    it("Stay leaves the drawer open with the edits intact", async () => {
      const wrapper = await openDrawerOnly();
      touch();
      await addPerson(wrapper, 0, "bob@o2.ai");
      await exits["the footer Cancel"](wrapper);
      await flushPromises();

      await leaveChoice("o-dialog-close-btn");

      expect(leaveDialog()).toBeNull();
      expect(drawer(wrapper).props("open")).toBe(true);
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();
      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.shift_rules[0].members).toEqual(["ana@o2.ai", "bob@o2.ai"]);
    });

    // The roster link is a way out too; a team with nobody on it is when it shows.
    async function openEmptyTeamDrawer() {
      const wrapper = render({
        members: [],
        schedule: schedule([rota("Primary")]),
        drawerOnly: true,
        intent: { mode: "edit", id: "rot_primary" },
      });
      await flushPromises();
      return wrapper;
    }
    const openMembersLink = (wrapper: any) =>
      wrapper.find('[data-test="oncall-rotation-open-members"]').trigger("click");

    it("the roster link without edits closes and opens the roster at once", async () => {
      const wrapper = await openEmptyTeamDrawer();

      await openMembersLink(wrapper);
      await flushPromises();

      expect(drawer(wrapper).props("open")).toBe(false);
      expect(discardConfirm(wrapper).props("modelValue")).toBe(false);
      expect(wrapper.emitted("open-members")).toHaveLength(1);
    });

    it("the roster link with edits asks first; Stay stays, Discard opens the roster", async () => {
      const wrapper = await openEmptyTeamDrawer();
      touch();
      await wrapper.findComponent({ name: "OInput" }).vm.$emit("update:modelValue", "Renamed");
      await flushPromises();

      await openMembersLink(wrapper);
      await flushPromises();
      expect(drawer(wrapper).props("open")).toBe(true);
      expect(leaveDialog()).not.toBeNull();
      expect(wrapper.emitted("open-members")).toBeUndefined();

      await leaveChoice("o-dialog-close-btn");
      expect(drawer(wrapper).props("open")).toBe(true);
      expect(wrapper.findComponent({ name: "OInput" }).props("modelValue")).toBe("Renamed");
      expect(wrapper.emitted("open-members")).toBeUndefined();

      await openMembersLink(wrapper);
      await flushPromises();
      await leaveChoice("o-dialog-neutral-btn");
      expect(drawer(wrapper).props("open")).toBe(false);
      expect(wrapper.emitted("open-members")).toHaveLength(1);
    });

    it("a Discard reached through Cancel does not open the roster", async () => {
      const wrapper = await openEmptyTeamDrawer();
      touch();
      await wrapper.findComponent({ name: "OInput" }).vm.$emit("update:modelValue", "Renamed");
      await flushPromises();

      await openMembersLink(wrapper);
      await flushPromises();
      await leaveChoice("o-dialog-close-btn");

      await exits["the footer Cancel"](wrapper);
      await flushPromises();
      await leaveChoice("o-dialog-neutral-btn");
      expect(drawer(wrapper).props("open")).toBe(false);
      expect(wrapper.emitted("open-members")).toBeUndefined();
    });

    it("Discard closes and puts the rotation back as stored", async () => {
      const wrapper = await openDrawerOnly();
      touch();
      await addPerson(wrapper, 0, "bob@o2.ai");
      await exits["the footer Cancel"](wrapper);
      await flushPromises();

      await leaveChoice("o-dialog-neutral-btn");
      expect(drawer(wrapper).props("open")).toBe(false);

      await wrapper.setProps({ intent: { mode: "edit", id: "rot_primary" } });
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();
      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.shift_rules[0].members).toEqual(["ana@o2.ai"]);
    });

    it("F2: Discard puts back an edited window and never touches the stored schedule", async () => {
      const stored = schedule([
        rota("Primary", [
          rule({ restrictions: [{ days: [5], start_minute: 540, end_minute: 1020 }] }),
        ]),
      ]);
      const before = JSON.parse(JSON.stringify(stored));
      const wrapper = render({
        schedule: stored,
        drawerOnly: true,
        intent: { mode: "edit", id: "rot_primary" },
      });
      await flushPromises();
      touch();
      const [, from] = wrapper
        .find('[data-test="oncall-schedule-restriction-0-0"]')
        .findAllComponents({ name: "OSelect" });
      from.vm.$emit("update:modelValue", 600);
      await flushPromises();
      expect(stored).toEqual(before);

      await exits["the footer Cancel"](wrapper);
      await flushPromises();
      await leaveChoice("o-dialog-neutral-btn");
      await wrapper.setProps({ intent: { mode: "edit", id: "rot_primary" } });
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.shift_rules[0].restrictions).toEqual([
        { days: [5], start_minute: 540, end_minute: 1020 },
      ]);
      expect(stored).toEqual(before);
    });

    it("F2: editing a duplicate's window leaves the original's window alone", async () => {
      const window = { days: [5], start_minute: 540, end_minute: 1020 };
      const wrapper = render({
        schedule: schedule([rota("Primary", [rule({ restrictions: [window] })])]),
      });
      await flushPromises();
      await wrapper.setProps({ intent: { mode: "duplicate", id: "rot_primary" } });
      await flushPromises();
      const [, from] = wrapper
        .find('[data-test="oncall-schedule-restriction-0-0"]')
        .findAllComponents({ name: "OSelect" });
      from.vm.$emit("update:modelValue", 600);
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations;
      expect(sent.map((r: any) => r.shift_rules[0].restrictions[0].start_minute)).toEqual([
        540, 600,
      ]);
    });
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

    // B3: each Covers pick writes exactly its windows; Custom starts from the working week.
    it.each([
      ["all", []],
      ["businessHours", [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }]],
      ["weekdays", [{ days: [0, 1, 2, 3, 4], start_minute: 0, end_minute: 1440 }]],
      ["weekends", [{ days: [5, 6], start_minute: 0, end_minute: 1440 }]],
      ["custom", [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }]],
    ])("writes %s", async (pick, windows) => {
      const wrapper = render({ schedule: schedule([rota("Primary", [layer()])]) });
      await openRotation(wrapper);

      await wrapper
        .findComponent('[data-test="oncall-schedule-covers-0"]')
        .vm.$emit("update:modelValue", pick);
      await flushPromises();
      expect(drawerRules(wrapper)[0].restrictions).toEqual(windows);
      expect(wrapper.find('[data-test="oncall-schedule-restriction-0-0"]').exists()).toBe(
        pick === "custom",
      );
    });

    it.each([
      [[], "all"],
      [[{ days: [5, 6], start_minute: 0, end_minute: 1440 }], "weekends"],
      [[{ days: [5], start_minute: 600, end_minute: 840 }], "custom"],
    ])("shows %j as %s", async (restrictions, pick) => {
      const wrapper = render({
        schedule: schedule([rota("Primary", [layer({ restrictions })])]),
      });
      await openRotation(wrapper);
      expect(
        wrapper.findComponent('[data-test="oncall-schedule-covers-0"]').props("modelValue"),
      ).toBe(pick);
    });

    it("removes a window", async () => {
      const wrapper = render({
        schedule: schedule([
          rota("Primary", [
            layer({ restrictions: [{ days: [0], start_minute: 0, end_minute: 60 }] }),
          ]),
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

    /// Two rules of ONE rotation with the same priority and the same hours are
    /// refused as a WHOLE, so Save has to be unreachable rather than a 400.
    it("blocks a save when two rules have the same priority and hours", async () => {
      const wrapper = render({
        schedule: schedule([rota("Primary", [layer(), layer({ name: "Weekend" })])]),
      });
      await openRotation(wrapper);

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
    service.listUnavailability.mockResolvedValue({ data: [] } as any);
    service.previewResolvedSchedule.mockResolvedValue({ data: [] } as any);
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

  const hour = 3_600_000_000;
  const turns = () =>
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_weekend",
          rotation: "Weekend",
          from: ANCHOR - hour,
          to: ANCHOR + hour,
          user_email: "ana@o2.ai",
        },
        {
          rotation_id: "rot_weekend",
          rotation: "Weekend",
          from: ANCHOR + hour,
          to: ANCHOR + 2 * hour,
          user_email: "bob@o2.ai",
        },
      ],
    } as any);

  // The chosen item's popover opens as the menu closes, in place of focus returning to the trigger.
  async function openStop(wrapper: any, index = 0) {
    const item = `[data-test="oncall-schedule-rule-stop-${index}"]`;
    await wrapper.find(item).trigger("click");
    const menu = wrapper
      .findAllComponents({ name: "ODropdown" })
      .find((d: any) => d.find(item).exists());
    menu.vm.$emit("close-auto-focus", new Event("focus"));
    await flushPromises();
  }

  async function pickStop(wrapper: any, index: number, date: string) {
    await wrapper.find(`[data-test="oncall-schedule-rule-stop-pick-${index}"]`).trigger("click");
    await flushPromises();
    await wrapper
      .find(`[data-test="oncall-schedule-rule-stop-date-${index}"] input`)
      .setValue(date);
    await wrapper
      .find(`[data-test="oncall-schedule-rule-stop-time-${index}"] input`)
      .setValue("09:00");
    await flushPromises();
  }

  // B4: nothing is chosen for the reader, and the confirm waits for a choice.
  it("stops a rule only once a stop is chosen", async () => {
    turns();
    const wrapper = render({ schedule: schedule([WEEKEND]) });
    await openRotation(wrapper);
    await openStop(wrapper);

    const confirm = () => wrapper.find('[data-test="oncall-schedule-rule-stop-confirm-0"]');
    expect(confirm().attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="oncall-schedule-rule-stop-choice-0-0"]').text()).toContain(
      "ana@o2.ai",
    );

    await wrapper.find('[data-test="oncall-schedule-rule-stop-choice-0-1"]').trigger("click");
    await flushPromises();
    expect(confirm().attributes("disabled")).toBeUndefined();
    await confirm().trigger("click");
    await flushPromises();

    expect(drawerRules(wrapper)[0].ends_at).toBe(ANCHOR + 2 * hour);
    expect(wrapper.find('[data-test="oncall-schedule-rule-summary-0"]').text()).toContain("stops");
    expect(wrapper.find('[data-test="oncall-schedule-rule-tab-icon-0"]').exists()).toBe(true);
    await save(wrapper);
    expect(savedRotations()[0].shift_rules[0].ends_at).toBe(ANCHOR + 2 * hour);
  });

  it("reads a picked date as the team's wall clock", async () => {
    const wrapper = mount(OnCallScheduleEditor, {
      props: {
        teamId: "team_1",
        timezone: "Asia/Kolkata",
        schedule: schedule([WEEKEND]),
        members: members("ana@o2.ai"),
      },
      global: { plugins: [i18n, store], stubs },
    });
    await openRotation(wrapper);
    await openStop(wrapper);

    await wrapper.find('[data-test="oncall-schedule-rule-stop-pick-0"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-test="oncall-schedule-rule-stop-date-0"] input')
      .setValue("2026-08-17");
    await wrapper.find('[data-test="oncall-schedule-rule-stop-time-0"] input').setValue("10:00");
    await wrapper.find('[data-test="oncall-schedule-rule-stop-confirm-0"]').trigger("click");
    await flushPromises();

    expect(drawerRules(wrapper)[0].ends_at).toBe(Date.UTC(2026, 7, 17, 4, 30) * 1000);
  });

  // F5: a picked instant at or before now is no choice at all.
  it("refuses a picked stop in the past", async () => {
    const wrapper = render({ schedule: schedule([WEEKEND]) });
    await openRotation(wrapper);
    await openStop(wrapper);

    await wrapper.find('[data-test="oncall-schedule-rule-stop-pick-0"]').trigger("click");
    await flushPromises();
    await wrapper
      .find('[data-test="oncall-schedule-rule-stop-date-0"] input')
      .setValue("2023-11-14");
    await wrapper.find('[data-test="oncall-schedule-rule-stop-time-0"] input').setValue("09:00");
    await flushPromises();

    expect(
      wrapper.find('[data-test="oncall-schedule-rule-stop-confirm-0"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find('[data-test="oncall-schedule-rule-stop-past-0"]').exists()).toBe(true);
  });

  // B4: the consequence names who takes the hours, or warns of the gap.
  it("says what stopping leaves behind", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Weekend", [
          rule({ name: "Base" }),
          rule({
            name: "Office",
            priority: 1,
            restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }],
          }),
        ]),
      ]),
    });
    await openRotation(wrapper);
    await openStop(wrapper, 0);
    await openStop(wrapper, 1);
    await pickStop(wrapper, 0, "2023-11-21");
    await pickStop(wrapper, 1, "2023-11-21");

    expect(wrapper.find('[data-test="oncall-schedule-rule-stop-consequence-1"]').text()).toContain(
      "Base",
    );
    expect(wrapper.find('[data-test="oncall-schedule-rule-stop-consequence-0"]').text()).toContain(
      "Leaves a gap",
    );
  });

  // D1: takers are judged at the chosen stop, and with nothing chosen there is nothing to judge.
  it("judges who takes the hours at the chosen stop, and says nothing before a choice", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Weekend", [
          rule({ name: "Primary", priority: 1 }),
          rule({ name: "Fallback", ends_at: ANCHOR + 24 * hour }),
        ]),
      ]),
    });
    await openRotation(wrapper);
    await openStop(wrapper, 0);
    const line = () => wrapper.find('[data-test="oncall-schedule-rule-stop-consequence-0"]');
    expect(line().exists()).toBe(false);

    await pickStop(wrapper, 0, "2023-11-21");
    expect(line().text()).toContain("Leaves a gap");
  });

  it("clears ends_at with Don't stop", async () => {
    const wrapper = render({
      schedule: schedule([rota("Weekend", [rule({ ends_at: ANCHOR + MICROS_PER_WEEK })])]),
    });
    await openRotation(wrapper);
    expect(wrapper.find('[data-test="oncall-schedule-rule-stop-0"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-schedule-rule-unstop-0"]').trigger("click");
    await flushPromises();

    await save(wrapper);
    expect(savedRotations()[0].shift_rules[0].ends_at).toBeUndefined();
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

/// The drawer has to explain what several shift rules add up to.
describe("OnCallScheduleEditor — explaining several shift rules", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    service.setSchedule.mockResolvedValue({ data: {} } as any);
    service.listUnavailability.mockResolvedValue({ data: [] } as any);
    service.previewResolvedSchedule.mockResolvedValue({ data: [] } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const region = (name: string, start: number, end: number) =>
    rule({
      name,
      priority: 10,
      restrictions: [{ days: [], start_minute: start, end_minute: end }],
    });
  const office = rule({
    name: "Office",
    priority: 1,
    restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1080 }],
  });

  async function openTab(wrapper: any, index: number) {
    await wrapper.find(`[data-test="oncall-schedule-rule-tab-${index}"]`).trigger("click");
    await flushPromises();
  }

  it("R1: a segment cut by both window edges says there is no change in view", async () => {
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_primary",
          from: Date.UTC(2023, 10, 14) * 1000,
          to: Date.UTC(2023, 10, 28) * 1000,
          user_email: "ana@o2.ai",
        },
      ],
    } as any);
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    await showList(wrapper);

    const rows = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("No change in view");
  });

  const followTheSun = () =>
    rota("Primary", [
      region("India", 0, 720),
      region("Americas", 720, 1440),
      rule({ name: "Follow-the-sun catch-all", priority: 0 }),
    ]);

  it("R12: says the hours a rule actually gets", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [region("India", 0, 720), rule({ name: "Catch-all", priority: 0 })]),
      ]),
    });
    await openRotation(wrapper);
    await openTab(wrapper, 1);

    expect(wrapper.find('[data-test="oncall-schedule-rule-summary-1"]').text()).toBe(
      "All hours · India wins over this · on call only Every day 12:00–24:00",
    );
  });

  it("R13: the preset catch-all reads as standby, with no icon and Save enabled", async () => {
    const wrapper = render({ schedule: schedule([followTheSun()]) });
    await openRotation(wrapper);
    await openTab(wrapper, 2);

    expect(wrapper.find('[data-test="oncall-schedule-rule-standby-2"]').text()).toBe(
      "Standby: India, Americas cover all its hours right now.",
    );
    expect(wrapper.find('[data-test="oncall-schedule-rule-tab-icon-2"]').exists()).toBe(false);
    expect(wrapper.find('[data-test^="oncall-schedule-rule-never-used-"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("R13: regions under a winning catch-all are flagged as never used, Save still enabled", async () => {
    const wrapper = render({ schedule: schedule([followTheSun()]) });
    await openRotation(wrapper);
    await openTab(wrapper, 2);
    await wrapper.find('[data-test="oncall-schedule-overlap-2-wins"]').trigger("click");
    await flushPromises();

    for (const index of [0, 1]) {
      await openTab(wrapper, index);
      expect(wrapper.find(`[data-test="oncall-schedule-rule-never-used-${index}"]`).text()).toBe(
        "Never used: Follow-the-sun catch-all covers all its hours and wins over it.",
      );
      expect(wrapper.find(`[data-test="oncall-schedule-rule-tab-icon-${index}"]`).exists()).toBe(
        true,
      );
    }
    expect(
      wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("R2: opens a follow-the-sun rotation with Save enabled", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [
          region("APAC", 0, 480),
          region("EMEA", 480, 960),
          region("AMER", 960, 1440),
          rule({ name: "Follow-the-sun catch-all", priority: 0 }),
        ]),
      ]),
    });
    await openRotation(wrapper);

    expect(wrapper.find('[data-test^="oncall-schedule-priority-clash-"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("R3: says each rule's hours and who wins where it overlaps", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary", [rule(), office])]) });
    await openRotation(wrapper);

    expect(wrapper.find('[data-test="oncall-schedule-rule-summary-0"]').text()).toBe(
      "All hours · Office wins over this · on call only Mon 00:00–09:00, Mon–Thu 18:00–09:00 next day, Fri 18:00–24:00, Sat, Sun all day",
    );
    await openTab(wrapper, 1);
    expect(wrapper.find('[data-test="oncall-schedule-rule-summary-1"]').text()).toBe(
      "Mon–Fri 09:00–18:00 · wins over Base",
    );
  });

  it("R4: offers no winner choice to rules that never overlap", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary", [region("APAC", 0, 480), region("EMEA", 480, 960)])]),
    });
    await openRotation(wrapper);

    expect(wrapper.find('[data-test="oncall-schedule-overlap-0"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-schedule-priority-0"]').exists()).toBe(false);
  });

  it("R4: choosing the winner reorders priorities, never below zero", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary", [rule(), office])]) });
    await openRotation(wrapper);

    const choice = wrapper.find('[data-test="oncall-schedule-overlap-0"] [data-selected]');
    expect(choice.attributes("data-selected")).toBe("loses");

    await wrapper.find('[data-test="oncall-schedule-overlap-0-wins"]').trigger("click");
    await flushPromises();
    expect(drawerRules(wrapper).map((r: any) => r.priority)).toEqual([2, 1]);

    await openTab(wrapper, 1);
    await wrapper.find('[data-test="oncall-schedule-overlap-1-wins"]').trigger("click");
    await flushPromises();
    expect(drawerRules(wrapper).map((r: any) => r.priority)).toEqual([2, 3]);

    await wrapper.find('[data-test="oncall-schedule-overlap-1-loses"]').trigger("click");
    await flushPromises();
    expect(drawerRules(wrapper).map((r: any) => r.priority)).toEqual([2, 1]);
  });

  it("R5: a new rule copies the shift length and first shift of the rule it came from", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ shift_micros: MICROS_PER_WEEK / 7, anchor_micros: ANCHOR - 5 })]),
      ]),
    });
    await openRotation(wrapper);

    await wrapper.find('[data-test="oncall-schedule-rule-add"]').trigger("click");
    await flushPromises();

    const added = drawerRules(wrapper)[1];
    expect(added.shift_micros).toBe(MICROS_PER_WEEK / 7);
    expect(added.anchor_micros).toBe(ANCHOR - 5);
    expect(added.members).toEqual([]);
    expect(added.restrictions).toEqual([]);
    expect(added.priority).toBe(1);
  });

  it("R7: marks a window that ends the next day and never offers a 24:00 start", async () => {
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [
          rule({ restrictions: [{ days: [], start_minute: 1320, end_minute: 360 }] }),
        ]),
      ]),
    });
    await openRotation(wrapper);

    expect(wrapper.find('[data-test="oncall-schedule-restriction-next-day-0-0"]').exists()).toBe(
      true,
    );
    const [, from, to] = wrapper
      .find('[data-test="oncall-schedule-restriction-0-0"]')
      .findAllComponents({ name: "OSelect" });
    expect(from.props("options").at(-1).value).toBe(1410);
    expect(to.props("options").at(-1).value).toBe(1440);
  });

  it("R10: holds the missing-people message until the picker is used", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);

    await wrapper.find('[data-test="oncall-schedule-rule-add"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rotation-needs-people-1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-schedule-rule-tab-icon-1"]').exists()).toBe(true);

    await addPerson(wrapper, 1, "bob@o2.ai");
    await removePerson(wrapper, 1, 0);
    expect(wrapper.find('[data-test="oncall-rotation-needs-people-1"]').exists()).toBe(true);
  });

  // B2: "+" lands on the new rule with its name ready to type; the body has no name field.
  it("opens a new rule's rename popover", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    expect(wrapper.find('[data-test="oncall-schedule-rule-name-0"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-schedule-rule-add"]').trigger("click");
    vi.runOnlyPendingTimers();
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-schedule-rule-name-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-schedule-rule-name-0"]').exists()).toBe(false);
  });

  it("R10: says so at once for a rule the server stored empty", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary", [rule({ members: [] })])]) });
    await openRotation(wrapper);

    expect(wrapper.find('[data-test="oncall-rotation-needs-people-0"]').exists()).toBe(true);
  });

  it("R11: dragging the handover order rewrites members", async () => {
    const wrapper = render({
      schedule: schedule([rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai"] })])]),
    });
    await openRotation(wrapper);
    await wrapper.find('[data-test="oncall-rule-people-edit-0"]').trigger("click");

    wrapper
      .findComponent('[data-test="oncall-rule-people-list-0"]')
      .vm.$emit("update:modelValue", ["bob@o2.ai", "ana@o2.ai"]);
    await flushPromises();

    expect(drawerRules(wrapper)[0].members).toEqual(["bob@o2.ai", "ana@o2.ai"]);
  });

  // B3: the collapsed line starts at whoever the server says holds the turn.
  it("starts the people line at the person on now", async () => {
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_primary",
          rotation: "Base",
          from: ANCHOR - 1,
          to: ANCHOR + 1,
          user_email: "cy@o2.ai",
        },
      ],
    } as any);
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai", "cy@o2.ai"] })]),
      ]),
      members: members("ana@o2.ai", "bob@o2.ai", "cy@o2.ai"),
    });
    await openRotation(wrapper);

    const line = wrapper.find('[data-test="oncall-rule-people-line-0"]').text();
    expect(line.indexOf("cy@o2.ai")).toBeLessThan(line.indexOf("ana@o2.ai"));
    expect(wrapper.find('[data-test="oncall-rule-people-holder-0"]').text()).toBe("on now");
  });

  // F2: an away holder's turn is still theirs; the stand-in is not where the turn sits.
  it("makes a person on call now on the rostered turn, not the stand-in's", async () => {
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_primary",
          rotation: "Base",
          from: ANCHOR - 1,
          to: ANCHOR + 1,
          user_email: "bob@o2.ai",
          scheduled_email: "ana@o2.ai",
        },
      ],
    } as any);
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai", "cy@o2.ai"] })]),
      ]),
      members: members("ana@o2.ai", "bob@o2.ai", "cy@o2.ai"),
    });
    await openRotation(wrapper);
    expect(wrapper.find('[data-test="oncall-rule-people-line-0"]').text()).toMatch(/^ana@o2\.ai/);
    await wrapper.find('[data-test="oncall-rule-people-edit-0"]').trigger("click");

    await wrapper.find('[data-test="oncall-rule-person-make-current-0-2"]').trigger("click");
    await flushPromises();

    expect(drawerRules(wrapper)[0].members).toEqual(["cy@o2.ai", "ana@o2.ai", "bob@o2.ai"]);
  });

  // F1: paging does not move who is on now; the line reads the first page.
  it("keeps the people line on the current turn while paging", async () => {
    service.previewResolvedSchedule.mockImplementation(
      async ({ from }: any) =>
        ({
          data: [
            {
              rotation_id: "rot_primary",
              rotation: "Base",
              from,
              to: from + 14 * 86_400_000_000,
              user_email: from <= ANCHOR ? "cy@o2.ai" : "bob@o2.ai",
            },
          ],
        }) as any,
    );
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai", "cy@o2.ai"] })]),
      ]),
      members: members("ana@o2.ai", "bob@o2.ai", "cy@o2.ai"),
    });
    await openRotation(wrapper);
    await wrapper.find('[data-test="oncall-draft-preview-next"]').trigger("click");
    await flushPromises();

    expect(service.previewResolvedSchedule).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="oncall-rule-people-line-0"]').text()).toMatch(/^cy@o2\.ai/);
  });

  // F1: an edit returns the picture to the first page.
  it("returns to the first page on any edit", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    await wrapper.find('[data-test="oncall-draft-preview-next"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-test="oncall-draft-preview-prev"]').attributes("disabled"),
    ).toBeUndefined();

    await wrapper.find('[data-test="oncall-schedule-name"]').setValue("Renamed");
    await flushPromises();
    expect(
      wrapper.find('[data-test="oncall-draft-preview-prev"]').attributes("disabled"),
    ).toBeDefined();
  });

  // B3: "Make on call now" turns the list so the chosen person sits on the current turn's index.
  it("makes a person on call now by rotating the list", async () => {
    service.previewResolvedSchedule.mockResolvedValue({
      data: [
        {
          rotation_id: "rot_primary",
          rotation: "Base",
          from: ANCHOR - 1,
          to: ANCHOR + 1,
          user_email: "bob@o2.ai",
        },
      ],
    } as any);
    const wrapper = render({
      schedule: schedule([
        rota("Primary", [rule({ members: ["ana@o2.ai", "bob@o2.ai", "cy@o2.ai"] })]),
      ]),
      members: members("ana@o2.ai", "bob@o2.ai", "cy@o2.ai"),
    });
    await openRotation(wrapper);
    await wrapper.find('[data-test="oncall-rule-people-edit-0"]').trigger("click");

    await wrapper.find('[data-test="oncall-rule-person-make-current-0-2"]').trigger("click");
    await flushPromises();

    expect(drawerRules(wrapper)[0].members).toEqual(["bob@o2.ai", "cy@o2.ai", "ana@o2.ai"]);
  });

  it("adds everyone on the team who is not in the rule", async () => {
    const wrapper = render({ schedule: schedule([rota("Primary")]) });
    await openRotation(wrapper);
    await wrapper.find('[data-test="oncall-rule-people-edit-0"]').trigger("click");
    await wrapper.find('[data-test="oncall-rule-people-add-all-0"]').trigger("click");
    await flushPromises();

    expect(drawerRules(wrapper)[0].members).toEqual(["ana@o2.ai", "bob@o2.ai"]);
  });
});
