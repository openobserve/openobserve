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
    props: ["streamFields", "group", "depth", "conditionInputWidth", "allowCustomColumns", "module"],
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
      conditions: [
        { filterType: "condition", column: "level", operator: "=", value: "error" },
      ],
    };
    const wrapper = createWrapper({ initialConditions: saved });
    const g = (wrapper.vm as any).conditionGroup;
    expect(g.conditions[0].column).toBe("level");
  });

  it("normalizes lowercase operators when normalizeOperators is true", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        { filterType: "condition", column: "msg", operator: "contains", value: "x" },
      ],
    };
    const wrapper = createWrapper({ initialConditions: saved, normalizeOperators: true });
    expect((wrapper.vm as any).conditionGroup.conditions[0].operator).toBe("Contains");
  });

  it("leaves operators untouched when normalizeOperators is false", () => {
    const saved = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        { filterType: "condition", column: "msg", operator: "contains", value: "x" },
      ],
    };
    const wrapper = createWrapper({ initialConditions: saved });
    expect((wrapper.vm as any).conditionGroup.conditions[0].operator).toBe("contains");
  });

  it("getPayload returns { version, conditions } for a valid rule", () => {
    const saved = {
      filterType: "group",
      conditions: [
        { filterType: "condition", column: "level", operator: "=", value: "error" },
      ],
    };
    const wrapper = createWrapper({ initialConditions: saved });
    const payload = (wrapper.vm as any).getPayload();
    expect(payload.version).toBe(2);
    expect(payload.conditions.conditions[0].column).toBe("level");
  });

  it("getPayload returns null and toasts when the rule is empty", () => {
    const wrapper = createWrapper({
      initialConditions: {
        filterType: "group",
        conditions: [{ filterType: "condition", column: "", operator: "" }],
      },
    });
    expect((wrapper.vm as any).getPayload()).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    );
  });

  it("passes fields through to FilterGroup as stream-fields", () => {
    const fields = [{ label: "level", value: "level", type: "Utf8" }];
    const wrapper = createWrapper({ fields });
    expect(
      wrapper.findComponent({ name: "FilterGroup" }).props("streamFields"),
    ).toEqual(fields);
  });
});
