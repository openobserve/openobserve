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
  /// The whole reason this row was trimmed: every person it used to name — the
  /// primary, whoever is next, whoever backs them up — is drawn on the
  /// timeline's own bands a few pixels below, from resolved segments rather
  /// than from `whoIsOnCall`, so saying them here gave the reader two
  /// derivations of one fact to reconcile.
  it("names nobody the chart already draws", () => {
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
    const text = wrapper.text();
    expect(text).not.toContain("mei@o2.ai");
    expect(text).not.toContain("dev@o2.ai");
    expect(text).not.toContain("Secondary");
    expect(text).not.toContain("On call until");
    expect(text).not.toContain("Next");
  });

  /// The act, not the status: a second rung that resolves to nobody is visible
  /// on the chart as an empty lane, and what this row adds is the way to fill
  /// it.
  it("offers to staff a second rotation when there is none", async () => {
    const wrapper = render();

    await wrapper.find('[data-test="oncall-answer-assign-secondary"]').trigger("click");
    expect(wrapper.emitted("assign-secondary")).toHaveLength(1);
  });

  /// A second staffed ROTATION, counted rather than looked up. The old lookup
  /// asked for a slot literally spelled "secondary", so a team whose second
  /// position was called anything else was still offered the act.
  it("stops offering to assign once a second rotation is staffed", () => {
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
    expect(wrapper.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);
  });

  /// Nobody on call is the one claim this row still makes, because it is the
  /// state in which the acts beside it are beside the point.
  it("states that nobody is on call", () => {
    const wrapper = render({ positions: [] });
    expect(wrapper.text()).toContain("Nobody is on call");
    expect(wrapper.find('[data-test="oncall-answer-nobody-hint"]').exists()).toBe(true);
  });

  /// Writing a cover lives on the chart's own toolbar now, beside Add rotation
  /// — one row of things a reader can do to this schedule rather than two.
  it("does not offer the cover the timeline's toolbar carries", () => {
    expect(render().find('[data-test="oncall-answer-request-swap"]').exists()).toBe(false);
  });

  /// Every action here names a person, so on a team with nobody on it they all
  /// open on an empty picker. The one act that leads somewhere is offered.
  it("offers the roster instead of actions nobody can complete", async () => {
    const wrapper = render({ positions: [], hasMembers: false });

    expect(wrapper.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(false);

    await wrapper.find('[data-test="oncall-answer-add-people"]').trigger("click");
    expect(wrapper.emitted("add-people")).toHaveLength(1);
  });

  /// A caller that has not read the roster yet must not hide the actions of a
  /// team that is staffed.
  it("keeps its actions when the roster is unknown", () => {
    const wrapper = render({ positions: [] });
    expect(wrapper.find('[data-test="oncall-answer-add-people"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-answer-assign-secondary"]').exists()).toBe(true);
  });
});
