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
  document.body.querySelector<HTMLInputElement>('[data-test="query-filter-bar-search"]') ??
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
  await wrapper!.find('[data-test="query-filter-bar-input"]').trigger("click");
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
  it("opens the field list when the caret is clicked", async () => {
    mountBar();
    await openBar();
    expect(input()).not.toBeNull();
    expect(rowKeys()).toEqual(["level", "status", "ok", "\u0000group"]);
    await type("sta");
    expect(rowKeys()).toEqual(["status"]);
  });

  it("keeps the list open and the caret focused when the press lands on a group's box", async () => {
    mountBar({
      modelValue: parseSqlFilter("status >= 500 AND (level = 'error' OR level = 'warn')")!,
    });
    await openBar();
    const groupBox = wrapper!.find('[data-test="query-filter-bar-group-1"]').element;
    const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    groupBox.dispatchEvent(press);
    await flushPromises();
    expect(press.defaultPrevented).toBe(true);
    expect(document.activeElement?.getAttribute("data-test")).toBe("query-filter-bar-input");
    expect(rows().length).toBeGreaterThan(0);
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

  it("opens the picker when the user types at the caret", async () => {
    mountBar();
    await type("s");
    expect(rowKeys()).toEqual(["status"]);
    expect(document.body.querySelector('[data-test="query-filter-bar-search"]')).toBeNull();
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

  it("backspace at a shut caret removes chips without opening the picker", async () => {
    const state = mountBar({ modelValue: parseSqlFilter("level = 'error' AND status = 1")! });
    await press("Backspace");
    await press("Backspace");
    expect(sql(state)).toBe("level = 'error'");
    expect(rows()).toHaveLength(0);
  });

  it("searches inside the picker while a chip part is edited, and at the caret otherwise", async () => {
    mountBar({ modelValue: parseSqlFilter("level = 'error'")! });
    await editPart("level", "field");
    expect(document.body.querySelector('[data-test="query-filter-bar-search"]')).not.toBeNull();
    await openBar();
    expect(document.body.querySelector('[data-test="query-filter-bar-search"]')).toBeNull();
    expect(document.activeElement?.getAttribute("data-test")).toBe("query-filter-bar-input");
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
      expect(document.body.querySelector('[data-test="query-filter-bar-search"]')).toBeNull();
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

  it("names operators as dashboards and alerts do, with a plain-language hint", async () => {
    mountBar({ modelValue: parseSqlFilter("level IN ('a', 'b') AND str_match(level, 'x')")! });
    expect(segment("level", "operator").text()).toBe("IN");
    await openBar();
    await type("level");
    await press("Enter");
    const contains = rows().find((row) =>
      row.getAttribute("data-test")!.endsWith("-item-contains"),
    )!;
    expect(contains.textContent).toContain("Contains");
    const eq = rows().find((row) => row.getAttribute("data-test")!.endsWith("-item-eq"))!;
    expect(eq.textContent!.replace(/\s+/g, "")).toBe("=is");
  });

  describe("AND / OR", () => {
    it("joins chips with AND by default and toggles a connector when it is clicked", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a' AND level = 'b'")! });
      expect(wrapper!.find('[data-test="query-filter-bar-mode"]').exists()).toBe(false);
      await wrapper!.find('[data-test="query-filter-bar-connector-1"]').trigger("click");
      expect(sql(state)).toBe("level = 'a' OR level = 'b'");
    });

    it("toggles a connector from the keyboard", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a' AND level = 'b'")! });
      const connector = wrapper!.find('[data-test="query-filter-bar-connector-1"]');
      expect(connector.element.tagName).toBe("BUTTON");
      await connector.trigger("keydown", { key: "Enter" });
      expect(sql(state)).toBe("level = 'a' OR level = 'b'");
      await wrapper!
        .find('[data-test="query-filter-bar-connector-1"]')
        .trigger("keydown", { key: " " });
      expect(sql(state)).toBe("level = 'a' AND level = 'b'");
    });

    it("sets the next connector by typing or, and Backspace puts it back to AND", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a'")! });
      await openBar();
      await type("or ");
      expect(wrapper!.find('[data-test="query-filter-bar-pending-connector"]').text()).toBe("OR");
      await press("Backspace");
      expect(wrapper!.find('[data-test="query-filter-bar-pending-connector"]').text()).toBe("AND");
      await type("or ");
      await type("level=b");
      await press("Enter");
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

  describe("caret position", () => {
    it("draws the caret and the half-built chip inside the group being typed into", async () => {
      mountBar({ modelValue: parseSqlFilter("level = 'a'")! });
      await openBar();
      await type("(");
      await type("level=b");
      await press("Enter");
      const group = wrapper!.find('[data-test="query-filter-bar-group-1"]');
      expect(group.find('[data-test="query-filter-bar-input"]').exists()).toBe(true);
      await type("level");
      await press("Enter");
      expect(group.find('[data-test="query-filter-bar-draft"]').exists()).toBe(true);
    });

    it("inserts at the front, where the old first chip takes the typed connector", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a' AND level = 'b'")! });
      await openBar();
      await press("ArrowLeft");
      await press("ArrowLeft");
      await type("or ");
      await type("level=c");
      await press("Enter");
      expect(sql(state)).toBe("level = 'c' OR level = 'a' AND level = 'b'");
    });

    it("puts the caret in a group whose box is pressed, so the next chip lands there", async () => {
      const state = mountBar({
        modelValue: parseSqlFilter("status >= 500 AND (level = 'error' OR level = 'warn')")!,
      });
      const box = wrapper!.find('[data-test="query-filter-bar-group-1"]').element;
      box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      await flushPromises();
      await type("or ");
      await type("level=info");
      await press("Enter");
      expect(sql(state)).toBe(
        "status >= 500 AND (level = 'error' OR level = 'warn' OR level = 'info')",
      );
    });

    it("steps into a group on Backspace instead of deleting it whole", async () => {
      const state = mountBar({
        modelValue: parseSqlFilter("status >= 500 AND (level = 'error' OR level = 'warn')")!,
      });
      await openBar();
      await press("Backspace");
      const group = wrapper!.find('[data-test="query-filter-bar-group-1"]');
      expect(group.find('[data-test="query-filter-bar-input"]').exists()).toBe(true);
      await press("Backspace");
      await press("Backspace");
      expect(sql(state)).toBe("status >= 500 AND level = 'error'");
    });

    it("drops an unfilled group and returns the caret to the end when the user leaves", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a'")! });
      await openBar();
      await type("(");
      expect(state.tree.items).toHaveLength(2);
      const elsewhere = document.createElement("button");
      document.body.appendChild(elsewhere);
      elsewhere.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();
      expect(state.tree.items).toHaveLength(1);
      expect(wrapper!.find('[data-test="query-filter-bar-group-1"]').exists()).toBe(false);
    });

    it("drops only the group it opened, never an empty group that was loaded", async () => {
      const loaded = parseSqlFilter("level = 'a'")!;
      const saved = {
        ...loaded,
        items: [
          ...loaded.items,
          { kind: "group" as const, id: "kept", connector: "AND" as const, items: [] },
        ],
      };
      const state = mountBar({ modelValue: saved });
      await openBar();
      await type("(");
      expect(state.tree.items).toHaveLength(3);
      await type(")");
      expect(state.tree.items.map((item) => item.id)).toEqual([loaded.items[0].id, "kept"]);
    });

    it("keeps the caret where it is on Escape", async () => {
      const state = mountBar({ modelValue: parseSqlFilter("level = 'a' AND level = 'b'")! });
      await openBar();
      await press("ArrowLeft");
      await press("Escape");
      await type("level=c");
      await press("Enter");
      expect(sql(state)).toBe("level = 'a' AND level = 'c' AND level = 'b'");
    });
  });

  it("folds deep groups only in the vertical layout, without emitting a change", async () => {
    const deep = "level = 'a' AND (level = 'b' OR (level = 'c' AND (level = 'd' OR status = 1)))";
    const onChange = vi.fn();
    mountBar({
      modelValue: parseSqlFilter(deep)!,
      layout: "vertical",
      "onUpdate:modelValue": onChange,
    });
    const summary = wrapper!.find('[data-test="query-filter-bar-summary-1-1-1"]');
    expect(summary.text()).toBe("level = d OR status = 1");
    await wrapper!.find('[data-test="query-filter-bar-expand-1-1-1"]').trigger("click");
    expect(wrapper!.find('[data-test="query-filter-bar-row-1-1-1-0"]').exists()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await wrapper!.setProps({ layout: "horizontal" });
    expect(wrapper!.find('[data-test^="query-filter-bar-summary-"]').exists()).toBe(false);
  });

  it("moves focus to the redrawn fold toggle even when the group id holds a quote", async () => {
    const deep = parseSqlFilter(
      "level = 'a' AND (level = 'b' OR (level = 'c' AND (level = 'd' OR status = 1)))",
    )!;
    const quoteIds = (node: FilterGroup): FilterGroup => ({
      ...node,
      id: `${node.id}"]`,
      items: node.items.map((item) => (item.kind === "group" ? quoteIds(item) : item)),
    });
    mountBar({ modelValue: quoteIds(deep), layout: "vertical" });
    const toggle = wrapper!.find('[data-test="query-filter-bar-expand-1-1-1"]');
    const id = toggle.attributes("data-fold-toggle");
    expect(id).toContain('"]');
    (toggle.element as HTMLElement).focus();
    await toggle.trigger("click");
    await flushPromises();
    expect((document.activeElement as HTMLElement).getAttribute("data-fold-toggle")).toBe(id);
  });

  it("hides a field already used in the group only for any-of-groups bars", async () => {
    const used = parseSqlFilter("level = 'a'")!;
    mountBar({ dialect: "promql", modelValue: used });
    await openBar();
    expect(rowKeys()).not.toContain("level");
    wrapper!.unmount();
    mountBar({ modelValue: used });
    await openBar();
    expect(rowKeys()).toContain("level");
  });

  it("offers no shorthand or custom-field row for a field a one-per-field profile already uses", async () => {
    const used = parseSqlFilter("level = 'a' AND my_col = 'b'")!;
    mountBar({ profile: "rum-funnel", modelValue: used });
    await openBar();
    await type("level=x");
    expect(rowKeys()).not.toContain("\u0000shorthand");
    await type("my_col");
    expect(rowKeys()).not.toContain("\u0000custom-field");
    await type("other_col");
    expect(rowKeys()).toContain("\u0000custom-field");
    await type("status=1");
    expect(rowKeys()).toContain("\u0000shorthand");
  });

  it("finds a field by its shown label as well as its name", async () => {
    mountBar({
      fields: [
        { name: "response_time_ms", type: "number", label: "Response time (ms)" },
        { name: "body", type: "string", label: "Response body" },
      ],
    });
    await openBar();
    await type("Response time");
    expect(rowKeys()).toEqual(["response_time_ms"]);
    await type("resp");
    expect(rowKeys()).toEqual(["response_time_ms", "body"]);
  });

  it("takes a comma list of fallback keys as one custom field only where the profile allows it", async () => {
    mountBar({ profile: "model-pricing" });
    await openBar();
    await type("anthropic.response.tier, anthropic.request.tier");
    expect(rowKeys()).toContain("\u0000custom-field");
    wrapper!.unmount();
    mountBar({ allowCustomFields: true });
    await openBar();
    await type("a.b, c.d");
    expect(rowKeys()).not.toContain("\u0000custom-field");
  });

  describe("extra suggestions", () => {
    const extraSuggestions = {
      title: "Recent searches",
      rows: [{ key: "one", label: "level = 'a'" }],
    };
    const EXTRA = "extra-one";

    it("lists them first while the bar is empty and hides them on typing", async () => {
      mountBar({ extraSuggestions });
      await openBar();
      expect(rowKeys()[0]).toBe(EXTRA);
      expect(rowKeys()).toContain("level");
      await type("l");
      expect(rowKeys()).not.toContain(EXTRA);
    });

    it("leaves them out once the bar holds a filter", async () => {
      mountBar({ extraSuggestions, modelValue: parseSqlFilter("level = 'a'")! });
      await openBar();
      expect(rowKeys()).not.toContain(EXTRA);
    });

    it("reaches a row with the keyboard and hands the host its own key", async () => {
      const onExtraSelect = vi.fn();
      mountBar({ extraSuggestions, onExtraSelect });
      await openBar();
      await press("ArrowDown");
      await press("Enter");
      expect(onExtraSelect).toHaveBeenCalledExactlyOnceWith("one", expect.any(KeyboardEvent));
      expect(rows()).toHaveLength(0);
    });

    it("leaves Enter on an empty caret running the query", async () => {
      const onSubmit = vi.fn();
      mountBar({ extraSuggestions, onSubmit });
      await openBar();
      await press("Enter");
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it("treats a field that looks like an extra row as a field", async () => {
      const onExtraSelect = vi.fn();
      mountBar({
        fields: [{ name: "extra-two", type: "string" }],
        extraSuggestions,
        onExtraSelect,
      });
      await openBar();
      await type("extra");
      await press("Enter");
      expect(onExtraSelect).not.toHaveBeenCalled();
      expect(wrapper!.find('[data-test="query-filter-bar-draft"]').exists()).toBe(true);
    });
  });

  describe("value suggestions", () => {
    const withService: FilterField[] = [...fields, { name: "service", type: "string" }];

    async function pickEquals(field: string) {
      await openBar();
      await type(field);
      await press("Enter");
      await press("Enter");
    }

    async function leave() {
      await press("Escape");
      await press("Escape");
    }

    it("asks the loader again each time, so a host whose context changed is not shown old values", async () => {
      let context = "a";
      const loadValues = vi.fn(async () => [`${context}-1`]);
      mountBar({ loadValues });
      await pickEquals("level");
      await vi.waitFor(() => expect(rowKeys()).toContain("a-1"));
      await leave();
      context = "b";
      await pickEquals("level");
      await vi.waitFor(() => expect(rowKeys()).toContain("b-1"));
      expect(rowKeys()).not.toContain("a-1");
      expect(loadValues).toHaveBeenCalledTimes(2);
    });

    it("does not keep an empty answer, so values show once the host recovers", async () => {
      const loadValues = vi.fn(async () => [] as string[]);
      mountBar({ loadValues });
      await pickEquals("level");
      await vi.waitFor(() => expect(loadValues).toHaveBeenCalledTimes(1));
      await leave();
      loadValues.mockResolvedValue(["error"]);
      await pickEquals("level");
      await vi.waitFor(() => expect(rowKeys()).toContain("error"));
    });

    it("drops a slow answer for a field the user already left", async () => {
      let landLevel: (values: string[]) => void = () => {};
      const loadValues = vi.fn((field: string) =>
        field === "level"
          ? new Promise<string[]>((resolve) => (landLevel = resolve))
          : Promise.resolve(["cart"]),
      );
      mountBar({ fields: withService, loadValues });
      await pickEquals("service");
      await vi.waitFor(() => expect(rowKeys()).toContain("cart"));
      await leave();
      await pickEquals("level");
      await vi.waitFor(() => expect(loadValues).toHaveBeenCalledWith("level", ""));
      await leave();
      await pickEquals("service");
      await vi.waitFor(() => expect(rowKeys()).toContain("cart"));
      landLevel(["error"]);
      await flushPromises();
      expect(rowKeys()).toContain("cart");
      expect(rowKeys()).not.toContain("error");
      expect(
        document.body.querySelector('[data-test="query-filter-bar-suggest"] [role="status"]'),
      ).toBeNull();
    });
  });

  it("splits values on a typed comma only in a multi-value step", async () => {
    const state = mountBar({ loadValues: vi.fn(async () => []) });
    await openBar();
    await type("level");
    await press("Enter");
    await type("any");
    await press("Enter");
    await type("a");
    await press(",");
    await type("b");
    await press(",");
    await press("Enter");
    expect(sql(state)).toBe("level IN ('a', 'b')");
    await type("level");
    await press("Enter");
    await press("Enter");
    const comma = new KeyboardEvent("keydown", { key: ",", bubbles: true, cancelable: true });
    input()!.dispatchEvent(comma);
    expect(comma.defaultPrevented).toBe(false);
  });

  it("draws no OR group controls outside any-of-groups bars", () => {
    mountBar({ modelValue: parseSqlFilter("level = 'a' AND (level = 'b' OR status = 1)")! });
    expect(wrapper!.find('[data-test="query-filter-bar-add-group"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test^="query-filter-bar-group-add-"]').exists()).toBe(false);
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
