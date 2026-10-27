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

const input = () => wrapper!.find<HTMLInputElement>('[data-test="query-filter-bar-input"]');
const rows = () =>
  Array.from(document.body.querySelectorAll('[data-test^="query-filter-bar-suggest-item-"]'));
const rowKeys = () =>
  rows().map((row) => row.getAttribute("data-test")!.replace("query-filter-bar-suggest-item-", ""));

async function type(text: string) {
  await input().setValue(text);
  await flushPromises();
}

async function press(key: string) {
  await input().trigger("keydown", { key });
  await flushPromises();
  await nextTick();
}

async function focusBar() {
  await input().trigger("focus");
  await flushPromises();
}

describe("QueryFilterBar", () => {
  it("opens the field list on focus", async () => {
    mountBar();
    await focusBar();
    expect(rowKeys()).toEqual(["level", "status", "ok"]);
  });

  it("builds a chip with the keyboard: field, operator, value, then reopens the field list", async () => {
    const state = mountBar();
    await focusBar();
    await type("lev");
    await press("Enter");
    expect(rowKeys()[0]).toBe("eq");
    await press("Enter");
    await vi.waitFor(() => expect(rowKeys()).toContain("error"));
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'error'");
    expect(wrapper!.find('[data-test="query-filter-bar-chip-level"]').exists()).toBe(true);
    expect(rowKeys()).toContain("status");
  });

  it("only offers operators that fit the field type", async () => {
    mountBar();
    await focusBar();
    await type("status");
    await press("Enter");
    expect(rowKeys()).toContain("gte");
    expect(rowKeys()).not.toContain("contains");
  });

  it("commits a typed value that is not among the suggestions", async () => {
    const state = mountBar();
    await focusBar();
    await type("status");
    await press("Enter");
    await type(">=");
    await press("Enter");
    await type("500");
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("status >= 500");
  });

  it("completes a typed prefix to a known value for is, but keeps the text for contains", async () => {
    const state = mountBar();
    await focusBar();
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
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'error' AND str_match(level, 'err')");
  });

  it("adds a chip from field=value shorthand", async () => {
    const state = mountBar();
    await focusBar();
    await type("level=warn");
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'warn'");
  });

  it("picks several values for is any of and applies on Enter", async () => {
    const state = mountBar();
    await focusBar();
    await type("level");
    await press("Enter");
    await type("any");
    await press("Enter");
    await vi.waitFor(() => expect(rowKeys()).toContain("warn"));
    await press("Enter");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("");
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("level IN ('error', 'warn')");
  });

  it("emits submit on Enter in an empty bar", async () => {
    const onSubmit = vi.fn();
    mountBar({ onSubmit });
    await focusBar();
    await press("Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("backspace arms the last chip and a second backspace removes it", async () => {
    const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
    await focusBar();
    await press("Backspace");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'error' AND status = 1");
    await press("Backspace");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'error'");
  });

  it("edits a chip in place when it is clicked", async () => {
    const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
    await wrapper!.find('[data-test="query-filter-bar-chip-level"]').trigger("click");
    await flushPromises();
    expect(input().element.value).toBe("error");
    await type("warn");
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'warn' AND status = 1");
  });

  it("lists every value with the current one first while an edited chip is untouched", async () => {
    const state = mountBar({ modelValue: parseSqlFilter("level = 'warn'")! });
    await wrapper!.find('[data-test="query-filter-bar-chip-level"]').trigger("click");
    await vi.waitFor(() => expect(rowKeys()).toEqual(["warn", "error", "info"]));
    const field = input().element;
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4]);
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'warn'");
    await wrapper!.find('[data-test="query-filter-bar-chip-level"]').trigger("click");
    await vi.waitFor(() => expect(rowKeys()).toContain("info"));
    rows()
      .find((row) => row.getAttribute("data-test")!.endsWith("-info"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'info'");
  });

  it.each([
    ["one Escape", () => press("Escape")],
    ["leaving the bar", () => input().trigger("blur")],
  ])("puts an edited chip back unchanged on %s", async (_, cancel) => {
    const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
    await wrapper!.find('[data-test="query-filter-bar-chip-level"]').trigger("click");
    await flushPromises();
    await type("warn");
    await cancel();
    await flushPromises();
    expect(wrapper!.findAll('[data-test^="query-filter-bar-chip-"]')).toHaveLength(2);
    expect(input().element.value).toBe("");
    expect(filterTreeToSql(state.tree, fields)).toBe("level = 'error' AND status = 1");
  });

  it("offers full-text search for a word that matches no field", async () => {
    const state = mountBar({ freeText: true });
    await focusBar();
    await type("timeout");
    await press("Enter");
    expect(filterTreeToSql(state.tree, fields)).toBe("match_all('timeout')");
  });

  describe("advanced mode", () => {
    it("joins with OR and groups with parentheses as they are typed", async () => {
      const state = mountBar({ mode: "advanced" });
      await focusBar();
      await type("status>=500");
      await press("Enter");
      await type("(");
      await type("level=error");
      await press("Enter");
      await type("or ");
      await type("level=warn");
      await press("Enter");
      await type(")");
      expect(filterTreeToSql(state.tree, fields)).toBe(
        "status >= 500 AND (level = 'error' OR level = 'warn')",
      );
    });

    it("toggles a connector when it is clicked", async () => {
      const state = mountBar({
        mode: "advanced",
        modelValue: parseSqlFilter("level = 'a' AND level = 'b'")!,
      });
      await wrapper!.find('[data-test="query-filter-bar-connector-1"]').trigger("click");
      expect(filterTreeToSql(state.tree, fields)).toBe("level = 'a' OR level = 'b'");
    });

    it("keeps basic mode off while the tree needs advanced features", () => {
      mountBar({ mode: "advanced", modelValue: parseSqlFilter("level = 'a' OR level = 'b'")! });
      const basic = wrapper!.find('[data-test="query-filter-bar-mode-basic"]');
      expect(basic.attributes("disabled")).toBeDefined();
    });
  });

  it("limits PromQL to label matchers and hides the mode switch", async () => {
    mountBar({ dialect: "promql" });
    expect(wrapper!.find('[data-test="query-filter-bar-mode"]').exists()).toBe(false);
    await focusBar();
    await type("level");
    await press("Enter");
    expect(rowKeys()).toEqual(["eq", "neq", "regex", "not_regex", "in", "not_in"]);
  });
});
