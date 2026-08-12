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

import OnCallEscalationCell from "@/components/oncall/OnCallEscalationCell.vue";
import i18n from "@/locales";
import type { EscalationProgress, ResponseState } from "@/ts/interfaces/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OProgressBar: { name: "OProgressBar", props: ["value", "variant"], template: "<div />" },
};

function firedRungs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    after_micros: i * 300_000_000,
    at: Date.now() * 1000,
    targets: ["the on-call"],
  }));
}

function render(
  state: ResponseState,
  progress: Partial<EscalationProgress> | null,
  totalRungs: number | null = 3,
) {
  return mount(OnCallEscalationCell, {
    props: {
      responseId: "resp-1",
      state,
      totalRungs,
      progress: progress && {
        fired: [],
        next_targets: [],
        next_at: null,
        exhausted: false,
        stopped_because: null,
        ...progress,
      },
    },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallEscalationCell", () => {
  it("names the rung it is on out of the rungs the policy defines", () => {
    const wrapper = render("triggered", { fired: firedRungs(2) });
    expect(wrapper.find('[data-test="oncall-escalation-cell-level"]').text()).toBe(
      "Level 2 of 3",
    );
  });

  /// A guessed denominator is worse than none: "Level 2 of 3" against a policy
  /// nobody could read would state a deadline that does not exist.
  it("omits the denominator when the policy could not be read", () => {
    const wrapper = render("triggered", { fired: firedRungs(2) }, null);
    expect(wrapper.find('[data-test="oncall-escalation-cell-level"]').text()).toBe("Level 2");
  });

  it("counts down to the next rung and names who it wakes", () => {
    const wrapper = render("triggered", {
      fired: firedRungs(1),
      next_targets: ["the next on-call"],
      next_at: (Date.now() + 4 * 60_000) * 1000,
    });

    const detail = wrapper.find('[data-test="oncall-escalation-cell-detail"]');
    expect(detail.text()).toContain("the next on-call");
    // Not exact: the countdown runs against the real clock, so seconds have
    // already elapsed by the time it renders.
    expect(detail.text()).toMatch(/[34]m/);
  });

  /// One or two words, not a sentence. The full copy ("Escalation stopped —
  /// somebody owns this.") truncated to nothing in a table cell, which is what
  /// this column was doing.
  it.each([
    ["acknowledged" as ResponseState, null, "Acknowledged"],
    ["resolved" as ResponseState, null, "Resolved"],
    ["triggered" as ResponseState, "snoozed", "Snoozed"],
  ])("reports %s as a stopped ladder in one word", (state, stoppedBecause, expected) => {
    const wrapper = render(state, {
      fired: firedRungs(1),
      stopped_because: stoppedBecause,
    });
    expect(wrapper.find('[data-test="oncall-escalation-cell-level"]').text()).toBe(expected);
  });

  /// Once a page IS answered, how fast is the useful fact — the ladder itself
  /// has nothing left to say.
  it("says how quickly an answered page was claimed", () => {
    const wrapper = mount(OnCallEscalationCell, {
      props: {
        responseId: "resp-1",
        state: "acknowledged" as ResponseState,
        totalRungs: 3,
        ackedInMicros: 42_000_000,
        progress: {
          fired: firedRungs(1),
          next_targets: [],
          next_at: null,
          exhausted: false,
          stopped_because: "acknowledged",
        },
      },
      global: { plugins: [i18n], stubs },
    });
    expect(wrapper.find('[data-test="oncall-escalation-cell-detail"]').text()).toBe(
      "acked in 42s",
    );
  });

  /// No progress loaded is not the same fact as "nothing has fired", so the bar
  /// is withheld rather than drawn empty.
  it("draws no bar when the ladder position is unknown", () => {
    const wrapper = render("triggered", null);
    expect(wrapper.find('[data-test="oncall-escalation-cell-bar"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-escalation-cell-level"]').text()).toBe(
      "Not paged yet",
    );
  });

  it("fills the bar in proportion to the rungs already fired", () => {
    const wrapper = render("triggered", { fired: firedRungs(2) }, 4);
    expect(wrapper.findComponent({ name: "OProgressBar" }).props("value")).toBe(0.5);
  });

  /// An exhausted ladder has nobody left to wake — the loudest state there is.
  it("marks an exhausted ladder as dangerous", () => {
    const wrapper = render("triggered", { fired: firedRungs(3), exhausted: true });
    expect(wrapper.findComponent({ name: "OProgressBar" }).props("variant")).toBe("danger");
  });
});
