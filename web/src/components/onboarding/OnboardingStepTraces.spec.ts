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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import type { SetupCardPresets } from "@/components/ingestion/setupCard/types";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";

import { buildChoices } from "./onboardingChoices";
import OnboardingStepTraces from "./OnboardingStepTraces.vue";

const choice = buildChoices(i18n.global.t as unknown as TranslateFn).find(
  (c) => c.id === "infrastructure",
)!;
const row = choice.rows.find((r) => r.id === "kubernetes-cluster")!;

const mountTraces = (picked?: SetupCardPresets) =>
  mount(OnboardingStepTraces, {
    props: { choice, row, traces: row.traces!, picked },
    global: { plugins: [store, i18n] },
  });

type W = ReturnType<typeof mountTraces>;
const option = (w: W, id: string) => w.find(`[data-test="onboarding-step-traces-${id}"]`);
const panel = (w: W) => w.find('[data-test="onboarding-step-traces-library-panel"]');
const language = (w: W, id: string) =>
  w.find(`[data-test="onboarding-step-traces-language-${id}"] button`);
const submit = (w: W) => w.find('[data-test="onboarding-step-traces-form"]').trigger("submit");
const panelTitle = (w: W) => w.find('[data-test="onboarding-preview-title"]').text();

describe("OnboardingStepTraces", () => {
  it("asks the question under the crumbs, with three answers and no Continue", async () => {
    const w = mountTraces();
    expect(w.find("h1").text()).toBe("Choose what to collect from your cluster");
    expect(w.text()).toContain("Infrastructure / Kubernetes cluster");
    expect(
      ["off", "ebpf", "library"].map((id) => [
        option(w, id).find(".text-sm").text(),
        option(w, id).find(".text-compact").text(),
      ]),
    ).toEqual([
      ["Logs, Metrics and Events", "Cluster health and container logs. One command."],
      [
        "Add Traces With eBPF",
        "No code changes, any language. Needs Linux kernel 5.8+ on your nodes.",
      ],
      [
        "Add Traces With Language Libraries",
        "More detail per app. Pick your languages, then restart your apps once.",
      ],
    ]);
    expect(w.text()).not.toContain("Continue");
    await w.find('[data-test="onboarding-step-traces-back"]').trigger("click");
    expect(w.emitted("back")).toHaveLength(1);
  });

  it("answers No and eBPF on one click", async () => {
    const w = mountTraces();
    await option(w, "off").trigger("click");
    await option(w, "ebpf").trigger("click");
    expect(w.emitted("pick")).toEqual([
      [{ traces: "off", languages: [] }],
      [{ traces: "ebpf", languages: [] }],
    ]);
  });

  it("opens the library row in place, with the card's languages and one button", async () => {
    const w = mountTraces();
    expect(panel(w).exists()).toBe(false);
    await option(w, "library").trigger("click");
    expect(option(w, "library").attributes("aria-expanded")).toBe("true");
    expect(option(w, "library").attributes("aria-controls")).toBe(panel(w).attributes("id"));
    const labels = panel(w)
      .findAll('[role="checkbox"]')
      .map((c) => c.element.closest("label")!.textContent!.trim());
    expect(labels).toEqual(["Java", ".NET", "Node.js", "Python"]);
    expect(w.find('[data-test="onboarding-step-traces-continue"]').text()).toBe(
      "Continue to Setup",
    );
    expect(w.emitted("pick")).toBeUndefined();
    await option(w, "library").trigger("click");
    expect(panel(w).exists()).toBe(false);
  });

  it("asks for a language instead of disabling Continue to Setup", async () => {
    const w = mountTraces();
    await option(w, "library").trigger("click");
    const button = w.find('[data-test="onboarding-step-traces-continue"]');
    expect(button.attributes("disabled")).toBeUndefined();
    expect(button.attributes("type")).toBe("submit");
    await submit(w);
    await vi.waitFor(() => expect(panel(w).text()).toContain("Pick at least one language."));
    expect(w.emitted("pick")).toBeUndefined();
    await language(w, "java").trigger("click");
    await vi.waitFor(() => expect(panel(w).text()).not.toContain("Pick at least one language."));
  });

  it("goes on with the ticked languages, in the card's order", async () => {
    const w = mountTraces();
    await option(w, "library").trigger("click");
    await language(w, "nodejs").trigger("click");
    await language(w, "java").trigger("click");
    await submit(w);
    await vi.waitFor(() => expect(w.emitted("pick")).toBeTruthy());
    expect(w.emitted("pick")).toEqual([[{ traces: "library", languages: ["java", "nodejs"] }]]);
  });

  it("opens with a library answer from the URL already ticked", () => {
    const w = mountTraces({ traces: "library", languages: ["python"] });
    expect(panel(w).exists()).toBe(true);
    expect(language(w, "python").attributes("aria-checked")).toBe("true");
    expect(language(w, "java").attributes("aria-checked")).toBe("false");
    expect(panelTitle(w)).toBe("Add Traces With Language Libraries");
  });

  it("shows each answer's text and signals in the panel", async () => {
    const w = mountTraces();
    const chips = () =>
      w
        .findAll('[data-test^="onboarding-preview-signal-"]')
        .map((c) => c.attributes("data-test")!.replace("onboarding-preview-signal-", ""));
    expect(panelTitle(w)).toBe("Logs, Metrics and Events");
    expect(chips()).toEqual(["logs", "metrics", "events"]);
    await option(w, "ebpf").trigger("mouseenter");
    expect(panelTitle(w)).toBe("Add Traces With eBPF");
    expect(chips()).toEqual(["logs", "metrics", "events", "traces"]);
    await option(w, "library").trigger("focus");
    expect(panelTitle(w)).toBe("Add Traces With Language Libraries");
  });
});
