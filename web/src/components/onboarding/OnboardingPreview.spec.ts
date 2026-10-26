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
import { mount, type VueWrapper } from "@vue/test-utils";

import OIcon from "@/lib/core/Icon/OIcon.vue";

import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";

import OnboardingPreview from "./OnboardingPreview.vue";
import type { OnboardingSignal } from "./onboardingChoices";

const preview = {
  eyebrow: raw("What you get"),
  title: raw("Infrastructure"),
  text: raw("See every host, pod and cloud service in one place."),
  signals: ["metrics", "logs", "events"] as OnboardingSignal[],
};

const chips = (w: VueWrapper) =>
  w.findAll('[data-test^="onboarding-preview-signal-"]').map((c) => c.text());

// Icons in the visible text, not in the example screen under it.
const icons = (w: VueWrapper) =>
  w
    .find(".row-start-1")
    .findAllComponents(OIcon)
    .map((i) => i.props("name"));

describe("OnboardingPreview", () => {
  it("draws the brand panel with the text and the example screen", () => {
    const w = mount(OnboardingPreview, {
      props: { preview, example: "infrastructure" },
      global: { plugins: [store] },
    });
    const panel = w.find('[data-test="onboarding-preview"]');
    expect(panel.classes()).toEqual(
      expect.arrayContaining([
        "bg-linear-to-b",
        "from-onboarding-panel-start",
        "to-onboarding-panel-end",
        "text-onboarding-panel-text",
      ]),
    );
    expect(w.find('[data-test="onboarding-preview-title"]').text()).toBe("Infrastructure");
    expect(w.text()).toContain("See every host, pod and cloud service in one place.");
    expect(chips(w)).toEqual(["Metrics", "Logs", "Events"]);
    // White on the brand fill: the chip sets the panel text colour itself, like every text on the panel.
    for (const chip of w.findAll('[data-test^="onboarding-preview-signal-"]')) {
      expect(chip.classes()).toEqual(
        expect.arrayContaining(["text-onboarding-panel-text", "bg-onboarding-panel-text/10"]),
      );
    }
    expect(icons(w)).toEqual(["bar-chart", "article", "bolt"]);
    // A sentence and chips, not the tick-mark list.
    expect(icons(w)).not.toContain("check");
    // Text only: no example screen under it.
    expect(w.find('[data-test="onboarding-example"]').exists()).toBe(false);
    // No "Example" tag: the "What you get" eyebrow already frames the screen. The eyebrow is full white, for AA contrast.
    expect(w.findAll("span").some((s) => s.text() === "Example")).toBe(false);
    expect(w.find("p").text()).toBe("What you get");
    expect(w.find("p").classes().join(" ")).not.toMatch(/\/\d+/);
    // Set on the element itself: a base paragraph colour would otherwise win over the panel's inherited white.
    expect(w.find("p").classes()).toContain("text-onboarding-panel-text");
    // Same for the title: the base heading colour is dark, which is unreadable on the brand panel.
    expect(w.find('[data-test="onboarding-preview-title"]').classes()).toContain(
      "text-onboarding-panel-text",
    );
  });

  it("still takes the text-only preview, with no example screen", () => {
    const w = mount(OnboardingPreview, {
      props: {
        preview: { eyebrow: raw("Logs"), title: raw("Fluent Bit"), text: raw("About it.") },
      },
      global: { plugins: [store] },
    });
    expect(w.find('[data-test="onboarding-preview-title"]').text()).toBe("Fluent Bit");
    expect(w.text()).toContain("About it.");
    expect(w.find('[data-test="onboarding-example"]').exists()).toBe(false);
  });

  it("still draws the tick-mark list for a preview that passes lines", () => {
    const w = mount(OnboardingPreview, {
      props: {
        preview: { eyebrow: raw("Agent"), title: raw("Steps"), lines: [raw("A"), raw("B")] },
      },
      global: { plugins: [store] },
    });
    expect(w.findAll("li").map((li) => li.text())).toEqual(["A", "B"]);
    expect(icons(w)).toEqual(["check", "check"]);
    expect(chips(w)).toEqual([]);
  });

  it("keeps the height of the tallest text it can show, with only the current one visible", () => {
    const longer = {
      eyebrow: raw("What you get"),
      title: raw("Logs"),
      text: raw("Search and filter every log line, whatever sends it."),
      signals: ["logs", "auditLogs", "securityEvents", "traces", "metrics"] as OnboardingSignal[],
    };
    const w = mount(OnboardingPreview, {
      props: { preview, example: "logs", reserve: [preview, longer] },
      global: { plugins: [store] },
    });
    const cells = w.findAll(".row-start-1");
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.classes().includes("invisible"))).toEqual([false, true, true]);
    expect(cells.map((c) => c.attributes("aria-hidden"))).toEqual([undefined, "true", "true"]);
    expect(w.findAll('[data-test="onboarding-preview-title"]').map((h) => h.text())).toEqual([
      "Infrastructure",
    ]);
    // Every text, chips included, is in the cell, so the tallest one sets its height.
    expect(cells[2].text()).toContain("Search and filter every log line, whatever sends it.");
    expect(cells[2].findAll("li").map((li) => li.text())).toEqual([
      "Logs",
      "Audit logs",
      "Security events",
      "Traces",
      "Metrics",
    ]);
    // Only the visible cell's chips carry a data-test.
    expect(chips(w)).toEqual(["Metrics", "Logs", "Events"]);
  });
});
