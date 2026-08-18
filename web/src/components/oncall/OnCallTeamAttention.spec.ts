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
import type { VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallTeamAttention from "@/components/oncall/OnCallTeamAttention.vue";
import i18n from "@/locales";
import type {
  ConfigRisk,
  ConfigRisks,
  TeamOverview,
  TeamReachability,
} from "@/ts/interfaces/oncall";

const stubs = {
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OTooltip: { name: "OTooltip", template: "<span />" },
};

function risk(over: Partial<ConfigRisk> = {}): ConfigRisk {
  return { kind: "priority_pages_nobody", severity: "medium", message: "P4 pages nobody", ...over };
}

function risks(list: ConfigRisk[], total = list.length): ConfigRisks {
  return { team_id: "t", horizon_days: 7, total, risks: list };
}

/// Only the field this banner reads: whether the deployment can send at all.
function reachability(smtp: boolean): TeamReachability {
  return {
    team_id: "t",
    team_name: "Payments",
    smtp_configured: smtp,
    members: [],
    reachable: 0,
    total: 0,
    unreachable_members: [],
  };
}

/// Only the two fields the evidence line reads: how long the window is and what
/// travelled the ladder inside it.
function overview(pages: number, reachedFinal = 0): TeamOverview {
  return {
    team_id: "t",
    team_name: "Payments",
    timezone: "UTC",
    members: 3,
    alerts_assigned: 6,
    ownership_paths: 2,
    covered_now: true,
    on_call_now: [],
    rungs: [],
    from: 0,
    to: 0,
    days: 7,
    stats: {
      pages,
      acknowledged: 0,
      acked_under_5m: 0,
      night_pages: 0,
      reached_second_rung: 0,
      reached_final_rung: reachedFinal,
    },
    acked_under_5m_percent: 0,
  } as TeamOverview;
}

function render(
  input: ConfigRisks | null,
  extra: {
    reachability?: TeamReachability;
    overview?: TeamOverview;
    checkedAt?: number;
  } = {},
) {
  return mount(OnCallTeamAttention, {
    props: { risks: input, ...extra },
    global: { plugins: [i18n], stubs },
  });
}

/// The card is behind a disclosure, so every test about a row opens it first.
async function open(wrapper: VueWrapper) {
  await wrapper.find('[data-test="oncall-attention-expand"]').trigger("click");
  return wrapper;
}

describe("OnCallTeamAttention", () => {
  /// A team with no findings must render nothing at all — a banner that is
  /// always present is one nobody reads.
  it("renders nothing when the server reports no risks", () => {
    const wrapper = render(risks([]));
    expect(wrapper.find('[data-test="oncall-team-attention"]').exists()).toBe(false);
  });

  it("renders nothing when the risks call failed", () => {
    expect(render(null).find('[data-test="oncall-team-attention"]').exists()).toBe(false);
  });

  /// Collapsed is one line: the worst finding whole, and a count you can open.
  /// Stacking three finished sentences is a paragraph nobody finishes.
  it("shows only the worst finding until it is opened", () => {
    const wrapper = render(
      risks([
        risk({ kind: "single_member_rotation", severity: "low", message: "low one" }),
        risk({ kind: "coverage_gap", severity: "high", message: "high one" }),
      ]),
    );
    expect(wrapper.text()).toContain("high one");
    expect(wrapper.text()).not.toContain("low one");
    expect(wrapper.find('[data-test="oncall-attention-expand"]').text()).toBe("2 findings");
  });

  /// The messages are finished sentences from the server. Re-wording them here
  /// would let the UI and the engine disagree about what is wrong.
  it("renders the server's message verbatim, split at its own clause break", async () => {
    const wrapper = await open(
      render(
        risks([
          risk({
            message: "P4 pages nobody, and 6 alert rules fire at it — those firings open no page",
          }),
        ]),
      ),
    );
    const row = wrapper.find('[data-test="oncall-attention-priority_pages_nobody"]');
    expect(row.text()).toContain("P4 pages nobody, and 6 alert rules fire at it");
    expect(row.text()).toContain("those firings open no page");
  });

  /// A finding is filed by what it costs — a page that will not be delivered, a
  /// page that can run out of people, or configuration that stopped meaning
  /// anything. Severities the server may add later must not fall off the card.
  it("groups findings by what they cost, and files unknown severities as gaps", async () => {
    const wrapper = await open(
      render(
        risks([
          risk({ kind: "coverage_gap", severity: "high", message: "blocking one" }),
          risk({ kind: "single_member_rotation", severity: "low", message: "inert one" }),
          risk({ kind: "slots_can_collide", severity: "brand-new", message: "unknown one" }),
        ]),
      ),
    );
    expect(wrapper.find('[data-test="oncall-attention-group-blocking"]').text()).toContain(
      "blocking one",
    );
    expect(wrapper.find('[data-test="oncall-attention-group-gaps"]').text()).toContain(
      "unknown one",
    );
    expect(wrapper.find('[data-test="oncall-attention-group-inert"]').text()).toContain(
      "inert one",
    );
    // Blocking sorts above gaps, which sorts above what is safe to leave.
    const text = wrapper.text();
    expect(text.indexOf("blocking one")).toBeLessThan(text.indexOf("unknown one"));
    expect(text.indexOf("unknown one")).toBeLessThan(text.indexOf("inert one"));
  });

  /// Each kind routes to the tab that actually repairs it.
  it.each([
    ["priority_pages_nobody", "policy"],
    ["ladder_last_rung_is_not_the_whole_team", "policy"],
    ["coverage_gap", "schedule"],
    ["single_member_rotation", "schedule"],
    ["ownership_rule_never_matched", "ownership"],
  ])("sends %s to the %s tab", async (kind, tab) => {
    const wrapper = await open(render(risks([risk({ kind })])));
    await wrapper.find(`[data-test="oncall-attention-cta-${kind}"]`).trigger("click");

    expect(wrapper.emitted("act")?.[0]).toEqual([tab]);
  });

  /// The button is named for the repair, not the destination — two findings on
  /// one tab still get their own verb.
  it("names the action after the repair", async () => {
    const wrapper = await open(
      render(risks([risk({ kind: "single_member_rotation", severity: "medium" })])),
    );
    expect(wrapper.find('[data-test="oncall-attention-cta-single_member_rotation"]').text()).toBe(
      "Add a member",
    );
  });

  /// I4: with no transport configured, the server reports
  /// `unreachable_on_rung` once per person per priority — eleven printings of
  /// one deployment-level fact. One row, naming who it costs.
  it("states a missing transport once and names who it affects", async () => {
    const wrapper = await open(
      render(
        risks([
          risk({
            kind: "unreachable_on_rung",
            severity: "high",
            message: "ana@o2.ai is on the P1 ladder and no page can reach them — no SMTP",
            user_email: "ana@o2.ai",
          }),
          risk({
            kind: "unreachable_on_rung",
            severity: "high",
            message: "ana@o2.ai is on the P2 ladder and no page can reach them — no SMTP",
            user_email: "ana@o2.ai",
          }),
          risk({
            kind: "unreachable_on_rung",
            severity: "high",
            message: "bo@o2.ai is on the P1 ladder and no page can reach them — no SMTP",
            user_email: "bo@o2.ai",
          }),
        ]),
        { reachability: reachability(false) },
      ),
    );

    const rows = wrapper.findAll('[data-test="oncall-attention-unreachable_on_rung"]');
    expect(rows).toHaveLength(1);
    // The same person on two ladders is one person who cannot be paged.
    expect(rows[0].text()).toContain("2 people affected — ana@o2.ai, bo@o2.ai");
    // Nothing on this screen configures a transport, so there is no CTA to
    // send somebody to a tab where every control is already correct.
    expect(wrapper.find('[data-test="oncall-attention-cta-unreachable_on_rung"]').exists()).toBe(
      false,
    );
    // Folded findings must not come back as an overflow count.
    expect(wrapper.find('[data-test="oncall-attention-hidden"]').exists()).toBe(false);
  });

  /// A transport that exists makes each of these a fact about one person, and
  /// the server's own sentence is what says which person and why.
  it("keeps per-person findings apart when the transport is fine", async () => {
    const wrapper = await open(
      render(
        risks([
          risk({ kind: "unreachable_on_rung", message: "ana has no verified method" }),
          risk({ kind: "unreachable_on_rung", message: "bo is not an org user" }),
        ]),
        { reachability: reachability(true) },
      ),
    );
    const text = wrapper.text();
    expect(text).toContain("ana has no verified method");
    expect(text).toContain("bo is not an org user");
  });

  /// A finding computed from configuration can only say what WOULD happen. What
  /// already did is what decides whether it is urgent.
  it("adds what the window actually cost when the deployment cannot page", async () => {
    const wrapper = await open(
      render(
        risks([
          risk({
            kind: "unreachable_on_rung",
            severity: "high",
            message: "ana@o2.ai is on the P1 ladder and no page can reach them",
            user_email: "ana@o2.ai",
          }),
        ]),
        { reachability: reachability(false), overview: overview(24) },
      ),
    );
    expect(wrapper.find('[data-test="oncall-attention-evidence-unreachable_on_rung"]').text()).toContain(
      "24 pages sent in the last 7 days",
    );
  });

  it("says how often a narrow ladder has already run to its end", async () => {
    const wrapper = await open(
      render(risks([risk({ kind: "ladder_last_rung_is_not_the_whole_team", severity: "medium" })]), {
        overview: overview(24, 2),
      }),
    );
    expect(
      wrapper
        .find('[data-test="oncall-attention-evidence-ladder_last_rung_is_not_the_whole_team"]')
        .text(),
    ).toContain("2 pages reached the final rung in the last 7 days");
  });

  /// A gap that has already opened is described by the schedule itself; only
  /// one still ahead gets a countdown.
  it("counts down a coverage gap that is still ahead", async () => {
    const inTwoDays = (Date.now() + 2 * 24 * 60 * 60 * 1000) * 1000;
    const wrapper = await open(
      render(risks([risk({ kind: "coverage_gap", severity: "medium", at: inTwoDays })])),
    );
    // Matched loosely on purpose: the shared clock ticks under the test, and
    // pinning the exact remainder makes this fail on a slow run, not a bug.
    expect(wrapper.find('[data-test="oncall-attention-evidence-coverage_gap"]').text()).toMatch(
      /^starts in \d+d/,
    );
    const past = await open(
      render(risks([risk({ kind: "coverage_gap", severity: "medium", at: 1 })])),
    );
    expect(past.find('[data-test="oncall-attention-evidence-coverage_gap"]').exists()).toBe(false);
  });

  /// The server truncates its own list but reports the true total, so a count
  /// describing only what fitted would be a quiet lie.
  it("counts against the server's total, not the list it sent", async () => {
    const wrapper = render(risks([risk({ kind: "a" }), risk({ kind: "b" })], 9));
    expect(wrapper.find('[data-test="oncall-attention-expand"]').text()).toBe("9 findings");
    await open(wrapper);
    expect(wrapper.find('[data-test="oncall-attention-hidden"]').text()).toBe("7 more not shown");
  });

  /// The findings are derived, so re-running them is a refetch — and the card
  /// says how old the answer it is showing is.
  it("reports its own freshness and asks for a re-check", async () => {
    const wrapper = await open(
      render(risks([risk()]), { checkedAt: (Date.now() - 5 * 60 * 1000) * 1000 }),
    );
    expect(wrapper.find('[data-test="oncall-attention-checked"]').text()).toBe("checked 5m ago");
    await wrapper.find('[data-test="oncall-attention-recheck"]').trigger("click");
    expect(wrapper.emitted("recheck")).toHaveLength(1);
  });

  it("says nothing about freshness before the first check lands", async () => {
    const wrapper = await open(render(risks([risk()])));
    expect(wrapper.find('[data-test="oncall-attention-checked"]').exists()).toBe(false);
  });
});
