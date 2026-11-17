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
import { mount } from "@vue/test-utils";

import store from "@/test/unit/helpers/store";

import OnboardingExampleScreen from "./OnboardingExampleScreen.vue";
import { raw } from "@/types/i18n";

import { ROW_SHOTS, type OnboardingExampleKind } from "./onboardingExamples";

const KINDS: OnboardingExampleKind[] = [
  "infrastructure",
  "backend",
  "frontend",
  "logs",
  "llm",
  "agent",
  "synthetics",
];

const mountScreen = (kind: OnboardingExampleKind) =>
  mount(OnboardingExampleScreen, { props: { kind }, global: { plugins: [store] } });

const imageSrc = (w: ReturnType<typeof mountScreen>) =>
  w.find('[data-test="onboarding-example-image"]').attributes("src");

describe("OnboardingExampleScreen", () => {
  // The test store is shared and starts dark.
  afterEach(() => store.commit("appTheme", "dark"));

  it.each(KINDS)("shows the %s screenshot in a hidden frame, with a caption", (kind) => {
    const w = mountScreen(kind);
    expect(w.attributes("data-kind")).toBe(kind);
    expect(imageSrc(w)).toMatch(new RegExp(`/images/onboarding/${kind}-dark\\.webp$`));
    expect(w.find('[data-test="onboarding-example-image"]').attributes("alt")).toBe("");
    expect(w.find('[data-test="onboarding-example-frame"]').attributes("aria-hidden")).toBe("true");
    const caption = w.find('[data-test="onboarding-example-caption"]');
    expect(caption.element.tagName).toBe("FIGCAPTION");
    expect(caption.classes()).toContain("sr-only");
    expect(caption.text()).toMatch(/^Example screen: /);
    // Every product name is filled in; no placeholder is left in the sentence.
    expect(caption.text()).not.toMatch(/[{}]/);
  });

  it("shows the light screenshot in light theme and switches with the theme", async () => {
    store.commit("appTheme", "light");
    const w = mountScreen("logs");
    expect(imageSrc(w)).toMatch(/\/logs-light\.webp$/);
    store.commit("appTheme", "dark");
    await w.vm.$nextTick();
    expect(imageSrc(w)).toMatch(/\/logs-dark\.webp$/);
  });

  it("fills in the product names in the captions", () => {
    const caption = (kind: OnboardingExampleKind) =>
      mountScreen(kind).find('[data-test="onboarding-example-caption"]').text();
    expect(caption("infrastructure")).toContain("Kubernetes cluster");
    expect(caption("frontend")).toContain("RUM web vitals");
    expect(caption("llm")).toContain("AI Observability Insights with");
    expect(caption("backend")).toContain("21 spans across 9 services");
    expect(caption("agent")).toContain("MCP server page");
    expect(caption("synthetics")).toContain("one HTTP check");
  });
  it("shows a step 2 row's own screenshot when it has one, and says which row in the caption", () => {
    const w = mount(OnboardingExampleScreen, {
      props: { kind: "infrastructure", row: "databases", rowName: raw("Databases") },
      global: { plugins: [store] },
    });
    expect(w.attributes("data-row")).toBe("databases");
    expect(imageSrc(w)).toMatch(/\/images\/onboarding\/rows\/infrastructure-databases-dark\.webp$/);
    expect(w.find('[data-test="onboarding-example-caption"]').text()).toBe(
      "Example screen: what OpenObserve shows for Databases.",
    );
  });

  it("falls back to the choice's screenshot for a row without one", () => {
    expect(ROW_SHOTS.has("infrastructure-kubernetes-cluster")).toBe(false);
    const w = mount(OnboardingExampleScreen, {
      props: {
        kind: "infrastructure",
        row: "kubernetes-cluster",
        rowName: raw("Kubernetes cluster"),
      },
      global: { plugins: [store] },
    });
    expect(w.attributes("data-row")).toBeUndefined();
    expect(imageSrc(w)).toMatch(/\/images\/onboarding\/infrastructure-dark\.webp$/);
  });

  it("has an image file for every row it lists", () => {
    const files = Object.keys(import.meta.glob("@/assets/images/onboarding/rows/*.webp"));
    for (const row of ROW_SHOTS) {
      for (const theme of ["light", "dark"]) {
        expect(files.some((f) => f.endsWith(`/rows/${row}-${theme}.webp`))).toBe(true);
      }
    }
  });
});
