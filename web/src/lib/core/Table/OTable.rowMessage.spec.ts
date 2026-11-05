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

import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import OTable from "./OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "./OTable.types";
import { raw } from "@/types/i18n";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { common: { dismiss: "Dismiss" } } },
});

const columns: OTableColumnDef<any>[] = [
  { id: "name", header: "Name", accessorKey: "name", size: 160 },
  { id: "outcome", header: "Outcome", accessorKey: "outcome", size: 100 },
  { id: "owner", header: "Owner", accessorKey: "owner", size: 100 },
  { id: "actions", header: "", isAction: true, size: 80, cell: () => "act" },
];
const rows = [
  { id: "a", name: "checkout", outcome: "OK", owner: "payments" },
  { id: "b", name: "inventory", outcome: "OK", owner: "supply" },
];

let wrapper: VueWrapper<any> | null = null;
const mountTable = (props: Record<string, unknown> = {}) => {
  wrapper = mount(OTable as any, {
    props: { data: rows, columns, rowKey: "id", ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  return wrapper;
};
const rowCells = (w: VueWrapper<any>, index: number) =>
  w.find(`[data-test="o2-table-row-${index}"]`).findAll("td");

describe("OTable row messages", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("renders every cell when no message is given", () => {
    const w = mountTable();
    expect(rowCells(w, 0)).toHaveLength(4);
    expect(w.find('[data-test="o2-table-row-message-cell"]').exists()).toBe(false);
  });

  it("covers the middle cells of that row only, keeping the name and the actions in place", () => {
    const w = mountTable({
      rowMessages: { a: { text: raw("Couldn't pause: try again."), dataTest: "row-a-error" } },
    });
    const cells = rowCells(w, 0);
    expect(cells).toHaveLength(3);
    expect(cells[0].text()).toContain("checkout");
    expect(cells[1].attributes("colspan")).toBe("2");
    expect(cells[2].text()).toContain("act");
    const message = w.find('[data-test="row-a-error"]');
    expect(message.attributes("role")).toBe("alert");
    expect(message.text()).toContain("Couldn't pause: try again.");
    expect(message.classes()).toContain("text-status-error-text");
    expect(rowCells(w, 1)).toHaveLength(4);
  });

  it("asks the caller to dismiss with the row's key and does not open the row", async () => {
    const w = mountTable({
      rowMessages: { b: { text: raw("Couldn't resume"), dataTest: "row-b-error" } },
    });
    const dismiss = w.find('[data-test="row-b-error-dismiss"]');
    expect(dismiss.attributes("aria-label")).toBe("Dismiss");
    await dismiss.trigger("click");
    expect(w.emitted("row-message-dismiss")).toEqual([["b"]]);
    expect(w.emitted("row-click")).toBeUndefined();
  });

  it("keeps Dismiss clear of the pinned actions when the table scrolls sideways", () => {
    const w = mountTable({ rowMessages: { a: { text: raw("Failed"), dataTest: "row-a-error" } } });
    const dismiss = w.find('[data-test="row-a-error-dismiss"]');
    const style = dismiss.attributes("style") ?? "";
    expect(dismiss.classes()).toContain("sticky");
    expect(w.find('[data-test="o2-table-row-message-text"]').classes()).toContain("sticky");
    const inset = Number(/inset-inline-end: (\d+)px/.exec(style)?.[1]);
    expect(inset).toBeGreaterThanOrEqual(80);
  });

  it("leaves Dismiss in the flow when nothing is pinned after the message", () => {
    const w = mount(OTable as any, {
      props: {
        data: rows,
        columns: columns.slice(0, 3),
        rowKey: "id",
        rowMessages: { a: { text: raw("Failed"), dataTest: "row-a-error" } },
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    wrapper = w;
    expect(w.find('[data-test="row-a-error-dismiss"]').classes()).not.toContain("sticky");
  });

  it("shrinks to an announced marker with Dismiss when only the name and actions show", async () => {
    const w = mount(OTable as any, {
      props: {
        data: rows,
        columns: [columns[0], columns[3]],
        rowKey: "id",
        rowMessages: { a: { text: raw("Couldn't pause: try again."), dataTest: "row-a-error" } },
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    wrapper = w;
    expect(rowCells(w, 0)).toHaveLength(2);
    expect(rowCells(w, 0)[0].text()).toContain("checkout");
    const message = w.find('[data-test="o2-table-cell-name"] [data-test="row-a-error"]');
    expect(message.attributes("role")).toBe("alert");
    expect(message.text()).toContain("Couldn't pause: try again.");
    const marker = message.find('[data-test="o2-table-row-message-marker"]');
    expect(marker.attributes("tabindex")).toBe("0");
    expect(marker.classes()).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-2",
        "focus-visible:outline-solid",
        "focus-visible:outline-focus-ring-accent",
      ]),
    );
    const markerTip = w
      .findAllComponents(OTooltip)
      .find((tip) => tip.props("content") === "Couldn't pause: try again.");
    expect(markerTip?.props("exclusive")).toBe(true);
    await w.find('[data-test="row-a-error-dismiss"]').trigger("click");
    expect(w.emitted("row-message-dismiss")).toEqual([["a"]]);
  });

  it("uses the marker, not the zero-wide spacer, when a resizable table shows only the name and actions", () => {
    const w = mount(OTable as any, {
      props: {
        data: rows,
        columns: [columns[0], columns[3]],
        rowKey: "id",
        enableColumnResize: true,
        defaultColumns: false,
        rowMessages: { a: { text: raw("Failed"), dataTest: "row-a-error" } },
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    wrapper = w;
    expect(w.find('[data-test="o2-table-th-__spacer__"]').exists()).toBe(true);
    expect(w.find('[data-test="o2-table-row-message-cell"]').exists()).toBe(false);
    expect(w.find('[data-test="o2-table-cell-name"] [data-test="row-a-error"]').exists()).toBe(
      true,
    );
  });

  it("shows the marker inside a pinned cell when every column is pinned", () => {
    const w = mount(OTable as any, {
      props: {
        data: rows,
        columns: [{ ...columns[0], pinned: "left" }, columns[3]],
        rowKey: "id",
        rowMessages: { b: { text: raw("Couldn't resume"), dataTest: "row-b-error" } },
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    wrapper = w;
    const cell = w.find('[data-test="o2-table-row-1"] [data-test="o2-table-cell-name"]');
    expect(cell.attributes("style")).toContain("position: sticky");
    expect(
      cell.find('[data-test="o2-table-cell-overlay"] [data-test="row-b-error"]').exists(),
    ).toBe(true);
    expect(w.find('[data-test="o2-table-row-message-cell"]').exists()).toBe(false);
  });

  it("keeps the message until the caller drops it", async () => {
    const w = mountTable({ rowMessages: { a: { text: raw("Failed"), dataTest: "row-a-error" } } });
    await w.setProps({ data: [...rows] });
    expect(w.find('[data-test="row-a-error"]').exists()).toBe(true);
    await w.setProps({ rowMessages: {} });
    expect(w.find('[data-test="row-a-error"]').exists()).toBe(false);
    expect(rowCells(w, 0)).toHaveLength(4);
  });
});
