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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, nextTick, ref } from "vue";
import TemplateList from "./TemplateList.vue";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// One viewport flag drives TemplateList and OTable, as the real matchMedia singleton does.
const mdUpRef = ref(true);
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({
    isMobile: computed(() => !mdUpRef.value),
    isTablet: computed(() => false),
    isDesktop: computed(() => mdUpRef.value),
    mdUp: computed(() => mdUpRef.value),
    lgUp: computed(() => mdUpRef.value),
  }),
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const headers = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="alert-templates-list-table"] th').map((th) => th.text().trim());

describe("TemplateList at phone width (B37)", { timeout: 15000 }, () => {
  let wrapper: VueWrapper | undefined;

  const mountList = async () => {
    wrapper = mount(TemplateList, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    mdUpRef.value = true;
  });

  it("hides Applies to and Used by below md so the name keeps the row width", async () => {
    mdUpRef.value = false;
    await mountList();

    const table = wrapper!.findComponent({ name: "OTable" });
    expect(table.props("columnVisibility")).toEqual({ applies_to: false, used_by: false });
    const shown = headers(wrapper!);
    expect(shown).toContain("Name");
    expect(shown).not.toContain("Applies to");
    expect(shown).not.toContain("Used by");
  });

  const toggle = () => wrapper!.findComponent({ name: "OTableColumnToggle" });
  const choose = async (visibility: Record<string, boolean>) => {
    toggle().vm.$emit("update:columnVisibility", visibility);
    await flushPromises();
  };
  const resize = async (desktop: boolean) => {
    mdUpRef.value = desktop;
    await nextTick();
    await flushPromises();
  };

  it("lets a phone user show a hidden column again from the column chooser", async () => {
    mdUpRef.value = false;
    await mountList();

    expect(toggle().exists()).toBe(true);
    expect(
      toggle()
        .props("columns")
        .map((c: { id: string }) => c.id),
    ).toEqual(expect.arrayContaining(["applies_to", "used_by"]));
    await choose({ applies_to: true, used_by: false });

    const shown = headers(wrapper!);
    expect(shown).toContain("Applies to");
    expect(shown).not.toContain("Used by");
  });

  it("keeps a phone choice from hiding the untouched column on desktop", async () => {
    mdUpRef.value = false;
    await mountList();
    await choose({ applies_to: true, used_by: false });

    await resize(true);
    expect(headers(wrapper!)).toEqual(expect.arrayContaining(["Applies to", "Used by"]));
  });

  it("keeps a desktop hide from showing the untouched column on a phone", async () => {
    await mountList();
    await choose({ applies_to: false, used_by: true });
    expect(headers(wrapper!)).not.toContain("Applies to");

    await resize(false);
    const shown = headers(wrapper!);
    expect(shown).not.toContain("Applies to");
    expect(shown).not.toContain("Used by");
  });

  it("returns to the viewport defaults on Reset", async () => {
    mdUpRef.value = false;
    await mountList();
    await choose({ applies_to: true, used_by: true });
    expect(toggle().props("defaultColumnVisibility")).toEqual({
      applies_to: false,
      used_by: false,
    });

    await choose({ applies_to: false, used_by: false });
    expect(headers(wrapper!)).not.toContain("Applies to");
    await resize(true);
    expect(headers(wrapper!)).toEqual(expect.arrayContaining(["Applies to", "Used by"]));
  });

  it("clears a choice made on the other viewport on Reset", async () => {
    mdUpRef.value = false;
    await mountList();
    await choose({ applies_to: true, used_by: false });
    await resize(true);
    await choose({ applies_to: true, used_by: false });
    expect(headers(wrapper!)).not.toContain("Used by");

    await choose({ applies_to: true, used_by: true });
    await resize(false);
    const shown = headers(wrapper!);
    expect(shown).not.toContain("Applies to");
    expect(shown).not.toContain("Used by");
  });

  it("shows both columns again when the viewport grows to md", async () => {
    mdUpRef.value = false;
    await mountList();

    mdUpRef.value = true;
    await nextTick();
    await flushPromises();

    const shown = headers(wrapper!);
    expect(shown).toContain("Applies to");
    expect(shown).toContain("Used by");
  });

  it("keeps both columns at desktop width and leaves them hideable", async () => {
    await mountList();

    const shown = headers(wrapper!);
    expect(shown).toContain("Applies to");
    expect(shown).toContain("Used by");
    const columns = wrapper!.findComponent({ name: "OTable" }).props("columns") as {
      id: string;
      hideable?: boolean;
    }[];
    expect(columns.find((c) => c.id === "applies_to")?.hideable).toBe(true);
    expect(columns.find((c) => c.id === "used_by")?.hideable).toBe(true);
  });
});
