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
import type { StepLocator } from "@/types/synthetics";
import BrowserJourneyLocator from "./BrowserJourneyLocator.vue";
import en from "@/locales/languages/en-US.json";

// The real message catalogue, not a stub: a missing key then fails the test
// rather than rendering as its own name.
const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const TESTID = '[data-test="login-sign-in"]';
const ROLE = 'role=button[name="Sign In"]';

const BUNDLE: StepLocator = {
  candidates: [
    { kind: "test_attribute", value: TESTID },
    { kind: "role", value: ROLE },
    { kind: "css", value: ".btn-primary" },
  ],
};

/** A step added by hand: the input is the only way it can name its element. */
const EMPTY: StepLocator = { candidates: [] };

function render(locator: StepLocator = BUNDLE) {
  return mount(BrowserJourneyLocator, {
    props: { locator },
    global: { plugins: [i18n] },
  });
}

const test = (name: string) => `[data-test="${name}"]`;

/** `data-test` sits on the OInput root, so reach the inner <input>. */
const ownInput = (wrapper: VueWrapper) =>
  wrapper.find(`${test("synthetics-journey-step-locator-override-input")} input`);

/** The last `update:locator` payload, which is what would be saved. */
function emitted(wrapper: VueWrapper): StepLocator {
  const events = wrapper.emitted("update:locator") as StepLocator[][] | undefined;
  expect(events, "no update:locator was emitted").toBeTruthy();
  return events![events!.length - 1][0];
}

describe("BrowserJourneyLocator", () => {
  it("renders every candidate as a row, in stored order", () => {
    const rows = render().findAll(test("synthetics-journey-step-locator-row"));
    expect(rows).toHaveLength(3);
    expect(rows[0].text()).toContain(TESTID);
    expect(rows[0].text()).toContain("Test attribute");
    expect(rows[2].text()).toContain(".btn-primary");
  });

  // Ordering IS the feature. It must not need discovering, so this is permanent
  // helper text rather than a tooltip.
  it("says how the list is used, without being asked", () => {
    expect(render().text()).toContain("Tried in order, top first");
  });

  it("labels where each candidate came from", () => {
    const wrapper = render({
      candidates: [
        { kind: "css", value: "#mine", origin: "authored" },
        { kind: "test_attribute", value: TESTID },
      ],
    });
    const rows = wrapper.findAll("tbody tr");
    expect(rows[0].text()).toContain("Yours");
    // Absent origin means recorded — the shape every pre-provenance bundle has.
    expect(rows[1].text()).toContain("Recorded");
  });

  // Provenance is worth a glance, not only a read: a row the author added should
  // be tellable from a recorded one without parsing the badge's text.
  it("colours the origin badge by where the candidate came from", () => {
    const wrapper = render({
      candidates: [
        { kind: "test_attribute", value: TESTID },
        { kind: "css", value: "#mine", origin: "authored" },
        { kind: "css", value: "#built", origin: "composite" },
      ],
    });
    const variants = wrapper.findAllComponents({ name: "OBadge" }).map((c) => c.props("variant"));
    expect(variants).toContain("primary-outline");
    expect(variants).toContain("info-outline");
  });
});

// "The first one that matches is used" is invisible in a list that conveys its
// order through vertical stacking alone.
describe("order", () => {
  it("numbers every row by its position in the list", () => {
    const orders = render()
      .findAll(test("synthetics-journey-step-locator-row-order"))
      .map((n) => n.text());
    expect(orders).toEqual(["1", "2", "3"]);
  });

  it("marks only the first row as the one that is tried first", () => {
    const wrapper = render();
    const marks = wrapper.findAll(test("synthetics-journey-step-locator-row-tried-first"));
    expect(marks).toHaveLength(1);
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("Tried first");
  });
});

// The reorder is the replacement for pinning. A pin was exclusive: the only way
// to say "prefer this one" was to turn fallback off entirely.
describe("reordering", () => {
  it("emits the new order and marks the list author-owned", async () => {
    const wrapper = render();
    const reversed = [...BUNDLE.candidates].reverse();

    await wrapper.findComponent({ name: "OTable" }).vm.$emit("row-reorder", reversed);

    const next = emitted(wrapper);
    expect(next.candidates.map((c) => c.value)).toEqual(reversed.map((c) => c.value));
    // H1: healing must never reorder an author-owned list, and the flag is set
    // by the act rather than by a control nobody would think to touch.
    expect(next.author_ordered).toBe(true);
  });
});

describe("adding your own locator", () => {
  async function addOwn(wrapper: VueWrapper, value: string) {
    await ownInput(wrapper).setValue(value);
    await wrapper.find(test("synthetics-journey-step-locator-add")).trigger("click");
  }

  it("labels the input as the primary control, not an override", () => {
    const wrapper = render(EMPTY);
    expect(ownInput(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain("How to find this element");
    expect(wrapper.text()).not.toContain("Use a different locator");
  });

  it("marks the input required — the block only renders when a target is needed", () => {
    const wrapper = render(EMPTY);
    expect(wrapper.findComponent({ name: "OInput" }).props("required")).toBe(true);
  });

  // A hand-added step reaches the same append path a recorded one does. There is
  // no separate override slot to write into — the candidate list is the only
  // place a locator lives, so the first entry simply starts it.
  it("still emits update:locator when a value is applied", async () => {
    const wrapper = render(EMPTY);
    await addOwn(wrapper, '[data-test="sign-in"]');

    const next = emitted(wrapper);
    expect(next.candidates).toEqual([
      { kind: "css", value: '[data-test="sign-in"]', origin: "authored" },
    ]);
    expect(next.author_ordered).toBe(true);
  });

  it("appends it, with a kind read from the value", async () => {
    const wrapper = render();
    await addOwn(wrapper, 'internal:role=button[name="Go"i]');

    const next = emitted(wrapper);
    expect(next.candidates).toHaveLength(4);
    expect(next.candidates[3]).toEqual({
      kind: "role",
      value: 'internal:role=button[name="Go"i]',
      origin: "authored",
    });
    expect(next.author_ordered).toBe(true);
  });

  // `row-key="value"` needs values to stay unique. Nothing could add a
  // candidate before this phase, so nothing checked — and a duplicate breaks
  // table selection silently rather than loudly.
  it("refuses a duplicate rather than breaking row identity", async () => {
    const wrapper = render();
    await addOwn(wrapper, TESTID);

    expect(wrapper.emitted("update:locator")).toBeFalsy();
    expect(wrapper.find(test("synthetics-journey-step-locator-error")).text()).toContain(
      "already in the list",
    );
  });

  // A recorded row has no in-place edit and no "start from this" copy button: the
  // stored list is what a later healing pass compares against, so an author's
  // correction is appended as their own row rather than written over the evidence.
  it("offers no way to edit a recorded value in place", () => {
    const wrapper = render();
    const rows = wrapper.findAll("tbody tr");
    expect(rows[0].find("input[type='text']").exists()).toBe(false);
    expect(wrapper.find(test("synthetics-journey-step-locator-start-from-btn")).exists()).toBe(
      false,
    );
  });
});

describe("deleting", () => {
  it("removes the row and keeps the rest in order", async () => {
    const wrapper = render();
    await wrapper.findAll(test("synthetics-journey-step-locator-delete-btn"))[0].trigger("click");

    expect(emitted(wrapper).candidates.map((c) => c.value)).toEqual([ROLE, ".btn-primary"]);
  });

  // "Use only this one" is expressed by deleting the others — right up to the
  // point where the step would name no element at all, which the save gate
  // refuses and this block cannot recover from.
  it("refuses to delete the last one", async () => {
    const wrapper = render({ candidates: [{ kind: "css", value: "#only" }] });
    await wrapper.find(test("synthetics-journey-step-locator-delete-btn")).trigger("click");

    expect(wrapper.emitted("update:locator")).toBeFalsy();
    expect(wrapper.find(test("synthetics-journey-step-locator-error")).text()).toContain(
      "at least one locator",
    );
  });
});

// Per row, not per block. The old whole-block notice fired only when EVERY
// candidate was positional — that is, only when nothing could be done about it
// — and stayed silent when something could.
describe("per-row warnings", () => {
  it("warns on each positional row, not only when all of them are", () => {
    const wrapper = render({
      candidates: [
        { kind: "test_attribute", value: '[data-test="row"] >> nth=1' },
        { kind: "role", value: ROLE },
        { kind: "css", value: "body > div:nth-child(3)" },
      ],
    });

    expect(wrapper.findAll(test("synthetics-journey-step-locator-row-positional"))).toHaveLength(2);
  });

  it("warns on an id the component library mints per render", () => {
    const wrapper = render({
      candidates: [
        { kind: "css", value: "#reka-popover-trigger-v-21" },
        { kind: "css", value: "#main-content" },
      ],
    });

    expect(wrapper.findAll(test("synthetics-journey-step-locator-row-generated-id"))).toHaveLength(
      1,
    );
  });
});

// What the block is responsible for: opening the builder with the right rows,
// and placing what comes back. The builder's own behaviour — the relation
// picker, the position toggle, the result string — is pinned in
// LocatorComposeDialog.spec.ts, because ODialog teleports its content out of
// this wrapper's tree and asserting through it would test the teleport.
describe("combining", () => {
  const dialogOf = (wrapper: VueWrapper) => wrapper.findComponent({ name: "LocatorComposeDialog" });

  async function select(wrapper: VueWrapper, values: string[]) {
    await wrapper.findComponent({ name: "OTable" }).vm.$emit("update:selectedIds", values);
    await wrapper.vm.$nextTick();
  }

  it("stays out of reach until two rows are selected", async () => {
    const wrapper = render();
    expect(wrapper.find(test("synthetics-journey-step-locator-combine")).exists()).toBe(false);

    await select(wrapper, [TESTID]);
    expect(wrapper.find(test("synthetics-journey-step-locator-combine")).exists()).toBe(false);

    await select(wrapper, [TESTID, ROLE]);
    expect(wrapper.find(test("synthetics-journey-step-locator-combine")).exists()).toBe(true);
  });

  // "Combine" alone reads as "merge these into a fallback set", which is the
  // opposite of what it builds — the result fails if any part stops matching.
  it("says what combining produces, beside the button", async () => {
    const wrapper = render();
    await select(wrapper, [TESTID, ROLE]);
    expect(wrapper.text()).toContain("Merge into one stricter locator");
  });

  async function openDialog(wrapper: VueWrapper, values: string[]) {
    await select(wrapper, values);
    await wrapper.find(test("synthetics-journey-step-locator-combine")).trigger("click");
    await wrapper.vm.$nextTick();
  }

  // `and` is provably safe between recorded candidates: Playwright verified each
  // against the same target, so intersecting them gives that target. Asking here
  // would add a click and teach nothing.
  it("opens with the selected rows and the recorded values to reason from", async () => {
    const wrapper = render();
    await openDialog(wrapper, [TESTID, ROLE]);

    const dialog = dialogOf(wrapper);
    expect(dialog.props("open")).toBe(true);
    // The proof the builder needs: every recorded value in the bundle. It uses
    // it to decide whether `and` is provably safe and the picker can be hidden.
    expect(dialog.props("recorded")).toEqual([TESTID, ROLE, ".btn-primary"]);
    expect((dialog.props("parts") as { value: string }[]).map((p) => p.value)).toEqual([
      TESTID,
      ROLE,
    ]);
  });

  // The guarantee ends the moment a locator the author typed joins in, and the
  // editor has no live DOM with which to notice a wrong choice.
  it("hands the builder only the recorded values, so it can tell them apart", async () => {
    const wrapper = render({
      candidates: [
        { kind: "test_attribute", value: TESTID },
        { kind: "css", value: "#mine", origin: "authored" },
      ],
    });
    await openDialog(wrapper, [TESTID, "#mine"]);

    // "#mine" is absent, so canDefaultToAnd is false and the builder asks.
    expect(dialogOf(wrapper).props("recorded")).toEqual([TESTID]);
  });

  it("passes the selected rows in LIST order, not selection order", async () => {
    const wrapper = render();
    // Selected bottom-up; the base part must still be the higher row.
    await openDialog(wrapper, [".btn-primary", TESTID]);

    expect((dialogOf(wrapper).props("parts") as { value: string }[]).map((p) => p.value)).toEqual([
      TESTID,
      ".btn-primary",
    ]);
  });

  it("appends the combination with its parts and how they were joined", async () => {
    const wrapper = render();
    await openDialog(wrapper, [TESTID, ROLE]);
    await wrapper.findComponent({ name: "LocatorComposeDialog" }).vm.$emit("combine", {
      value: `${TESTID} >> internal:and=${JSON.stringify(ROLE)}`,
      from: [{ value: TESTID }, { relation: "and", value: ROLE }],
    });

    const next = emitted(wrapper);
    expect(next.candidates).toHaveLength(4);
    const combined = next.candidates[3];
    expect(combined.origin).toBe("composite");
    // The first part is the base, so it carries no relation; every later one
    // must. A flat relation on the candidate could not express a mixed chain.
    expect(combined.from?.[0]).toEqual({ value: TESTID });
    expect(combined.from?.[1]).toEqual({ relation: "and", value: ROLE });
    // `kind` comes from the first part — "composite" is where it came from, not
    // how the element is found, so LocatorKind stays a five-value enum.
    expect(combined.kind).toBe("test_attribute");
  });
});

describe("a step added by hand", () => {
  it("is a single required input, with no table above it", () => {
    const wrapper = render({ candidates: [] });

    expect(wrapper.find(test("synthetics-journey-step-locator-table")).exists()).toBe(false);
    expect(ownInput(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain("How to find this element");
  });
});
