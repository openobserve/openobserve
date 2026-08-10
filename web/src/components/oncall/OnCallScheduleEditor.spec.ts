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

const stubs = {
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
          level: "primary",
          members: ["ana@o2.ai", "bob@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

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
          level: "primary",
          members: ["ana@o2.ai", "bob@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

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
          level: "primary",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

    const field = wrapper.find('[data-test="oncall-schedule-handover-primary"]');
    expect(field.exists()).toBe(true);

    const before = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]')[0].text();
    await field.setValue("not-a-date");
    await flushPromises();
    const after = wrapper.findAll('[data-test="oncall-schedule-preview-shift"]')[0].text();
    expect(after).toBe(before);
  });

  // An empty rotation is refused by the server; dropping it locally keeps a
  // half-filled form from failing the whole save.
  it("drops empty rotations on save", async () => {
    const wrapper = render({
      schedule: schedule([
        {
          level: "primary",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
        {
          level: "secondary",
          members: [],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

    await wrapper.find('[data-test="oncall-schedule-save"]').trigger("click");
    await flushPromises();

    const sent = service.setSchedule.mock.calls[0][0] as any;
    expect(sent.data.rotations).toHaveLength(1);
    expect(sent.data.rotations[0].level).toBe("primary");
  });

  it("offers only levels that have no rotation yet", async () => {
    const wrapper = render({
      schedule: schedule([
        {
          level: "primary",
          members: ["ana@o2.ai"],
          shift_micros: MICROS_PER_WEEK,
          anchor_micros: ANCHOR,
        },
      ]),
    });
    await flushPromises();

    const levelPicker = wrapper.find('[data-test="oncall-schedule-new-level"]');
    expect(levelPicker.text()).not.toContain("Primary");
    expect(levelPicker.text()).toContain("Secondary");
  });
});
