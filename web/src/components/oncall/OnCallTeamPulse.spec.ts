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

  /// "Secondary" is a RUNG, not a role — the delay comes from the policy.
  it("reads the backup's paging delay off the policy", () => {
    const wrapper = render({
      policy: {
        rungs: [
          {
            priority: 1,
            steps: [{ after_micros: 0 }, { after_micros: 5 * MICROS_PER_MINUTE }],
            channels: [],
          },
        ],
      },
    });
    expect(wrapper.text()).toContain("paged at +5m");
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
    expect(wrapper.find('[data-test="oncall-pulse-reach-p4"]').text()).toContain("Pages nobody");
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
