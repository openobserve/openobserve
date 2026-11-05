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
import { describe, expect, it, vi } from "vitest";

import OnCallEscalationLadder from "@/components/oncall/OnCallEscalationLadder.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type {
  EscalationPreview,
  OnCallPolicy,
  PreviewL0,
  PreviewRecipient,
  Rotation,
  TeamRungSummary,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE } from "@/ts/interfaces/oncall";

vi.mock("@/services/users", () => ({
  default: { orgUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

const stubs = {
  OTag: {
    name: "OTag",
    props: ["variant", "type", "value", "label"],
    template: "<span>{{ label }}<slot /></span>",
  },
  OTooltip: {
    name: "OTooltip",
    props: ["content"],
    template: "<span>{{ content }}<slot name='content' /></span>",
  },
  OTimeline: { name: "OTimeline", template: "<ol><slot /></ol>" },
  OTimelineItem: {
    name: "OTimelineItem",
    props: { label: null, title: null, subtitle: null, variant: null, framed: Boolean },
    template: '<li>{{ label }} {{ title }} {{ subtitle }}<slot name="subtitle" /><slot /></li>',
  },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OButton: {
    name: "OButton",
    props: ["variant", "size"],
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

const rotation: Rotation = {
  id: "rot_1",
  name: "Primary",
  shift_rules: [
    { name: "Base", members: ["ana@o2.ai"], shift_micros: MICROS_PER_MINUTE, anchor_micros: 0 },
  ],
};

const l0 = (over: Partial<PreviewL0> = {}): PreviewL0 => ({
  mode: "gate",
  triage_budget_seconds: 90,
  available: true,
  summary: "The AI SRE triages first. The first level is held for up to 90s.",
  allow_suppress: false,
  allow_promotion: true,
  allow_downgrade: true,
  ...over,
});

const priorities: TeamRungSummary[] = [
  {
    priority: "P1",
    rungs: 3,
    pages_anyone: true,
    nobody_after_micros: 15 * MICROS_PER_MINUTE,
    ends_with_whole_team: true,
    channels: ["email"],
  },
  { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false, channels: [] },
];

const paging = (priority: string, rungs: number): TeamRungSummary => ({
  priority,
  rungs,
  pages_anyone: true,
  nobody_after_micros: 5 * MICROS_PER_MINUTE,
  ends_with_whole_team: false,
  channels: ["email"],
});

/// P2, P3 and P4 run one ladder; P1 runs its own and P5 wakes nobody.
const fivePriorities: TeamRungSummary[] = [
  paging("P1", 3),
  paging("P2", 1),
  paging("P3", 1),
  paging("P4", 1),
  { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false, channels: [] },
];

const oneStep = [{ after_micros: 0, targets: [{ kind: "on_call_now" as const }] }];

const sharedPolicy = {
  id: "p",
  org_id: "o",
  team_id: "t",
  rungs: [
    {
      priority: 1 as const,
      steps: [
        ...oneStep,
        { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "whole_team" as const }] },
      ],
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
      {
        after_micros: 0,
        targets: ["the on-call"],
        recipients: [person()],
        resolves_to_nobody: false,
      },
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
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallEscalationLadder", () => {
  /// A priority missing from the strip is one nobody would think to check.
  it("offers every priority, including the ones that wake nobody", () => {
    const wrapper = render();

    expect(wrapper.find('[data-test="oncall-ladder-priority-p1"]').text()).toContain("1 step");
    expect(wrapper.find('[data-test="oncall-ladder-priority-p4"]').text()).toContain(
      "Pages nobody",
    );
  });

  /// The card folds a repeat into one row, but the chip counts every step, as the policy editor does.
  it("draws one row per configured step, matching the chip's step count", () => {
    const whole = (after: number) => ({
      after_micros: after,
      targets: ["the whole team"],
      recipients: [person()],
      resolves_to_nobody: false,
    });
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the on-call"],
            recipients: [person()],
            resolves_to_nobody: false,
          },
          whole(5 * MICROS_PER_MINUTE),
          whole(15 * MICROS_PER_MINUTE),
        ],
      }),
    });

    expect(wrapper.findAll('[data-test^="oncall-ladder-rung-time-"]')).toHaveLength(3);
    expect(wrapper.find('[data-test="oncall-ladder-priority-p1"]').text()).toContain("3 steps");
    expect(wrapper.find('[data-test="oncall-ladder-rungs"]').text()).not.toContain("repeats");
  });

  /// An unselected priority has no preview, so the policy's steps are counted the same way.
  it("counts an unselected priority's repeated steps from the policy", () => {
    const policy = {
      ...sharedPolicy,
      rungs: sharedPolicy.rungs.map((rung) =>
        rung.priority === 2
          ? {
              ...rung,
              steps: [
                ...oneStep,
                { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "whole_team" as const }] },
                {
                  after_micros: 15 * MICROS_PER_MINUTE,
                  targets: [{ kind: "whole_team" as const }],
                },
              ],
            }
          : rung,
      ),
    };
    const wrapper = render({ priorities: [paging("P1", 2), paging("P2", 3)], policy });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p2"]').text()).toContain("3 steps");
  });

  /// The chips carry the same priority colours the Pages list does.
  it("draws each chip's priority as the shared priority badge", () => {
    const wrapper = render();
    const tag = wrapper
      .find('[data-test="oncall-ladder-priority-p1"]')
      .findComponent({ name: "OTag" });

    expect(tag.props("type")).toBe("alertPriority");
    expect(tag.props("value")).toBe("p1");
  });

  it("names each priority's channels once, on its chip", () => {
    const wrapper = render({
      priorities: [{ ...priorities[0], channels: ["email", "sms", "voice"] }, priorities[1]],
    });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p1"]').text()).toContain(
      "Email, SMS, Voice call · 1 step",
    );
  });

  // S3: two priorities that send differently are two ladders, whatever their steps.
  it("does not fold priorities whose channels differ", () => {
    const policy = {
      ...sharedPolicy,
      rungs: sharedPolicy.rungs.map((rung) =>
        rung.priority === 3 ? { ...rung, channels: ["email" as const, "sms" as const] } : rung,
      ),
    };
    const wrapper = render({ priorities: fivePriorities, policy });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p2-p4"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-ladder-priority-p3"]').exists()).toBe(true);
  });

  it("puts Edit and Send test page on the right of the card header", () => {
    const wrapper = render({ canConfigure: true });
    const header = wrapper.find('[data-test="oncall-ladder-header"]');

    const edit = header.findComponent('[data-test="oncall-policy-edit"]');
    expect(edit.text()).toBe("Edit");
    expect(edit.props("variant")).toBe("outline-primary");
    expect(edit.props("size")).toBe("sm");
    const send = header.findComponent('[data-test="oncall-ladder-send-test"]');
    expect(send.text()).toContain("Send test page");
    expect(send.props("variant")).toBe("outline");
    expect(send.props("size")).toBe("sm");
    expect(edit.element.parentElement?.classList.contains("ms-auto")).toBe(true);
  });

  // A first step that reaches nobody would send nothing, so Send test is not offered.
  it("disables Send test while the first step reaches nobody", () => {
    const wrapper = render({
      canConfigure: true,
      preview: preview({
        rungs: [
          {
            after_micros: 300,
            targets: ["the whole team"],
            recipients: [person()],
            resolves_to_nobody: false,
          },
          { after_micros: 0, targets: ["the on-call"], recipients: [], resolves_to_nobody: true },
        ],
      }),
    });

    expect(
      wrapper.find('[data-test="oncall-ladder-send-test"]').attributes("disabled"),
    ).toBeDefined();
  });

  // The confirm is built from the preview, so a preview still showing the last priority must not be sent from.
  it("disables Send test while the preview is for another priority", () => {
    const wrapper = render({
      canConfigure: true,
      selected: "P2",
      preview: preview({ priority: "P1" }),
    });

    expect(
      wrapper.find('[data-test="oncall-ladder-send-test"]').attributes("disabled"),
    ).toBeDefined();
  });

  // A keyboard or screen-reader user must reach why Send test is off, so the real button stays focusable.
  it("keeps a blocked Send test focusable and describes it by its reason", async () => {
    const { OButton: _button, OTooltip: _tooltip, ...realButton } = stubs;
    const wrapper = mount(OnCallEscalationLadder, {
      props: {
        priorities,
        selected: "P2",
        preview: preview({ priority: "P1" }),
        canConfigure: true,
      },
      global: { plugins: [i18n, store], stubs: realButton },
    });
    const send = wrapper.find('[data-test="oncall-ladder-send-test"]');
    expect(send.attributes("disabled")).toBeUndefined();
    expect(send.attributes("aria-disabled")).toBe("true");
    const reason = wrapper.find(`[id="${send.attributes("aria-describedby")}"]`);
    expect(reason.text()).toBe(String(i18n.global.t("oncall.ladderSendTestBlocked")));
    await send.trigger("click");
    expect(wrapper.emitted("send-test")).toBeUndefined();
  });

  it("offers Send test only to someone who can configure", async () => {
    expect(render().find('[data-test="oncall-ladder-send-test"]').exists()).toBe(false);

    const wrapper = render({ canConfigure: true });
    await wrapper.find('[data-test="oncall-ladder-send-test"]').trigger("click");
    expect(wrapper.emitted("send-test")).toHaveLength(1);
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

  /// A folded tab stays lit whichever priority inside it is selected.
  it("keeps the red finding off the selected chip", () => {
    const wrapper = render({
      selected: "P3",
      priorities: [
        {
          priority: "P3",
          rungs: 0,
          pages_anyone: false,
          ends_with_whole_team: false,
          channels: [],
        },
        {
          priority: "P2",
          rungs: 0,
          pages_anyone: false,
          ends_with_whole_team: false,
          channels: [],
        },
        {
          priority: "P5",
          rungs: 0,
          pages_anyone: false,
          ends_with_whole_team: false,
          channels: [],
        },
      ],
    });
    const variantOf = (priority: string) =>
      wrapper
        .findAllComponents({ name: "OButton" })
        .find((chip) => chip.attributes("data-test") === `oncall-ladder-priority-${priority}`)
        ?.props("variant");

    expect(variantOf("p3")).toBe("outline-primary");
    expect(variantOf("p2")).toBe("outline-destructive");
    // P4–P5 paging nobody is the default, so it is not drawn as a finding.
    expect(variantOf("p5")).toBe("outline");
  });

  /// The card header names the priority and its channels; the chip above already carries the step count.
  it("heads the card with the priority tag and its channel icons", () => {
    const wrapper = render({
      priorities: [{ ...priorities[0], channels: ["email", "sms", "voice"] }, priorities[1]],
    });
    const header = wrapper.find('[data-test="oncall-ladder-header"]');

    expect(
      header
        .findAllComponents({ name: "OTag" })
        .map((tag) => [tag.props("type"), tag.props("value")]),
    ).toEqual([["alertPriority", "p1"]]);
    expect(
      header
        .findAll('[data-test^="oncall-channel-icon-"]')
        .map((icon) => icon.attributes("data-test")),
    ).toEqual([
      "oncall-channel-icon-email",
      "oncall-channel-icon-sms",
      "oncall-channel-icon-voice",
    ]);
  });

  /// Two priorities that both wake nobody are one finding, and the policy is
  /// not needed to know it.
  it("folds the silent priorities together", () => {
    const wrapper = render({
      selected: "P1",
      priorities: [
        {
          priority: "P4",
          rungs: 0,
          pages_anyone: false,
          ends_with_whole_team: false,
          channels: [],
        },
        {
          priority: "P5",
          rungs: 0,
          pages_anyone: false,
          ends_with_whole_team: false,
          channels: [],
        },
      ],
    });

    expect(wrapper.find('[data-test="oncall-ladder-priority-p4-p5"]').text()).toContain(
      "Pages nobody",
    );
  });

  // Channels belong to the priority, so a step row names only the seat and the person in it.
  it("names who sits in the seat, with the seat pill after the name and no channel icons", () => {
    const row = render().find('[data-test="oncall-ladder-rung-0"]');
    const person = row.find('[data-test="oncall-ladder-person-0-ana@o2.ai"]');

    const seat = person
      .findAllComponents({ name: "OTag" })
      .find((tag) => tag.text() === "Whoever is on call");
    expect(seat?.props("variant")).toBe("default-outline");
    expect(person.findComponent({ name: "OAvatar" }).props("value")).toBe("ana@o2.ai");
    expect(row.find('[data-test^="oncall-channel-icon-"]').exists()).toBe(false);
  });

  // The live roster says which seat each person holds, even when one person holds both.
  it("pairs each person with the seat they hold now", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["whoever is on call in Primary", "whoever is on call in Secondary"],
            recipients: [person({ user_email: "bob@o2.ai" }), person({ user_email: "ana@o2.ai" })],
            resolves_to_nobody: false,
          },
        ],
      }),
      onCallNow: [
        { rotation_id: "r1", rotation_name: "Primary", rule: "Base", user_email: "ana@o2.ai" },
        { rotation_id: "r2", rotation_name: "Secondary", rule: "Base", user_email: "bob@o2.ai" },
      ],
    });
    const seatOf = (email: string) =>
      wrapper
        .find(`[data-test="oncall-ladder-person-0-${email}"]`)
        .findAllComponents({ name: "OTag" })
        .map((tag) => tag.text());

    expect(seatOf("ana@o2.ai")).toEqual(["Primary"]);
    expect(seatOf("bob@o2.ai")).toEqual(["Secondary"]);
  });

  /// Six addresses are a wall, not an answer.
  it("stacks a whole-team step's faces and counts the rest", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the whole team"],
            recipients: ["a", "b", "c", "d", "e"].map((x) => person({ user_email: `${x}@o2.ai` })),
            resolves_to_nobody: false,
          },
        ],
      }),
    });
    const people = wrapper.find('[data-test="oncall-ladder-people-0"]');

    expect(wrapper.find('[data-test="oncall-ladder-rung-0"]').text()).toContain("Whole team");
    expect(people.findAllComponents({ name: "OAvatar" })).toHaveLength(3);
    expect(people.text()).toContain("+2");
  });

  // Every face names itself, and the "+N" chip names the people it hides, each with their address.
  it("names a whole-team rung's people in tooltips on the faces and the count", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the whole team"],
            recipients: ["a", "b", "c", "d"].map((x) => person({ user_email: `${x}@o2.ai` })),
            resolves_to_nobody: false,
          },
        ],
      }),
    });

    const people = wrapper.find('[data-test="oncall-ladder-people-0"]');
    expect(people.findAllComponents({ name: "OTooltip" })).toHaveLength(4);
    expect(people.find('[data-test="o-avatar-group-more"]').text()).toContain("d@o2.ai");
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

  /// A ladder that pages the same unreachable people at every level is one
  /// finding, not four identical blocks a reader has to compare by eye.
  it("keeps consecutive rungs that resolve to the same people as separate rows", () => {
    const stale = (afterMicros: number) => ({
      after_micros: afterMicros,
      targets: ["the whole team"],
      recipients: [
        person({ user_email: "a@o2.ai", would_a_page_land: false, deliverable_channels: [] }),
        person({ user_email: "b@o2.ai", would_a_page_land: false, deliverable_channels: [] }),
        person({ user_email: "c@o2.ai", would_a_page_land: false, deliverable_channels: [] }),
      ],
      resolves_to_nobody: false,
    });
    const wrapper = render({
      preview: preview({
        rungs: [
          stale(0),
          stale(5 * MICROS_PER_MINUTE),
          stale(15 * MICROS_PER_MINUTE),
          stale(30 * MICROS_PER_MINUTE),
        ],
      }),
    });

    expect(wrapper.findAll('[data-test^="oncall-ladder-rung-time-"]')).toHaveLength(4);
    const last = wrapper.find(`[data-test="oncall-ladder-rung-${30 * MICROS_PER_MINUTE}"]`);
    expect(last.text()).toContain("3 of 3 unreachable");
    expect(wrapper.text()).not.toContain("repeats until");
  });

  /// A rung that differs from its neighbour — even by one person's
  /// reachability — must not be swallowed into the run around it.
  it("does not fold a rung whose verdict differs from its neighbours", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          {
            after_micros: 0,
            targets: ["the whole team"],
            recipients: [person({ user_email: "a@o2.ai" })],
            resolves_to_nobody: false,
          },
          {
            after_micros: 5 * MICROS_PER_MINUTE,
            targets: ["the whole team"],
            recipients: [
              person({ user_email: "a@o2.ai", would_a_page_land: false, deliverable_channels: [] }),
            ],
            resolves_to_nobody: false,
          },
        ],
      }),
    });

    expect(wrapper.findAll('[data-test^="oncall-ladder-rung-time-"]')).toHaveLength(2);
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
    const times = wrapper
      .findAll('[data-test^="oncall-ladder-rung-time-"]')
      .map((cell) => cell.text());

    expect(times).toEqual(["At once", "After 5 min"]);
    // The ending fires with the last step, so it says "Then" rather than repeat that step's delay.
    expect(wrapper.find('[data-test="oncall-ladder-ends-time"]').text()).toBe("Then");
    for (const cell of wrapper.findAll(
      '[data-test^="oncall-ladder-rung-time-"], [data-test="oncall-ladder-ends-time"]',
    )) {
      expect(cell.classes()).toContain("w-24");
    }
  });

  /// "Level 3 of 3" and "nobody is coming" are the same rung and opposite
  /// situations — the ending says which, in the server's own sentence.
  it("says how the ladder ends", () => {
    const wrapper = render();
    const ending = wrapper.find('[data-test="oncall-ladder-ends"]').text();

    expect(ending).toContain("Nobody else is paged · page shows Nobody answered");
    // The server's long ending sentence is dropped, so the row stays one line.
    expect(ending).not.toContain("escalation ends");
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

    // On hover of the ending, so it stays one line with no ⓘ.
    expect(
      wrapper
        .find('[data-test="oncall-ladder-ends-line"]')
        .findComponent({ name: "OTooltip" })
        .props("content"),
    ).toContain("Platform");
  });

  it("says so when the selected priority pages nobody, in grey for the low-priority default", () => {
    const low = render({ selected: "P4", preview: preview({ pages_anyone: false, rungs: [] }) });
    const lowLine = low.find('[data-test="oncall-ladder-silent"]');
    expect(lowLine.classes()).toContain("text-text-secondary");
    expect(lowLine.text()).toBe("Nobody is paged (default)");

    const high = render({ selected: "P2", preview: preview({ pages_anyone: false, rungs: [] }) });
    expect(high.find('[data-test="oncall-ladder-silent"]').classes()).toContain(
      "text-status-error-text",
    );
  });

  it("offers a way to add a final rung when the ladder runs out", async () => {
    const wrapper = render({ preview: preview({ reaches_nobody: true }), canConfigure: true });
    await wrapper.find('[data-test="oncall-ladder-add-rung"]').trigger("click");

    expect(wrapper.emitted("edit")).toHaveLength(1);
  });

  // Edit is the header button alone; the ladder body is read-only.
  it("does not open Edit from a click on the ladder body", async () => {
    const editor = render({ canConfigure: true });
    const body = editor.find('[data-test="oncall-ladder-body"]');
    expect(body.classes()).not.toContain("cursor-pointer");
    await body.trigger("click");
    expect(editor.emitted("edit")).toBeUndefined();
  });

  // Two people can share a name, so each name on a rung carries its email in a tooltip.
  it("names people on a rung with their email one hover away", () => {
    const wrapper = render();
    const names = wrapper.findAllComponents({ name: "OnCallPersonName" });
    expect(names.length).toBeGreaterThan(0);
    expect(names[0].props("email")).toBe("ana@o2.ai");
    // No display name known, so the tooltip carries the address alone, once.
    expect(names[0].findComponent({ name: "OTooltip" }).text()).toBe("ana@o2.ai");
  });

  it("offers no Add a step to a reader who cannot change the policy", () => {
    const wrapper = render({ preview: preview({ reaches_nobody: true }) });

    expect(wrapper.find('[data-test="oncall-ladder-add-rung"]').exists()).toBe(false);
  });

  /// On a gated priority the rail's first rung is NOT what fires at 0m — the
  /// page is held for the budget first. Drawing the rungs alone showed a
  /// timeline that is not the one that runs.
  it("draws the L0 step with the server's own sentence", () => {
    const wrapper = render({ preview: preview({ l0: l0() }) });
    const step = wrapper.find('[data-test="oncall-ladder-l0-gate"]');

    expect(step.exists()).toBe(true);
    // One line, no chip and no ⓘ.
    expect(step.text()).toBe("AI triage: holds step 1 for up to 90 s to add findings");
    expect(step.findComponent({ name: "OTag" }).exists()).toBe(false);
  });

  /// The deployment's answer beats the policy's: a gate with no agent
  /// reachable does not hold the page, it pages immediately, and a hold drawn
  /// there reads as configured and is wrong.
  it("draws no L0 step when no agent is available, whatever the mode says", () => {
    const wrapper = render({ preview: preview({ l0: l0({ available: false }) }) });

    expect(wrapper.find('[data-test="oncall-ladder-l0-gate"]').exists()).toBe(false);
  });

  /// An older server does not send the field at all, which reads the same as a
  /// deployment with no agent.
  it("draws no L0 step when the preview does not carry one", () => {
    const wrapper = render();

    expect(wrapper.find('[data-test="oncall-ladder-l0-gate"]').exists()).toBe(false);
  });

  /// `mode` arrives resolved for this priority — the P1 invariant is already
  /// applied server-side. Two places deciding what P1 means is how they come
  /// to disagree, so a policy saying otherwise must not win here.
  it("reads the mode off the preview, never off the stored policy", () => {
    const gatedPolicy = {
      ...sharedPolicy,
      l0: {
        mode: { P1: "gate", P2: "gate", P3: "gate", P4: "only" },
        triage_budget_seconds: 90,
        allow_promotion: true,
        max_promotion_steps: 1,
        allow_downgrade: true,
        allow_suppress: false,
      },
    };
    const wrapper = render({
      policy: gatedPolicy,
      preview: preview({ l0: l0({ mode: "parallel" }) }),
    });

    expect(wrapper.find('[data-test="oncall-ladder-l0-parallel"]').text()).toBe(
      "AI triage: alongside step 1",
    );
    expect(wrapper.find('[data-test="oncall-ladder-l0-gate"]').exists()).toBe(false);
  });

  /// A policy minted at create_team, before the team had members, took the
  /// whole-team fallback and nothing revisited it. Rotations plus an
  /// all-whole_team ladder is only ever that bug.
  it("names the stale default ladder when every level pages the whole team", () => {
    const wholeTeam = {
      ...sharedPolicy,
      rungs: sharedPolicy.rungs.map((rung) => ({
        ...rung,
        steps: [{ after_micros: 0, targets: [{ kind: "whole_team" as const }] }],
      })),
    };
    const wrapper = render({ policy: wholeTeam, rotations: [rotation] });

    expect(wrapper.find('[data-test="oncall-ladder-stale-default"]').text()).toContain(
      "created before they existed",
    );
  });

  /// A team with no rotations has nobody but "everyone" to page, so the same
  /// ladder is the only correct one and naming it a bug would be wrong.
  it("says nothing about a whole-team ladder on a team with no rotations", () => {
    const wholeTeam = {
      ...sharedPolicy,
      rungs: sharedPolicy.rungs.map((rung) => ({
        ...rung,
        steps: [{ after_micros: 0, targets: [{ kind: "whole_team" as const }] }],
      })),
    };
    const wrapper = render({ policy: wholeTeam, rotations: [] });

    expect(wrapper.find('[data-test="oncall-ladder-stale-default"]').exists()).toBe(false);
  });

  /// One level naming a rotation means the adoption ran.
  it("says nothing when a level already names a rotation", () => {
    const wrapper = render({ policy: sharedPolicy, rotations: [rotation] });

    expect(wrapper.find('[data-test="oncall-ladder-stale-default"]').exists()).toBe(false);
  });
});
