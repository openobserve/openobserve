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
    const wrapper = mountRail();
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

  it("marks the active pack and category", () => {
    const wrapper = mountRail({ pack: "openobserve", category: "pod" });
    expect(
      wrapper.find('[data-test="alert-library-rail-pack-openobserve"]').attributes("data-active"),
    ).toBe("true");
    expect(
      wrapper.find('[data-test="alert-library-rail-category-pod"]').attributes("data-active"),
    ).toBe("true");
    expect(
      wrapper.find('[data-test="alert-library-rail-category-all"]').attributes("data-active"),
    ).toBe("false");
  });

  it("carries no install-status facet — the rail navigates, the strip filters", () => {
    const text = mountRail().text();
    expect(text).not.toContain("Ready to install");
    expect(text).not.toContain("Installed");
  });
});
