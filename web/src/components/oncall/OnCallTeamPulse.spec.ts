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

import OnCallTeamPulse from "@/components/oncall/OnCallTeamPulse.vue";
import i18n from "@/locales";
import type { EscalationPreview, PreviewRung, TeamOverview } from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span>{{ content }}</span>" },
  OSeparator: { name: "OSeparator", template: "<hr />" },
  OSpinner: { name: "OSpinner", template: "<span />" },
  OButton: { name: "OButton", template: "<button><slot /></button>" },
};

const NOW = Date.now() * 1000;

const schedule = {
  id: "s",
  org_id: "default",
  team_id: "t",
  timezone: "UTC",
  created_at: 0,
  updated_at: 0,
  rotations: [
    {
      name: "Primary",
      members: ["ana@o2.ai", "bob@o2.ai"],
      shift_micros: MICROS_PER_WEEK,
      // Mid-shift, so there is a handover ahead to name.
      anchor_micros: NOW - 2 * 24 * 60 * 60 * 1_000_000,
    },
  ],
};

function person(email: string, over: Record<string, unknown> = {}) {
  return {
    user_email: email,
    reason: "on call now",
    would_a_page_land: true,
    deliverable_channels: [],
    ...over,
  };
}

function rung(over: Partial<PreviewRung> = {}): PreviewRung {
  return {
    after_micros: 0,
    targets: ["the on-call"],
    recipients: [person("ana@o2.ai")],
    resolves_to_nobody: false,
    ...over,
  } as PreviewRung;
}

function preview(over: Partial<EscalationPreview> = {}): EscalationPreview {
  return {
    team_id: "t",
    team_name: "Payments",
    priority: "P1",
    at: NOW,
    pages_anyone: true,
    channels: [],
    rungs: [
      rung(),
      rung({
        after_micros: 5 * MICROS_PER_MINUTE,
        targets: ["the secondary"],
        recipients: [person("bob@o2.ai")],
      }),
    ],
    ends_with: "Escalation stops.",
    cross_team_moves: [],
    reaches_nobody: false,
    ...over,
  } as EscalationPreview;
}

function overview(over: Partial<TeamOverview> = {}): TeamOverview {
  return {
    team_id: "t",
    team_name: "Payments",
    timezone: "UTC",
    members: 2,
    alerts_assigned: 0,
    ownership_paths: 1,
    covered_now: true,
    on_call_now: ["ana@o2.ai"],
    rungs: [],
    from: NOW - 7 * 24 * 60 * 60 * 1_000_000,
    to: NOW,
    days: 7,
    stats: {
      pages: 0,
      acknowledged: 0,
      acked_under_5m: 0,
      night_pages: 0,
      reached_second_rung: 0,
      reached_final_rung: 0,
    },
    acked_under_5m_percent: 0,
    ...over,
  };
}

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallTeamPulse, {
    props: {
      preview: preview(),
      slots: [{ rotation: "Primary", user_email: "ana@o2.ai", next_user_email: "bob@o2.ai" }],
      schedule,
      overview: overview(),
      ...over,
    } as any,
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallTeamPulse", () => {
  /// The rail IS the ladder: one step per rung, in the order they fire.
  it("draws a step per rung with the delay on the ones that wait", () => {
    const wrapper = render();

    expect(wrapper.find('[data-test="oncall-pulse-rung-0"]').text()).toContain("ana@o2.ai");
    expect(wrapper.find('[data-test="oncall-pulse-rung-0"]').text()).toContain("is paged first");
    expect(wrapper.find('[data-test="oncall-pulse-rung-1"]').text()).toContain("bob@o2.ai");
    expect(wrapper.text()).toContain("+5m");
  });

  /// A rung that wakes a pool has no single face to put on it, so it is named
  /// by what it targets and counted rather than listed.
  it("names the pool and counts it when a rung wakes more than one person", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          rung(),
          rung({
            after_micros: 15 * MICROS_PER_MINUTE,
            targets: ["the whole team"],
            recipients: [person("ana@o2.ai"), person("bob@o2.ai"), person("mei@o2.ai")],
          }),
        ],
      }),
    });

    const step = wrapper.find('[data-test="oncall-pulse-rung-1"]').text();
    expect(step).toContain("The whole team");
    expect(step).toContain("all 3 members");
  });

  /// Where the ladder ends is read against every delay above it, so it rides
  /// the last rung rather than a panel elsewhere.
  it("says how the ladder ends on its last step", () => {
    expect(render().find('[data-test="oncall-pulse-rung-1"]').text()).toContain("then stops");

    const handsOff = render({ preview: preview({ final_action: "notify_default_team" }) });
    expect(handsOff.find('[data-test="oncall-pulse-rung-1"]').text()).toContain("then hands off");
  });

  /// The server's reason is a full sentence, which is a paragraph on a rail —
  /// the rung carries four words, and the sentence is one hover away.
  it("badges the unreachable rung and keeps the server's sentence on hover", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          rung({
            recipients: [
              person("ana@o2.ai", {
                would_a_page_land: false,
                why_not: "no SMTP transport is configured on this deployment",
              }),
            ],
          }),
        ],
      }),
    });

    const mark = wrapper.find('[data-test="oncall-pulse-rung-problem-0"]');
    expect(mark.exists()).toBe(true);
    expect(mark.text()).toContain("email only · no SMTP transport");
    // The stubbed tooltip renders its content, so the sentence is still there.
    expect(mark.text()).toContain("no SMTP transport is configured on this deployment");
  });

  /// A reason the mapping has never seen must not vanish — it falls back to
  /// the sentence rather than to a short word that might be wrong.
  it("keeps an unrecognised reason verbatim", () => {
    const wrapper = render({
      preview: preview({
        rungs: [
          rung({
            recipients: [
              person("ana@o2.ai", { would_a_page_land: false, why_not: "the moon is in the way" }),
            ],
          }),
        ],
      }),
    });

    expect(wrapper.find('[data-test="oncall-pulse-rung-problem-0"]').text()).toContain(
      "the moon is in the way",
    );
  });

  it("keeps the mark off a rung that would reach everybody on it", () => {
    expect(render().find('[data-test="oncall-pulse-rung-problem-0"]').exists()).toBe(false);
  });

  /// A ladder with no rungs at all is the loudest thing this strip can say.
  it("says plainly when a page right now would wake nobody", () => {
    const wrapper = render({ preview: preview({ rungs: [], pages_anyone: false }) });
    expect(wrapper.find('[data-test="oncall-pulse-reaches-nobody"]').exists()).toBe(true);
  });

  /// Every silent priority on one chip: the finding is one fact however many
  /// priorities share it.
  it("names every priority that pages nobody on one chip", () => {
    const wrapper = render({
      overview: overview({
        rungs: [
          { priority: "P1", rungs: 2, pages_anyone: true, ends_with_whole_team: true },
          { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
          { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
        ],
      }),
    });

    const chip = wrapper.find('[data-test="oncall-pulse-silent"]');
    expect(chip.text()).toContain("P4, P5");
    expect(chip.text()).toContain("pages nobody");
  });

  it("draws no silent chip while every priority pages somebody", () => {
    const wrapper = render({
      overview: overview({
        rungs: [{ priority: "P1", rungs: 2, pages_anyone: true, ends_with_whole_team: true }],
      }),
    });
    expect(wrapper.find('[data-test="oncall-pulse-silent"]').exists()).toBe(false);
  });

  /// The countdown and the instant together: "in 5d 10h" is unreadable against
  /// a calendar, and the instant alone hides how far away it is.
  it("says who takes the pager next and when", () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-pulse-handoff"]').text()).toContain("bob@o2.ai");
    expect(wrapper.find('[data-test="oncall-pulse-handoff"]').text()).toContain("in ");
  });

  /// A one-person rotation has no next. Naming the same person again would
  /// suggest a second pair of hands that does not exist.
  it("says so when nothing is scheduled to take the pager", () => {
    const wrapper = render({
      slots: [{ rotation: "Primary", user_email: "ana@o2.ai", next_user_email: null }],
    });
    expect(wrapper.find('[data-test="oncall-pulse-no-handoff"]').exists()).toBe(true);
  });

  it("reports the window's pages and the share acked quickly", () => {
    const wrapper = render({
      overview: overview({
        stats: {
          pages: 6,
          acknowledged: 4,
          acked_under_5m: 0,
          night_pages: 1,
          reached_second_rung: 5,
          reached_final_rung: 4,
        },
        acked_under_5m_percent: 0,
      }),
    });

    expect(wrapper.find('[data-test="oncall-pulse-pages"]').text()).toContain("6 pages");
    expect(wrapper.find('[data-test="oncall-pulse-acked"]').text()).toContain("0% acked < 5m");
    expect(wrapper.find('[data-test="oncall-pulse-reached-final"]').text()).toContain(
      "4 reached the whole team",
    );
  });

  it("says plainly when the window had no pages at all", () => {
    expect(render().find('[data-test="oncall-pulse-no-pages"]').exists()).toBe(true);
  });

  /// The strip reads; the tabs below it edit. Each link says which tab.
  it.each([
    ["oncall-pulse-edit-ladder", "edit-ladder"],
    ["oncall-pulse-open-schedule", "open-schedule"],
    ["oncall-pulse-view-pages", "open-pages"],
  ])("emits %s's errand", async (testId, event) => {
    const wrapper = render();
    await wrapper.find(`[data-test="${testId}"]`).trigger("click");
    expect(wrapper.emitted(event)).toBeTruthy();
  });
});
