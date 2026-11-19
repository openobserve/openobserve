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
import { filterTreeToSql, type FilterField, type FilterGroup } from "@/utils/query/filterBar";
import { parseSqlFilter } from "@/utils/query/filterBarParser";

const fields: FilterField[] = [
  { name: "a", type: "number" },
  { name: "b", type: "string" },
  { name: "c", type: "string" },
];

const DT = "w";
let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

function mountBar(query = "") {
  const state = { tree: parseSqlFilter(query)! };
  wrapper = mount(QueryFilterBar, {
    attachTo: document.body,
    props: {
      modelValue: state.tree,
      fields,
      openOnType: true,
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
const caretPlace = () => {
  const group = caret().closest<HTMLElement>("[data-filter-group]")?.dataset.filterGroup;
  return group ? "group" : "root";
};

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
  )
    target.click();
  await settle();
}

async function type(text: string) {
  for (const char of text) {
    const box = active() as HTMLInputElement;
    box.value += char;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  }
}

async function start() {
  caret().focus();
  caret().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await settle();
}

async function walkTo(testId: string, back = true) {
  for (let i = 0; i < 40 && activeTest() !== `${DT}-${testId}`; i++)
    await key(back ? "ArrowLeft" : "ArrowRight");
  expect(activeTest()).toBe(`${DT}-${testId}`);
}

describe("chip bar keyboard: one Tab stop, the arrows walk parts and gaps", () => {
  it("leaves every chip part and AND/OR out of the Tab order and walks them in reading order", async () => {
    mountBar("a = 1 OR b = 'x'");
    await start();
    const parts = document.querySelectorAll(`[data-test="${DT}-field"] [data-walk]`);
    expect([...parts].every((part) => part.getAttribute("tabindex") === "-1")).toBe(true);

    const visited: string[] = [];
    for (let i = 0; i < 11; i++) {
      await key("ArrowLeft");
      visited.push(activeTest() === `${DT}-input` ? `caret` : activeTest().replace(`${DT}-`, ""));
    }
    // The next condition's AND/OR stands just before the caret, wherever the caret is.
    expect(visited).toEqual([
      "pending-connector",
      "chip-b-value",
      "chip-b-operator",
      "chip-b-field",
      "connector-1",
      "caret",
      "pending-connector",
      "chip-a-value",
      "chip-a-operator",
      "chip-a-field",
      "caret",
    ]);
  });

  it("adds a condition at the gap the caret was walked to, not at the end", async () => {
    const state = mountBar("a = 1 AND c = 'z'");
    await start();
    await walkTo("connector-1");
    await key("ArrowLeft");
    expect(activeTest()).toBe(`${DT}-input`);
    await type("b");
    await key("Enter");
    await key("Enter");
    await type("y");
    await key("Enter");
    expect(sql(state)).toBe("a = 1 AND b = 'y' AND c = 'z'");
  });

  it("typing on a part carries on right after that chip", async () => {
    const state = mountBar("a = 1 AND c = 'z'");
    await start();
    await walkTo("chip-a-operator");
    await key("b");
    expect(caret().value).toBe("b");
    await key("Enter");
    await key("Enter");
    await type("y");
    await key("Enter");
    expect(sql(state)).toBe("a = 1 AND b = 'y' AND c = 'z'");
  });

  it("edits the part it is on, switches parts with Tab, and Escape comes back to the part", async () => {
    const state = mountBar("b = 'x'");
    await start();
    await walkTo("chip-b-operator");
    await key("Enter");
    expect(activeTest()).toBe(`${DT}-search`);
    // The list opens on the current operator.
    const highlighted = document.querySelector(`[data-test^="${DT}-suggest-item-"][data-active]`);
    expect(highlighted?.getAttribute("data-test")).toBe(`${DT}-suggest-item-eq`);
    await key("ArrowDown");
    await key("Enter");
    expect(sql(state)).toBe("b != 'x'");
    expect(activeTest()).toBe(`${DT}-chip-b-operator`);

    await key("Enter");
    await key("Tab");
    expect(rowKeys()).toContain("x");
    await key("Escape");
    expect(activeTest()).toBe(`${DT}-chip-b-value`);
  });

  it("Backspace on a part removes the chip and leaves the caret where it stood", async () => {
    const state = mountBar("a = 1 AND b = 'x' AND c = 'z'");
    await start();
    await walkTo("chip-b-field");
    await key("Backspace");
    expect(sql(state)).toBe("a = 1 AND c = 'z'");
    expect(activeTest()).toBe(`${DT}-input`);
    await type("b");
    await key("Enter");
    await key("Enter");
    await type("q");
    await key("Enter");
    expect(sql(state)).toBe("a = 1 AND b = 'q' AND c = 'z'");
  });
});

describe("chip bar keyboard: AND/OR and groups", () => {
  it("( on an AND/OR brackets the two conditions it joins and keeps focus on it", async () => {
    const state = mountBar("a = 1 AND b = 'x' OR c = 'z'");
    await start();
    await walkTo("connector-2");
    await key("(");
    expect(sql(state)).toBe("a = 1 AND (b = 'x' OR c = 'z')");
    expect(active().dataset.join).toBeTruthy();
  });

  it("( beside a group adds the condition to that group", async () => {
    const state = mountBar("a = 1 OR (b = 'x' OR c = 'z')");
    await start();
    await walkTo("connector-1");
    await key("(");
    expect(sql(state)).toBe("(a = 1 OR b = 'x' OR c = 'z')");
  });

  it("walks into a group, adds there, and ungroups from its button", async () => {
    const state = mountBar("a = 1 OR (b = 'x' OR c = 'z')");
    await start();
    await walkTo("ungroup-1");
    await key("ArrowLeft");
    expect(caretPlace()).toBe("group");
    await type("b");
    await key("Enter");
    await key("Enter");
    await type("y");
    await key("Enter");
    expect(sql(state)).toBe("a = 1 OR (b = 'x' OR c = 'z' AND b = 'y')");

    await key("Escape");
    await walkTo("ungroup-1", false);
    await key("Enter");
    expect(state.tree.items.every((item) => item.kind === "condition")).toBe(true);
  });

  it("the next condition's AND/OR shows while the bar has focus and switches from the keyboard", async () => {
    const state = mountBar("a = 1");
    await start();
    const pending = () => document.querySelector(`[data-test="${DT}-pending-connector"]`);
    expect(pending()?.textContent).toContain("AND");
    await key("ArrowLeft");
    expect(activeTest()).toBe(`${DT}-pending-connector`);
    await key("Enter");
    expect(pending()?.textContent).toContain("OR");
    await key("ArrowRight");
    await type("b");
    await key("Enter");
    await key("Enter");
    await type("x");
    await key("Enter");
    expect(sql(state)).toBe("a = 1 OR b = 'x'");
  });

  it("typing and / or offers a row to join with it, and Space or Enter switches", async () => {
    mountBar("a = 1");
    await start();
    await type("or");
    expect(rowKeys()[0]).toBe("\u0000join:OR");
    await type(" ");
    expect(document.querySelector(`[data-test="${DT}-pending-connector"]`)?.textContent).toContain(
      "OR",
    );
    await type("and");
    await key("Enter");
    expect(document.querySelector(`[data-test="${DT}-pending-connector"]`)?.textContent).toContain(
      "AND",
    );
  });
});

describe("chip bar keyboard: undo, redo and clear", () => {
  it("undoes, redoes and clears with Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y and Ctrl+Backspace", async () => {
    const state = mountBar("a = 1 AND b = 'x'");
    await start();
    await walkTo("chip-b-field");
    await key("Backspace");
    expect(sql(state)).toBe("a = 1");
    await key("z", { ctrlKey: true });
    expect(sql(state)).toBe("a = 1 AND b = 'x'");
    await key("z", { ctrlKey: true, shiftKey: true });
    expect(sql(state)).toBe("a = 1");
    await key("z", { ctrlKey: true });
    await key("y", { ctrlKey: true });
    expect(sql(state)).toBe("a = 1");
    await key("Backspace", { ctrlKey: true });
    expect(state.tree.items).toEqual([]);
    await key("z", { ctrlKey: true });
    expect(sql(state)).toBe("a = 1");
  });

  it("leaves Ctrl+Z to the browser while text is being typed", async () => {
    const state = mountBar("a = 1");
    await start();
    await type("b");
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    caret().dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(sql(state)).toBe("a = 1");
  });
});
