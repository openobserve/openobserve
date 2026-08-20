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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import LibraryRail from "./LibraryRail.vue";
import type { LibraryFacet } from "./libraryFacets";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const packs: LibraryFacet[] = [
  { id: "k8s", label: raw("Kubernetes"), count: 86 },
  { id: "openobserve", label: raw("OpenObserve"), count: 1 },
  { id: "databases", label: raw("databases"), count: 230 },
];

const categories: LibraryFacet[] = [
  { id: "pod", label: raw("Pod"), count: 12 },
  { id: "node", label: raw("Node"), count: 9 },
  { id: "cert-manager", label: raw("Cert Manager"), count: 0 },
];

const severities: LibraryFacet[] = [
  { id: "all", label: raw("All"), count: 86 },
  { id: "critical", label: raw("Critical"), count: 20 },
  { id: "warning", label: raw("Warning"), count: 60 },
  { id: "info", label: raw("Info"), count: 6 },
];

const mountRail = (props: Record<string, unknown> = {}) =>
  mount(LibraryRail, {
    props: {
      packs,
      selectedPacks: [],
      categories,
      selectedCategories: [],
      severities,
      severity: "all",
      ...props,
    },
    global: { plugins: [i18n] },
  });

type Rail = ReturnType<typeof mountRail>;

/** Open the categories tab — the rail lists one axis at a time. */
const showCategories = (wrapper: Rail) =>
  wrapper.find('[data-test="alert-library-rail-axis-categories"]').trigger("click");

/** Tick or untick a row. OCheckbox owns nothing: it reports, the parent decides. */
const toggle = (wrapper: Rail, test: string) =>
  wrapper.find(`[data-test="${test}"]`).find('[role="checkbox"]').trigger("click");

// OInput sets inheritAttrs:false and re-derives child selectors, so the field
// itself is `<data-test>-field`.
const field = (wrapper: Rail, test: string) =>
  wrapper.find<HTMLInputElement>(`[data-test="${test}-field"]`);

const type = (wrapper: Rail, test: string, text: string) => field(wrapper, test).setValue(text);

describe("LibraryRail", () => {
  it("renders the two navigation axes and the severity group", () => {
    const text = mountRail().text();
    expect(text).toContain("Packs");
    expect(text).toContain("Category");
    expect(text).toContain("Severity");
  });

  it("lists every pack with its alert count", () => {
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="alert-library-rail-pack-k8s"]').text()).toContain(
      "Kubernetes",
    );
    expect(wrapper.find('[data-test="alert-library-rail-count-k8s"]').text()).toBe("86");
  });

  // ── selection ────────────────────────────────────────────────────────────
  it("adds a pack to the selection rather than replacing it", async () => {
    // The whole point of check marks: two packs can be on screen at once.
    const wrapper = mountRail({ selectedPacks: ["k8s"] });
    await toggle(wrapper, "alert-library-rail-pack-openobserve");
    expect(wrapper.emitted("update:selectedPacks")).toEqual([[["k8s", "openobserve"]]]);
  });

  it("removes a pack when its own box is unticked", async () => {
    const wrapper = mountRail({ selectedPacks: ["k8s", "openobserve"] });
    await toggle(wrapper, "alert-library-rail-pack-k8s");
    expect(wrapper.emitted("update:selectedPacks")).toEqual([[["openobserve"]]]);
  });

  it("shows the tick on exactly the selected rows", () => {
    const wrapper = mountRail({ selectedPacks: ["openobserve"] });
    const checked = (id: string) =>
      wrapper
        .find(`[data-test="alert-library-rail-pack-${id}"]`)
        .find('[role="checkbox"]')
        .attributes("aria-checked");
    expect(checked("openobserve")).toBe("true");
    expect(checked("k8s")).toBe("false");
  });

  it("selects categories the same way, on their own tab", async () => {
    const wrapper = mountRail({ selectedCategories: ["pod"] });
    await showCategories(wrapper);
    await toggle(wrapper, "alert-library-rail-category-node");
    expect(wrapper.emitted("update:selectedCategories")).toEqual([[["pod", "node"]]]);
  });

  it("emits the severity the user picked", async () => {
    const wrapper = mountRail();
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    expect(wrapper.emitted("update:severity")).toEqual([["critical"]]);
  });

  it("keeps the severity selected when its own chip is re-clicked", async () => {
    // Severity stays single-select: it is one question with one answer, and the
    // explicit All chip is how you widen it.
    const wrapper = mountRail({ severity: "critical" });
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    expect(wrapper.emitted("update:severity")).toBeUndefined();
  });

  // ── search ───────────────────────────────────────────────────────────────
  it("filters the listed rows as you type, case-insensitively", async () => {
    const wrapper = mountRail();
    await type(wrapper, "alert-library-rail-search-packs", "KUBE");
    expect(wrapper.find('[data-test="alert-library-rail-pack-k8s"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-pack-databases"]').exists()).toBe(false);
  });

  it("searches the label people read, not the id", async () => {
    // "k8s" is the id; "Kubernetes" is what the row says. Matching the id would
    // make the box behave differently from the list it is filtering.
    const wrapper = mountRail();
    await type(wrapper, "alert-library-rail-search-packs", "k8s");
    expect(wrapper.find('[data-test="alert-library-rail-pack-k8s"]').exists()).toBe(false);
  });

  it("filters rows without touching the selection", async () => {
    // A search is a view over the list. Typing must never silently deselect
    // the pack whose alerts are on screen.
    const wrapper = mountRail({ selectedPacks: ["databases"] });
    await type(wrapper, "alert-library-rail-search-packs", "kube");
    expect(wrapper.emitted("update:selectedPacks")).toBeUndefined();
  });

  it("says so when nothing matches, instead of showing a blank rail", async () => {
    const wrapper = mountRail();
    await type(wrapper, "alert-library-rail-search-packs", "zzzz");
    expect(wrapper.find('[data-test="alert-library-rail-empty-packs"]').exists()).toBe(true);
  });

  it("keeps each axis' search term while you switch between them", async () => {
    // The terms answer different questions, so one must not clear the other.
    const wrapper = mountRail();
    await type(wrapper, "alert-library-rail-search-packs", "kube");
    await showCategories(wrapper);
    expect(field(wrapper, "alert-library-rail-search-categories").element.value).toBe("");

    await wrapper.find('[data-test="alert-library-rail-axis-packs"]').trigger("click");
    expect(field(wrapper, "alert-library-rail-search-packs").element.value).toBe("kube");
  });

  it("hides a dead-end row, unless it is the one you have selected", async () => {
    // A zero-count row filters to nothing, so offering it wastes a click — but
    // hiding a SELECTED one would strand the user with no way to untick it.
    const wrapper = mountRail();
    await showCategories(wrapper);
    expect(wrapper.find('[data-test="alert-library-rail-category-cert-manager"]').exists()).toBe(
      false,
    );

    await wrapper.setProps({ selectedCategories: ["cert-manager"] });
    expect(wrapper.find('[data-test="alert-library-rail-category-cert-manager"]').exists()).toBe(
      true,
    );
  });

  // ── clearing ─────────────────────────────────────────────────────────────
  it("counts the selection and clears it, one axis at a time", async () => {
    const wrapper = mountRail({ selectedPacks: ["k8s", "openobserve"] });
    expect(wrapper.find('[data-test="alert-library-rail-selected-packs"]').text()).toContain("2");

    await wrapper.find('[data-test="alert-library-rail-clear-packs"]').trigger("click");
    expect(wrapper.emitted("update:selectedPacks")).toEqual([[[]]]);
    // The other axis is a separate question and is left alone.
    expect(wrapper.emitted("update:selectedCategories")).toBeUndefined();
  });

  it("disables clear when there is nothing to clear", () => {
    const wrapper = mountRail();
    expect(
      wrapper.find('[data-test="alert-library-rail-clear-packs"]').attributes("disabled"),
    ).toBeDefined();
  });

  // ── the axis tabs ────────────────────────────────────────────────────────
  it("counts the selection behind each tab, and shows nothing at zero", async () => {
    // The count answers "have I left a filter on over there?" — which is the
    // question a hidden axis raises. A zero would be noise on every fresh load.
    const wrapper = mountRail({ selectedPacks: ["k8s", "databases"] });
    expect(wrapper.find('[data-test="alert-library-rail-axis-count-packs"]').text()).toBe("2");
    expect(wrapper.find('[data-test="alert-library-rail-axis-count-categories"]').text()).toBe("");
  });

  it("shows one axis at a time, and remembers the other's selection", async () => {
    const wrapper = mountRail({ selectedPacks: ["openobserve"], selectedCategories: ["pod"] });
    expect(wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-category-pod"]').exists()).toBe(false);

    await showCategories(wrapper);
    expect(wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-rail-category-pod"]').exists()).toBe(true);

    await wrapper.find('[data-test="alert-library-rail-axis-packs"]').trigger("click");
    expect(
      wrapper
        .find('[data-test="alert-library-rail-pack-openobserve"]')
        .find('[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("true");
    // Switching axes is a view change, not a navigation change.
    expect(wrapper.emitted("update:selectedPacks")).toBeUndefined();
    expect(wrapper.emitted("update:selectedCategories")).toBeUndefined();
  });

  it("stays on the categories tab when the pack selection changes under it", async () => {
    // The category LIST changes when packs change. The tab must not also flip
    // back to packs: the user opened categories to browse them.
    const wrapper = mountRail();
    await showCategories(wrapper);

    await wrapper.setProps({
      selectedPacks: ["openobserve"],
      categories: [{ id: "ingest", label: raw("Ingest"), count: 1 }],
    });

    expect(wrapper.find('[data-test="alert-library-rail-category-ingest"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-pack-k8s"]').exists()).toBe(false);
  });

  it("carries no install-status facet — the rail navigates, the strip filters", () => {
    const text = mountRail().text();
    expect(text).not.toContain("Ready to install");
    expect(text).not.toContain("Installed");
  });
});
