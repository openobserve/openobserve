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

import OnCallScheduleAnswer from "@/components/oncall/OnCallScheduleAnswer.vue";
import i18n from "@/locales";
import type { OnCallSlot, ResolvedSegment } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
};

const DAY = MICROS_PER_DAY;
const now = Date.now() * 1000;

const slot = (over: Partial<OnCallSlot> = {}): OnCallSlot => ({
  slot: "primary",
  rotation: "Primary",
  user_email: "mei@o2.ai",
  ...over,
});

const seg = (over: Partial<ResolvedSegment> = {}): ResolvedSegment => ({
  slot: "primary",
  from: now - DAY,
  to: now + 6 * DAY,
  user_email: "mei@o2.ai",
  rotation: "Primary",
  ...over,
});

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallScheduleAnswer, {
    props: { slots: [slot()], segments: [seg()], timezone: "UTC", ...over },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallScheduleAnswer", () => {
  /// The one line the tab exists to produce, and the reason the rail's cards
  /// could go: who is on, and how much of their shift is left.
  it("names the holder and how long they have left", () => {
    const text = render().find('[data-test="oncall-answer-holder"]').text();
    expect(text).toContain("mei@o2.ai");
    expect(text).toContain("On call until");
    expect(render().find('[data-test="oncall-answer-until"]').text()).toContain("left");
  });

  /// Read off the SEGMENTS, not off `shift_micros`: a cover or a restriction
  /// ends the current shift somewhere the cadence alone would not put it.
  it("takes the handover from the resolved segment, not the rotation's cadence", () => {
    const endsAt = now + 2 * DAY;
    const wrapper = render({ segments: [seg({ to: endsAt })] });
    // The instant, not the countdown: the shared clock ticks between the
    // fixture and the render, so "2d" is "1d 23h" by the time it is drawn.
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(endsAt / 1000));
    expect(wrapper.find('[data-test="oncall-answer-until"]').text()).toContain(weekday);
  });

  /// The window may simply not reach the handover. That is a missing fact, not
  /// "no handover exists", and printing an inferred end time would be a lie.
  it("says so when no segment covers the present", () => {
    const wrapper = render({ segments: [] });
    expect(wrapper.find('[data-test="oncall-answer-until"]').text()).toContain(
      "No scheduled handover",
    );
  });

  it("names who takes the pager next", () => {
    const wrapper = render({
      segments: [
        seg(),
        seg({ from: now + 6 * DAY, to: now + 13 * DAY, user_email: "priya@o2.ai" }),
      ],
    });
    const next = wrapper.find('[data-test="oncall-answer-next"]').text();
    expect(next).toContain("priya@o2.ai");
  });

  /// An unstaffed secondary is the difference between "the ladder has a second
  /// rung" and "the second rung resolves to nobody" — a finding, coloured as
  /// one, with the act that fixes it beside it.
  it("calls out an unstaffed secondary and offers to staff it", async () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-answer-secondary"]').text()).toContain(
      "No one assigned",
    );

    await wrapper.find('[data-test="oncall-answer-assign-secondary"]').trigger("click");
    expect(wrapper.emitted("assign-secondary")).toHaveLength(1);
  });

  it("names the secondary when there is one, and stops offering to assign", () => {
    const wrapper = render({
      slots: [slot(), slot({ slot: "secondary", user_email: "dev@o2.ai" })],
    });
    expect(wrapper.find('[data-test="oncall-answer-secondary-who"]').text()).toContain("dev@o2.ai");
    expect(wrapper.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);
  });

  /// Nobody on call is not a quieter version of this line — it is a different
  /// claim, and it must not read as a blank name.
  it("states that nobody is on call rather than rendering an empty holder", () => {
    const wrapper = render({ slots: [] });
    expect(wrapper.text()).toContain("Nobody is on call");
    expect(wrapper.find('[data-test="oncall-answer-nobody-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-answer-holder"]').exists()).toBe(false);
  });

  /// A swap trades two people's shifts. With nobody on call there is no shift
  /// on this side of the trade.
  it("cannot request a swap when nobody holds the pager", () => {
    const wrapper = render({ slots: [] });
    expect(
      wrapper.find('[data-test="oncall-answer-request-swap"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("asks the parent for a swap", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-answer-request-swap"]').trigger("click");
    expect(wrapper.emitted("request-swap")).toHaveLength(1);
  });
});
