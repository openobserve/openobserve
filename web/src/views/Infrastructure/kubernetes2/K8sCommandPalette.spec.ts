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

import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import i18n from "@/locales";
import K8sCommandPalette from "./K8sCommandPalette.vue";
import type { PaletteGroup, PaletteItem } from "./k8sPalette";

enableAutoUnmount(afterEach);

const entry = (id: string, group: PaletteGroup, label: string): PaletteItem => ({
  id,
  group,
  label: raw(label),
  sub: raw("sub"),
  icon: "hub",
  search: label,
  hot: false,
  target: { type: "cluster", cluster: label } as any,
});

const items: PaletteItem[] = [
  entry("a", "goTo", "alpha pods"),
  entry("b", "goTo", "alpha nodes"),
  entry("c", "clusters", "prod"),
  entry("d", "clusters", "stage"),
];

const body = () => document.body;
const q = (selector: string) => body().querySelector(selector) as HTMLElement | null;
const option = (index: number) => q(`[data-test="k8s2-palette-item-${index}"]`);
const input = () =>
  q(
    '[data-test="k8s2-palette-input"] input, input[data-test="k8s2-palette-input"]',
  ) as HTMLInputElement;

const open = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(K8sCommandPalette, {
    props: { open: true, items, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const type = async (value: string) => {
  input().value = value;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
};

const press = async (key: string) => {
  option(0)!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await flushPromises();
};

describe("K8sCommandPalette", () => {
  it("lists results under group headers", async () => {
    await open();
    await type("s");
    expect(q('[data-test="k8s2-palette-group-goTo"]')).not.toBeNull();
    expect(q('[data-test="k8s2-palette-group-clusters"]')).not.toBeNull();
    expect(body().querySelectorAll('[role="option"]')).toHaveLength(4);
  });

  it("filters the list as the query is typed", async () => {
    await open();
    input().value = "stage";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(body().querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(option(0)!.textContent).toContain("stage");
  });

  it("shows the empty state when nothing matches", async () => {
    await open();
    input().value = "zzzzqq";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(q('[data-test="k8s2-palette-empty"]')).not.toBeNull();
  });

  it("moves the active option with the arrow keys and wraps at both ends", async () => {
    await open();
    await type("s");
    expect(option(0)!.getAttribute("aria-selected")).toBe("true");
    await press("ArrowDown");
    expect(option(1)!.getAttribute("aria-selected")).toBe("true");
    await press("ArrowUp");
    await press("ArrowUp");
    expect(option(3)!.getAttribute("aria-selected")).toBe("true");
    await press("ArrowDown");
    expect(option(0)!.getAttribute("aria-selected")).toBe("true");
  });

  it("selects the active item on Enter and closes", async () => {
    const wrapper = await open();
    await press("ArrowDown");
    await press("Enter");
    expect(wrapper.emitted("select")).toEqual([[items[1]]]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("points the input at the highlighted option and keeps headers out of the listbox roles", async () => {
    await open();
    await type("s");
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-haspopup")).toBe("listbox");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-controls")).toBe("k8s2-palette-listbox");
    expect(input().getAttribute("aria-activedescendant")).toBe(option(0)!.id);
    await press("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(option(1)!.id);
    expect(q('[data-test="k8s2-palette-group-goTo"]')!.getAttribute("role")).toBe("presentation");
  });

  it("says when results are cut, and not otherwise", async () => {
    const wrapper = await open({
      items: Array.from({ length: 20 }, (_, i) => entry(`m${i}`, "pods", `match ${i}`)),
    });
    await type("match");
    expect(q('[data-test="k8s2-palette-more"]')!.textContent).toContain("Showing 12 of 20");
    await wrapper.setProps({ items });
    await type("alpha");
    expect(q('[data-test="k8s2-palette-more"]')).toBeNull();
  });

  it("lists every cluster for an empty query when scoped to the clusters group", async () => {
    await open({ group: "clusters" });
    expect(body().querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(q('[data-test="k8s2-palette-group-goTo"]')).toBeNull();
  });

  it("shows no status line when the index is complete", async () => {
    await open();
    expect(q('[data-test="k8s2-palette-status"]')).toBeNull();
  });

  it("says resources are loading while the index loads", async () => {
    await open({ loading: true });
    expect(q('[data-test="k8s2-palette-status"]')!.textContent).toContain("Loading resources…");
  });

  it("notes the fallback when the index failed, ahead of the loading note", async () => {
    await open({ indexFailed: true, loading: true });
    expect(q('[data-test="k8s2-palette-status"]')!.textContent).toContain(
      "Showing only the resources this view has loaded.",
    );
  });

  it("notes a truncated index", async () => {
    await open({ truncated: true });
    expect(q('[data-test="k8s2-palette-status"]')!.textContent).toContain("20,000");
  });

  it("hides the status line in the cluster switcher", async () => {
    await open({ loading: true, group: "clusters" });
    expect(q('[data-test="k8s2-palette-status"]')).toBeNull();
  });
});
