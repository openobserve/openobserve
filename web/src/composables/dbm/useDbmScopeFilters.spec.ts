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

/**
 * The rule this composable exists to make structural: a dimension may not
 * reach the REQUEST unless the same page also offers a clearable control for
 * it. `filters` and `requestParams` are derived from the same refs, so the
 * applied-but-invisible state is unrepresentable rather than merely avoided.
 */

import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

import { useDbmScopeFilters, type DbmScopeFiltersOptions } from "./useDbmScopeFilters";

/**
 * The composable calls `useI18nTyped`, so it needs a component instance. This
 * mounts a throwaway one and hands back what the composable returned.
 */
const setup = (options: Partial<DbmScopeFiltersOptions> = {}) => {
  let api!: ReturnType<typeof useDbmScopeFilters>;
  mount(
    defineComponent({
      setup() {
        api = useDbmScopeFilters({
          query: {},
          options: () => ({}),
          apply: () => {},
          ...options,
        });
        return () => null;
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return api;
};

describe("useDbmScopeFilters seeding", () => {
  it("seeds every dimension from the URL", () => {
    const { models } = setup({
      query: { system: "postgresql", instance: "orders-db", namespace: "public" },
    });

    expect(models.system.value).toBe("postgresql");
    expect(models.instance.value).toBe("orders-db");
    expect(models.namespace.value).toBe("public");
  });

  it("treats a missing or empty param as unset", () => {
    const { models } = setup({ query: { system: "", instance: undefined } });

    expect(models.system.value).toBeNull();
    expect(models.instance.value).toBeNull();
  });

  /**
   * A repeated query param arrives as an array. Taking the first would apply
   * HALF of what the URL said, under a chip claiming the whole of it — so an
   * ambiguous scope reads as no scope.
   */
  it("refuses an ambiguous repeated param rather than applying half of it", () => {
    const { models } = setup({ query: { system: ["postgresql", "mysql"] } });

    expect(models.system.value).toBeNull();
  });
});

describe("useDbmScopeFilters request params", () => {
  it("sends only the dimensions that are set", () => {
    const { requestParams } = setup({ query: { system: "mysql" } });

    expect(requestParams.value).toEqual({ system: "mysql" });
  });

  /**
   * THE invariant. Table health accepts no `namespace`, so one left in the URL
   * by a sibling tab must not reach its request — the select is withheld, and
   * a filter that is not offered must not be applied.
   */
  it("withholds an unaccepted dimension from the request", () => {
    const { requestParams, filters } = setup({
      query: { system: "postgresql", namespace: "public" },
      dimensions: ["instance", "system"],
    });

    expect(requestParams.value).toEqual({ system: "postgresql" });
    expect(requestParams.value).not.toHaveProperty("namespace");
    expect(filters.value.map((f) => f.key)).toEqual(["instance", "system"]);
  });

  /**
   * Every dimension that CAN be sent must have a control. Read the other way
   * round from the test above: this is what makes an invisible filter
   * impossible rather than merely absent today.
   */
  it("offers a control for every dimension it is willing to send", () => {
    const { requestParams, filters } = setup({
      query: { system: "postgresql", instance: "db1", namespace: "public" },
    });

    const offered = new Set(filters.value.map((f) => f.key));
    for (const key of Object.keys(requestParams.value)) {
      expect(offered.has(key)).toBe(true);
    }
  });
});

describe("useDbmScopeFilters URL params", () => {
  /**
   * The URL keeps ALL THREE even where the endpoint takes two: a `namespace`
   * carried in from Blocked queries has to survive a visit to Table health, or
   * stepping through the tabs silently strips the reader's scope.
   */
  it("preserves an unaccepted dimension in the URL", () => {
    const { queryParams } = setup({
      query: { system: "postgresql", namespace: "public" },
      dimensions: ["instance", "system"],
    });

    expect(queryParams.value.namespace).toBe("public");
    expect(queryParams.value.system).toBe("postgresql");
  });

  /** An unset dimension is `undefined`, which a spread over the query clears. */
  it("clears an unset dimension from the URL", () => {
    const { queryParams } = setup({ query: {} });

    expect(queryParams.value).toEqual({
      system: undefined,
      instance: undefined,
      namespace: undefined,
    });
  });
});

describe("useDbmScopeFilters behaviour", () => {
  it("runs the page's apply once per change, after writing the model", () => {
    const apply = vi.fn();
    const { filters, models } = setup({ apply });

    filters.value.find((f) => f.key === "system")?.onChange("mysql");

    expect(models.system.value).toBe("mysql");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  /** Cleared to `null`, never `""` — an empty string is a value on the wire. */
  it("clears a dimension to null rather than an empty string", () => {
    const { filters, models } = setup({ query: { system: "mysql" } });

    filters.value.find((f) => f.key === "system")?.onChange(null);

    expect(models.system.value).toBeNull();
  });

  it("drops every dimension on clear", () => {
    const { models, clear, requestParams } = setup({
      query: { system: "postgresql", instance: "db1", namespace: "public" },
    });

    clear();

    expect(models.system.value).toBeNull();
    expect(models.instance.value).toBeNull();
    expect(models.namespace.value).toBeNull();
    expect(requestParams.value).toEqual({});
  });

  it("reports whether any accepted dimension is set", () => {
    expect(setup({ query: {} }).isScoped.value).toBe(false);
    expect(setup({ query: { system: "mysql" } }).isScoped.value).toBe(true);
    // Set, but on a dimension this endpoint does not accept — so it narrows
    // nothing here and must not claim to.
    expect(
      setup({ query: { namespace: "public" }, dimensions: ["instance", "system"] }).isScoped.value,
    ).toBe(false);
  });

  it("builds its dropdown options from the page's rows, deduplicated", () => {
    const { filters } = setup({
      options: () => ({ system: ["postgresql", "mysql", "postgresql", null, undefined, ""] }),
    });

    expect(filters.value.find((f) => f.key === "system")?.options.map((o) => o.value)).toEqual([
      "postgresql",
      "mysql",
    ]);
  });
});
