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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import ExplorerResultRow from "./ExplorerResultRow.vue";

const mountRow = (expanded = false, attach = false) =>
  mount(ExplorerResultRow, {
    ...(attach ? { attachTo: document.body } : {}),
    props: {
      record: { _timestamp: 1, level: "error" },
      time: "10:05:00",
      expanded,
      openLabel: "Open",
      openDataTest: "row-open",
    },
    global: { plugins: [i18n, store] },
  });

// A real click with its click count: test-utils cannot set a MouseEvent detail.
const click = (row: { element: Element }, detail: number) =>
  row.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));

describe("ExplorerResultRow", () => {
  // jsdom computes no Tailwind, so the row's look is pinned by its classes. The chevron must carry
  // its own: the drawer's scoped .dld-expand-btn rule does not reach this component, and without
  // them the button falls back to the browser's 20px default and the row grows from 25px to 29px.
  it("styles its own expand chevron, as the Logs Explorer's row did", () => {
    const button = mountRow().find("button.dld-expand-btn");
    expect(button.classes()).toEqual(
      expect.arrayContaining([
        "items-center",
        "justify-center",
        "size-5!",
        "p-0.5!",
        "border-0",
        "bg-transparent",
        "text-text-secondary",
        "hover:text-text-body",
      ]),
    );
  });

  it("keeps the Logs Explorer's row spacing and hover", () => {
    expect(mountRow().classes()).toEqual(
      expect.arrayContaining([
        "dld-result-row",
        "px-2",
        "py-1",
        "gap-2",
        "border-b",
        "hover:bg-surface-subtle",
      ]),
    );
  });

  it("both chevrons are named buttons a keyboard can reach and press", async () => {
    const row = mountRow(true);
    const [expand, open] = row.findAll("button");
    expect(expand.attributes("aria-label")).toBe("Collapse");
    expect(expand.attributes("aria-expanded")).toBe("true");
    expect(open.attributes("aria-label")).toBe("Open");
    expect(open.attributes("data-test")).toBe("row-open");
    expect(open.attributes("tabindex")).not.toBe("-1");
    await open.trigger("click");
    expect(row.emitted("open")).toHaveLength(1);
  });

  it("the left chevron toggles the JSON and never opens the detail", async () => {
    const row = mountRow(true);
    expect(row.find("button").attributes("aria-label")).toBe("Collapse");
    await row.find("button").trigger("click");
    expect(row.emitted("toggle")).toHaveLength(1);
    expect(row.emitted("open")).toBeUndefined();
  });

  it("a row click opens the detail after the double-click gap; the right › opens at once", async () => {
    vi.useFakeTimers();
    try {
      const row = mountRow();
      click(row, 1);
      expect(row.emitted("open")).toBeUndefined();
      vi.advanceTimersByTime(250);
      expect(row.emitted("open")).toHaveLength(1);
      await row.find("[data-test='row-open']").trigger("click");
      expect(row.emitted("open")).toHaveLength(2);
      expect(row.emitted("toggle")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a double-click selects text and never opens the detail", async () => {
    vi.useFakeTimers();
    try {
      const row = mountRow();
      click(row, 1);
      vi.advanceTimersByTime(100);
      click(row, 2);
      await row.trigger("dblclick");
      vi.advanceTimersByTime(1000);
      expect(row.emitted("open")).toBeUndefined();
      // A later single click still opens it.
      click(row, 1);
      vi.advanceTimersByTime(250);
      expect(row.emitted("open")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a click whose open is pending is dropped when the row goes away", async () => {
    vi.useFakeTimers();
    try {
      const row = mountRow();
      click(row, 1);
      row.unmount();
      vi.advanceTimersByTime(1000);
      expect(row.emitted("open")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Enter on the focused row opens the detail; Enter on the chevron does not", async () => {
    const row = mountRow();
    expect(row.attributes("tabindex")).toBe("0");
    await row.trigger("keydown", { key: "Enter" });
    await row.find("button").trigger("keydown", { key: "Enter" });
    expect(row.emitted("open")).toHaveLength(1);
  });

  it("a click that ends a text selection in the row keeps the selection, opening nothing", async () => {
    const row = mountRow(false, true);
    const text = row.find("[data-test='explorer-result-record']").element;
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await row.trigger("click");
    expect(row.emitted("open")).toBeUndefined();

    // With the selection gone, the same click opens the detail (after the double-click gap).
    selection.removeAllRanges();
    vi.useFakeTimers();
    try {
      click(row, 1);
      vi.advanceTimersByTime(250);
    } finally {
      vi.useRealTimers();
    }
    expect(row.emitted("open")).toHaveLength(1);
    row.unmount();
  });
});
