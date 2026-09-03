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
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import { createStore } from "vuex";

import IacRegistryLinks from "./IacRegistryLinks.vue";

const i18n = createI18n({
  locale: "en",
  messages: {
    en: { common: { openProviderOnRegistry: "OpenObserve provider on the {registry}" } },
  },
});

function mountLinks(theme: "light" | "dark") {
  return mount(IacRegistryLinks, {
    global: { plugins: [createStore({ state: { theme } }), i18n] },
  });
}

describe("IacRegistryLinks", () => {
  it("links each registry in a new tab", () => {
    const links = mountLinks("light").findAll("a");

    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toBe(
      "https://registry.terraform.io/providers/openobserve/openobserve/latest",
    );
    expect(links[1].attributes("href")).toBe(
      "https://search.opentofu.org/provider/openobserve/openobserve/latest",
    );
    for (const link of links) {
      expect(link.attributes("target")).toBe("_blank");
      expect(link.attributes("rel")).toBe("noopener noreferrer");
      expect(link.attributes("aria-label")).toContain("OpenObserve provider on the");
    }
  });

  // Regression: the variants were first toggled with `hidden` / `dark:inline-flex`,
  // which lost to the display utility OIcon's root already carries, so light mode
  // rendered both OpenTofu marks at once.
  it("renders exactly one mark per link", () => {
    for (const theme of ["light", "dark"] as const) {
      const images = mountLinks(theme).findAll("img");
      expect(images).toHaveLength(2);
    }
  });

  // Vite inlines these SVGs as data URIs, so the assertions read the artwork
  // itself: the on-light OpenTofu mark carries the navy outline that gives it
  // definition on a white surface, and the on-dark one is the amber silhouette.
  it("uses OpenTofu's on-light mark in light mode and its on-dark mark in dark mode", () => {
    const src = (theme: "light" | "dark") =>
      (mountLinks(theme).findAll("img")[1].attributes("src") ?? "").toLowerCase();

    expect(src("light")).toContain("%230d1a2b");
    expect(src("light")).not.toContain("%23ffca28");
    expect(src("dark")).toContain("%23ffca28");
    expect(src("dark")).not.toContain("%230d1a2b");
  });

  it("uses one Terraform mark in both themes", () => {
    const src = (theme: "light" | "dark") =>
      (mountLinks(theme).findAll("img")[0].attributes("src") ?? "").toLowerCase();

    expect(src("light")).toContain("%234040b2");
    expect(src("dark")).toBe(src("light"));
  });
});
