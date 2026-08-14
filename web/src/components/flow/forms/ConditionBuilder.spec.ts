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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import i18n from "@/locales";
import ConditionBuilder from "./ConditionBuilder.vue";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => mockToast(...a) }));

// FilterGroup is heavy (and unrelated to this logic); stub it.
vi.mock("@/components/alerts/FilterGroup.vue", () => ({
  default: {
    name: "FilterGroup",
    template: '<div class="filter-group-stub" />',
    props: [
      "streamFields",
      "group",
      "depth",
      "conditionInputWidth",
      "allowCustomColumns",
      "module",
      "namePrefix",
      "indentRem",
    ],
    emits: ["add-condition", "add-group", "remove-group"],
  },
}));

function createWrapper(props: Record<string, any> = {}) {
  return mount(ConditionBuilder, {
    global: { plugins: [i18n] },
    props,
  });
}

describe("ConditionBuilder", () => {
  afterEach(() => vi.clearAllMocks());

  it("seeds an empty V2 group with one blank condition when no initial rule", () => {
    const wrapper = createWrapper();
    const g = (wrapper.vm as any).conditionGroup;
    expect(g.filterType).toBe("group");
    expect(Array.isArray(g.conditions)).toBe(true);
    expect(g.conditions).toHaveLength(1);
    expect(g.conditions[0].column).toBe("");
  });

  it("loads a saved V2 rule as-is", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [{ filterType: "condition", column: "level", operator: "=", value: "error" }],
    };
    const wrapper = createWrapper({ initialConditions: saved });
    const g = (wrapper.vm as any).conditionGroup;
    expect(g.conditions[0].column).toBe("level");
  });

  it("normalizes lowercase operators when normalizeOperators is true", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [{ filterType: "condition", column: "msg", operator: "contains", value: "x" }],
    };
    const wrapper = createWrapper({ initialConditions: saved, normalizeOperators: true });
    expect((wrapper.vm as any).conditionGroup.conditions[0].operator).toBe("Contains");
  });

  it("leaves operators untouched when normalizeOperators is false", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [{ filterType: "condition", column: "msg", operator: "contains", value: "x" }],
    };
    const wrapper = createWrapper({ initialConditions: saved });
    expect((wrapper.vm as any).conditionGroup.conditions[0].operator).toBe("contains");
  });

  it("submit resolves { version, conditions } for a valid rule", async () => {
    const saved = {
      filterType: "group",
      conditions: [{ filterType: "condition", column: "level", operator: "=", value: "error" }],
    };
    const wrapper = createWrapper({ initialConditions: saved });
    const payload = await (wrapper.vm as any).submit();
    expect(payload.version).toBe(2);
    expect(payload.conditions.conditions[0].column).toBe("level");
  });

  // The zod schema now gates the save: an empty/incomplete rule fails
  // validation, so submit() resolves null and the message renders inline under
  // the FilterGroup (the old imperative error toast is gone).
  it("submit resolves null and shows an inline error when the rule is empty", async () => {
    const wrapper = createWrapper({
      initialConditions: {
        filterType: "group",
        conditions: [{ filterType: "condition", column: "", operator: "" }],
      },
    });
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    await flushPromises();
    expect(wrapper.find('[data-test="add-condition-error"]').exists()).toBe(true);
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("passes fields through to FilterGroup as stream-fields", () => {
    const fields = [{ label: "level", value: "level", type: "Utf8" }];
    const wrapper = createWrapper({ fields });
    expect(wrapper.findComponent({ name: "FilterGroup" }).props("streamFields")).toEqual(fields);
  });

  // ── Prop plumbing down to FilterGroup ─────────────────────────────────────
  // Both of these are load-bearing and fail SILENTLY when dropped, which is how
  // #13277 killed custom columns: the select kept rendering, it just stopped
  // being creatable. FilterGroup is stubbed here, so these pin the first hop
  // only — the second hop (FilterGroup -> FilterCondition) is pinned in
  // FilterGroup.spec, and the create behaviour itself in FilterCondition.spec.

  it("renders FilterGroup in FORM MODE (name-prefix=conditions)", () => {
    // Without the prefix, FilterCondition falls out of name-binding and no leaf
    // value ever reaches the form — the whole builder silently stops working.
    const wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "FilterGroup" }).props("namePrefix")).toBe("conditions");
  });

  it("passes allowCustomColumns through to FilterGroup", () => {
    const wrapper = createWrapper({ allowCustomColumns: true });
    expect(wrapper.findComponent({ name: "FilterGroup" }).props("allowCustomColumns")).toBe(true);
  });

  // Note the deliberate asymmetry: FilterGroup/FilterCondition default this to
  // FALSE so alerts never get a creatable column select, but this flow-specific
  // wrapper defaults it to TRUE — both of its consumers (pipeline + workflow
  // Condition nodes) want custom columns, and the pipeline drawer's guidelines
  // tell users to type one and press Enter.
  it("defaults allowCustomColumns to true (flow nodes want custom columns)", () => {
    const wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "FilterGroup" }).props("allowCustomColumns")).toBe(true);
  });

  it("still honours an explicit opt-out", () => {
    const wrapper = createWrapper({ allowCustomColumns: false });
    expect(wrapper.findComponent({ name: "FilterGroup" }).props("allowCustomColumns")).toBe(false);
  });
  // ── Ported from pipeline Condition.spec ───────────────────────────────────
  // These behaviours moved here when pipelines and workflows were put back on
  // this one shared body; the drawer spec now only covers its own chrome.

  it("loads the V1-backend AND format", () => {
    const wrapper = createWrapper({
      initialConditions: {
        and: [{ column: "level", operator: "=", value: "error" }],
      },
    });
    const g = (wrapper.vm as any).conditionGroup;
    expect(g.filterType).toBe("group");
    expect(g.logicalOperator).toBe("AND");
  });

  it("loads the V1-backend OR format", () => {
    const wrapper = createWrapper({
      initialConditions: {
        or: [{ column: "level", operator: "=", value: "error" }],
      },
    });
    expect((wrapper.vm as any).conditionGroup.logicalOperator).toBe("OR");
  });

  it("updates the group when FilterGroup emits add-condition", async () => {
    const wrapper = createWrapper();
    const root = (wrapper.vm as any).conditionGroup;
    const updated = {
      ...JSON.parse(JSON.stringify(root)),
      logicalOperator: "OR",
    };
    await wrapper.findComponent({ name: "FilterGroup" }).vm.$emit("add-condition", updated);
    expect((wrapper.vm as any).conditionGroup.logicalOperator).toBe("OR");
  });

  // ── Schema validation matrix (was the drawer's "blocks submit" suite) ─────
  const rule = (c: any) => ({
    filterType: "group",
    logicalOperator: "AND",
    groupId: "g1",
    conditions: Array.isArray(c) ? c : [c],
  });
  const cond = (o: any) => ({ filterType: "condition", id: "c1", ...o });

  it.each([
    ["an empty conditions array", rule([])],
    ["an empty column", cond({ column: "", operator: "=", value: "x" })],
    ["an empty operator", cond({ column: "lvl", operator: "", value: "x" })],
    ["a column but no value", cond({ column: "lvl", operator: "=", value: "" })],
  ])("blocks submit for %s", async (_label, c: any) => {
    const wrapper = createWrapper({
      initialConditions: Array.isArray(c?.conditions) ? c : rule(c),
    });
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
  });

  it("blocks submit when ANY of several conditions is incomplete", async () => {
    const wrapper = createWrapper({
      initialConditions: rule([
        cond({ column: "lvl", operator: "=", value: "error" }),
        cond({ column: "svc", operator: "=", value: "" }),
      ]),
    });
    await expect((wrapper.vm as any).submit()).resolves.toBeNull();
  });

  it.each([
    ["an empty-string value", cond({ column: "lvl", operator: "!=", value: '""' })],
    ["a null value", cond({ column: "lvl", operator: "!=", value: "null" })],
  ])("accepts %s as a complete condition", async (_label, c: any) => {
    const wrapper = createWrapper({ initialConditions: rule(c) });
    const payload = await (wrapper.vm as any).submit();
    expect(payload).not.toBeNull();
    expect(payload.version).toBe(2);
  });

  it("accepts a nested group as a valid condition", async () => {
    const wrapper = createWrapper({
      initialConditions: rule({
        filterType: "group",
        logicalOperator: "OR",
        groupId: "g2",
        conditions: [cond({ column: "lvl", operator: "=", value: "warn" })],
      }),
    });
    const payload = await (wrapper.vm as any).submit();
    expect(payload).not.toBeNull();
  });

  it("preserves ignore_case in the returned payload", async () => {
    const wrapper = createWrapper({
      initialConditions: rule(
        cond({ column: "lvl", operator: "=", value: "error", ignore_case: true }),
      ),
    });
    const payload = await (wrapper.vm as any).submit();
    expect(payload.conditions.conditions[0].ignore_case).toBe(true);
  });
});
