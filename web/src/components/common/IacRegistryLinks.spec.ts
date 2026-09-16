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
    en: {
      common: {
        openProviderOnRegistry: "OpenObserve provider on the {registry}",
        iacProviderCaption: "Terraform provider",
      },
    },
  },
});

function mountLinks(theme: "light" | "dark", props: { compact?: boolean } = {}) {
  return mount(IacRegistryLinks, {
    props,
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

  // The affordance gap this component shipped with: the marks carried an
  // aria-label and a tooltip, so nothing was visible until you hovered.
  it("labels the pair with one visible caption", () => {
    const wrapper = mountLinks("light");
    const caption = wrapper.find('[data-test="iac-registry-links-caption"]');

    expect(caption.exists()).toBe(true);
    expect(caption.text()).toBe("Terraform provider");
  });

  // The caption names the artifact, which is a "Terraform provider" for OpenTofu
  // too; naming a REGISTRY would mislabel whichever of the two marks it omits.
  it("captions the artifact, not either registry", () => {
    const caption = mountLinks("light").find('[data-test="iac-registry-links-caption"]').text();

    expect(caption).not.toMatch(/registry/i);
  });

  it("derives the caption data-test from dataTest", () => {
    const wrapper = mount(IacRegistryLinks, {
      props: { dataTest: "slos-slolist-iac-registries" },
      global: { plugins: [createStore({ state: { theme: "light" } }), i18n] },
    });

    expect(wrapper.find('[data-test="slos-slolist-iac-registries-caption"]').exists()).toBe(true);
  });

  it("drops the caption when compact, keeping both links", () => {
    const wrapper = mountLinks("light", { compact: true });

    expect(wrapper.find('[data-test="iac-registry-links-caption"]').exists()).toBe(false);
    expect(wrapper.findAll("a")).toHaveLength(2);
  });

  // The caption is an addition, never a replacement: hover-free labelling must
  // not cost the per-destination name each link already carried.
  it("keeps each link's per-registry aria-label alongside the caption", () => {
    const links = mountLinks("light").findAll("a");

    expect(links[0].attributes("aria-label")).toBe(
      "OpenObserve provider on the Terraform Registry",
    );
    expect(links[1].attributes("aria-label")).toBe("OpenObserve provider on the OpenTofu Registry");
  });
});
