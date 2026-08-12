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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallScheduleCalendar from "@/components/oncall/OnCallScheduleCalendar.vue";
import i18n from "@/locales";
import type { Rotation } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OToggleGroupItem: { name: "OToggleGroupItem", props: ["value"], template: "<button><slot /></button>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="(e) => $emit('click', e)"><slot /></button>`,
  },
};

const WEEK = 604_800_000_000;

function rotation(over: Partial<Rotation> = {}): Rotation {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return {
    name: "Primary",
    members: ["ana@o2.ai", "bob@o2.ai"],
    shift_micros: WEEK,
    anchor_micros: midnight.getTime() * 1000,
    ...over,
  };
}

function render(rotations: Rotation[], timezone = "UTC") {
  return mount(OnCallScheduleCalendar, {
    props: { rotations, timezone },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallScheduleCalendar", () => {
  it("draws a track per rotation plus the in-force track", () => {
    const wrapper = render([rotation(), rotation({ name: "Weekends" })]);

    expect(wrapper.find('[data-test="oncall-calendar-track-Primary"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-calendar-track-Weekends"]').exists()).toBe(true);
    // The computed row: what is actually in force when rotations overlap.
    expect(wrapper.find('[data-test="oncall-calendar-track-In force"]').exists()).toBe(true);
  });

  it("shows who covers each band", () => {
    const wrapper = render([rotation()]);
    expect(wrapper.find('[data-test="oncall-calendar-track-Primary"]').text()).toContain(
      "ana@o2.ai",
    );
  });

  /// A gap is the one thing on this chart worth alarming about: alerts routed
  /// here during it page nobody.
  /// A single rotation renders as ONE track, not the rotation plus an
  /// identical "in force" copy — but it must still draw the gap.
  it("marks a stretch with nobody on call", () => {
    const wrapper = render([rotation({ members: [] })]);
    const tracks = wrapper.findAll('[data-test^="oncall-calendar-track-"]');

    expect(tracks).toHaveLength(1);
    expect(tracks[0].text()).toContain("No one on call");
  });

  /// Two rotations mean the layering has to resolve somewhere, and that is
  /// what the computed track is for.
  it("adds the in-force track only once there is layering to resolve", () => {
    const one = render([rotation()]);
    expect(one.find('[data-test="oncall-calendar-track-In force"]').exists()).toBe(false);

    const two = render([rotation(), rotation({ name: "Weekend" })]);
    expect(two.find('[data-test="oncall-calendar-track-In force"]').exists()).toBe(true);
  });

  /// Pinning the marker to an edge when today is off screen would read as
  /// "now" when it is nothing of the sort.
  it("shows the now marker only while today is in view", () => {
    const wrapper = render([rotation()]);
    expect(wrapper.find('[data-test="oncall-calendar-now"]').exists()).toBe(true);
  });

  it("moves the window and comes back to today", async () => {
    const wrapper = render([rotation()]);
    const label = () => wrapper.find('[data-test="oncall-calendar-window"]').text();
    const start = label();

    await wrapper.find('[data-test="oncall-calendar-next"]').trigger("click");
    expect(label()).not.toBe(start);
    // Paging away takes today off screen, so the marker goes with it.
    expect(wrapper.find('[data-test="oncall-calendar-now"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-calendar-today"]').trigger("click");
    expect(label()).toBe(start);
    expect(wrapper.find('[data-test="oncall-calendar-now"]').exists()).toBe(true);
  });

  it("changes the visible span with the range toggle", async () => {
    const wrapper = render([rotation()]);
    const week = wrapper.find('[data-test="oncall-calendar-window"]').text();

    wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "day");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="oncall-calendar-window"]').text()).not.toBe(week);
  });

  /// The Final track exists to answer "who is actually in force". It used to
  /// take the last rotation in the array, which named the wrong person for
  /// every team whose rotations overlap — the same bug resolveHolder was
  /// written to fix everywhere else.
  it("resolves an overlap by priority, not by array order", () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const anchor = midnight.getTime() * 1000;

    const wrapper = render([
      rotation({ name: "Wins", members: ["ana@o2.ai"], anchor_micros: anchor, priority: 10 }),
      rotation({ name: "Loses", members: ["bob@o2.ai"], anchor_micros: anchor, priority: 1 }),
    ]);

    const final = wrapper.find('[data-test="oncall-calendar-track-In force"]');
    expect(final.text()).toContain("ana@o2.ai");
    expect(final.text()).not.toContain("bob@o2.ai");
  });

  /// A restricted rotation is switched off outside its window, so the hours it
  /// does not cover are a real gap. Ignoring restrictions drew it as covering
  /// the whole week and hid the gap completely.
  it("draws the hours a restricted rotation does not cover as a gap", () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    // Weekdays 09:00-17:00 only, so every night and both weekend days are
    // uncovered.
    const wrapper = render([
      rotation({
        name: "Business hours",
        members: ["ana@o2.ai"],
        anchor_micros: midnight.getTime() * 1000,
        restrictions: [{ days: [0, 1, 2, 3, 4], start_minute: 540, end_minute: 1020 }],
      }),
    ]);

    const final = wrapper.find('[data-test="oncall-calendar-track-Business hours"]');
    expect(final.text()).toContain("No one on call");
    expect(final.text()).toContain("ana@o2.ai");
  });

  it("says what to do when there are no rotations", () => {
    const wrapper = render([]);
    expect(wrapper.text()).toContain("Add a rotation");
  });
});
