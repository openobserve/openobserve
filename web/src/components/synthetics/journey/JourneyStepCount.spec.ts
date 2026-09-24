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
import type { BrowserStep } from "@/types/synthetics";
import type { ChildJourney } from "@/utils/synthetics/expandJourney";
import JourneyStepCount from "./JourneyStepCount.vue";

const OTooltipStub = {
  props: ["content"],
  template: '<span data-test="step-count-tooltip" :data-tooltip="content" />',
};

const click = (id: string): BrowserStep => ({
  id,
  action: "click",
  name: `Click ${id}`,
  locator: { candidates: [{ kind: "css", value: `#${id}` }] },
});
const own = (count: number, prefix = "s") =>
  Array.from({ length: count }, (_, i) => click(`${prefix}${i + 1}`));
const reference = (id: string, childId: string, name: string): BrowserStep => ({
  id,
  action: "subtest",
  name,
  subtest: { id: childId, name },
});
const child = (id: string, name: string, count: number): ChildJourney => ({
  id,
  name,
  folderId: "shared",
  steps: own(count, `${id}-`),
});

function mountCount(steps: BrowserStep[], children: ChildJourney[] = [], limit = 50) {
  return mount(JourneyStepCount, {
    props: { steps, children: new Map(children.map((c) => [c.id, c])), limit },
    global: { plugins: [i18n], stubs: { OTooltip: OTooltipStub } },
  });
}

const text = (w: ReturnType<typeof mountCount>) => w.text().replace(/\s+/g, " ").trim();
const tooltip = (w: ReturnType<typeof mountCount>) => w.find('[data-test="step-count-tooltip"]');

function setLocale(code: string) {
  const g = i18n.global as unknown as { locale: string | { value: string } };
  const previous = typeof g.locale === "string" ? g.locale : g.locale.value;
  if (typeof g.locale === "string") g.locale = code;
  else g.locale.value = code;
  return previous;
}

describe("JourneyStepCount", () => {
  it("shows the rows as the count when the test has no subtests", () => {
    expect(text(mountCount(own(4)))).toBe("4 steps");
    expect(text(mountCount(own(1)))).toBe("1 step");
  });

  it("shows no count for a test with no steps", () => {
    const w = mountCount([]);
    expect(w.text()).toBe("");
    expect(w.find("span").exists()).toBe(false);
  });

  it("counts the steps that execute and the one subtest", () => {
    const w = mountCount(
      [...own(4), reference("r1", "login", "Login")],
      [child("login", "login-shared", 14)],
    );
    expect(text(w)).toBe("18 steps (including 1 subtest)");
  });

  it("counts two subtests in the plural", () => {
    const w = mountCount(
      [...own(6), reference("r1", "login", "Login"), reference("r2", "checkout", "Checkout")],
      [child("login", "login-shared", 38), child("checkout", "checkout-flow", 14)],
    );
    expect(text(w)).toBe("58 steps (including 2 subtests)");
  });

  it("counts a subtest used twice twice", () => {
    const w = mountCount(
      [reference("r1", "login", "Login"), ...own(2), reference("r2", "login", "Login")],
      [child("login", "login-shared", 5)],
    );
    expect(text(w)).toBe("12 steps (including 2 subtests)");
    expect(tooltip(w).attributes("data-tooltip")).toBe(
      '2 steps in this test, 5 from "login-shared", and 5 from "login-shared". This test executes 12 of the 50 allowed.',
    );
  });

  it("explains one subtest in the tooltip, with the limit", () => {
    const w = mountCount(
      [...own(4), reference("r1", "login", "Login")],
      [child("login", "login-shared", 14)],
    );
    expect(tooltip(w).attributes("data-tooltip")).toBe(
      '4 steps in this test and 14 from "login-shared". This test executes 18 of the 50 allowed.',
    );
  });

  it("lists several subtests in the tooltip in journey order, joined as a list", () => {
    // The cache is filled checkout-first, so its order is not the journey order.
    const w = mountCount(
      [...own(6), reference("r1", "login", "Login"), reference("r2", "checkout", "Checkout")],
      [child("checkout", "checkout-flow", 14), child("login", "login-shared", 38)],
    );
    expect(tooltip(w).attributes("data-tooltip")).toBe(
      '6 steps in this test, 38 from "login-shared", and 14 from "checkout-flow". This test executes 58 of the 50 allowed.',
    );
  });

  it("shows no tooltip when the test has no subtests", () => {
    expect(tooltip(mountCount(own(4))).exists()).toBe(false);
    expect(tooltip(mountCount(own(51))).exists()).toBe(false);
  });

  it("turns the count red only over the limit", () => {
    const steps = [...own(4), reference("r1", "login", "Login")];
    const atLimit = mountCount(steps, [child("login", "login-shared", 46)]);
    expect(text(atLimit)).toBe("50 steps (including 1 subtest)");
    expect(atLimit.find(".text-status-error-text").exists()).toBe(false);

    const over = mountCount(steps, [child("login", "login-shared", 47)]);
    expect(text(over)).toBe("51 steps (including 1 subtest)");
    expect(over.find(".text-status-error-text").exists()).toBe(true);

    expect(mountCount(own(51)).find(".text-status-error-text").exists()).toBe(true);
  });

  it("while a subtest's steps are not loaded, shows the rows, not red, with no tooltip", () => {
    const w = mountCount([...own(4), reference("r1", "login", "Login")], [], 3);
    expect(text(w)).toBe("5 steps");
    expect(w.find(".text-status-error-text").exists()).toBe(false);
    expect(tooltip(w).exists()).toBe(false);
  });

  it("joins the tooltip parts with the locale's list rule", () => {
    // Messages fall back to English; only the list joiner follows the German locale.
    const previous = setLocale("de");
    try {
      const w = mountCount(
        [...own(6), reference("r1", "login", "Login"), reference("r2", "checkout", "Checkout")],
        [child("login", "login-shared", 38), child("checkout", "checkout-flow", 14)],
      );
      expect(tooltip(w).attributes("data-tooltip")).toBe(
        '6 steps in this test, 38 from "login-shared" und 14 from "checkout-flow". This test executes 58 of the 50 allowed.',
      );
    } finally {
      setLocale(previous);
    }
  });

  it("the count is focusable as the tooltip trigger when there are subtests", () => {
    const w = mountCount(
      [...own(4), reference("r1", "login", "Login")],
      [child("login", "login-shared", 14)],
    );
    const trigger = w.find('[tabindex="0"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.text()).toContain("18 steps (including 1 subtest)");
    expect(trigger.find('[data-test="step-count-tooltip"]').exists()).toBe(true);

    expect(mountCount(own(4)).find('[tabindex="0"]').exists()).toBe(false);
  });

  it("describes the count with the breakdown for keyboard and screen-reader users", () => {
    // Earlier mounts are separate apps whose teleported ids can repeat.
    document.body.innerHTML = "";
    const w = mountCount(
      [...own(4), reference("r1", "login", "Login")],
      [child("login", "login-shared", 14)],
      50,
    );
    const describedBy = w.find("[aria-describedby]");
    expect(describedBy.exists()).toBe(true);
    const id = describedBy.attributes("aria-describedby");
    const description = document.getElementById(id!);
    expect(description).not.toBeNull();
    expect(description!.textContent?.trim()).toBe(
      '4 steps in this test and 14 from "login-shared". This test executes 18 of the 50 allowed.',
    );

    w.unmount();
    expect(document.getElementById(id!)).toBeNull();

    expect(mountCount(own(4)).find("[aria-describedby]").exists()).toBe(false);
  });
});
