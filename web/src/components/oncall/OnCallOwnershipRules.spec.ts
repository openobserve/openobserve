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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallOwnershipRules from "@/components/oncall/OnCallOwnershipRules.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import i18n from "@/locales";
import type { OwnershipRuleStats } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const stubs = {
  OEmptyState: {
    name: "OEmptyState",
    props: ["size", "preset", "filtered", "description", "hideAction"],
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
  /// The server sorts by the engine's own precedence, which ranks a service above a longer-named cluster.
  it("lists rules in the order the server sent, numbered in that order", async () => {
    const wrapper = render({
      rules: [
        rule({ dimensions: { service: "pay" } }),
        rule({
          rule_id: "r2",
          team_id: "team_2",
          dimensions: { "k8s-cluster": "production-us-east" },
        }),
      ],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-ownership-table"]').exists()).toBe(true);
    const rows = wrapper
      .findAll("tbody tr")
      .filter((row) => row.find('[data-test^="oncall-routing-says-"]').exists());
    expect(
      rows.map((row) => [
        row.find('[data-test^="oncall-routing-says-"]').attributes("data-test"),
        row.findAll("td")[0].text(),
      ]),
    ).toEqual([
      ["oncall-routing-says-r1", "1"],
      ["oncall-routing-says-r2", "2"],
    ]);
    expect(wrapper.text()).toContain("Order");
  });

  /// A team's tab is the org list filtered, so a rule keeps the number it has on org Routing.
  it("numbers a team's rules by their place in the org's order", async () => {
    const wrapper = render({
      teamId: "team_1",
      rules: [
        rule({
          rule_id: "r2",
          team_id: "team_2",
          dimensions: { service: "cart", "k8s-namespace": "shop" },
        }),
        rule(),
      ],
    });
    await flushPromises();
    const rows = wrapper
      .findAll("tbody tr")
      .filter((row) => row.find('[data-test^="oncall-routing-says-"]').exists());
    expect(rows).toHaveLength(1);
    expect(rows[0].findAll("td")[0].text()).toBe("2");
  });

  /// "0 - 0 of 0" under an empty team list is a pager with nothing to page.
  it("drops the pager from an empty team list and keeps it on the org list", async () => {
    const team = render({ teamId: "team_9", rules: [rule()] });
    await flushPromises();
    expect(team.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(false);
    const filled = render({ teamId: "team_1", rules: [rule()] });
    await flushPromises();
    expect(filled.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(true);
  });

  /// One wording for the empty list, with no sub-sentence under the title.
  it("shows the empty state with no description override", async () => {
    const wrapper = render({ teamId: "team_9", rules: [] });
    await flushPromises();
    const empty = wrapper.findComponent({ name: "OEmptyState" });
    expect(empty.props("preset")).toBe("no-oncall-rules");
    expect(empty.props("description")).toBeUndefined();
  });

  it("reads the match as chips with sentence-case fields, and a trailing * as starts with", async () => {
    const wrapper = render({
      rules: [rule({ dimensions: { service: "checkout-*", "k8s-namespace": "shop" } })],
    });
    await flushPromises();
    const says = wrapper.find('[data-test="oncall-routing-says-r1"]').text();
    expect(says).toContain("K8s namespace");
    expect(says).toContain("Service starts with");
    expect(says).toContain("checkout-");
    expect(says).not.toContain("*");
  });

  it("names where each rule routes on the org page, and drops that column on a team's tab", async () => {
    const org = render({ rules: [rule(), rule({ rule_id: "r2", team_id: "team_2" })] });
    await flushPromises();
    expect(org.find('[data-test="oncall-rule-team-r2"]').text()).toBe("Checkout");
    const team = render({
      teamId: "team_1",
      rules: [rule(), rule({ rule_id: "r2", team_id: "team_2" })],
    });
    await flushPromises();
    expect(team.find('[data-test="oncall-routing-says-r1"]').exists()).toBe(true);
    expect(team.find('[data-test="oncall-routing-says-r2"]').exists()).toBe(false);
    expect(team.find('[data-test="oncall-rule-team-r1"]').exists()).toBe(false);
  });

  it("counts pages caught and marks a rule that never matched", async () => {
    const wrapper = render({
      rules: [rule(), rule({ rule_id: "r2", last_matched_at: null, pages_caught: 0 })],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-caught-r1"]').text()).toBe("6 pages");
    expect(wrapper.text()).toContain("Never");
  });

  it("colours Health and Specificity through the badge registry", async () => {
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
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-rule-health-r1"]').text()).toContain("Checkout");
    const types = wrapper.findAllComponents(OTag).map((tag) => tag.props("type"));
    expect(types).toContain("oncallRuleHealth");
    expect(types).toContain("dimensionKey");
  });

  it("acts from the row: Edit and a destructive Delete, plus Test routing where hosted", async () => {
    const wrapper = render({ testable: true });
    await flushPromises();
    const remove = wrapper
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "oncall-ownership-delete-r1")!;
    expect(remove.props("variant")).toBe("ghost-destructive");
    await remove.trigger("click");
    expect(wrapper.emitted("remove")?.[0]).toEqual([rule()]);
    await wrapper.find('[data-test="oncall-routing-edit-r1"]').trigger("click");
    expect(wrapper.emitted("edit")?.[0]).toEqual([rule()]);
    await wrapper.find('[data-test="oncall-routing-test-r1"]').trigger("click");
    expect(wrapper.emitted("test")?.[0]).toEqual([rule()]);
  });

  it("states the catch-all under the table on the org list", async () => {
    const wrapper = render({ defaultTeamId: "team_2" });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-catch-all-row"]').exists()).toBe(false);
    const row = wrapper.find('[data-test="oncall-routing-catch-all"]');
    expect(row.text()).toContain("Everything else");
    expect(row.text()).toContain("Checkout");
    await wrapper.find('[data-test="oncall-routing-catch-all-set"]').trigger("click");
    expect(wrapper.emitted("change-default")).toHaveLength(1);
  });

  it("warns when the org has no catch-all", async () => {
    const wrapper = render({ defaultTeamId: null });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-catch-all-team"]').text()).toBe(
      "Everything else pages nobody",
    );
  });

  it("shows the catch-all line on a team's tab only when that team is the default", async () => {
    const own = render({ teamId: "team_1", defaultTeamId: "team_1" });
    await flushPromises();
    expect(own.find('[data-test="oncall-routing-catch-all"]').text()).toContain(
      "Also gets every alert no team owns",
    );
    expect(own.find('[data-test="oncall-routing-catch-all-set"]').text()).toBe("Change in Routing");
    // The team's last rule, so it is the body's last row and never part of the pager.
    const body = own.find('[data-test="o2-table-body"]');
    const rows = body.findAll("tr");
    expect(rows[rows.length - 1].attributes("data-test")).toBe("oncall-routing-catch-all-row");
    expect(own.find('[data-test="o2-table-pagination-note"]').exists()).toBe(false);
    const other = render({ teamId: "team_1", defaultTeamId: "team_2" });
    await flushPromises();
    expect(other.find('[data-test="oncall-routing-catch-all"]').exists()).toBe(false);
  });

  /// The default team with no rule of its own still gets every unowned alert, so that row stands in for an empty table.
  it("keeps the catch-all row on the default team's tab with no rules", async () => {
    const wrapper = render({ rules: [], teamId: "team_1", defaultTeamId: "team_1" });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-catch-all-row"]').exists()).toBe(true);
  });

  it("filters by search on what the cells read", async () => {
    const wrapper = render({
      search: "checkout",
      rules: [rule(), rule({ rule_id: "r2", team_id: "team_2", dimensions: { service: "cart" } })],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-says-r1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-routing-says-r2"]').exists()).toBe(true);
  });

  // A reader who cannot write routing must not reach an editor whose save would only answer 403.
  it("offers no add from the empty state to a reader who cannot edit routing", async () => {
    const readOnly = render({ rules: [], editable: false });
    await flushPromises();
    const empty = readOnly.findComponent({ name: "OEmptyState" });
    expect(empty.props("hideAction")).toBe(true);
    empty.vm.$emit("action", "create");
    expect(readOnly.emitted("add")).toBeUndefined();

    const writer = render({ rules: [] });
    await flushPromises();
    writer.findComponent({ name: "OEmptyState" }).vm.$emit("action", "create");
    expect(writer.emitted("add")).toHaveLength(1);
  });

  it("hides row actions for a reader who cannot edit routing", async () => {
    const wrapper = render({ editable: false, defaultTeamId: "team_1" });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-routing-edit-r1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-routing-catch-all-set"]').exists()).toBe(false);
  });
});
