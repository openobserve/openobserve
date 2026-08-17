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

import OnCallEscalation from "@/components/oncall/OnCallEscalation.vue";
import i18n from "@/locales";
import type { EscalationProgress } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", template: "<span />" },
};

function render(progress: Partial<EscalationProgress>, events: unknown[] = []) {
  return mount(OnCallEscalation, {
    props: {
      progress: {
        fired: [],
        next_targets: [],
        next_at: null,
        exhausted: false,
        stopped_because: null,
        ...progress,
      },
      events: events as never,
    },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallEscalation", () => {
  /// The question mid-incident is not "who has been paged" but "when does this
  /// wake somebody else", and it was answerable nowhere in the product.
  it("says who is next and how long until they are woken", () => {
    const wrapper = render({
      next_targets: ["the next on-call"],
      next_at: (Date.now() + 12 * 60_000) * 1000,
    });

    const next = wrapper.find('[data-test="oncall-escalation-next"]');
    expect(next.text()).toContain("the next on-call");
    // Not an exact string: the countdown is computed against the real clock,
    // so the seconds have already ticked by the time it renders.
    expect(next.text()).toMatch(/1[12]m/);
  });

  /// A rung due but not yet dispatched is still a real answer; a negative
  /// countdown would not be.
  it("says imminent rather than counting backwards", () => {
    const wrapper = render({
      next_targets: ["the on-call"],
      next_at: (Date.now() - 5_000) * 1000,
    });
    expect(wrapper.find('[data-test="oncall-escalation-next"]').text()).toContain(
      "any moment",
    );
  });

  it("lists the rungs already sent, with who they reached", () => {
    const wrapper = render({
      fired: [
        { after_micros: 0, at: 1_700_000_000_000_000, targets: ["ana@o2.ai"] },
        { after_micros: 300_000_000, at: 1_700_000_300_000_000, targets: ["bob@o2.ai"] },
      ],
    });

    expect(wrapper.find('[data-test="oncall-escalation-rung-0"]').text()).toContain(
      "ana@o2.ai",
    );
    const second = wrapper.find('[data-test="oncall-escalation-rung-300000000"]');
    expect(second.text()).toContain("bob@o2.ai");
    expect(second.text()).toContain("+5m");
  });

  /// A stopped ladder has no next rung, and a countdown to something that will
  /// never happen is worse than saying nothing.
  it("explains why the ladder is not climbing instead of counting down", () => {
    for (const [reason, phrase] of [
      ["acknowledged", "somebody owns this"],
      ["snoozed", "paused"],
      ["resolved", "resolved"],
    ] as const) {
      const wrapper = render({
        stopped_because: reason,
        next_at: (Date.now() + 60_000) * 1000,
        next_targets: ["the whole team"],
      });

      expect(wrapper.find('[data-test="oncall-escalation-stopped"]').text()).toContain(phrase);
      expect(wrapper.find('[data-test="oncall-escalation-next"]').exists()).toBe(false);
    }
  });

  /// The ladder running out with nobody acknowledging is the quiet failure
  /// this panel exists to make loud.
  it("says plainly when the ladder ran out", () => {
    const wrapper = render({ exhausted: true });
    expect(wrapper.find('[data-test="oncall-escalation-exhausted"]').text()).toContain(
      "nobody left to escalate to",
    );
  });

  it("says when nothing has gone out yet", () => {
    const wrapper = render({});
    expect(wrapper.find('[data-test="oncall-escalation-none"]').exists()).toBe(true);
  });
  /// §G.9 #6: /escalation cannot say a fired rung reached nobody — it looks
  /// exactly like one that landed. The rail cross-references the timeline's
  /// whole-rung-lost marker, scoped to the CURRENT run: an earlier run's lost
  /// rung is history, not a retry in flight.
  it("marks a fired rung the transport lost, from the timeline", () => {
    const wrapper = render(
      { fired: [{ after_micros: 0, at: 1, targets: ["ana@o2.ai"] }] },
      [{ kind: "page", at: 1, actor: "o2-engine", body: "paged ana", rung_micros: 0, delivered: false }],
    );
    expect(wrapper.find('[data-test="oncall-escalation-rung-lost-0"]').exists()).toBe(true);
  });

  it("does not carry an old run's lost rung into the current one", () => {
    const wrapper = render(
      { fired: [{ after_micros: 0, at: 9, targets: ["bo@o2.ai"] }] },
      [
        // run 1 lost its first rung; the handoff started run 2, which landed.
        { kind: "page", at: 1, actor: "o2-engine", body: "paged ana", rung_micros: 0, delivered: false },
        { kind: "page", at: 9, actor: "o2-engine", body: "paged bo", rung_micros: 0, ladder_run: 2 },
      ],
    );
    expect(wrapper.find('[data-test="oncall-escalation-rung-lost-0"]').exists()).toBe(false);
  });

});
