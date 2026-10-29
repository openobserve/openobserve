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
import type { AnnotationSource } from "@/ts/interfaces/dashboard";
import { buildAnnotationFiltersSql } from "@/utils/dashboard/annotationSources";
import {
  annotationSourceToFormValues,
  formValuesToAnnotationSource,
} from "./AnnotationSourceForm.schema";

const leaf = (column: string, operator: string, value: string, logicalOperator = "AND") => ({
  filterType: "condition" as const,
  column,
  operator,
  value,
  logicalOperator: logicalOperator as "AND" | "OR",
});

const source = (filters: AnnotationSource["filters"]): AnnotationSource => ({
  id: "s1",
  name: "Deploys",
  color: "#5960b2",
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "deploys",
  filters,
  title: "{service}",
});

const FIXTURES: Record<string, AnnotationSource["filters"]> = {
  "backend-written tree (no ids), legacy spellings": {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      leaf("service", "=", "api"),
      leaf("msg", "Contains", "deploy", "OR"),
      {
        filterType: "group",
        logicalOperator: "OR",
        conditions: [leaf("env", "!=", "dev"), leaf("version", "is_not_null", "", "OR")],
      },
    ],
  },
  "tree with client ids and a $variable": {
    groupId: "g-root",
    filterType: "group",
    logicalOperator: "AND",
    conditions: [{ ...leaf("$col", "=", "$service"), id: "c1" }],
  },
  "new operators, list as JSON text": {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      leaf("env", "in", '["prod","stage"]'),
      { ...leaf("msg", "contains", "Err"), case_insensitive: true },
      leaf("path", "re_match", "^/api"),
    ],
  },
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("annotation source filters: untouched sources save unchanged", () => {
  for (const [name, filters] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const stored = JSON.stringify(filters);
      const values = annotationSourceToFormValues(source(JSON.parse(stored)));
      wrapper = mount(FilterBuilder, {
        attachTo: document.body,
        global: { plugins: [i18n] },
        props: { profile: "annotation", modelValue: values.filters, fields: [] },
      });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      expect(JSON.stringify(formValuesToAnnotationSource("s1", values).filters)).toBe(stored);
    });
  }

  it("saves an edited list as JSON text, which loads back as the same list", () => {
    const codec = FILTER_PROFILES.annotation.codec;
    const tree = codec.parse(FIXTURES["new operators, list as JSON text"], { fields: [] });
    const first = tree.items[0] as any;
    tree.items[0] = { ...first, values: ["prod", "qa"] };
    const edited = codec.serialize(tree, { fields: [] }) as any;
    expect(edited.conditions[0].value).toEqual(["prod", "qa"]);
    const values = annotationSourceToFormValues(
      source(FIXTURES["new operators, list as JSON text"]),
    );
    const saved = formValuesToAnnotationSource("s1", { ...values, filters: edited });
    expect((saved.filters.conditions[0] as any).value).toBe('["prod","qa"]');
    const reread = codec.parse(saved.filters, { fields: [] }).items[0] as any;
    expect(reread.values).toEqual(["prod", "qa"]);
  });

  it("builds SQL for every new operator", () => {
    expect(buildAnnotationFiltersSql(FIXTURES["new operators, list as JSON text"])).toBe(
      "env IN ('prod', 'stage') AND str_match_ignore_case(msg, 'Err') AND re_match(path, '^/api')",
    );
    const more = {
      filterType: "group" as const,
      logicalOperator: "AND" as const,
      conditions: [
        leaf("env", "not_in", '["dev"]'),
        leaf("path", "starts_with", "/v1"),
        leaf("file", "ends_with", ".js", "OR"),
        leaf("msg", "re_not_match", "debug"),
        leaf("a", "is_empty", ""),
      ],
    };
    expect(buildAnnotationFiltersSql(more)).toBe(
      "env NOT IN ('dev') AND path LIKE '/v1%' OR file LIKE '%.js' AND re_not_match(msg, 'debug') AND (a IS NULL OR a = '')",
    );
  });

  it("drops a list with no items as a blank row", () => {
    const filters = {
      filterType: "group" as const,
      logicalOperator: "AND" as const,
      conditions: [leaf("env", "in", "[]")],
    };
    expect(buildAnnotationFiltersSql(filters)).toBe("");
  });
});
