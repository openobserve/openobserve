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

function render(
  progress: Partial<EscalationProgress>,
  events: unknown[] = [],
  responderRole: "owner" | "impacted" = "owner",
) {
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
      responderRole,
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

  /// B9's other "nobody": a rung whose targets resolved to no one. The ladder
  /// does the OPPOSITE thing about it — an empty rung is consumed and advanced
  /// past at once; a lost rung keeps its place and is retried — so the two
  /// must carry different tags. Told apart structurally: a rung that attempted
  /// anyone writes per-send delivery entries; an empty rung writes only its
  /// page line.
  it("marks an empty rung differently from a lost one", () => {
    const wrapper = render(
      {
        fired: [
          { after_micros: 0, at: 1, targets: ["on-call now"] },
          { after_micros: 300_000_000, at: 2, targets: ["next on call"] },
        ],
      },
      [
        // Rung 0: matched nobody at all — page line only, no delivery rows.
        { kind: "page", at: 1, actor: "o2-engine", body: "nobody matched on_call_now", rung_micros: 0 },
        // Rung +5m: had a person, every send failed — the lost marker.
        { kind: "delivery", at: 2, actor: "o2-engine", body: "email to bo failed", rung_micros: 300_000_000, recipient: "bo@o2.ai", channel: "email", delivered: false },
        { kind: "page", at: 2, actor: "o2-engine", body: "could not reach bo@o2.ai", rung_micros: 300_000_000, delivered: false },
      ],
    );
    expect(wrapper.find('[data-test="oncall-escalation-rung-empty-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-escalation-rung-lost-0"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-escalation-rung-lost-300000000"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-escalation-rung-empty-300000000"]').exists()).toBe(false);
  });

  /// A rung that reached people writes delivery rows, so it earns neither tag.
  /// D8/D-21: an impacted record is a liaison seat. Its ladder is truncated to
  /// two rungs by `impacted_ladder`, never repeats, and never hands off — so a
  /// short ladder that stops is the design working, and the owner ladder's
  /// warning ("nobody left to escalate to") would ask a team to chase an
  /// outage it cannot fix.
  it("says a liaison ladder is short on purpose", () => {
    const wrapper = render({ fired: [{ after_micros: 0, at: 1, targets: ["ana@o2.ai"] }] }, [], "impacted");
    expect(wrapper.find('[data-test="oncall-escalation-liaison-note"]').text()).toContain(
      "one chase",
    );
  });

  it("reads a spent liaison ladder as finished, not as exhausted", () => {
    const wrapper = render({ exhausted: true }, [], "impacted");
    expect(wrapper.find('[data-test="oncall-escalation-liaison-done"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-escalation-exhausted"]').exists()).toBe(false);
  });

  /// The owner's ladder running out is still the loud failure it was.
  it("keeps the exhausted warning on an owner record", () => {
    const wrapper = render({ exhausted: true });
    expect(wrapper.find('[data-test="oncall-escalation-exhausted"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-escalation-liaison-note"]').exists()).toBe(false);
  });

  it("puts no nobody-tag on a rung that landed", () => {
    const wrapper = render(
      { fired: [{ after_micros: 0, at: 1, targets: ["ana@o2.ai"] }] },
      [
        { kind: "delivery", at: 1, actor: "o2-engine", body: "email delivered to ana", rung_micros: 0, recipient: "ana@o2.ai", channel: "email", delivered: true },
        { kind: "page", at: 1, actor: "o2-engine", body: "paged ana@o2.ai", rung_micros: 0 },
      ],
    );
    expect(wrapper.find('[data-test="oncall-escalation-rung-empty-0"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-escalation-rung-lost-0"]').exists()).toBe(false);
  });

});
