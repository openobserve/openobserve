// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import { FILTER_PROFILES } from "@/components/filterBar/filterProfiles";
import {
  buildJobFilterConditionPayload,
  buildOptionalJobConditionPayload,
  isJobFilterComplete,
  normalizeJobFilterCondition,
} from "./jobFilter";

const leaf = (column: string, operator: string, value: unknown, logicalOperator = "AND") => ({
  filterType: "condition",
  column,
  operator,
  value,
  values: [],
  logicalOperator,
});

const FIXTURES: Record<string, unknown> = {
  "match everything": { type: "all" },
  "V2 envelope with a nested group": {
    version: 2,
    conditions: {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        leaf("service.name", "=", "checkout"),
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [leaf("duration", ">", 100), leaf("span_name", "Contains", "llm", "OR")],
        },
      ],
    },
  },
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("eval job filters: untouched filters save unchanged", () => {
  for (const [name, saved] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const stored = JSON.stringify(saved);
      const group = normalizeJobFilterCondition(JSON.parse(stored));
      wrapper = mount(FilterBuilder, {
        attachTo: document.body,
        global: { plugins: [i18n] },
        props: { profile: "eval", modelValue: group, fields: [] },
      });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      expect(JSON.stringify(buildJobFilterConditionPayload(group))).toBe(stored);
    });
  }

  it("keeps a new operator and case_insensitive through the save cleanup", () => {
    const codec = FILTER_PROFILES.eval.codec;
    const tree = codec.parse(null, { fields: [] });
    tree.items = [
      {
        kind: "condition",
        id: "a",
        connector: "AND",
        field: "env",
        operator: "in",
        values: ["a", "b"],
      },
      {
        kind: "condition",
        id: "b",
        connector: "OR",
        field: "msg",
        operator: "contains_ci",
        values: ["Err"],
      },
    ];
    const group = codec.serialize(tree, { fields: [] }) as any;
    expect(isJobFilterComplete(group)).toBe(true);
    expect(buildOptionalJobConditionPayload(group)).toEqual({
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "env",
            operator: "in",
            value: ["a", "b"],
            values: [],
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "msg",
            operator: "Contains",
            value: "Err",
            values: [],
            logicalOperator: "OR",
            case_insensitive: true,
          },
        ],
      },
    });
  });

  it("treats an empty list as unfinished", () => {
    const group = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [leaf("env", "in", [])],
    };
    expect(isJobFilterComplete(group)).toBe(false);
    expect(buildOptionalJobConditionPayload(group as any)).toBeNull();
  });
});
