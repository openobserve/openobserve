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
      schedule: schedule([
        {
          name: "Primary",
          members: ["ana@o2.ai", "bob@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
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
      schedule: schedule([
        {
          name: "Primary",
          members: ["ana@o2.ai", "bob@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
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
      schedule: schedule([
        {
          name: "Primary",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();
    await openRotation(wrapper);

    const field = wrapper.find('[data-test="oncall-schedule-handover"]');
    expect(field.exists()).toBe(true);

    const before = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]')[0].text();
    await field.setValue("not-a-date");
    await flushPromises();
    const after = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]')[0].text();
    expect(after).toBe(before);
  });

  // An empty rotation is refused by the server; dropping it locally keeps a
  // half-emptied form from failing the whole save.
  it("drops empty rotations on save", async () => {
    const wrapper = render({
      schedule: schedule([
        {
          name: "Primary",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
        {
          name: "Backup",
          members: ["bob@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

    // Empty the second rotation the way a user would, through its editor.
    await openRotation(wrapper, 1);
    await wrapper
      .findComponent('[data-test="oncall-schedule-members"]')
      .vm.$emit("update:modelValue", []);
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-save"]').trigger("click");
    await flushPromises();

    const sent = service.setSchedule.mock.calls[0][0] as any;
    expect(sent.data.rotations).toHaveLength(1);
    expect(sent.data.rotations[0].name).toBe("Primary");
  });

  /// Rotations are named shifts, not slots in a fixed ladder, so there is no
  /// list of remaining levels to pick from and no cap on how many you can add.
  /// A second rotation is for follow-the-sun, not for a "secondary".
  it("adds a named rotation without asking for a level", async () => {
    const wrapper = render({
      schedule: schedule([
        {
          name: "Primary",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-schedule-new-level"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();

    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(2);
  });

  /// The blocker this pins: two rotations both defaulted to priority 0 with no
  /// restrictions, which the server calls "equally in force" and rejects — so
  /// adding a second one failed the WHOLE save and took the working one down.
  it("gives a second rotation a distinct priority", async () => {
    const wrapper = render({
      schedule: schedule([
        {
          name: "On-call rotation",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-add-rotation"]').trigger("click");
    await flushPromises();

    const rows = wrapper.findComponent({ name: "OTable" }).props("data") as any[];
    expect(rows).toHaveLength(2);
    expect(rows[1].priority).not.toBe(rows[0].priority ?? 0);
  });

  /// The drawer used to survive its own save; the parent then rebuilt `draft`,
  /// detaching the object the drawer was still editing.
  it("closes the editor after saving", async () => {
    service.setSchedule.mockResolvedValue({ data: {} } as any);
    const wrapper = render({
      schedule: schedule([
        {
          name: "On-call rotation",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();
    await openRotation(wrapper);
    expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(true);

    await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
    await flushPromises();

    expect(wrapper.findComponent({ name: "ODrawer" }).props("open")).toBe(false);
  });
  /// A layer's *when* was the half the editor could not express: a
  /// follow-the-sun setup was preset-or-API only, and a rotation the API had
  /// restricted rendered here as though it applied always.
  describe("when a layer applies", () => {
    const layer = (over: Record<string, unknown> = {}) => ({
      name: "Primary",
      members: ["ana@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      anchor_micros: ANCHOR,
      priority: 0,
      ...over,
    });

    it("round-trips a restriction the API wrote", async () => {
      const wrapper = render({
        schedule: schedule([
          layer({ restrictions: [{ days: [0, 1, 2], start_minute: 540, end_minute: 1020 }] }),
        ]),
      });
      await openRotation(wrapper);

      expect(wrapper.find('[data-test="oncall-schedule-restriction-0"]').exists()).toBe(true);
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.restrictions).toEqual([{ days: [0, 1, 2], start_minute: 540, end_minute: 1020 }]);
    });

    /// A window with no days applies on no day, which is a rotation resolving
    /// to nobody — so a new one starts as the working week.
    it("adds a window that already means something", async () => {
      const wrapper = render({ schedule: schedule([layer()]) });
      await openRotation(wrapper);

      await wrapper.find('[data-test="oncall-schedule-restriction-add"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      const sent = (service.setSchedule.mock.calls[0][0] as any).data.rotations[0];
      expect(sent.restrictions).toEqual([{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }]);
    });

    it("removes a window", async () => {
      const wrapper = render({
        schedule: schedule([
          layer({ restrictions: [{ days: [0], start_minute: 0, end_minute: 60 }] }),
        ]),
      });
      await openRotation(wrapper);

      await wrapper.find('[data-test="oncall-schedule-restriction-remove-0"]').trigger("click");
      await flushPromises();
      await wrapper.find('[data-test="oncall-rotation-done"]').trigger("click");
      await flushPromises();

      expect((service.setSchedule.mock.calls[0][0] as any).data.rotations[0].restrictions).toEqual([]);
    });

    /// Two layers equally in force are refused as a WHOLE — the rotation that
    /// works today goes down with the edit — so Save has to be unreachable
    /// rather than the reader learning it from a 400.
    it("blocks a save that would collide with another layer's priority", async () => {
      const wrapper = render({
        schedule: schedule([layer(), layer({ name: "Weekend", priority: 1 })]),
      });
      await openRotation(wrapper, 1);

      const priority = wrapper.find('[data-test="oncall-schedule-priority"]');
      priority.element.value = "0";
      await priority.trigger("change");

      expect(wrapper.find('[data-test="oncall-schedule-priority-clash"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="oncall-rotation-done"]').attributes("disabled"),
      ).toBeDefined();
    });

    /// Slots do not compete — both resolve at the same instant with their own
    /// members — so an identical priority across two slots is not a clash.
    it("allows the same priority in a different slot", async () => {
      const wrapper = render({
        schedule: schedule([layer(), layer({ name: "Backup", slot: "secondary", priority: 0 })]),
      });
      await openRotation(wrapper, 1);

      expect(wrapper.find('[data-test="oncall-schedule-priority-clash"]').exists()).toBe(false);
    });
  });
});
