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

import OnCallOwnershipRules from "@/components/oncall/OnCallOwnershipRules.vue";
import i18n from "@/locales";
import type { OwnershipRuleStats } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const stubs = {
  OEmptyState: {
    name: "OEmptyState",
    props: ["size", "preset", "filtered", "description"],
    emits: ["action"],
    template: "<div />",
  },
  ODropdown: { name: "ODropdown", template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template: "<button @click=\"$emit('select')\"><slot /></button>",
  },
};

const teams = [
  { id: "team_1", name: "Platform SRE" },
  { id: "team_2", name: "Checkout" },
];

function rule(over: Partial<OwnershipRuleStats> = {}): OwnershipRuleStats {
  return {
    rule_id: "r1",
    team_id: "team_1",
    path: "service=payments-api",
    dimensions: { service: "payments-api" },
    created_at: 0,
    pages_caught: 6,
    last_matched_at: 1_700_000_000_000_000,
    health: "active",
    health_summary: "caught 6 pages",
    shadowed_by: [],
    ...over,
  };
}

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallOwnershipRules, {
    props: { rules: [rule()], teams, aliases: [{ id: "service", display: "Service" }], ...props },
    global: { plugins: [i18n, store], stubs },
  });
}

describe("OnCallOwnershipRules", () => {
  it("reads each rule as a sentence: conditions → team", () => {
    const wrapper = render();
    const says = wrapper.find('[data-test="oncall-routing-says-r1"]').text();
    expect(says).toContain("Alerts from");
    expect(says).toContain("Service");
    expect(says).toContain("payments-api");
    expect(says).toContain("Platform SRE");
  });

  it("says what a rule caught in 30 days, or that it never matched", () => {
    const wrapper = render({
      rules: [rule(), rule({ rule_id: "r2", last_matched_at: null, pages_caught: 0 })],
    });
    expect(wrapper.find('[data-test="oncall-routing-caught-r1"]').text()).toBe(
      "6 pages in 30 days",
    );
    expect(wrapper.find('[data-test="oncall-routing-caught-r2"]').text()).toBe("Never matched yet");
  });

  it("reads a trailing * as starts with, not a literal star", () => {
    const wrapper = render({ rules: [rule({ dimensions: { service: "checkout-*" } })] });
    const says = wrapper.find('[data-test="oncall-routing-says-r1"]').text();
    expect(says).toContain("Service starts with");
    expect(says).toContain("checkout-");
    expect(says).not.toContain("*");
  });

  it("groups the org list by team, alphabetically", () => {
    const wrapper = render({
      rules: [rule(), rule({ rule_id: "r2", team_id: "team_2", dimensions: { service: "cart" } })],
    });
    const groups = wrapper.findAll('[data-test^="oncall-rule-group-"]');
    expect(groups.map((g) => g.attributes("data-test"))).toEqual([
      "oncall-rule-group-team_2",
      "oncall-rule-group-team_1",
    ]);
    expect(groups[0].text()).toContain("Checkout");
  });

  it("filters to one team on a team's tab, with no team heading", () => {
    const wrapper = render({
      teamId: "team_1",
      rules: [rule(), rule({ rule_id: "r2", team_id: "team_2" })],
    });
    expect(wrapper.find('[data-test="oncall-routing-row-r1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-routing-row-r2"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-rule-group-team_1"]').text()).not.toMatch(
      /^Platform SRE/,
    );
  });

  it("keeps delete behind the more menu, never as a row button", async () => {
    const wrapper = render();
    const remove = wrapper.find('[data-test="oncall-ownership-delete-r1"]');
    expect(remove.exists()).toBe(true);
    await remove.trigger("click");
    expect(wrapper.emitted("remove")?.[0]).toEqual([rule()]);
    await wrapper.find('[data-test="oncall-routing-edit-r1"]').trigger("click");
    expect(wrapper.emitted("edit")?.[0]).toEqual([rule()]);
  });

  it("pins the catch-all as the last row on the org list", async () => {
    const wrapper = render({ defaultTeamId: "team_2" });
    const row = wrapper.find('[data-test="oncall-routing-catch-all"]');
    expect(row.text()).toContain("Everything else");
    expect(row.text()).toContain("Checkout");
    await wrapper.find('[data-test="oncall-routing-catch-all-set"]').trigger("click");
    expect(wrapper.emitted("change-default")).toHaveLength(1);
  });

  it("warns when the org has no catch-all", () => {
    const wrapper = render({ defaultTeamId: null });
    expect(wrapper.find('[data-test="oncall-routing-catch-all-team"]').text()).toBe(
      "Everything else pages nobody",
    );
  });

  it("shows the catch-all line on a team's tab only when that team is the default", () => {
    const own = render({ teamId: "team_1", defaultTeamId: "team_1" });
    expect(own.find('[data-test="oncall-routing-catch-all"]').text()).toContain(
      "Also gets every alert no team owns",
    );
    expect(own.find('[data-test="oncall-routing-catch-all-set"]').attributes("aria-label")).toBe(
      "Change in Routing",
    );
    const other = render({ teamId: "team_1", defaultTeamId: "team_2" });
    expect(other.find('[data-test="oncall-routing-catch-all"]').exists()).toBe(false);
  });

  it("names the team taking a shadowed rule's pages", () => {
    const wrapper = render({
      rules: [
        rule({
          health: "shadowed",
          shadowed_by: [
            {
              rule_id: "r9",
              team_id: "team_2",
              team_name: "Checkout",
              path: "service=payments-api/k8s-cluster=prod",
              outcome: "",
            },
          ] as OwnershipRuleStats["shadowed_by"],
        }),
      ],
    });
    expect(wrapper.find('[data-test="oncall-routing-note-r1"]').text()).toContain("Checkout");
    const types = wrapper.findAllComponents({ name: "OTag" }).map((tag) => tag.props("type"));
    expect(types).toContain("oncallRuleHealth");
  });

  it("filters by search on conditions and team name", () => {
    const wrapper = render({
      search: "checkout",
      rules: [rule(), rule({ rule_id: "r2", team_id: "team_2", dimensions: { service: "cart" } })],
    });
    expect(wrapper.find('[data-test="oncall-routing-row-r1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-routing-row-r2"]').exists()).toBe(true);
  });

  it("hides row actions for a reader who cannot edit routing", () => {
    const wrapper = render({ editable: false, defaultTeamId: "team_1" });
    expect(wrapper.find('[data-test="oncall-routing-edit-r1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-routing-catch-all-set"]').exists()).toBe(false);
  });
});
