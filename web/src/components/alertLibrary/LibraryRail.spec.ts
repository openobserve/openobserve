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
];

const categories: LibraryFacet[] = [
  { id: "all", label: raw("All categories"), count: 86 },
  { id: "pod", label: raw("Pod"), count: 12 },
  { id: "node", label: raw("Node"), count: 9 },
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
      pack: "k8s",
      categories,
      category: "all",
      severities,
      severity: "all",
      ...props,
    },
    global: { plugins: [i18n] },
  });

/** Open the categories tab — the rail lists one axis at a time. */
const showCategories = (wrapper: ReturnType<typeof mountRail>) =>
  wrapper.find('[data-test="alert-library-rail-axis-categories"]').trigger("click");

describe("LibraryRail", () => {
  it("renders the three navigation groups", () => {
    const text = mountRail().text();
    expect(text).toContain("Packs");
    expect(text).toContain("Category");
    expect(text).toContain("Severity");
  });

  it("lists every pack with its alert count", () => {
    const wrapper = mountRail();
    const k8s = wrapper.find('[data-test="alert-library-rail-pack-k8s"]');
    expect(k8s.text()).toContain("Kubernetes");
    expect(k8s.text()).toContain("86");
  });

  it("emits the pack the user picked instead of navigating itself", async () => {
    const wrapper = mountRail();
    await wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').trigger("click");
    expect(wrapper.emitted("update:pack")).toEqual([["openobserve"]]);
  });

  it("emits the category the user picked", async () => {
    // Packs and categories share one list behind a segmented control, so the
    // categories tab has to be opened before its rows exist.
    const wrapper = mountRail();
    await showCategories(wrapper);
    await wrapper.find('[data-test="alert-library-rail-category-pod"]').trigger("click");
    expect(wrapper.emitted("update:category")).toEqual([["pod"]]);
  });

  it("emits the severity the user picked", async () => {
    const wrapper = mountRail();
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    expect(wrapper.emitted("update:severity")).toEqual([["critical"]]);
  });

  it("keeps the severity selected when its own chip is re-clicked", async () => {
    // The rail is navigation: you widen it with the explicit All chip, never by
    // accidentally clearing the one you just chose.
    const wrapper = mountRail({ severity: "critical" });
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    expect(wrapper.emitted("update:severity")).toBeUndefined();
  });

  it("marks the active pack and category", async () => {
    const wrapper = mountRail({ pack: "openobserve", category: "pod" });
    expect(
      wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').attributes("data-active"),
    ).toBe("true");

    await showCategories(wrapper);
    expect(
      wrapper.find('[data-test="alert-library-rail-category-pod"]').attributes("data-active"),
    ).toBe("true");
    expect(
      wrapper.find('[data-test="alert-library-rail-category-all"]').attributes("data-active"),
    ).toBe("false");
  });

  it("shows one axis at a time, and remembers the other's selection", async () => {
    // The tabs switch what is LISTED, not what is selected — a pack chosen on
    // one tab must still be chosen after browsing categories on the other,
    // otherwise switching tabs silently resets navigation.
    const wrapper = mountRail({ pack: "openobserve", category: "pod" });
    expect(wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-category-pod"]').exists()).toBe(false);

    await showCategories(wrapper);
    expect(wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-rail-category-pod"]').exists()).toBe(true);

    await wrapper.find('[data-test="alert-library-rail-axis-packs"]').trigger("click");
    expect(
      wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').attributes("data-active"),
    ).toBe("true");
    // Switching axes is a view change, not a navigation change.
    expect(wrapper.emitted("update:pack")).toBeUndefined();
    expect(wrapper.emitted("update:category")).toBeUndefined();
  });

  it("stays on the categories tab when the pack changes under it", async () => {
    // Switching pack resets the category to "all" (a category belongs to a
    // pack), and the category LIST changes with it. The tab must not also flip
    // back to packs: the user opened categories to browse them, and yanking the
    // list out from under them would make picking a pack feel like a mode exit.
    const wrapper = mountRail();
    await showCategories(wrapper);

    await wrapper.setProps({
      pack: "openobserve",
      category: "all",
      categories: [
        { id: "all", label: raw("All"), count: 1 },
        { id: "ingest", label: raw("Ingest"), count: 1 },
      ],
    });

    expect(wrapper.find('[data-test="alert-library-rail-category-ingest"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-pack-k8s"]').exists()).toBe(false);
  });

  it("counts the choices behind each tab, discounting the 'all' pseudo-facet", () => {
    // The count answers "how many options are in here", which is what makes a
    // tab worth opening; counting `all` would advertise a choice that is the
    // absence of one.
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="alert-library-rail-axis-count-packs"]').text()).toBe("2");
    expect(wrapper.find('[data-test="alert-library-rail-axis-count-categories"]').text()).toBe("2");
  });

  it("carries no install-status facet — the rail navigates, the strip filters", () => {
    const text = mountRail().text();
    expect(text).not.toContain("Ready to install");
    expect(text).not.toContain("Installed");
  });
});
