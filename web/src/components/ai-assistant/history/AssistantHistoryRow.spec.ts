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
    const wrapper = setup();
    expect(wrapper.element.tagName).toBe("LI");
    const button = wrapper.get('[data-test="assistant-history-row"]');
    expect(button.attributes("aria-label")).toBeUndefined();
    expect(button.text()).toMatch(/^Checkout 5xx spike, .+$/);
    expect(button.attributes("tabindex")).toBe("0");
    expect(button.find('[data-test="assistant-history-row-menu"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-history-row-menu"]').attributes("aria-label")).toBe(
      "Actions for Checkout 5xx spike",
    );
  });

  it("lets the title wrap to its two-line clamp inside the nowrap row button", () => {
    const title = setup().get('[data-test="assistant-history-row"] [data-test="o-truncated-text"]');
    expect(title.classes()).toEqual(expect.arrayContaining(["line-clamp-2", "whitespace-normal"]));
  });

  it("drops the title bubble once the row is chosen, and brings it back after the pointer leaves (X1)", async () => {
    const wrapper = setup();
    const title = () => wrapper.get('[data-test="o-truncated-text"]');
    expect(title().attributes("data-o-tooltip-off")).toBeUndefined();
    const button = wrapper.get('[data-test="assistant-history-row"]');
    await button.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(title().attributes("data-o-tooltip-off")).toBe("");
    await button.trigger("pointerleave");
    expect(title().attributes("data-o-tooltip-off")).toBeUndefined();
  });

  it("lifts the time to body text on the filled current and hovered row (AA)", () => {
    const current = setup({}, { current: true });
    const time = current.get('[data-test="assistant-history-row-time"]');
    expect(time.classes()).toEqual(
      expect.arrayContaining(["text-text-body!", "group-hover/row:text-text-body!"]),
    );
    document.body.innerHTML = "";
    const other = setup();
    expect(other.get('[data-test="assistant-history-row-time"]').classes()).not.toContain(
      "text-text-body!",
    );
  });

  it("marks the current chat and keeps the other rows out of the Tab order", () => {
    const current = setup({}, { current: true });
    expect(current.get('[data-test="assistant-history-row"]').attributes("aria-current")).toBe(
      "true",
    );
    expect(current.classes()).toContain("bg-surface-subtle");
    document.body.innerHTML = "";
    const other = setup({}, { tabbable: false });
    expect(
      other.get('[data-test="assistant-history-row"]').attributes("aria-current"),
    ).toBeUndefined();
    expect(other.get('[data-test="assistant-history-row"]').attributes("tabindex")).toBe("-1");
  });

  it("shows the status word instead of the time, beside the row's leading light (v7 IMPL-PLAN Threads)", () => {
    const answering = setup({ activeTurn: true });
    expect(answering.get('[data-test="assistant-history-row-state"]').text()).toBe("Answering");
    expect(answering.find('[data-test="assistant-history-row-time"]').exists()).toBe(false);
    expect(answering.find('[data-test="assistant-status-dot"]').attributes("data-state")).toBe(
      "working",
    );
    document.body.innerHTML = "";
    const needs = setup(
      { activeTurn: true, pendingApproval: true },
      { expiresAt: 222_000, now: 0 },
    );
    expect(needs.get('[data-test="assistant-history-row-state"]').text()).toBe("Needs you · 3:42");
    expect(needs.get('[data-test="assistant-history-row-state"]').classes()).toContain(
      "text-assistant-signal-attention",
    );
    document.body.innerHTML = "";
    const failed = setup({}, { status: "failed" });
    expect(failed.get('[data-test="assistant-history-row-state"]').text()).toBe("Failed");
    document.body.innerHTML = "";
    const idle = setup();
    expect(idle.find('[data-test="assistant-history-row-state"]').exists()).toBe(false);
    expect(idle.find('[data-test="assistant-history-row-time"]').exists()).toBe(true);
  });

  it("puts another org on the second line, with no menu and no opening in place", async () => {
    const wrapper = await armed({}, { org: "Payments EU" });
    expect(wrapper.get('[data-test="assistant-history-row-org"]').text()).toBe("Payments EU");
    expect(wrapper.find('[data-test="assistant-history-row-menu"]').exists()).toBe(false);
    await wrapper.get('[data-test="assistant-history-row"]').trigger("click");
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("offers a draft only Delete draft", async () => {
    const wrapper = await armed({}, { status: "draft" });
    await wrapper.get('[data-test="assistant-history-row-deleteDraft"]').trigger("click");
    expect(wrapper.emitted("delete-draft")).toHaveLength(1);
    expect(menuIds(wrapper)).toEqual(["assistant-history-row-deleteDraft"]);
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
      "assistant-history-row-float",
      "assistant-history-row-rename",
      "assistant-history-row-pin",
      "assistant-history-row-share",
      "assistant-history-row-export",
      "assistant-history-row-delete",
    ]);
    document.body.innerHTML = "";
    expect(menuIds(await armed({ activeTurn: true }))).toContain("assistant-history-row-stop");
    document.body.innerHTML = "";
    expect(menuIds(await armed({ local: true }))).toEqual([
      "assistant-history-row-export",
      "assistant-history-row-delete",
    ]);
    document.body.innerHTML = "";
    expect(menuIds(await armed({}, { readonly: true }))).toEqual([
      "assistant-history-row-float",
      "assistant-history-row-export",
    ]);
  });

  it("exports the row's chat as Markdown from its menu", async () => {
    const wrapper = await armed();
    await wrapper.get('[data-test="assistant-history-row-export"]').trigger("click");
    expect(wrapper.emitted("export")).toEqual([[historyRow().sid]]);
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

  it.each([
    [{ pendingApproval: true }, "attention"],
    [{ activeTurn: true }, "working"],
  ] as const)("leads %o with the board's %s light (B-shell2-5)", (row, signal) => {
    const wrapper = setup(row);
    const light = wrapper.get('[data-test="assistant-history-row-light"]');
    expect(light.attributes("data-signal")).toBe(signal);
    expect(light.find('[data-test="assistant-status-dot"]').attributes("data-state")).toBe(signal);
  });

  it("keeps the light's slot empty on a chat at rest, so titles stay on one edge", () => {
    const light = setup().get('[data-test="assistant-history-row-light"]');
    expect(light.attributes("data-signal")).toBeUndefined();
    expect(light.find('[data-test="assistant-status-dot"]').exists()).toBe(false);
    expect(light.classes()).toEqual(expect.arrayContaining(["w-4", "shrink-0"]));
  });

  it("marks a chat failed by this tab with the failed light", () => {
    const wrapper = setup({}, { status: "failed" });
    expect(wrapper.get('[data-test="assistant-history-row-light"]').attributes("data-signal")).toBe(
      "failed",
    );
  });

  it("shows the organization glyph on an org-shared chat and says so to assistive tech", () => {
    const share = {
      id: "s1",
      visibility: "org" as const,
      mode: "snapshot" as const,
      expiresAt: null,
      outOfDate: false,
      count: 1,
    };
    const wrapper = setup({ share });
    const glyph = wrapper.get('[data-test="assistant-history-row-shared"]');
    expect(glyph.attributes("data-visibility")).toBe("org");
    expect(wrapper.get('[data-test="assistant-history-row"]').text()).toContain(
      "Shared with your organization",
    );
    expect(setup().find('[data-test="assistant-history-row-shared"]').exists()).toBe(false);
  });

  it("shows the public-link glyph from the list's share read when the row itself carries none", () => {
    const glyph = setup({}, { sharedAs: "public" }).get(
      '[data-test="assistant-history-row-shared"]',
    );
    expect(glyph.attributes("data-visibility")).toBe("public");
  });
});
