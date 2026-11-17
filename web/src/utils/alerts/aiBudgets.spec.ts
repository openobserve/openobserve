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

import { describe, it, expect } from "vitest";
import {
  budgetAlertPayload,
  budgetAlertUpdate,
  budgetFromAlert,
  budgetMissingField,
  budgetNameTaken,
  budgetReading,
  budgetSpend,
  budgetSql,
  budgetSummarySql,
  formatBudgetUsd,
  budgetState,
  isLegacyBudgetAlert,
  mergeLegacyBudgets,
  spendError,
  warningValue,
  type BudgetDef,
} from "./aiBudgets";
import { agentParentsJoin } from "@/plugins/traces/config/llmInsightsPanels";

const feature: BudgetDef = {
  name: "deep-research-daily",
  scope: "feature",
  value: "deep-research",
  limitUsd: 400,
  period: "day",
  stream: "default",
};

describe("budgets", () => {
  // One named user, apart from the per-user cap ("Each user").
  it("budgets one user on user_id, as one key", () => {
    const vip: BudgetDef = { ...feature, scope: "oneUser", value: "u_42" };
    expect(budgetSql(vip, true)).toContain("WHERE user_id = 'u_42' GROUP BY user_id");
    expect(budgetSql(vip, true)).toContain("THEN user_id END) AS user_id");
    expect(budgetSpend(vip, [{ spent: 12 }])).toMatchObject({ spent: 12, keys: 1 });
    expect(
      budgetFromAlert({
        stream_name: "default",
        context_attributes: {
          budget_name: "vip",
          budget_scope: "oneUser",
          budget_value: "u_42",
          budget_limit_usd: "10",
          budget_period: "day",
        },
      })?.scope,
    ).toBe("oneUser");
  });

  it("groups spend by the scope's column, unaliased, so the SQL multi-alert accepts it", () => {
    const sql = budgetSql(feature, true);
    expect(sql).toMatch(/^SELECT feature_name, SUM\(cost\) AS spent FROM \(/);
    expect(sql).toContain(
      "WHERE feature_name = 'deep-research' GROUP BY feature_name ORDER BY spent DESC",
    );
    const perSession = budgetSql({ ...feature, scope: "session", value: "", period: "hour" }, true);
    expect(perSession).toContain(
      "WHERE gen_ai_conversation_id IS NOT NULL AND gen_ai_conversation_id != '' GROUP BY gen_ai_conversation_id ORDER BY spent DESC",
    );
    expect(perSession).not.toContain("LIMIT");
  });

  // The agent name or user is often only on the root/agent span, the cost on its children.
  it("attributes a trace's whole cost to the value any of its spans carries", () => {
    const agent = budgetSql({ ...feature, scope: "agent", value: "omp" }, true);
    expect(agent).toContain(
      "SELECT trace_id, MAX(CASE WHEN gen_ai_agent_name = 'omp' THEN gen_ai_agent_name END) AS gen_ai_agent_name, COALESCE(",
    );
    expect(agent).toContain(
      `FROM "default"${agentParentsJoin("default", true)} WHERE trace_id IN (SELECT trace_id FROM "default" WHERE gen_ai_agent_name = 'omp') GROUP BY trace_id) WHERE gen_ai_agent_name = 'omp'`,
    );
    // "Each user": a trace goes to the user its spans carry.
    expect(budgetSql({ ...feature, scope: "user", value: "" }, true)).toContain(
      "SELECT trace_id, MAX(user_id) AS user_id, COALESCE(",
    );
    // Over LLM calls only, so an agent span carrying the model does not count its children's cost again.
    const model = budgetSql({ ...feature, scope: "model", value: "gpt-4o" }, true);
    expect(model).not.toContain("SUM(gen_ai_usage_cost)");
    expect(model).toContain("THEN gen_ai_usage_cost ELSE 0 END) AS spent");
    expect(model).toContain("WHERE gen_ai_response_model = 'gpt-4o'");
    expect(model).not.toContain("agent_parents");
  });

  // A stream that stores no parents joins none.
  it("spends a trace's top-level agents when it has no LLM-call cost", () => {
    for (const scope of ["agent", "user", "session", "feature", "oneUser"] as const) {
      const b = { ...feature, scope, value: scope === "user" || scope === "session" ? "" : "v" };
      const sql = budgetSql(b, true);
      expect(sql).toContain("gen_ai_operation_name = 'invoke_agent' AND agent_parent_span IS NULL");
      expect(sql).toContain(`FROM "default"${agentParentsJoin("default", true)}`);
      const flat = budgetSql(b, false);
      expect(flat).toContain(`FROM "default"${agentParentsJoin("default", false)}`);
      expect(flat).not.toContain("reference_parent_span_id");
    }
    const alert = budgetAlertPayload(
      { ...feature, scope: "agent", value: "omp" },
      { folderId: "f", destination: "", owner: "me", timezone: "UTC", hasParentSpan: true },
    );
    expect(alert.query_condition.sql).toBe(
      budgetSql({ ...feature, scope: "agent", value: "omp" }, true),
    );
  });

  it("is one alert, warning at 80% and critical at 100% of each key's spend, readable back", () => {
    const alert = budgetAlertPayload(feature, {
      folderId: "f",
      destination: "litellm-hook",
      owner: "me",
      timezone: "UTC",
      hasParentSpan: true,
    });
    expect(alert.name).toBe("deep-research-daily");
    expect(alert.destinations).toEqual(["litellm-hook"]);
    expect(alert.query_condition.sql).not.toContain("HAVING");
    expect(alert.query_condition.aggregation).toMatchObject({
      having: { column: "spent", operator: ">=", value: 400 },
      warning_value: 320,
      multi_alert: true,
    });
    expect(alert.trigger_condition).toMatchObject({ operator: ">=", threshold: 1, period: 1440 });
    expect(alert.tags).toEqual(["pack:ai-budgets"]);
    expect(budgetFromAlert(alert)).toEqual(feature);
    expect(budgetFromAlert({ stream_name: "default", context_attributes: {} })).toBeNull();
  });

  it("states under, warning and over, and counts each-scope keys over", () => {
    expect(budgetState(100, 400)).toBe("under");
    expect(budgetState(330, 400)).toBe("warning");
    expect(budgetState(412, 400)).toBe("over");
    const eachUser = { ...feature, scope: "user" as const, value: "", limitUsd: 25 };
    const each = budgetSpend(eachUser, [
      { key_count: 240, over_count: 130, spent: 4000, largest: 30 },
    ]);
    expect(each).toEqual({ spent: 4000, over: 130, largest: 30, keys: 240 });
    expect(budgetSpend(eachUser, [])).toEqual({ spent: 0, over: 0, largest: 0, keys: 0 });
  });

  // A per-key budget counts every key, not the first page of them.
  it("summarises a per-key budget over all its keys", () => {
    const sql = budgetSummarySql({ ...feature, scope: "user", value: "", limitUsd: 25 }, true);
    expect(sql).toMatch(
      /^SELECT COUNT\(\*\) AS key_count, SUM\(CASE WHEN spent >= 25 THEN 1 ELSE 0 END\) AS over_count, SUM\(spent\) AS spent, MAX\(spent\) AS largest FROM \(SELECT user_id, SUM\(cost\) AS spent FROM \(/,
    );
    expect(sql).not.toContain("LIMIT");
  });

  // 80% of a sub-cent limit, rounded to 4 decimals, landed on the limit and was refused.
  it("keeps the warning below the limit for sub-cent limits, without float noise", () => {
    expect(warningValue(0.0001)).toBe(0.00008);
    expect(warningValue(0.0002)).toBe(0.00016);
    expect(warningValue(0.3)).toBe(0.24);
    expect(warningValue(400)).toBe(320);
  });

  // A sub-cent spend read "$0.00" next to a "$0.0003" limit.
  it("shows sub-cent amounts with their digits, cents otherwise", () => {
    expect(formatBudgetUsd(0.00044)).toBe("$0.00044");
    expect(formatBudgetUsd(0.0003)).toBe("$0.0003");
    expect(formatBudgetUsd(0)).toBe("$0.00");
    expect(formatBudgetUsd(29.114)).toBe("$29.11");
  });

  // Two alerts of one name both fire and cannot be told apart on the page.
  it("refuses a name another budget already has, as stored", () => {
    const others = [{ name: "omp-day" }, { name: "deep research" }];
    expect(budgetNameTaken(" omp-day ", others)).toBe(true);
    expect(budgetNameTaken("deep_research", others)).toBe(true);
    expect(budgetNameTaken("omp-month", others)).toBe(false);
    expect(budgetNameTaken("  ", others)).toBe(false);
  });

  // A legacy budget's twin alert carries its name; editing the budget must not trip on it.
  it("leaves the edited budget's own name free", () => {
    const others = [{ name: "omp-monthly" }, { name: "omp-monthly" }, { name: "omp-day" }];
    expect(budgetNameTaken("omp-monthly", others, "omp-monthly")).toBe(false);
    expect(budgetNameTaken("omp-day", others, "omp-monthly")).toBe(true);
    expect(budgetNameTaken("omp-monthly", others)).toBe(true);
  });

  // A stream without the scope's column fails the budget's query; the dialog says so instead.
  it("names the scope's column when the stream has not received it", () => {
    const fields = [{ name: "trace_id" }, { name: "gen_ai_agent_name" }, { name: "user_id" }];
    expect(budgetMissingField("agent", fields)).toBeNull();
    expect(budgetMissingField("user", fields)).toBeNull();
    expect(budgetMissingField("oneUser", fields)).toBeNull();
    expect(budgetMissingField("feature", fields)).toBe("feature_name");
    expect(budgetMissingField("session", fields)).toBe("gen_ai_conversation_id");
    expect(budgetMissingField("model", [])).toBe("gen_ai_response_model");
  });

  // Pre-multi-alert budgets have no aggregation, so an edit has nowhere to move the limit.
  it("recognises a legacy two-alert budget and lists its pair once", () => {
    const current = budgetAlertPayload(feature, {
      folderId: "f",
      destination: "",
      owner: "me",
      timezone: "UTC",
      hasParentSpan: true,
    });
    expect(isLegacyBudgetAlert(current)).toBe(false);
    expect(isLegacyBudgetAlert({ ...current, query_condition: { aggregation: null } })).toBe(true);

    const def = (
      alertId: string,
      legacy: boolean,
      name = "omp-monthly",
      over: Partial<typeof feature> = {},
      alertName = `${name}_${alertId}`,
    ) => ({ ...feature, name, legacy, alertIds: [alertId], alertName, ...over });
    const merged = mergeLegacyBudgets([
      def("warn", true),
      def("over", true),
      def("new", false, "omp-day"),
    ]);
    expect(merged.map((d) => d.alertIds)).toEqual([["warn", "over"], ["new"]]);
  });

  // Budgets that reused a name are separate budgets, not one pair.
  it("folds only a true warn/over pair of one budget", () => {
    const def = (id: string, alertName: string, over: Partial<typeof feature> = {}) => ({
      ...feature,
      name: "twin",
      legacy: true,
      alertIds: [id],
      alertName,
      ...over,
    });
    const merged = mergeLegacyBudgets([
      def("a1", "twin_warn", { value: "omp", limitUsd: 10 }),
      def("a2", "twin_over", { value: "omp", limitUsd: 10 }),
      def("b1", "twin2_warn", { value: "research", limitUsd: 500 }),
      def("b2", "twin2_over", { value: "research", limitUsd: 500 }),
      def("c1", "twin_warn", { value: "support", limitUsd: 77 }),
      def("d1", "twin_over", { value: "omp", limitUsd: 11 }),
      def("e1", "twin_warn", { value: "omp", limitUsd: 10 }),
    ]);
    expect(merged.map((d) => d.alertIds)).toEqual([
      ["a1", "a2"],
      ["b1", "b2"],
      ["c1"],
      ["d1"],
      ["e1"],
    ]);
  });

  // A failed or forbidden spend read is unknown: never $0 and never "under".
  it("reads a failed spend query as unknown, telling a missing grant apart", () => {
    expect(spendError({ status: 403 })).toBe("forbidden");
    expect(spendError({ response: { status: 403 } })).toBe("forbidden");
    expect(spendError(new Error("boom"))).toBe("failed");

    const failed = budgetReading(feature, "forbidden");
    expect(failed.error).toBe("forbidden");
    expect(failed.state).toBeNull();
    expect(budgetReading(feature, [])).toMatchObject({ error: null, state: "under" });
  });

  it("moves the limit everywhere it is stored on an edit, keeping the rest of the alert", () => {
    const stored = {
      ...budgetAlertPayload(feature, {
        folderId: "f",
        destination: "old-hook",
        owner: "first@example.com",
        timezone: "Asia/Kolkata",
        hasParentSpan: true,
      }),
      id: "a1",
      enabled: false,
    };
    stored.destinations = ["old-hook", "pager"];
    stored.trigger_condition.frequency = 30;
    const next = budgetAlertUpdate(
      stored,
      { ...feature, limitUsd: 50 },
      {
        destination: "litellm-hook",
        editor: "me@example.com",
        hasParentSpan: true,
      },
    );
    expect(next.query_condition.aggregation.having.value).toBe(50);
    expect(next.query_condition.aggregation.warning_value).toBe(40);
    expect(next.context_attributes.budget_limit_usd).toBe("50");
    expect(budgetFromAlert(next)?.limitUsd).toBe(50);
    expect(next).toMatchObject({
      id: "a1",
      owner: "first@example.com",
      enabled: false,
      last_edited_by: "me@example.com",
      destinations: ["litellm-hook", "pager"],
    });
    // Same period: the schedule set on the alert stays.
    expect(next.trigger_condition).toMatchObject({ frequency: 30, timezone: "Asia/Kolkata" });

    const monthly = budgetAlertUpdate(
      stored,
      { ...feature, period: "month" },
      {
        destination: "",
        editor: "me",
        hasParentSpan: true,
      },
    );
    expect(monthly.trigger_condition.period).toBe(43200);
    expect(monthly.destinations).toEqual(["pager"]);
  });
});
