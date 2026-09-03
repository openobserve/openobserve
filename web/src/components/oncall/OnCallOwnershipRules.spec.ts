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
  OTable: {
    name: "OTable",
    props: ["data", "columns", "loading"],
    template: `<div><div v-for="row in data" :key="row.rule_id">
      <slot name="cell-match" :row="row" />
      <slot name="cell-specificity" :row="row" />
      <slot name="cell-caught" :row="row" />
      <slot name="cell-last" :row="row" />
      <slot name="cell-health" :row="row" />
    </div></div>`,
  },
  OEmptyState: { name: "OEmptyState", template: "<div />" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OTimeCell: { name: "OTimeCell", props: ["value"], template: "<span />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OButton: { name: "OButton", template: "<button><slot /></button>" },
};

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

function render(rules: OwnershipRuleStats[] = [rule()]) {
  return mount(OnCallOwnershipRules, {
    props: { rules, aliases: [{ id: "service", display: "Service" }] },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const table = (w: Wrapper) => w.findComponent({ name: "OTable" });
const rows = (w: Wrapper) => table(w).props("data") as OwnershipRuleStats[];
const column = (w: Wrapper, id: string) =>
  (table(w).props("columns") as any[]).find((c) => c.id === id);
/// By data-test, not "the first OTag" — the specificity column renders tags too.
const health = (w: Wrapper, id = "r1") => w.findComponent(`[data-test="oncall-rule-health-${id}"]`);

describe("OnCallOwnershipRules", () => {
  /// Precedence is the whole point of the table: the server breaks ties on
  /// literal prefix length, so the longer rule is consulted first and must be
  /// listed first. Creation order would put them in an order that misleads.
  it("lists the most specific rule first, whatever order it arrived in", () => {
    const wrapper = render([
      // The namespace path is the longer STRING but the weaker claim: sorting
      // on rendered text would put these the wrong way round.
      rule({
        rule_id: "short",
        path: "k8s-namespace=payments",
        dimensions: { "k8s-namespace": "payments" },
      }),
      rule({
        rule_id: "long",
        path: "service=payments-api",
        dimensions: { service: "payments-api" },
      }),
    ]);
    expect(rows(wrapper).map((r) => r.rule_id)).toEqual(["long", "short"]);
  });

  it("numbers rows by that evaluation order, not by arrival", () => {
    const wrapper = render([
      rule({ rule_id: "short", dimensions: { "k8s-namespace": "payments" } }),
      rule({ rule_id: "long", dimensions: { service: "payments-api" } }),
    ]);
    const order = column(wrapper, "order");
    expect(order.accessorFn(rows(wrapper)[0])).toBe(1);
    expect(order.accessorFn(rows(wrapper)[1])).toBe(2);
  });

  /// `k8s-namespace=payments` is how the engine stores it; a person reading a
  /// table wants spaces.
  it("renders the rule spaced for reading, sorted so it is stable", () => {
    const wrapper = render([
      rule({ dimensions: { "k8s-namespace": "payments", "k8s-cluster": "prod" } }),
    ]);
    expect(column(wrapper, "match").accessorFn(rows(wrapper)[0])).toBe(
      "k8s-cluster = prod · k8s-namespace = payments",
    );
  });

  /// "Shadowed" alone does not tell you who to go and talk to.
  it("names the team taking a shadowed rule's pages", () => {
    const wrapper = render([
      rule({
        health: "shadowed",
        shadowed_by: [
          {
            rule_id: "r2",
            team_id: "team_2",
            team_name: "Ledger",
            path: "service=x",
            outcome: "takes it",
          },
        ],
      }),
    ]);
    expect(health(wrapper).text()).toContain("Ledger");
  });

  it("marks a rule that has never matched", () => {
    const wrapper = render([
      rule({ health: "never_used", pages_caught: 0, last_matched_at: null }),
    ]);
    expect(health(wrapper).text()).toContain("Never used");
    expect(health(wrapper).props("variant")).toBe("default-soft");
  });

  it("tones an active rule apart from a shadowed one", () => {
    expect(health(render([rule()])).props("variant")).toBe("success-soft");
    const shadowed = render([
      rule({
        health: "shadowed",
        shadowed_by: [{ rule_id: "r2", team_id: "t", path: "p", outcome: "o" }],
      }),
    ]);
    expect(health(shadowed).props("variant")).toBe("warning-soft");
  });

  it("asks the parent to open the rule editor", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-ownership-add-rule"]').trigger("click");
    expect(wrapper.emitted("add")).toHaveLength(1);
  });

  /// The org screen hosts every team's rules on one table, so a row has to say
  /// where it routes. On a team's own tab the same column would repeat the
  /// page title on every row.
  it("adds a team column only when asked to", () => {
    const org = mount(OnCallOwnershipRules, {
      props: { rules: [rule({ team_name: "Payments" })], showTeam: true },
      global: { plugins: [i18n, store], stubs },
    });
    expect(column(org, "team")).toBeTruthy();
    expect(column(org, "team").accessorFn(rows(org)[0])).toBe("Payments");
    expect(column(render(), "team")).toBeUndefined();
  });

  /// The id is what the rule is actually written against — the honest
  /// fallback when the server sent no display name.
  it("falls back to the team id when the server sent no name", () => {
    const wrapper = mount(OnCallOwnershipRules, {
      props: { rules: [rule({ team_name: null })], showTeam: true },
      global: { plugins: [i18n, store], stubs },
    });
    expect(column(wrapper, "team").accessorFn(rows(wrapper)[0])).toBe("team_1");
  });

  /// A tab strip already names this list; repeating the title inside it reads
  /// as two sections, and the header's Add rule as two ways in.
  it("drops its own title when the host names the section", () => {
    const wrapper = mount(OnCallOwnershipRules, {
      props: { rules: [rule()], showHeader: false },
      global: { plugins: [i18n, store], stubs },
    });
    expect(wrapper.find('[data-test="oncall-ownership-header"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-ownership-add-rule"]').exists()).toBe(false);
  });
});
