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
import { describe, expect, it } from "vitest";

import OnCallCoverForm from "@/components/oncall/OnCallCoverForm.vue";
import i18n from "@/locales";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import type { Shift } from "@/utils/oncall";

const FROM = 1_700_000_000_000_000;

const stubs = {
  // Renders the body and exposes the primary click, which is what drives a
  // swap — the cover half submits through OForm instead.
  ODialog: {
    name: "ODialog",
    // The REAL prop names. `primary-label` / `primary-disabled` are not props
    // of ODialog at all — passing those is what hid the footer entirely, so a
    // stub that accepted them would keep the bug invisible in tests.
    props: ["open", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonDisabled"],
    emits: ["click:primary", "click:secondary", "update:open"],
    template: `<div v-if="open">
      <slot />
      <button
        data-test="dialog-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>`,
  },
  // `defaultValues` is declared because the pre-selected person is only
  // observable through it: OFormSelect is a stub, so the field itself renders
  // nothing to read the value off.
  OForm: { name: "OForm", props: ["defaultValues", "schema"], template: "<form><slot /></form>" },
  OFormSelect: { name: "OFormSelect", template: "<div />" },
  OFormDateTimeRange: { name: "OFormDateTimeRange", template: "<div />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OBanner: { name: "OBanner", template: "<div><slot /></div>" },
  OToggleGroup: {
    name: "OToggleGroup",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    props: ["value"],
    template: `<button @click="$parent.$emit('update:modelValue', value)"><slot /></button>`,
  },
  // `options` and `modelValue` both matter here: the value IS the shift's start
  // instant, and a stub that dropped them would let a swap of the wrong two
  // weeks pass.
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options", "label"],
    emits: ["update:modelValue"],
    template: `<select @change="$emit('update:modelValue', $event.target.value)">
      <option v-for="o in options" :key="String(o.value)" :value="o.value">{{ o.label }}</option>
    </select>`,
  },
};

function shift(member: string, index: number): Shift {
  return {
    member,
    startMicros: FROM + index * MICROS_PER_WEEK,
    endMicros: FROM + (index + 1) * MICROS_PER_WEEK,
  };
}

const SHIFTS: Shift[] = [shift("ana@o2.ai", 0), shift("bo@o2.ai", 1), shift("ana@o2.ai", 2)];

function render(shifts: Shift[] = SHIFTS) {
  return mount(OnCallCoverForm, {
    props: {
      open: true,
      members: [],
      timezone: "UTC",
      shifts,
    },
    global: { plugins: [i18n], stubs },
  });
}

/// Picks the nth option of the nth select — the two selects are "this shift"
/// and "swaps with", in that order.
async function pick(wrapper: any, which: 0 | 1, optionIndex: number) {
  const select = wrapper.findAll("select")[which];
  const option = select.findAll("option")[optionIndex];
  select.element.value = option.element.value;
  await select.trigger("change");
}

async function intoSwapMode(wrapper: any) {
  await wrapper.find('[data-test="oncall-cover-mode-swap"]').trigger("click");
}

/// The header's *Take override* opens this dialog on the reader — the answer
/// they came to give, already filled in. A pre-selection the picker cannot
/// show is worse than none: the field would read as chosen and submit as
/// nothing, so the team roster is the gate.
describe("OnCallCoverForm — a pre-selected person", () => {
  const MEMBERS = [{ user_email: "ana@o2.ai" }, { user_email: "bo@o2.ai" }];

  function renderCover(defaultUser: string, members = MEMBERS) {
    return mount(OnCallCoverForm, {
      props: { open: true, members, timezone: "UTC", shifts: [], defaultUser },
      global: { plugins: [i18n], stubs },
    });
  }

  const filledUser = (wrapper: ReturnType<typeof renderCover>) =>
    wrapper.findComponent({ name: "OForm" }).props("defaultValues").user_email;

  it("pre-selects somebody on the team", () => {
    expect(filledUser(renderCover("bo@o2.ai"))).toBe("bo@o2.ai");
  });

  /// Somebody reading a team they are not on — an admin arranging cover for a
  /// team elsewhere in the org. There is no option for them, so there is no
  /// pre-selection either.
  it("pre-selects nobody when that person is not on this team", () => {
    expect(filledUser(renderCover("zoe@o2.ai"))).toBe("");
  });

  /// The value has to BE one of the options, not merely equal-looking: a
  /// select matches by identity, so the roster's own spelling is what lands.
  it("fills the roster's spelling, not the caller's", () => {
    expect(filledUser(renderCover(" Ana@O2.ai "))).toBe("ana@o2.ai");
  });

  it("pre-selects nobody when the caller named nobody", () => {
    expect(filledUser(renderCover(""))).toBe("");
  });
});

describe("OnCallCoverForm — swapping", () => {
  /// F6: two people trading weeks is ONE errand. Expressed as two covers it is
  /// two dialogs, two date ranges, and a chance to get the second one backwards.
  it("writes one cover each way, each naming the other person", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);

    await pick(wrapper, 0, 0); // ana's first week
    await pick(wrapper, 1, 1); // bo's week
    await wrapper.find('[data-test="dialog-primary"]').trigger("click");

    const swap = wrapper.emitted("swap")?.[0]?.[0] as any;
    expect(swap).toBeTruthy();
    // Over ana's week, bo covers; over bo's week, ana does. Getting this
    // backwards writes a swap that changes nothing and reads as if it worked.
    expect(swap.first).toEqual({
      user_email: "bo@o2.ai",
      start_at: SHIFTS[0].startMicros,
      end_at: SHIFTS[0].endMicros,
    });
    expect(swap.second).toEqual({
      user_email: "ana@o2.ai",
      start_at: SHIFTS[1].startMicros,
      end_at: SHIFTS[1].endMicros,
    });
  });

  /// The summary names both directions, because "Ana and Bo swap" leaves the
  /// reader to work out which week each of them ends up holding.
  it("says which week each person ends up holding", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 0);
    await pick(wrapper, 1, 1);

    const text = wrapper.find('[data-test="oncall-swap-summary"]').text();
    expect(text).toContain("bo@o2.ai takes ana@o2.ai's shift");
    expect(text).toContain("ana@o2.ai takes bo@o2.ai's");
  });

  /// Two shifts of the same person writes two covers that change nothing —
  /// refused with a reason rather than a disabled button and no explanation.
  it("refuses a swap between one person's own two weeks", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 0); // ana
    await pick(wrapper, 1, 2); // ana again

    expect(wrapper.find('[data-test="oncall-swap-problem"]').text()).toContain(
      "changes nothing",
    );
    expect(wrapper.find('[data-test="oncall-swap-summary"]').exists()).toBe(false);

    await wrapper.find('[data-test="dialog-primary"]').trigger("click");
    expect(wrapper.emitted("swap")).toBeFalsy();
  });

  it("refuses a shift swapped with itself", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 1);
    await pick(wrapper, 1, 1);

    expect(wrapper.find('[data-test="oncall-swap-problem"]').text()).toContain(
      "cannot swap with itself",
    );
    await wrapper.find('[data-test="dialog-primary"]').trigger("click");
    expect(wrapper.emitted("swap")).toBeFalsy();
  });

  /// The dialog had NO footer at all: it passed `primary-label` and
  /// `secondary-label`, which are not props of ODialog — `primaryButtonLabel`
  /// is — so `hasFooter` was false and Save and Cancel were never rendered.
  /// Unknown props fall through as attributes and warn about nothing, which is
  /// why a whole missing button survived a screen-by-screen audit.
  it("renders a save button at all", () => {
    const wrapper = render();
    const save = wrapper.find('[data-test="dialog-primary"]');

    expect(save.exists()).toBe(true);
    expect(save.text()).toBe("Save");
  });

  /// Nothing picked is not a swap, and a button that writes two covers must
  /// not be pressable until it knows which two.
  it("cannot be saved before two shifts are chosen", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);

    expect(wrapper.find('[data-test="dialog-primary"]').attributes("disabled")).toBeDefined();
  });

  /// A team with no rota has no weeks to trade, and an empty picker is a worse
  /// answer than no picker.
  it("offers no swap mode when there are no shifts to trade", () => {
    expect(render([]).find('[data-test="oncall-cover-mode"]').exists()).toBe(false);
  });

  /// A gap is a hole to fill, never a week to trade: opening on Swap would
  /// answer a question the caller did not ask.
  it("opens on cover, even after a swap was left selected", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    expect(wrapper.find('[data-test="oncall-swap-form"]').exists()).toBe(true);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect(wrapper.find('[data-test="oncall-swap-form"]').exists()).toBe(false);
  });
});
