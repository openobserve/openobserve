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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";

import type { HistoryRow } from "@/composables/assistant";

import { historyRow, historyStubs } from "../__tests__/historyStubs";
import AssistantHistoryRow, { type AssistantHistoryRowProps } from "./AssistantHistoryRow.vue";

function setup(row: Partial<HistoryRow> = {}, props: Partial<AssistantHistoryRowProps> = {}) {
  return mount(AssistantHistoryRow, {
    props: {
      row: historyRow(row),
      current: false,
      mode: "popover",
      pending: null,
      tabbable: true,
      serverMode: true,
      serverPins: true,
      timezone: "UTC",
      ...props,
    },
    global: { stubs: historyStubs },
    attachTo: document.body,
  });
}

// The menus mount once the row is pointed at, as a long list keeps them unmounted until then.
async function armed(row: Partial<HistoryRow> = {}, props: Partial<AssistantHistoryRowProps> = {}) {
  const wrapper = setup(row, props);
  await wrapper.get('[data-test="assistant-history-item"]').trigger("pointerenter");
  return wrapper;
}

// Rename from the menu waits a task, for the menu to hand focus back first.
async function rename(wrapper: ReturnType<typeof setup>) {
  await wrapper.get('[data-test="assistant-history-row-rename"]').trigger("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

const menuIds = (wrapper: ReturnType<typeof setup>) =>
  wrapper.findAll('[role="menu"] [data-test]').map((el) => el.attributes("data-test"));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AssistantHistoryRow", () => {
  it("is a list item with one row button named by title and time, and a separate kebab", () => {
    const wrapper = setup({ origin: "editor" });
    expect(wrapper.element.tagName).toBe("LI");
    const button = wrapper.get('[data-test="assistant-history-row"]');
    expect(button.attributes("aria-label")).toBeUndefined();
    expect(button.text()).toMatch(/^Checkout 5xx spike, .+, Editor$/);
    expect(button.attributes("tabindex")).toBe("0");
    expect(button.find('[data-test="assistant-history-row-menu"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-history-row-menu"]').attributes("aria-label")).toBe(
      "Actions for Checkout 5xx spike",
    );
    expect(wrapper.get('[data-test="assistant-history-row-origin"]').text()).toBe("Editor");
  });

  it("marks the current chat and keeps the other rows out of the Tab order", () => {
    const current = setup({}, { current: true });
    expect(current.get('[data-test="assistant-history-row"]').attributes("aria-current")).toBe(
      "true",
    );
    expect(current.classes()).toContain("border-s-border-strong");
    document.body.innerHTML = "";
    const other = setup({}, { tabbable: false });
    expect(
      other.get('[data-test="assistant-history-row"]').attributes("aria-current"),
    ).toBeUndefined();
    expect(other.get('[data-test="assistant-history-row"]').attributes("tabindex")).toBe("-1");
  });

  it("says answering, and waiting for approval before it", () => {
    const answering = setup({ activeTurn: true });
    expect(answering.get('[data-test="assistant-history-row-state"]').text()).toBe("Answering…");
    expect(answering.get('[data-test="assistant-history-row"]').text()).toMatch(/, Answering…$/);
    document.body.innerHTML = "";
    const needs = setup({ activeTurn: true, pendingApproval: true });
    expect(needs.get('[data-test="assistant-history-row-state"]').text()).toBe(
      "Waiting for your approval",
    );
  });

  it("keeps the text tokens while a change is pending and disables the kebab with the reason", () => {
    const wrapper = setup({}, { pending: "delete" });
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.get('[data-test="assistant-history-row-pending"]').text()).toBe("Deleting…");
    expect(wrapper.html()).not.toMatch(/opacity-(50|60)/);
    const kebab = wrapper.get('[data-test="assistant-history-row-menu"]');
    expect(kebab.attributes("aria-disabled")).toBe("true");
  });

  it("offers the full menu, a browser-only row only what it can do, and read-only none of the changes", async () => {
    expect(menuIds(setup())).toEqual([]);
    document.body.innerHTML = "";
    expect(menuIds(await armed())).toEqual([
      "assistant-history-row-open",
      "assistant-history-row-rename",
      "assistant-history-row-pin",
      "assistant-history-row-download-markdown",
      "assistant-history-row-download-json",
      "assistant-history-row-delete",
    ]);
    document.body.innerHTML = "";
    expect(menuIds(await armed({ local: true }))).toEqual([
      "assistant-history-row-open",
      "assistant-history-row-download-markdown",
      "assistant-history-row-download-json",
      "assistant-history-row-delete",
    ]);
    document.body.innerHTML = "";
    expect(menuIds(await armed({}, { readonly: true }))).toEqual([
      "assistant-history-row-open",
      "assistant-history-row-download-markdown",
      "assistant-history-row-download-json",
    ]);
  });

  it("names the browser pin when the server does not keep pins", async () => {
    const wrapper = await armed({ pinned: true }, { serverPins: false });
    expect(wrapper.get('[data-test="assistant-history-row-pin"]').text()).toBe(
      "Unpin (in this browser)",
    );
  });

  it("renames inline: Enter saves the trimmed title, Escape and blank change nothing", async () => {
    const wrapper = await armed();
    await rename(wrapper);
    const input = wrapper.get('[data-test="assistant-history-rename"] input');
    await input.setValue("  Payments p95  ");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toEqual([[historyRow().sid, "Payments p95"]]);
    await rename(wrapper);
    const again = wrapper.get('[data-test="assistant-history-rename"] input');
    await again.setValue("Other");
    await again.trigger("keydown", { key: "Escape" });
    await rename(wrapper);
    const blank = wrapper.get('[data-test="assistant-history-rename"] input');
    await blank.setValue("   ");
    await blank.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toHaveLength(1);
  });

  it("keeps an IME composition's Enter for the composition, not the save", async () => {
    const wrapper = await armed();
    await rename(wrapper);
    const input = wrapper.get('[data-test="assistant-history-rename"] input');
    await input.setValue("日本");
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    await input.trigger("keydown", { key: "Enter", keyCode: 229 });
    expect(wrapper.emitted("rename")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("rename")).toEqual([[historyRow().sid, "日本"]]);
  });

  it("mounts no menu until the row is pointed at or focused", async () => {
    const wrapper = setup();
    expect(wrapper.find('[data-test="assistant-history-row-rename"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-history-item"]').trigger("focusin");
    expect(wrapper.find('[data-test="assistant-history-row-rename"]').exists()).toBe(true);
  });

  it("stays a list item when a virtual list renders it as a div", () => {
    const wrapper = setup({}, { tag: "div" });
    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.attributes("role")).toBe("listitem");
  });

  it("shows the counter from 180 characters", async () => {
    const wrapper = await armed();
    await rename(wrapper);
    const input = wrapper.get('[data-test="assistant-history-rename"] input');
    await input.setValue("a".repeat(179));
    expect(wrapper.text()).not.toContain("179/200");
    await input.setValue("a".repeat(187));
    expect(wrapper.text()).toContain("187/200");
    await input.setValue("a".repeat(230));
    expect(wrapper.text()).toContain("200/200");
  });

  it("opens on click and forwards arrow keys to the list", async () => {
    const wrapper = setup();
    const button = wrapper.get('[data-test="assistant-history-row"]');
    await button.trigger("click");
    await button.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.emitted("open")).toEqual([[historyRow().sid]]);
    expect(wrapper.emitted("navigate")).toHaveLength(1);
  });
});
