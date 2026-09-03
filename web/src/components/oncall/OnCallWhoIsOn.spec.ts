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

import OnCallWhoIsOn from "@/components/oncall/OnCallWhoIsOn.vue";
import i18n from "@/locales";
import type { DeliveryRecord, OnCallPosition } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: `<span>{{ value }}</span>` },
  OUserCell: { name: "OUserCell", props: ["value"], template: `<span>{{ value }}</span>` },
  ODescriptionList: { name: "ODescriptionList", template: "<dl><slot /></dl>" },
  ODescriptionItem: {
    name: "ODescriptionItem",
    props: ["label"],
    template: "<div><dt>{{ label }}</dt><dd><slot /></dd></div>",
  },
};

function delivery(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    kind: "delivery",
    at: 1,
    actor: "o2-engine",
    body: "email",
    channel: "email",
    ...overrides,
  } as DeliveryRecord;
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallWhoIsOn, {
    props: { positions: [] as OnCallPosition[], deliveries: [], ...props },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallWhoIsOn", () => {
  /// A team with nothing resolving is the failure this card exists to surface,
  /// not an empty card.
  it("says plainly when the schedule resolves to nobody", () => {
    expect(render().find('[data-test="oncall-who-is-on-nobody"]').exists()).toBe(true);
  });

  /// **There is no default slot to look up.** The response is ordered by the
  /// schedule and every entry is an ordinary rotation, so "on call now" is the
  /// first one listed — and every other row is labelled with the rotation that
  /// produced it rather than with a role word two screens could disagree about.
  it("names each row after the rotation that produced it", () => {
    const wrapper = render({
      positions: [
        { rotation_id: "rot_primary", rotation_name: "Primary", rule: "weekly", user_email: "ana@o2.ai" },
        { rotation_id: "rot_db", rotation_name: "Database", rule: "weekly", user_email: "bo@o2.ai" },
      ],
    });
    const rows = wrapper.findAll("dd");
    expect(rows[0].text()).toContain("ana@o2.ai");
    expect(wrapper.text()).toContain("bo@o2.ai");
    expect(wrapper.text()).toContain("Database");
  });

  /// This page's own sends, never the team's general reachability — the two
  /// answer different questions and would contradict the ledger below.
  it("marks who this page reached and who it did not", () => {
    const wrapper = render({
      positions: [
        { rotation_id: "rot_primary", rotation_name: "Primary", rule: "weekly", user_email: "ana@o2.ai" },
        { rotation_id: "rot_secondary", rotation_name: "Secondary", rule: "weekly", user_email: "bo@o2.ai" },
      ],
      deliveries: [
        delivery({ recipient: "ana@o2.ai", delivered: false }),
        delivery({ recipient: "bo@o2.ai", delivered: true }),
      ],
    });

    expect(wrapper.find('[data-test="oncall-who-is-on-primary-reach"]').text()).toBe("unreached");
    expect(wrapper.find('[data-test="oncall-who-is-on-reach-bo@o2.ai"]').text()).toBe("reached");
  });

  /// One landed send is enough: a retry that failed after a message arrived
  /// does not un-reach the person.
  it("counts a person as reached if any send to them landed", () => {
    const wrapper = render({
      positions: [{ rotation_id: "rot_primary", rotation_name: "Primary", rule: "weekly", user_email: "ana@o2.ai" }],
      deliveries: [
        delivery({ recipient: "ana@o2.ai", delivered: false }),
        delivery({ recipient: "ana@o2.ai", delivered: true }),
      ],
    });
    expect(wrapper.find('[data-test="oncall-who-is-on-primary-reach"]').text()).toBe("reached");
  });

  it("says nothing about somebody this page never tried", () => {
    const wrapper = render({
      positions: [{ rotation_id: "rot_primary", rotation_name: "Primary", rule: "weekly", user_email: "ana@o2.ai" }],
    });
    expect(wrapper.find('[data-test="oncall-who-is-on-primary-reach"]').exists()).toBe(false);
  });

  /// `next_user_email` used to draw its own "Up next" row, which named the
  /// same person the Handover row already does — a second copy of one fact,
  /// not a second fact. The roster stays a single row per rotation either way.
  it("does not draw a separate row for the rotation's next holder", () => {
    const wrapper = render({
      positions: [
        {
          rotation_id: "rot_primary",
          rotation_name: "Primary",
          rule: "weekly",
          user_email: "ana@o2.ai",
          next_user_email: "cy@o2.ai",
        },
      ],
    });
    expect(wrapper.text()).not.toContain("Up next");
    expect(wrapper.findAll("dd").filter((d) => d.text().includes("cy@o2.ai"))).toHaveLength(0);
  });

  /// Handover is one row — who, and how long until they have it — not the
  /// person's name beside a separate "Up next" line naming them again.
  it("says when the pager changes hands, and to whom", () => {
    // A few minutes past the exact 5-day mark: the clock ticks between this
    // line and the component's own `useOnCallClock()` read, and landing
    // exactly on the hour boundary would round down to "4d 23h" on the
    // slowest CI runs.
    const fiveDaysMicros = (Date.now() + 5 * 24 * 60 * 60 * 1000 + 60_000) * 1000;
    const wrapper = render({
      positions: [{ rotation_id: "rot_primary", rotation_name: "Primary", rule: "weekly", user_email: "ana@o2.ai" }],
      handoverAt: fiveDaysMicros,
      handoverTo: "yuki@o2.ai",
    });
    expect(wrapper.text()).toContain("yuki@o2.ai");
    expect(wrapper.text()).toContain("(5d)");
  });

  /// A closed record is history. The roster it is given was resolved as of the
  /// moment it closed, so the card has to read as a record of who carried it —
  /// "on call right now" over a name from last Tuesday is a lie the card tells
  /// about a person.
  describe("once the page is closed", () => {
    const closedProps = {
      positions: [{ rotation_id: "rot_primary", rotation_name: "Primary", rule: "weekly", user_email: "ana@o2.ai", next_user_email: "cy@o2.ai" }],
      closedAt: 1_700_000_000_000_000,
    };

    it("speaks about the shift in the past tense", () => {
      const wrapper = render(closedProps);
      expect(wrapper.text()).toContain("On call at the time");
      expect(wrapper.text()).not.toContain("On call right now");
      expect(wrapper.text()).toContain("ana@o2.ai");
    });

    /// The handover row is advice about a pager somebody still has to carry.
    it("drops the handover row", () => {
      const wrapper = render({
        ...closedProps,
        handoverAt: 1_700_000_000_000_000,
        handoverTo: "yuki@o2.ai",
      });
      expect(wrapper.text()).not.toContain("yuki@o2.ai");
      expect(wrapper.text()).not.toContain("Handover");
    });

    /// An unstaffed rotation is an emergency while a page is open and a plain
    /// fact after it closed.
    it("states an empty roster without alarming about it", () => {
      const wrapper = render({ positions: [], closedAt: 1_700_000_000_000_000 });
      const nobody = wrapper.find('[data-test="oncall-who-is-on-nobody"]');
      expect(nobody.text()).toContain("when this page closed");
      expect(nobody.classes()).not.toContain("text-status-error-text");
    });
  });
});
