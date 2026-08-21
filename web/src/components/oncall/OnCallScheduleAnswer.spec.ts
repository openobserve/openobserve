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
import type { OnCallPosition } from "@/ts/interfaces/oncall";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    props: ["disabled"],
    emits: ["click"],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
};

const position = (over: Partial<OnCallPosition> = {}): OnCallPosition => ({
  rotation_id: "rot_primary",
  rotation_name: "Primary",
  rule: "Base",
  user_email: "mei@o2.ai",
  ...over,
});

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallScheduleAnswer, {
    props: { positions: [position()], ...over },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallScheduleAnswer", () => {
  /// The whole reason this row was trimmed: the primary, their remaining shift
  /// and the handover are on the pulse strip above the tabs and on the
  /// timeline's own "on now" band, so saying them a third time here gave the
  /// reader two derivations of one fact to reconcile.
  it("does not restate the primary or the handover the chart already draws", () => {
    const text = render().text();
    expect(text).not.toContain("mei@o2.ai");
    expect(text).not.toContain("On call until");
    expect(text).not.toContain("Next");
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

  /// A second staffed ROTATION, named after itself. The old lookup asked for a
  /// slot literally spelled "secondary", so a team whose second position was
  /// called anything else read as having none.
  it("names the second rotation when there is one, and stops offering to assign", () => {
    const wrapper = render({
      positions: [
        position(),
        position({
          rotation_id: "rot_secondary",
          rotation_name: "Secondary",
          user_email: "dev@o2.ai",
        }),
      ],
    });
    expect(wrapper.find('[data-test="oncall-answer-secondary-who"]').text()).toContain("dev@o2.ai");
    expect(wrapper.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);
  });

  /// Nobody on call is a louder claim than an empty second rung, and it must
  /// not read as a blank name — so it takes the row rather than sitting beside
  /// a secondary status that is beside the point.
  it("states that nobody is on call instead of naming the secondary's state", () => {
    const wrapper = render({ positions: [] });
    expect(wrapper.text()).toContain("Nobody is on call");
    expect(wrapper.find('[data-test="oncall-answer-nobody-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-answer-secondary"]').exists()).toBe(false);
  });

  /// A swap trades two people's shifts. With nobody on call there is no shift
  /// on this side of the trade.
  it("cannot request a swap when nobody holds the pager", () => {
    const wrapper = render({ positions: [] });
    expect(
      wrapper.find('[data-test="oncall-answer-request-swap"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("asks the parent for a swap", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-answer-request-swap"]').trigger("click");
    expect(wrapper.emitted("request-swap")).toHaveLength(1);
  });

  /// Every action here names a person, so on a team with nobody on it they all
  /// open on an empty picker. The one act that leads somewhere is offered.
  it("offers the roster instead of actions nobody can complete", async () => {
    const wrapper = render({ positions: [], hasMembers: false });

    expect(wrapper.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-answer-request-swap"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-answer-add-people"]').trigger("click");
    expect(wrapper.emitted("add-people")).toHaveLength(1);
  });

  /// A caller that has not read the roster yet must not hide the actions of a
  /// team that is staffed.
  it("keeps its actions when the roster is unknown", () => {
    const wrapper = render({ positions: [] });
    expect(wrapper.find('[data-test="oncall-answer-add-people"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-answer-request-swap"]').exists()).toBe(true);
  });
});
