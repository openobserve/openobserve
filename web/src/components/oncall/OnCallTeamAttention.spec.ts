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

import OnCallTeamAttention from "@/components/oncall/OnCallTeamAttention.vue";
import i18n from "@/locales";
import type { ConfigRisk, ConfigRisks } from "@/ts/interfaces/oncall";

const stubs = {
  OBanner: { name: "OBanner", template: "<div><slot /><slot name='actions' /></div>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
};

function risk(over: Partial<ConfigRisk> = {}): ConfigRisk {
  return { kind: "priority_pages_nobody", severity: "medium", message: "P4 pages nobody", ...over };
}

function render(risks: ConfigRisks | null, max?: number) {
  return mount(OnCallTeamAttention, {
    props: max === undefined ? { risks } : { risks, max },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallTeamAttention", () => {
  /// A team with no findings must render nothing at all — a banner that is
  /// always present is one nobody reads.
  it("renders nothing when the server reports no risks", () => {
    const wrapper = render({ team_id: "t", horizon_days: 7, total: 0, risks: [] });
    expect(wrapper.find('[data-test="oncall-team-attention"]').exists()).toBe(false);
  });

  it("renders nothing when the risks call failed", () => {
    expect(render(null).find('[data-test="oncall-team-attention"]').exists()).toBe(false);
  });

  /// The messages are finished sentences from the server. Re-wording them here
  /// would let the UI and the engine disagree about what is wrong.
  it("renders the server's message verbatim", () => {
    const wrapper = render({
      team_id: "t",
      horizon_days: 7,
      total: 1,
      risks: [risk({ message: "root@example.com is on the P1 ladder and no page can reach them" })],
    });
    expect(wrapper.text()).toContain("no page can reach them");
  });

  /// "Nobody can be reached at all" has to outrank "this rotation has one
  /// person", whatever order the server returned them in.
  it("puts the severe findings first", () => {
    const wrapper = render({
      team_id: "t",
      horizon_days: 7,
      total: 2,
      risks: [
        risk({ kind: "single_member_rotation", severity: "low", message: "low one" }),
        risk({ kind: "unreachable_on_rung", severity: "high", message: "high one" }),
      ],
    });
    const text = wrapper.text();
    expect(text.indexOf("high one")).toBeLessThan(text.indexOf("low one"));
  });

  /// Each kind routes to the tab that actually repairs it.
  it.each([
    ["priority_pages_nobody", "policy"],
    ["coverage_gap", "schedule"],
    ["ownership_rule_never_matched", "ownership"],
  ])("sends %s to the %s tab", async (kind, tab) => {
    const wrapper = render({ team_id: "t", horizon_days: 7, total: 1, risks: [risk({ kind })] });
    await wrapper.find(`[data-test="oncall-attention-cta-${kind}"]`).trigger("click");

    expect(wrapper.emitted("act")?.[0]).toEqual([tab]);
  });

  /// The server truncates its own list but reports the true total, so a count
  /// describing only what fitted would be a quiet lie.
  it("counts the overflow against the server's total, not the list it sent", () => {
    const wrapper = render(
      {
        team_id: "t",
        horizon_days: 7,
        total: 9,
        risks: [risk({ kind: "a" }), risk({ kind: "b" })],
      },
      2,
    );
    expect(wrapper.find('[data-test="oncall-attention-more"]').text()).toBe("+7 more");
  });
});
