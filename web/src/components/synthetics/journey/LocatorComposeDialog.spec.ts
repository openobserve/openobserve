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
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { LocatorCandidate } from "@/types/synthetics";
import LocatorComposeDialog from "./LocatorComposeDialog.vue";
import en from "@/locales/languages/en-US.json";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

// ODialog teleports its content to document.body, which would put every
// assertion below outside the wrapper's tree. Stubbed to render inline so the
// builder is what is under test rather than the teleport.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonDisabled"],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div v-if="open" class="dialog-stub">
      <slot />
      <button data-test="stub-primary" :disabled="primaryButtonDisabled" @click="$emit('click:primary')" />
    </div>`,
};

const TESTID = '[data-test="org-row"]';
const ROLE = 'internal:role=row[name="acme_prod"i]';
const TEXT = 'internal:text="acme_prod"';

const c = (value: string, kind: LocatorCandidate["kind"] = "css"): LocatorCandidate => ({
  kind,
  value,
});

function render(parts: LocatorCandidate[], recorded: string[] = parts.map((p) => p.value)) {
  return mount(LocatorComposeDialog, {
    props: { open: true, parts, recorded },
    global: { plugins: [i18n], stubs: { ODialog: ODialogStub } },
  });
}

const test = (name: string) => `[data-test="${name}"]`;
const result = (w: VueWrapper) => w.find(test("synthetics-journey-step-locator-combine-result"));
const picker = (w: VueWrapper) => w.find(test("synthetics-journey-step-locator-combine-relation"));

describe("LocatorComposeDialog", () => {
  it("lists the parts and says the element must match all of them", () => {
    const wrapper = render([c(TESTID, "test_attribute"), c(ROLE, "role")]);

    expect(wrapper.text()).toContain("must match ALL of these");
    expect(wrapper.findAll(test("synthetics-journey-step-locator-combine-part"))).toHaveLength(2);
    // "AND", "intersect" and "composite" never appear in body copy. `Combined`
    // shows up only as the origin badge, back in the list.
    expect(wrapper.text()).not.toMatch(/\bintersect/i);
    expect(wrapper.text()).not.toMatch(/\bcomposite\b/i);
  });

  // Derived from the positional invariant, not from a live page. Playwright
  // appends an index only when nothing matched uniquely, so its absence proves
  // the selector resolved to exactly one element at record time. There is no
  // page to count against here, and a made-up count would be worse than none.
  it("reports what each part matched when it was recorded", () => {
    const wrapper = render([c(`${TESTID} >> nth=1`, "test_attribute"), c(ROLE, "role")]);
    const parts = wrapper.findAll(test("synthetics-journey-step-locator-combine-part"));

    expect(parts[0].text()).toContain("matched several when recorded");
    expect(parts[1].text()).toContain("matched 1 when recorded");
  });

  it("names the failure mode and the mitigation, before the fact", () => {
    const warning = render([c(TESTID), c(ROLE)]).find(
      test("synthetics-journey-step-locator-combine-warning"),
    );

    expect(warning.text()).toContain("stricter, not more resilient");
    expect(warning.text()).toContain("still tried after it");
  });
});

// `and` is provably safe when every part came from the recording: Playwright
// verified each against the same target element, so intersecting them gives
// that element. Asking there adds a click and teaches nothing.
describe("the relation picker", () => {
  it("stays hidden, and applies `and`, for a recorded-only selection", () => {
    const wrapper = render([c(TESTID), c(ROLE)]);

    expect(picker(wrapper).exists()).toBe(false);
    expect(result(wrapper).text()).toBe(`${TESTID} >> internal:and=${JSON.stringify(ROLE)}`);
  });

  it("appears, with nothing pre-selected, once an authored part joins in", () => {
    const wrapper = render([c(TESTID), c("#mine")], [TESTID]);

    expect(picker(wrapper).exists()).toBe(true);
    expect(picker(wrapper).findAll("[data-state='checked']")).toHaveLength(0);
    // A wrong default here produces an empty match the editor cannot detect, so
    // there is nothing to build until they choose.
    expect(result(wrapper).exists()).toBe(false);
  });

  it("builds a containment locator when the author says the first wraps the second", async () => {
    const wrapper = render([c(TESTID), c(TEXT)], [TESTID]);
    await wrapper.findComponent({ name: "ORadioGroup" }).vm.$emit("update:modelValue", "has");

    expect(result(wrapper).text()).toBe(`${TESTID} >> internal:has=${JSON.stringify(TEXT)}`);
  });
});

// The defect the Task 0 spike caught. `and` intersects result sets and runs the
// inner selector against the document root, so a filter engine on the right
// filters the document, matches nothing, and the whole thing resolves to
// nothing — silently, with no error anywhere.
describe("a part that can only narrow something else down", () => {
  it("is refused under `and`, and the author is steered to wraps", async () => {
    const wrapper = render([c(TESTID), c('internal:has-text="acme_prod"')], [TESTID]);
    await wrapper.findComponent({ name: "ORadioGroup" }).vm.$emit("update:modelValue", "and");

    expect(
      wrapper.find(test("synthetics-journey-step-locator-combine-filter-error")).exists(),
    ).toBe(true);
    expect(
      wrapper.find(test("stub-primary")).attributes("disabled"),
    ).toBeDefined();
  });

  it("is fine under wraps", async () => {
    const wrapper = render([c(TESTID), c('internal:has-text="acme_prod"')], [TESTID]);
    await wrapper.findComponent({ name: "ORadioGroup" }).vm.$emit("update:modelValue", "has");

    expect(
      wrapper.find(test("synthetics-journey-step-locator-combine-filter-error")).exists(),
    ).toBe(false);
  });
});

// The one control that picks between the two shapes in the design: precision,
// or an assertion that fails loudly the day the list is reordered.
describe("the position toggle", () => {
  const toggle = (w: VueWrapper) => w.find(test("synthetics-journey-step-locator-combine-position"));

  it("is absent when the base part carries no index", () => {
    expect(toggle(render([c(TESTID), c(ROLE)])).exists()).toBe(false);
  });

  // `nth=1` is the second match. Authors count from one, and the caption says
  // what happens rather than what the token is.
  it("offers the 1-based position an author would count", () => {
    const wrapper = render([c(`${TESTID} >> nth=1`), c(ROLE)]);
    expect(toggle(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain("position 2");
    expect(wrapper.text()).toContain("list that has been reordered");
  });

  it("strips the index by default, and keeps it before the join when asked", async () => {
    const wrapper = render([c(`${TESTID} >> nth=1`), c(ROLE)]);
    const join = `internal:and=${JSON.stringify(ROLE)}`;

    // Off by default: an index is what combining exists to remove.
    expect(result(wrapper).text()).toBe(`${TESTID} >> ${join}`);

    await wrapper.findComponent({ name: "OCheckbox" }).vm.$emit("update:modelValue", true);

    const guarded = result(wrapper).text();
    expect(guarded).toBe(`${TESTID} >> nth=1 >> ${join}`);
    // Order inside the string is load-bearing: index after the join would apply
    // to the intersection, which holds one element, and match nothing.
    expect(guarded.indexOf("nth=")).toBeLessThan(guarded.indexOf("internal:and="));
  });
});

describe("applying", () => {
  it("emits the built value and the parts it was built from", async () => {
    const wrapper = render([c(TESTID, "test_attribute"), c(ROLE, "role")]);
    await wrapper.find(test("stub-primary")).trigger("click");

    const [payload] = wrapper.emitted("combine")![0] as [
      { value: string; from: { value: string; relation?: string }[] },
    ];
    expect(payload.value).toContain("internal:and=");
    // The base carries no relation; every later part does. That is what lets a
    // mixed chain — `has` then `descendant` — be expressed at all.
    expect(payload.from).toEqual([{ value: TESTID }, { relation: "and", value: ROLE }]);
    expect(wrapper.emitted("update:open")!.at(-1)).toEqual([false]);
  });

  it("cannot be applied while the relation is unanswered", () => {
    const wrapper = render([c(TESTID), c("#mine")], [TESTID]);
    expect(wrapper.find(test("stub-primary")).attributes("disabled")).toBeDefined();
  });
});
