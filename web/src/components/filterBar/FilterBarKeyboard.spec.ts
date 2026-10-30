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
import type { FilterLayout } from "./filterProfiles";

const fields: FilterField[] = [
  { name: "a", type: "number" },
  { name: "b", type: "string" },
  { name: "c", type: "string" },
];

const DT = "kb";
let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

function mountBar(layout: FilterLayout) {
  const state = { tree: emptyFilterGroup() as FilterGroup };
  wrapper = mount(QueryFilterBar, {
    attachTo: document.body,
    props: {
      modelValue: state.tree,
      fields,
      layout,
      dataTest: DT,
      loadValues: vi.fn(async () => []),
      "onUpdate:modelValue": async (next: FilterGroup) => {
        state.tree = next;
        await wrapper!.setProps({ modelValue: next });
      },
    },
  });
  return state;
}

const settle = async () => {
  await flushPromises();
  await nextTick();
  await flushPromises();
};
const active = () => document.activeElement as HTMLElement;
const activeTest = () => active()?.getAttribute("data-test") ?? "";
const sql = (state: { tree: FilterGroup }) => filterTreeToSql(state.tree, fields);
const caret = () => document.querySelector<HTMLInputElement>(`[data-test="${DT}-input"]`)!;
const rowKeys = () =>
  Array.from(document.querySelectorAll(`[data-test^="${DT}-suggest-item-"]`)).map((row) =>
    row.getAttribute("data-test")!.replace(`${DT}-suggest-item-`, ""),
  );

async function key(name: string, init: KeyboardEventInit = {}) {
  const target = active();
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  // jsdom has no built-in activation, so Enter and Space on a focused button click it as a browser does.
  if (
    !event.defaultPrevented &&
    target instanceof HTMLButtonElement &&
    (name === "Enter" || name === " ")
  ) {
    target.click();
  }
  await settle();
}

/** Types one character at a time into the focused text box; `replace` types over its selected text. */
async function type(text: string, replace = false) {
  if (replace) (active() as HTMLInputElement).value = "";
  for (const char of text) {
    const box = active() as HTMLInputElement;
    box.value += char;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  }
}

const tabbable = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-test="${DT}-field"] button:not([disabled]):not([tabindex="-1"]), [data-test="${DT}-field"] input`,
    ),
  );

/** Moves focus as Tab / Shift+Tab does, through the bar's focusable parts in document order. */
async function tab(back = false) {
  const list = tabbable();
  const at = list.indexOf(active());
  list[(at + (back ? -1 : 1) + list.length) % list.length].focus();
  await settle();
}

async function tabTo(testId: string, back = true) {
  for (let i = 0; i < 40 && activeTest() !== `${DT}-${testId}`; i++) await tab(back);
  expect(activeTest()).toBe(`${DT}-${testId}`);
}

async function pickOperator(id: string) {
  const index = rowKeys().indexOf(id);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < index; i++) await key("ArrowDown");
  await key("Enter");
}

async function condition(field: string, operator: string, values: string[]) {
  await type(field);
  await key("Enter");
  await pickOperator(operator);
  for (const value of values) {
    await type(value);
    await key("Enter");
  }
  if (values.length > 1) await key("Enter", { ctrlKey: true });
}

describe.each<FilterLayout>(["horizontal", "vertical"])("keyboard only (%s)", (layout) => {
  it("builds a = 1 AND (b IN (x, y) OR c contains z), then edits and removes parts", async () => {
    const state = mountBar(layout);
    caret().focus();
    await settle();

    await condition("a", "eq", ["1"]);
    await type("(");
    await condition("b", "in", ["x", "y"]);
    await type("or ");
    await condition("c", "contains", ["z"]);
    // The caret is still inside the group until `)` closes it.
    expect(wrapper!.find(`[data-test="${DT}-group-1"] [data-test="${DT}-input"]`).exists()).toBe(
      true,
    );
    await type(")");
    await key("Escape");
    expect(sql(state)).toBe("a = 1 AND (b IN ('x', 'y') OR str_match(c, 'z'))");

    await tabTo("chip-c-value");
    await key("Enter");
    expect(activeTest()).toBe(`${DT}-search`);
    await type("zz", true);
    await key("Enter");
    expect(sql(state)).toBe("a = 1 AND (b IN ('x', 'y') OR str_match(c, 'zz'))");
    // Focus comes back to the part that was changed, not to the page.
    expect(activeTest()).toBe(`${DT}-chip-c-value`);

    await tabTo("connector-1-1");
    await key("Enter");
    expect(sql(state)).toBe("a = 1 AND (b IN ('x', 'y') AND str_match(c, 'zz'))");

    await tabTo("chip-b-field");
    await key("Backspace");
    // A one-item group needs no brackets in SQL, but stays a group until ungrouped.
    expect(sql(state)).toBe("a = 1 AND str_match(c, 'zz')");

    await tabTo("ungroup-1", false);
    await key("Enter");
    expect(state.tree.items.map((item) => item.kind)).toEqual(["condition", "condition"]);

    caret().focus();
    await settle();
    await key("Backspace");
    await key("Backspace");
    expect(sql(state)).toBe("a = 1");
  });

  it("moves the caret between chips with the arrow keys and inserts there", async () => {
    const state = mountBar(layout);
    caret().focus();
    await settle();
    await condition("a", "eq", ["1"]);
    await condition("c", "eq", ["3"]);
    await key("Escape");
    await key("ArrowLeft");
    await condition("b", "eq", ["2"]);
    expect(sql(state)).toBe("a = 1 AND b = '2' AND c = '3'");
    await key("Escape");
    // Delete arms the chip after the caret, a second Delete removes it.
    await key("Delete");
    await key("Delete");
    expect(sql(state)).toBe("a = 1 AND b = '2'");
  });

  it("ticks values with Space and applies them with Ctrl+Enter", async () => {
    const state = mountBar(layout);
    await wrapper!.setProps({ loadValues: vi.fn(async () => ["x", "y", "w"]) });
    caret().focus();
    await settle();
    await type("b");
    await key("Enter");
    await pickOperator("in");
    await vi.waitFor(() => expect(rowKeys()).toEqual(["x", "y", "w"]));
    await key("ArrowDown");
    await key(" ");
    await key("ArrowDown");
    await key(" ");
    await key("Enter", { ctrlKey: true });
    expect(sql(state)).toBe("b IN ('y', 'w')");
  });
});

describe("keyboard only (vertical groups)", () => {
  it("folds and unfolds a group from its chevron and summary, keeping focus on the toggle", async () => {
    const state = mountBar("vertical");
    caret().focus();
    await settle();
    await condition("a", "eq", ["1"]);
    await type("(");
    await condition("b", "eq", ["x"]);
    await type(")");
    await key("Escape");

    await tabTo("collapse-1");
    expect(active().getAttribute("aria-expanded")).toBe("true");
    await key("Enter");
    expect(activeTest()).toBe(`${DT}-expand-1`);
    expect(document.querySelector(`[data-test="${DT}-summary-1"]`)?.textContent).toContain("b = x");
    await key(" ");
    expect(activeTest()).toBe(`${DT}-collapse-1`);
    expect(document.querySelector(`[data-test="${DT}-row-1-0"]`)).not.toBeNull();

    await key("Enter");
    await tab();
    expect(activeTest()).toBe(`${DT}-summary-1`);
    await key("Enter");
    expect(activeTest()).toBe(`${DT}-collapse-1`);
    expect(document.querySelector(`[data-test="${DT}-summary-1"]`)).toBeNull();
    expect(state.tree.items.map((item) => item.kind)).toEqual(["condition", "group"]);
  });

  it("unfolds a folded group when the arrow keys move the caret into it", async () => {
    mountBar("vertical");
    caret().focus();
    await settle();
    await condition("a", "eq", ["1"]);
    await type("(");
    await condition("b", "eq", ["x"]);
    await type(")");
    await key("Escape");
    await tabTo("collapse-1");
    await key("Enter");
    caret().focus();
    await settle();
    await key("ArrowLeft");
    expect(document.querySelector(`[data-test="${DT}-summary-1"]`)).toBeNull();
    expect(
      document.querySelector(`[data-test="${DT}-group-1"] [data-test="${DT}-input"]`),
    ).not.toBeNull();
  });
});
