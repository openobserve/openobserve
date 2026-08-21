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
import type {
  EscalationPreview,
  OnCallPolicy,
  PreviewRecipient,
  TeamRungSummary,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE } from "@/ts/interfaces/oncall";

const stubs = {
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span>{{ content }}</span>" },
  OTimeline: { name: "OTimeline", template: "<ol><slot /></ol>" },
  OTimelineItem: {
    name: "OTimelineItem",
    props: { label: null, title: null, subtitle: null, variant: null, framed: Boolean },
    template: "<li>{{ label }} {{ title }} {{ subtitle }}<slot /></li>",
  },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OButton: {
    name: "OButton",
    props: ["variant"],
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

const paging = (priority: string, rungs: number): TeamRungSummary => ({
  priority,
  rungs,
  pages_anyone: true,
  nobody_after_micros: 5 * MICROS_PER_MINUTE,
  ends_with_whole_team: false,
});

/// P2, P3 and P4 run one ladder; P1 runs its own and P5 wakes nobody.
const fivePriorities: TeamRungSummary[] = [
  paging("P1", 3),
  paging("P2", 1),
  paging("P3", 1),
  paging("P4", 1),
  { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
];

const oneStep = [{ after_micros: 0, targets: [{ kind: "on_call_now" as const }] }];

const sharedPolicy = {
  id: "p",
  org_id: "o",
  team_id: "t",
  rungs: [
    {
      priority: 1 as const,
      steps: [...oneStep, { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "whole_team" as const }] }],
      channels: ["email" as const],
    },
    { priority: 2 as const, steps: oneStep, channels: ["email" as const] },
    { priority: 3 as const, steps: oneStep, channels: ["email" as const] },
    { priority: 4 as const, steps: oneStep, channels: ["email" as const] },
  ],
} satisfies OnCallPolicy;

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

  /// Four chips describing one ladder are four things to check.
  it("folds consecutive priorities that run the same ladder into one chip", async () => {
    const wrapper = render({ priorities: fivePriorities, policy: sharedPolicy });
    const chip = wrapper.find('[data-test="oncall-ladder-priority-p2-p4"]');

    expect(chip.text()).toContain("P2–P4");
    expect(chip.text()).toContain("same ladder");
    // The one that differs keeps its own chip.
    expect(wrapper.find('[data-test="oncall-ladder-priority-p1"]').exists()).toBe(true);

    await chip.trigger("click");
    expect(wrapper.emitted("update:selected")?.[0]).toEqual(["P2"]);
  });

  /// Without the policy the ladders are UNKNOWN, and "same ladder" would be a
  /// claim nothing on this side can support.
  it("folds nothing when the policy has not been read", () => {
    const wrapper = render({ priorities: fivePriorities });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p2-p4"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-ladder-priority-p3"]').exists()).toBe(true);
  });

  /// A range chip promises every priority inside it. A strip that skips one
  /// must not be folded across the gap.
  it("does not fold across a priority the strip never listed", () => {
    const wrapper = render({
      priorities: [fivePriorities[1], fivePriorities[3]],
      policy: sharedPolicy,
    });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p2-p4"]').exists()).toBe(false);
  });

  /// The chip's own border and text carry the finding when it is red; on the
  /// selected one the finding is already spelled out in full underneath.
  it("keeps the red finding off the selected chip", () => {
    const wrapper = render({
      selected: "P3",
      // Two silent priorities, far enough apart not to fold, so the only
      // difference between the chips is which one is selected.
      priorities: [
        { priority: "P3", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
        { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
      ],
    });
    const variantOf = (priority: string) =>
      wrapper
        .findAllComponents({ name: "OButton" })
        .find((chip) => chip.attributes("data-test") === `oncall-ladder-priority-${priority}`)
        ?.props("variant");

    expect(variantOf("p3")).toBe("outline-primary");
    expect(variantOf("p5")).toBe("outline-destructive");
  });

  /// Two priorities that both wake nobody are one finding, and the policy is
  /// not needed to know it.
  it("folds the silent priorities together", () => {
    const wrapper = render({
      selected: "P1",
      priorities: [
        { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
        { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
      ],
    });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p4-p5"]').text()).toContain(
      "Pages nobody",
    );
  });

  /// The whole point: a policy lists target KINDS, and the question is who
  /// that resolves to right now. One line — the channels that would carry it
  /// are noise until one of them cannot.
  it("names who the rung resolves to, without listing channels", () => {
    const text = render().find('[data-test="oncall-ladder-rung-0"]').text();

    // The engine now NAMES the rotation. "The on-call" was a role word two
    // screens resolved differently, and both were right.
    expect(text).toContain("Whoever is on call");
    expect(text).toContain("right now that is ana@o2.ai");
    expect(text).not.toContain("Email");
  });

  /// Six addresses are a wall, not an answer.
  it("counts the people on a rung once there are more than two", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the whole team"],
            recipients: [
              person({ user_email: "a@o2.ai" }),
              person({ user_email: "b@o2.ai" }),
              person({ user_email: "c@o2.ai" }),
            ],
            resolves_to_nobody: false,
          },
        ],
      }),
    });

    expect(wrapper.text()).toContain("all 3 people right now");
  });

  /// A healthy ladder is read for its SHAPE — nothing about delivery is said
  /// when there is nothing to say.
  it("says nothing about delivery when every page would land", () => {
    const wrapper = render();

    expect(wrapper.find('[data-test="oncall-ladder-rung-problem-0"]').exists()).toBe(false);
  });

  /// The server's reason is a full sentence, which is a paragraph on a rail —
  /// the rung carries four words, and the sentence is one hover away.
  it("badges why a page would not land, keeping the server's sentence on hover", () => {
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

    const badge = wrapper.find('[data-test="oncall-ladder-rung-problem-0"]');
    expect(badge.text()).toContain("email only · no SMTP transport");
    // The stubbed tooltip renders its content, so nothing is lost.
    expect(badge.text()).toContain("this deployment has no SMTP transport configured");
  });

  /// A reason the mapping has never seen must not vanish.
  it("keeps an unrecognised reason verbatim", () => {
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
                why_not: "the moon is in the way",
              }),
            ],
            resolves_to_nobody: false,
          },
        ],
      }),
    });

    expect(wrapper.find('[data-test="oncall-ladder-rung-problem-0"]').text()).toContain(
      "the moon is in the way",
    );
  });

  /// One silent address is easy to miss among names that would land, and the
  /// reason for one of six says nothing about the other five.
  it("counts the unreachable people on a rung with several", () => {
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

  /// A rung that fires and reaches nobody is worse than a slow one: the ladder
  /// moves on and the page stays unanswered.
  it("calls out a rung that resolves to nobody", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [],
            resolves_to_nobody: true,
          },
        ],
      }),
    });

    expect(wrapper.find('[data-test="oncall-ladder-rung-problem-0"]').text()).toContain(
      "Reaches nobody",
    );
  });

  /// The rail carries the axis itself — the delay — and the ending is its last
  /// rung, because when the ladder runs out is what the delays are read against.
  it("puts each rung's delay on the rail, and the ending at its foot", () => {
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

    expect(labels).toEqual(["0m", "+5m", "end"]);
  });

  /// Nothing is firing in a preview — it is what WOULD happen. A loud first
  /// node reads as "this one is live now", which is a different screen.
  it("keeps the whole rail quiet", () => {
    const variants = render()
      .findAllComponents({ name: "OTimelineItem" })
      .map((item) => item.props("variant"));

    expect(new Set(variants)).toEqual(new Set(["muted"]));
  });

  /// "Level 3 of 3" and "nobody is coming" are the same rung and opposite
  /// situations — the ending says which, in the server's own sentence.
  it("says how the ladder ends", () => {
    const wrapper = render();
    const ending = wrapper.find('[data-test="oncall-ladder-ends"]').text();

    expect(ending).toContain("Escalation stops");
    expect(ending).toContain("escalation ends");
  });

  /// A ladder that hands the page on has not stopped, and saying it stopped
  /// would tell somebody nobody is coming when somebody is.
  it("does not say a handed-off ladder stops", () => {
    const wrapper = render({ preview: preview({ final_action: "notify_default_team" }) });

    expect(wrapper.find('[data-test="oncall-ladder-ends"]').text()).toContain("hands off");
  });

  /// How a page can leave this team at all, in the server's words.
  it("keeps the cross-team moves on the ending", () => {
    const wrapper = render({
      preview: preview({ cross_team_moves: ["a responder can hand this to Platform"] }),
    });

    expect(wrapper.find('[data-test="oncall-ladder-move-0"]').text()).toContain("Platform");
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
