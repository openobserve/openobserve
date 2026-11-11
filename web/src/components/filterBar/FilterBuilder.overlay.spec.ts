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
import { defineComponent, h, nextTick, ref, type Component } from "vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import FilterBuilder from "./FilterBuilder.vue";
import type { FilterProfileName } from "./filterProfiles";
import type { FilterField } from "@/utils/query/filterBar";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "status", type: "number" },
  { name: "message", type: "string" },
];

const DT = "fb";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

const leaf = (column: string, operator: string, value: unknown, logicalOperator = "AND") => ({
  filterType: "condition",
  column,
  operator,
  value,
  logicalOperator,
});

const saved = () => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: "root",
  conditions: [
    leaf("level", "=", "error"),
    {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "nested",
      conditions: [leaf("status", ">=", "500"), leaf("message", "contains", "timeout", "OR")],
    },
  ],
});

const macrotask = () => new Promise((resolve) => setTimeout(resolve));

async function settle() {
  await flushPromises();
  await nextTick();
  await macrotask();
  await flushPromises();
}

function mountIn(overlay: Component, profile: FilterProfileName) {
  const model = ref<unknown>(saved());
  const Host = defineComponent({
    setup() {
      return () =>
        h(
          overlay,
          { open: true, title: "Host" },
          {
            default: () =>
              h(FilterBuilder, {
                profile,
                modelValue: model.value,
                fields,
                dataTest: DT,
                loadValues: vi.fn(async () => ["error", "warn"]),
                "onUpdate:modelValue": (next: unknown) => {
                  model.value = next;
                },
              }),
          },
        );
    },
  });
  wrapper = mount(Host, { attachTo: document.body });
  return model;
}

const el = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${DT}-${id}"]`);
const caret = () => el("input") as HTMLInputElement;
const listOpen = () => Boolean(el("suggest"));

async function click(id: string) {
  el(id)!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el(id)!.click();
  await settle();
}

async function type(text: string) {
  caret().value = text;
  caret().dispatchEvent(new Event("input"));
  await settle();
}

async function press(key: string) {
  caret().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await settle();
}

async function pickRow(key: string) {
  el(`suggest-item-${key}`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
}

const hosts: [string, Component, FilterProfileName][] = [
  ["pipeline drawer", ODrawer, "pipeline"],
  ["annotation drawer", ODrawer, "annotation"],
  ["dialog", ODialog, "pipeline"],
];

describe.each(hosts)("FilterBuilder inside a %s", (_name, overlay, profile) => {
  it("keeps the list, the caret and the new group after Add group on a saved nested group", async () => {
    const model = mountIn(overlay, profile);
    await settle();
    expect(el("group-1")).not.toBeNull();
    // The root list is already open, so the dialog's focus trap is paused under the popover.
    await click("add-condition");
    expect(listOpen()).toBe(true);
    const input = caret();

    await click("add-group-1");

    expect(listOpen()).toBe(true);
    expect(el("group-1-2")).not.toBeNull();
    expect(caret()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.closest(`[data-test="${DT}-group-1-2"]`)).not.toBeNull();

    await type("level");
    await press("Enter");
    await pickRow("eq");
    await type("warn");
    await press("Enter");
    expect(el("group-1-2")?.textContent).toContain("warn");
    const nested = (model.value as any).conditions[1];
    expect(nested.conditions[2]).toMatchObject({
      filterType: "group",
      conditions: [{ column: "level", operator: "=", value: "warn" }],
    });
  });

  it("keeps the list and the caret inside the group after Add condition on a saved nested group", async () => {
    mountIn(overlay, profile);
    await settle();
    await click("add-condition");
    expect(listOpen()).toBe(true);

    await click("add-condition-1");

    expect(listOpen()).toBe(true);
    expect(document.activeElement).toBe(caret());
    expect(caret().closest(`[data-test="${DT}-group-1"]`)).not.toBeNull();
  });
});
