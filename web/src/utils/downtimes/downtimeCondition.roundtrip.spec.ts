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
import type { DimensionCondition } from "@/services/downtimes";
import { buildCondition, defaultDowntimeValues } from "./downtimeForm";

const pair = (key: string, value: string, operator: "=" | "!=" = "="): DimensionCondition => ({
  type: "pair",
  key,
  operator,
  value,
});

const FIXTURES: Record<string, DimensionCondition> = {
  "single pair": pair("service", "payments"),
  "AND root with an OR group": {
    type: "group",
    op: "and",
    items: [
      { type: "group", op: "or", items: [pair("service", "a"), pair("service", "b*")] },
      pair("env", "staging", "!="),
    ],
  },
  "OR root": { type: "group", op: "or", items: [pair("host", "db-1"), pair("host", "db-2")] },
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("downtime condition: untouched conditions save unchanged", () => {
  for (const [name, condition] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const stored = JSON.stringify(condition);
      const values = defaultDowntimeValues(Date.parse("2026-10-28T10:00:00Z"), "UTC");
      values.condition_open = true;
      values.condition = JSON.parse(stored);
      wrapper = mount(FilterBuilder, {
        attachTo: document.body,
        global: { plugins: [i18n] },
        props: { profile: "downtime", modelValue: values.condition, fields: [] },
      });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      expect(JSON.stringify(buildCondition(values))).toBe(stored);
      const codec = FILTER_PROFILES.downtime.codec;
      expect(
        JSON.stringify(
          codec.serialize(codec.parse(JSON.parse(stored), { fields: [] }), { fields: [] }),
        ),
      ).toBe(stored);
    });
  }

  it("a new downtime starts with no condition, which the page asks for", () => {
    const values = defaultDowntimeValues(Date.parse("2026-10-28T10:00:00Z"), "UTC");
    expect(values.condition).toBeNull();
    values.condition_open = true;
    expect(buildCondition(values)).toBeUndefined();
  });
});
