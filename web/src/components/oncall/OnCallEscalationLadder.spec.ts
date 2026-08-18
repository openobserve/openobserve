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

import OnCallEscalationLadder from "@/components/oncall/OnCallEscalationLadder.vue";
import i18n from "@/locales";
import type { EscalationPreview, PreviewRecipient, TeamRungSummary } from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE } from "@/ts/interfaces/oncall";

const stubs = {
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OTimeline: { name: "OTimeline", template: "<ol><slot /></ol>" },
  OTimelineItem: {
    name: "OTimelineItem",
    props: { label: null, title: null, subtitle: null, variant: null, framed: Boolean },
    template: "<li>{{ label }} {{ title }} {{ subtitle }}<slot /></li>",
  },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

const person = (over: Partial<PreviewRecipient> = {}): PreviewRecipient => ({
  user_email: "ana@o2.ai",
  reason: "you are on call",
  would_a_page_land: true,
  deliverable_channels: ["email"],
  ...over,
});

const priorities: TeamRungSummary[] = [
  {
    priority: "P1",
    rungs: 3,
    pages_anyone: true,
    nobody_after_micros: 15 * MICROS_PER_MINUTE,
    ends_with_whole_team: true,
  },
  { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
];

function preview(over: Partial<EscalationPreview> = {}): EscalationPreview {
  return {
    team_id: "t",
    team_name: "Payments",
    priority: "P1",
    at: 0,
    pages_anyone: true,
    channels: ["email"],
    rungs: [
      { after_micros: 0, targets: ["the on-call"], recipients: [person()], resolves_to_nobody: false },
    ],
    ends_with: "escalation ends",
    cross_team_moves: [],
    reaches_nobody: false,
    ...over,
  };
}

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallEscalationLadder, {
    props: { priorities, selected: "P1", preview: preview(), ...over } as any,
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallEscalationLadder", () => {
  /// A priority missing from the strip is one nobody would think to check.
  it("offers every priority, including the ones that wake nobody", () => {
    const wrapper = render();

    expect(wrapper.find('[data-test="oncall-ladder-priority-p1"]').text()).toContain("3 rungs");
    expect(wrapper.find('[data-test="oncall-ladder-priority-p4"]').text()).toContain(
      "Pages nobody",
    );
  });

  it("asks the caller to switch priority", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-ladder-priority-p4"]').trigger("click");

    expect(wrapper.emitted("update:selected")?.[0]).toEqual(["P4"]);
  });

  /// Red on the filled selected chip fails contrast and is unreadable — and it
  /// is the one priority whose finding is already spelled out underneath.
  it("drops the red finding on the selected chip but keeps it on the others", () => {
    const wrapper = render({
      selected: "P4",
      // Two silent priorities, so the difference is selection and nothing else.
      priorities: [
        { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
        { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
      ],
    });
    const classesOf = (priority: string) =>
      wrapper.find(`[data-test="oncall-ladder-priority-${priority}"] span`).classes();

    expect(classesOf("p4")).not.toContain("text-status-error-text");
    expect(classesOf("p5")).toContain("text-status-error-text");
  });

  /// The whole point: a policy lists target KINDS, and the question is who
  /// that resolves to right now, and on what.
  ///
  /// The per-recipient `reason` is deliberately not shown — it restates the
  /// rung title ("the on-call" / "you are on call") once per person.
  it("names who the rung resolves to, and the channels that would carry it", () => {
    const text = render().find('[data-test="oncall-ladder-rung-0"]').text();

    expect(text).toContain("The on-call");
    expect(text).toContain("Right now that is");
    expect(text).toContain("ana@o2.ai");
    expect(text).toContain("Email");
  });

  /// Never our own guess at why a page failed.
  it("shows the server's reason when a page would not land", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [
              person({
                would_a_page_land: false,
                deliverable_channels: [],
                why_not: "this deployment has no SMTP transport configured",
              }),
            ],
            resolves_to_nobody: false,
          },
        ],
      }),
    });

    expect(wrapper.text()).toContain("no SMTP transport configured");
  });

  /// The rail carries the axis itself — the delay — as the design has it,
  /// which is what lets the rungs line up against each other.
  it("puts each rung's delay on the rail", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [person()],
            resolves_to_nobody: false,
          },
          {
            after_micros: 5 * MICROS_PER_MINUTE,
            targets: ["the next on-call"],
            recipients: [person({ user_email: "b@o2.ai" })],
            resolves_to_nobody: false,
          },
        ],
      }),
    });
    const labels = wrapper
      .findAllComponents({ name: "OTimelineItem" })
      .map((item) => item.props("label"));

    expect(labels).toEqual(["0m", "+5m"]);
  });

  /// The rung firing now is the one somebody is living through; the later ones
  /// are still ahead, so they recede.
  it("gives the rung firing now the loud node and later ones a muted one", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [person()],
            resolves_to_nobody: false,
          },
          {
            after_micros: 5 * MICROS_PER_MINUTE,
            targets: ["the next on-call"],
            recipients: [person({ user_email: "b@o2.ai" })],
            resolves_to_nobody: false,
          },
        ],
      }),
    });
    const variants = wrapper
      .findAllComponents({ name: "OTimelineItem" })
      .map((item) => item.props("variant"));

    expect(variants).toEqual(["destructive", "muted"]);
  });

  /// The rail is the CLOCK, not a health indicator. Colouring it by health
  /// turned every node red on a deployment where nothing can be delivered,
  /// which says the same thing three times and loses the ordering — the state
  /// already has its own badge inside the card.
  it("colours the rail by position, not by whether the rung would land", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [person({ would_a_page_land: false, deliverable_channels: [] })],
            resolves_to_nobody: false,
          },
          {
            after_micros: 5 * MICROS_PER_MINUTE,
            targets: ["the next on-call"],
            recipients: [person({ user_email: "b@o2.ai", would_a_page_land: false, deliverable_channels: [] })],
            resolves_to_nobody: true,
          },
        ],
      }),
    });
    const variants = wrapper
      .findAllComponents({ name: "OTimelineItem" })
      .map((item) => item.props("variant"));

    expect(variants).toEqual(["destructive", "muted"]);
  });

  it("frames each rung so it reads as its own block", () => {
    expect(render().findComponent({ name: "OTimelineItem" }).props("framed")).toBe(true);
  });

  /// "1 of 1 unreachable" says nothing the reason underneath does not say
  /// better; the count earns its place only when people could be missed.
  it("counts unreachable people only when the rung has several", () => {
    const single = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [person({ would_a_page_land: false, deliverable_channels: [] })],
            resolves_to_nobody: false,
          },
        ],
      }),
    });
    expect(single.text()).not.toContain("1 of 1");
  });

  /// One silent address is easy to miss among names that would land.
  it("counts the unreachable people on a whole-team rung", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the whole team"],
            recipients: [
              person({ user_email: "a@o2.ai" }),
              person({ user_email: "b@o2.ai", would_a_page_land: false, deliverable_channels: [] }),
            ],
            resolves_to_nobody: false,
          },
        ],
      }),
    });

    expect(wrapper.text()).toContain("1 of 2 unreachable");
  });

  it("says so when the selected priority pages nobody", () => {
    const wrapper = render({ selected: "P4", preview: preview({ pages_anyone: false, rungs: [] }) });
    expect(wrapper.find('[data-test="oncall-ladder-silent"]').exists()).toBe(true);
  });

  it("offers a way to add a final rung when the ladder runs out", async () => {
    const wrapper = render({ preview: preview({ reaches_nobody: true }) });
    await wrapper.find('[data-test="oncall-ladder-add-rung"]').trigger("click");

    expect(wrapper.emitted("edit")).toHaveLength(1);
  });
});
