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

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";

import { buildChoices } from "./onboardingChoices";
import OnboardingStepRows from "./OnboardingStepRows.vue";

const choices = buildChoices(i18n.global.t as unknown as TranslateFn);
const infrastructure = choices.find((c) => c.id === "infrastructure")!;
const backend = choices.find((c) => c.id === "backend")!;

const mountRows = (choice = infrastructure, attachTo?: HTMLElement) =>
  mount(OnboardingStepRows, {
    props: { choice },
    global: { plugins: [store] },
    attachTo,
  });

type W = ReturnType<typeof mountRows>;
const rows = (w: W) => w.findAll('[data-test^="onboarding-step-rows-row-"]');
const panelTitle = (w: W) => w.find('[data-test="onboarding-preview-title"]').text();
const filled = (w: W) =>
  rows(w).map((r) => r.classes().includes("md:bg-onboarding-choice-active-bg"));

describe("OnboardingStepRows", () => {
  it("shows the title and the rows, with no lead under the title", () => {
    const w = mountRows();
    expect(w.find("h1").text()).toBe("How do you want to monitor your infrastructure?");
    expect(w.text()).not.toContain("You can add the others later");
    expect(rows(w)).toHaveLength(infrastructure.rows.length);
  });

  it("fills the row under the pointer or focus and shows it in the panel", async () => {
    const w = mountRows();
    expect(filled(w)[0]).toBe(true);
    expect(panelTitle(w)).toBe(infrastructure.rows[0].name);
    await rows(w)[2].trigger("mouseenter");
    expect(filled(w).indexOf(true)).toBe(2);
    expect(panelTitle(w)).toBe(infrastructure.rows[2].name);
    await rows(w)[3].trigger("focus");
    expect(filled(w).indexOf(true)).toBe(3);
    expect(panelTitle(w)).toBe(infrastructure.rows[3].name);
  });

  it("reserves the panel text height of every row, so hover never moves the example screen", () => {
    const hidden = mountRows().findAll('[data-test="onboarding-preview"] .row-start-1.invisible');
    expect(hidden.map((c) => c.find("h2").text())).toEqual(infrastructure.rows.map((r) => r.name));
  });

  it("shows the choice's example screen in the panel, for every row", async () => {
    const w = mountRows();
    const kind = () => w.find('[data-test="onboarding-example"]').attributes("data-kind");
    expect(kind()).toBe("infrastructure");
    await rows(w)[1].trigger("mouseenter");
    expect(kind()).toBe("infrastructure");
  });

  it("shows no example screen for Continuous profiling, rather than a trace waterfall", async () => {
    const profiling = buildChoices(i18n.global.t as unknown as TranslateFn, {
      profiling: true,
    }).find((c) => c.id === "backend")!;
    const w = mountRows(profiling);
    const at = profiling.rows.findIndex((r) => r.id === "continuous-profiling");
    expect(w.find('[data-test="onboarding-example"]').exists()).toBe(true);
    await rows(w)[at].trigger("mouseenter");
    expect(panelTitle(w)).toBe("Continuous profiling");
    expect(w.find('[data-test="onboarding-example"]').exists()).toBe(false);
  });

  it("moves between rows with the arrow keys, skipping the coding agent link", async () => {
    // The first backend row has a coding agent link under it; the arrow goes past it.
    const w = mountRows(backend, document.body);
    expect(
      w.find('[data-test="onboarding-step-rows-agent-add-a-library-to-your-code"]').exists(),
    ).toBe(true);
    const items = rows(w);
    (items[0].element as HTMLElement).focus();
    await items[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1].element);
    expect(panelTitle(w)).toBe(backend.rows[1].name);
    await items[1].trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0].element);
    w.unmount();
  });

  it("opens a row and goes back", async () => {
    const w = mountRows();
    await rows(w)[0].trigger("click");
    expect(w.emitted("open")![0][0]).toEqual({ row: infrastructure.rows[0] });
    await w.find('[data-test="onboarding-step-rows-back"]').trigger("click");
    expect(w.emitted("back")).toHaveLength(1);
  });
});
