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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import QueryFilterBar from "./QueryFilterBar.vue";
import {
  emptyFilterGroup,
  filterTreeToSql,
  type FilterField,
  type FilterGroup,
} from "@/utils/query/filterBar";
import { parseSqlFilter } from "@/utils/query/filterBarParser";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "status", type: "number" },
  { name: "ok", type: "boolean" },
];

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

function mountBar(props: Record<string, unknown> = {}) {
  const state = { tree: (props.modelValue as FilterGroup) ?? emptyFilterGroup() };
  wrapper = mount(QueryFilterBar, {
    attachTo: document.body,
    props: {
      modelValue: state.tree,
      fields,
      loadValues: vi.fn(async () => ["error", "warn", "info"]),
      "onUpdate:modelValue": async (next: FilterGroup) => {
        state.tree = next;
        await wrapper!.setProps({ modelValue: next });
      },
      ...props,
    },
  });
  return state;
}

const sql = (state: { tree: FilterGroup }, list = fields) => filterTreeToSql(state.tree, list);
const input = () =>
  document.body.querySelector<HTMLInputElement>('[data-test="query-filter-bar-input"]');
const rows = () =>
  Array.from(document.body.querySelectorAll('[data-test^="query-filter-bar-suggest-item-"]'));
const rowKeys = () =>
  rows().map((row) => row.getAttribute("data-test")!.replace("query-filter-bar-suggest-item-", ""));
const segment = (field: string, part: string) =>
  wrapper!.find(`[data-test="query-filter-bar-chip-${field}-${part}"]`);

async function type(text: string) {
  const field = input()!;
  field.value = text;
  field.dispatchEvent(new Event("input"));
  await flushPromises();
}

async function press(key: string) {
  input()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await flushPromises();
  await nextTick();
}

async function openBar() {
  await wrapper!.find('[data-test="query-filter-bar-add"]').trigger("click");
  await flushPromises();
}

async function clickRow(key: string) {
  rows()
    .find((row) => row.getAttribute("data-test")!.endsWith(`-item-${key}`))!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
}

async function editPart(field: string, part: string) {
  await segment(field, part).trigger("click");
  await flushPromises();
}

describe("QueryFilterBar", () => {
  it("opens the field list with a search box when the bar is clicked", async () => {
    mountBar();
    await openBar();
    expect(input()).not.toBeNull();
    expect(rowKeys()).toEqual(["level", "status", "ok"]);
    await type("sta");
    expect(rowKeys()).toEqual(["status"]);
  });

  it("builds a chip with the keyboard: field, operator, value, then reopens the field list", async () => {
    const state = mountBar();
    await openBar();
    await type("lev");
    await press("Enter");
    expect(rowKeys()[0]).toBe("eq");
    await press("Enter");
    await vi.waitFor(() => expect(rowKeys()).toContain("error"));
    await press("Enter");
    expect(sql(state)).toBe("level = 'error'");
    expect(segment("level", "field").text()).toBe("level");
    expect(segment("level", "operator").text()).toBe("=");
    expect(segment("level", "value").text()).toBe("error");
    expect(rowKeys()).toContain("status");
  });

  it("starts typing into the search box from the bar", async () => {
    mountBar();
    await wrapper!.find('[data-test="query-filter-bar-add"]').trigger("keydown", { key: "s" });
    await flushPromises();
    expect(rowKeys()).toEqual(["status"]);
  });

  it("only offers operators that fit the field type", async () => {
    mountBar();
    await openBar();
    await type("status");
    await press("Enter");
    expect(rowKeys()).toContain("gte");
    expect(rowKeys()).not.toContain("contains");
  });

  it("commits a typed value that is not among the suggestions", async () => {
    const state = mountBar();
    await openBar();
    await type("status");
    await press("Enter");
    await type(">=");
    await press("Enter");
    await type("500");
    await press("Enter");
    expect(sql(state)).toBe("status >= 500");
  });

  it("completes a typed prefix to a known value for is, but keeps the text for contains", async () => {
    const state = mountBar();
    await openBar();
    await type("level");
    await press("Enter");
    await press("Enter");
    await vi.waitFor(() => expect(rowKeys()).toContain("error"));
    await type("err");
    expect(rowKeys()).toEqual(["error", "\u0000custom"]);
    await press("Enter");
    await type("level");
    await press("Enter");
    await type("contains");
    await press("Enter");
    await type("err");
    await vi.waitFor(() => expect(rowKeys()).toEqual(["\u0000custom", "error"]));
    await press("Enter");
    expect(sql(state)).toBe("level = 'error' AND str_match(level, 'err')");
  });

  it("adds a chip from field=value shorthand", async () => {
    const state = mountBar();
    await openBar();
    await type("level=warn");
    await press("Enter");
    expect(sql(state)).toBe("level = 'warn'");
  });

  it("picks several values for is any of and applies on Enter", async () => {
    const state = mountBar();
    await openBar();
    await type("level");
    await press("Enter");
    await type("any");
    await press("Enter");
    await vi.waitFor(() => expect(rowKeys()).toContain("warn"));
    await press("Enter");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("Enter");
    expect(sql(state)).toBe("");
    await press("Enter");
    expect(sql(state)).toBe("level IN ('error', 'warn')");
  });

  it("ticks several values for is any of and applies them from the footer", async () => {
    const state = mountBar();
    await openBar();
    await clickRow("level");
    await clickRow("in");
    await vi.waitFor(() => expect(rowKeys()).toContain("warn"));
    const footer = () =>
      document.body.querySelector('[data-test="query-filter-bar-selected-count"]')!.textContent;
    expect(footer()).toBe("No values selected");
    await clickRow("error");
    await clickRow("warn");
    expect(footer()).toBe("2 values selected");
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    document.body
      .querySelector<HTMLElement>('[data-test="query-filter-bar-apply"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(sql(state)).toBe("level IN ('error', 'warn')");
    await editPart("level", "value");
    await vi.waitFor(() => expect(rowKeys()).toEqual(["error", "warn", "info"]));
    await clickRow("warn");
    await clickRow("info");
    document.body
      .querySelector<HTMLElement>('[data-test="query-filter-bar-apply"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(sql(state)).toBe("level IN ('error', 'info')");
  });

  it("emits submit on Enter in an empty search box", async () => {
    const onSubmit = vi.fn();
    mountBar({ onSubmit });
    await openBar();
    await press("Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("backspace arms the last chip and a second backspace removes it", async () => {
    const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
    await openBar();
    await press("Backspace");
    expect(sql(state)).toBe("level = 'error' AND status = 1");
    await press("Backspace");
    expect(sql(state)).toBe("level = 'error'");
  });

  describe("editing one part of a chip", () => {
    const withService: FilterField[] = [...fields, { name: "service", type: "string" }];

    it("changes only the value", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
      await editPart("level", "value");
      expect(input()!.value).toBe("error");
      await type("warn");
      await press("Enter");
      expect(sql(state)).toBe("level = 'warn' AND status = 1");
    });

    it("lists every value with the current one first while it is untouched", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'warn'")! });
      await editPart("level", "value");
      await vi.waitFor(() => expect(rowKeys()).toEqual(["warn", "error", "info"]));
      expect([input()!.selectionStart, input()!.selectionEnd]).toEqual([0, 4]);
      await press("Enter");
      expect(sql(state)).toBe("level = 'warn'");
      await editPart("level", "value");
      await vi.waitFor(() => expect(rowKeys()).toContain("info"));
      await clickRow("info");
      expect(sql(state)).toBe("level = 'info'");
    });

    it("changes only the operator and keeps the value", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'error'")! });
      await editPart("level", "operator");
      expect(rowKeys()).toContain("contains");
      await clickRow("neq");
      expect(sql(state)).toBe("level != 'error'");
      await editPart("level", "operator");
      await clickRow("contains");
      expect(sql(state)).toBe("str_match(level, 'error')");
      await editPart("level", "operator");
      await clickRow("is_null");
      expect(sql(state)).toBe("level IS NULL");
    });

    it("changes only the field when the operator still fits", async () => {
      const state = mountBar({
        fields: withService,
        modelValue: parseSqlFilter("level = 'cart' AND status = 1")!,
      });
      await editPart("level", "field");
      await type("serv");
      await press("Enter");
      expect(sql(state, withService)).toBe("service = 'cart' AND status = 1");
    });

    it("asks for a new operator when the field type does not take the old one", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("str_match(level, 'x')")! });
      await editPart("level", "field");
      await clickRow("status");
      expect(rowKeys()).toContain("gte");
      expect(rowKeys()).not.toContain("contains");
      await clickRow("gte");
      await type("500");
      await press("Enter");
      expect(sql(state)).toBe("status >= 500");
    });

    it("leaves the chip unchanged on Escape", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
      await editPart("level", "value");
      await type("warn");
      await press("Escape");
      expect(input()).toBeNull();
      expect(sql(state)).toBe("level = 'error' AND status = 1");
    });

    it("marks the part being edited", async () => {
      mountBar({ modelValue: parseSqlFilter("level = 'error'")! });
      await editPart("level", "operator");
      expect(segment("level", "operator").classes()).toContain("ring-2");
      expect(segment("level", "value").classes()).not.toContain("ring-2");
    });
  });

  it("offers full-text search for a word that matches no field", async () => {
    const state = mountBar({ freeText: true });
    await openBar();
    await type("timeout");
    await press("Enter");
    expect(sql(state)).toBe("match_all('timeout')");
  });

  describe("AND / OR", () => {
    it("joins chips with AND by default and toggles a connector when it is clicked", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a' AND level = 'b'")! });
      expect(wrapper!.find('[data-test="query-filter-bar-mode"]').exists()).toBe(false);
      await wrapper!.find('[data-test="query-filter-bar-connector-1"]').trigger("click");
      expect(sql(state)).toBe("level = 'a' OR level = 'b'");
    });

    it("joins with OR and groups with parentheses as they are typed", async () => {
      const state = mountBar();
      await openBar();
      await type("status>=500");
      await press("Enter");
      await type("(");
      await type("level=error");
      await press("Enter");
      await type("or ");
      await type("level=warn");
      await press("Enter");
      await type(")");
      expect(sql(state)).toBe("status >= 500 AND (level = 'error' OR level = 'warn')");
    });
  });

  it("limits PromQL to label matchers without connectors", async () => {
    mountBar({ dialect: "promql", modelValue: parseSqlFilter("level = 'a' AND ok = true")! });
    expect(wrapper!.find('[data-test^="query-filter-bar-connector-"]').exists()).toBe(false);
    await openBar();
    await type("level");
    await press("Enter");
    expect(rowKeys()).toEqual(["eq", "neq", "regex", "not_regex", "in", "not_in"]);
  });
});
