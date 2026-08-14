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
import type { TeamOverview } from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OTag: { name: "OTag", props: ["value"], template: "<span>{{ value }}<slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
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
      // Mid-shift, so there is a "left" and a handover ahead.
      anchor_micros: NOW - 2 * 24 * 60 * 60 * 1_000_000,
    },
  ],
};

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
      slots: [{ rotation: "Primary", user_email: "ana@o2.ai", next_user_email: "bob@o2.ai" }],
      schedule,
      policy: { rungs: [] },
      overview: overview(),
      ...over,
    } as any,
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallTeamPulse", () => {
  it("says when the shift started, how much is left and who it hands to", () => {
    const line = render().find('[data-test="oncall-pulse-shift"]').text();

    expect(line).toContain("Since");
    expect(line).toContain("left");
    expect(line).toContain("bob@o2.ai");
  });

  /// A rotation resolving to nobody is the failure the panel exists for.
  it("says nobody is on call when the rotation resolves to no one", () => {
    expect(render({ slots: [] }).find('[data-test="oncall-pulse-nobody"]').exists()).toBe(true);
  });

  /// A one-person rotation has no next: naming the same person as backup would
  /// suggest a second pair of hands that does not exist.
  it("says so when nobody backs the rotation up", () => {
    const wrapper = render({
      slots: [{ rotation: "Primary", user_email: "ana@o2.ai", next_user_email: null }],
    });
    expect(wrapper.find('[data-test="oncall-pulse-no-backup"]').exists()).toBe(true);
  });

  /// The delay AND the wording come from the policy: the second rung is named
  /// by what it targets, never assumed to be "Secondary". `targets` is required
  /// on the wire, so the fixture carries it — a step without one is a shape the
  /// server rejects, and pinning it here would test a policy nobody can save.
  it("reads the backup's paging delay off the policy", () => {
    const wrapper = render({
      policy: {
        rungs: [
          {
            priority: 1,
            steps: [
              { after_micros: 0, targets: [{ kind: "on_call_now" }] },
              { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "next_on_call" }] },
            ],
            channels: [],
          },
        ],
      },
    });
    expect(wrapper.text()).toContain("paged at +5m");
  });

  /// The bug this guards: with a staffed `secondary` slot, the Overview said
  /// "Secondary — mei" (the next primary) while the Schedule tab said
  /// "Secondary → priya" (the slot). Both were right; one word meant two
  /// people. A rung that targets `next_on_call` must say so.
  it("calls the second rung what it targets, not 'Secondary'", () => {
    const wrapper = render({
      slots: [
        { slot: "primary", rotation: "Primary", user_email: "ana@o2.ai", next_user_email: "bo@o2.ai" },
        { slot: "secondary", rotation: "Secondary", user_email: "cy@o2.ai", next_user_email: "dee@o2.ai" },
      ],
      policy: {
        rungs: [
          {
            priority: 1,
            steps: [
              { after_micros: 0, targets: [{ kind: "on_call_now" }] },
              { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "next_on_call" }] },
            ],
            channels: [],
          },
        ],
      },
    });
    const text = wrapper.text();
    expect(text).toContain("Next on call");
    // cy holds the secondary SLOT and this rung does not name it, so cy must
    // not appear as the backup.
    expect(text).not.toContain("cy@o2.ai");
    expect(text).toContain("bo@o2.ai");
  });

  /// One member list; the secondary is DERIVED from it. The offset says which
  /// position, and without it the first question anybody asks is why that
  /// person — but only when it is not 1, because at 1 they literally are next
  /// and the label already says so.
  it("says where a derived secondary came from when the offset is not 1", () => {
    const wrapper = render({
      slots: [
        {
          slot: "primary",
          rotation: "Primary",
          user_email: "ana@o2.ai",
          next_user_email: "bo@o2.ai",
          next_offset: 5,
        },
      ],
      policy: {
        rungs: [
          {
            priority: 1,
            steps: [
              { after_micros: 0, targets: [{ kind: "on_call_now" }] },
              { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "next_on_call" }] },
            ],
            channels: [],
          },
        ],
      },
    });
    expect(wrapper.find('[data-test="oncall-pulse-backup-offset"]').text()).toContain("+5");
  });

  it("stays quiet about an offset of 1, which the label already says", () => {
    const wrapper = render({
      slots: [
        {
          slot: "primary",
          rotation: "Primary",
          user_email: "ana@o2.ai",
          next_user_email: "bo@o2.ai",
          next_offset: 1,
        },
      ],
      policy: {
        rungs: [
          {
            priority: 1,
            steps: [
              { after_micros: 0, targets: [{ kind: "on_call_now" }] },
              { after_micros: 5 * MICROS_PER_MINUTE, targets: [{ kind: "next_on_call" }] },
            ],
            channels: [],
          },
        ],
      },
    });
    expect(wrapper.find('[data-test="oncall-pulse-backup-offset"]').exists()).toBe(false);
  });

  /// The primary slot is named, not guessed at as "the first staffed one" —
  /// a two-slot team returns two, in whatever order the server likes.
  it("shows the primary slot under 'on call now', whatever order the slots arrive in", () => {
    const wrapper = render({
      slots: [
        { slot: "secondary", rotation: "Secondary", user_email: "cy@o2.ai", next_user_email: "dee@o2.ai" },
        { slot: "primary", rotation: "Primary", user_email: "ana@o2.ai", next_user_email: "bo@o2.ai" },
      ],
    });
    expect(wrapper.find('[data-test="oncall-pulse-holder"]').text()).toContain("ana@o2.ai");
  });

  /// The ladder summary is the server's, including the priorities it says wake
  /// nobody — that silence is the finding, not an empty row.
  it("renders the ladder reach the server reported", () => {
    const wrapper = render({
      overview: overview({
        rungs: [
          {
            priority: "P1",
            rungs: 3,
            pages_anyone: true,
            nobody_after_micros: 15 * MICROS_PER_MINUTE,
            ends_with_whole_team: true,
          },
          { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
        ],
      }),
    });

    const p1 = wrapper.find('[data-test="oncall-pulse-reach-p1"]').text();
    expect(p1).toContain("3 rungs");
    expect(p1).toContain("nobody after 15m");
    // P4 is silent, so it belongs to the collapsed summary row rather than a
    // line of its own — five "Pages nobody" lines is one fact stated five times.
    expect(wrapper.find('[data-test="oncall-pulse-reach-silent"]').text()).toContain(
      "Pages nobody",
    );
  });

  /// Four panels share a row and the tallest sets its height, so this one is
  /// capped: every silent priority collapses onto a single trailing line.
  it("collapses every silent priority onto one row", () => {
    const wrapper = render({
      overview: overview({
        rungs: [
          { priority: "P1", rungs: 3, pages_anyone: true, ends_with_whole_team: true },
          { priority: "P2", rungs: 2, pages_anyone: true, ends_with_whole_team: false },
          { priority: "P3", rungs: 1, pages_anyone: true, ends_with_whole_team: false },
          { priority: "P4", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
          { priority: "P5", rungs: 0, pages_anyone: false, ends_with_whole_team: false },
        ],
      }),
    });

    const silent = wrapper.find('[data-test="oncall-pulse-reach-silent"]');
    expect(silent.text()).toContain("P4, P5");
    // Two paging rows plus the silent summary — never one row per priority.
    expect(wrapper.findAll('[data-test^="oncall-pulse-reach-"]')).toHaveLength(3);
  });

  /// Server-computed over the window, which is what makes it safe on a tile.
  it("reports the window's pages and the share acked quickly", () => {
    const wrapper = render({
      overview: overview({
        stats: {
          pages: 24,
          acknowledged: 18,
          acked_under_5m: 16,
          night_pages: 2,
          reached_second_rung: 3,
          reached_final_rung: 1,
        },
        acked_under_5m_percent: 89,
      }),
    });

    expect(wrapper.find('[data-test="oncall-pulse-pages"]').text()).toBe("24");
    expect(wrapper.find('[data-test="oncall-pulse-fast"]').text()).toBe("89%");
    const detail = wrapper.find('[data-test="oncall-pulse-activity"]').text();
    expect(detail).toContain("3 reached rung 2");
    expect(detail).toContain("1 reached the whole team");
    expect(detail).toContain("2 pages overnight");
  });

  it("says plainly when the window had no pages at all", () => {
    expect(render().find('[data-test="oncall-pulse-no-pages"]').exists()).toBe(true);
  });

  /// Whether a page would LAND, per channel, with the server's own reason —
  /// a blocked channel that failed silently is the whole problem.
  it("shows each channel's verdict for whoever is on call", () => {
    const wrapper = render({
      reachability: {
        team_id: "t",
        team_name: "Payments",
        smtp_configured: false,
        reachable: 0,
        total: 1,
        unreachable_members: ["ana@o2.ai"],
        members: [
          {
            user_email: "ana@o2.ai",
            is_org_user: true,
            mailbox_shaped: true,
            deliverable_channels: [],
            configured_but_unverified: [],
            would_a_page_land: false,
            channels: [
              {
                channel: "email",
                deliverable: false,
                configured_but_unverified: false,
                blocked_because: "this deployment has no SMTP transport configured",
              },
            ],
          },
        ],
      },
    });

    const chip = wrapper.find('[data-test="oncall-pulse-channel-email"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("✗");
  });
});
