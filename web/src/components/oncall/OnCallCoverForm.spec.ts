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

import { flushPromises, mount } from "@vue/test-utils";
import { inject } from "vue";
import { describe, expect, it } from "vitest";

import OnCallCoverForm from "@/components/oncall/OnCallCoverForm.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import i18n from "@/locales";
import { MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { formatDayRange, formatShiftRange, toZonedInputValue } from "@/utils/oncall";
import type { UpcomingShift } from "./OnCallCoverForm.vue";
import { queryClient } from "@/composables/query/queryClient";
import { orgUsersQuery } from "@/services/users.queries";
import store from "@/test/unit/helpers/store";

/// Tomorrow, not a frozen instant in 2023. Every fixture below is a window
/// somebody could actually be asked to cover, and a schema that refuses hours
/// which have already elapsed reads a hardcoded past constant as the defect it
/// is there to catch.
const FROM = Date.now() * 1000 + MICROS_PER_DAY;

/// A team whose clock is half an hour off every round offset, which is where
/// a UTC-flavoured "midnight" shows up as 05:30.
const IST = "Asia/Kolkata";

/// What a hand-pick in the range control puts into the field.
const PICKED = { from: FROM, to: FROM + MICROS_PER_HOUR };

/**
 * What a stubbed field shares with a real one: it reads its value and **its
 * error** from the form context, and writes back through `setFieldValue`.
 *
 * Rendering the error is the part that matters. "Save does nothing" and "Save
 * refuses and says why" look identical to a test that cannot see the message,
 * and the first of those is the defect this file was rewritten for.
 */
function useStubbedField(name: string) {
  const form = inject<any>(FORM_CONTEXT_KEY);
  return {
    // `useStore`, not a `computed` over `form.state`: the latter reads the
    // store once and never hears about the validation that follows a submit,
    // so the error would be permanently empty and every refusal test would
    // pass by describing a blank field.
    value: form.useStore((state: any) => state.values?.[name] ?? ""),
    // Read from `errorMap`, not `errors`: TanStack keys issues by the
    // validator that raised them (`onDynamic` here, since the schema is the
    // single source), and the flat `errors` array is shaped differently.
    error: form.useStore((state: any) =>
      Object.values(state.fieldMeta?.[name]?.errorMap ?? {})
        .flat()
        .map((issue: unknown) =>
          typeof issue === "string" ? issue : ((issue as { message?: string })?.message ?? ""),
        )
        .join(" "),
    ),
    set: (range: { from: number; to: number } | undefined) => form?.setFieldValue(name, range),
  };
}

/// What the closed When field reads, as the picker is told to print it.
const fieldText = (wrapper: { findComponent: (s: { name: string }) => any }) =>
  String(wrapper.findComponent({ name: "OFormDateTimeRange" }).attributes("trigger-text") ?? "");

const stubs = {
  // Renders the body and exposes the primary click, which is what drives a
  // swap — the cover half submits through OForm instead.
  ODialog: {
    name: "ODialog",
    // The REAL prop names. `primary-label` / `primary-disabled` are not props
    // of ODialog at all — passing those is what hid the footer entirely, so a
    // stub that accepted them would keep the bug invisible in tests.
    props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonDisabled"],
    emits: ["click:primary", "click:secondary", "update:open"],
    template: `<div v-if="open">
      <slot />
      <slot name="footer-left" />
      <button
        data-test="dialog-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>`,
  },
  // **OForm is NOT stubbed.** Stubbing it is how "Save issues no request"
  // shipped: the schema required `start_at`/`end_at` while the form carried a
  // single `window`, zod failed on two keys with no rendered control, and
  // `@submit` never fired — invisible to every test here, because none of them
  // ran a validator. The real OForm runs the real schema over the real values.
  //
  // The FIELDS stay stubbed, and that is sound: TanStack validates
  // `state.values` as a whole, so the schema is exercised whether or not a
  // control rendered. These stubs read and write the form through the same
  // context a real field uses, so a test can see what the reader would.
  OFormSelect: {
    name: "OFormSelect",
    props: ["name"],
    setup(props: { name: string }) {
      return useStubbedField(props.name);
    },
    template: `<div :data-test-field="name" :data-test-value="value">{{ error }}</div>`,
  },
  // `data-test-type` is the picker's OWN bookkeeping, and it decides whether
  // the instants beside it survive: read back as `relative`, the real control
  // re-resolves the period against the moment it mounts and throws the seeded
  // window away.
  OFormDateTimeRange: {
    name: "OFormDateTimeRange",
    props: ["name"],
    template: `<span :data-test-field="name" :data-test-type="value?.type">
      <slot name="label-append" />
      <slot name="above" />
      <button data-test="window-pick" @click="set(PICKED)">{{ error }}</button>
      <button data-test="window-clear" @click="set(undefined)"></button>
      <button data-test="window-round" @click="round()"></button>
    </span>`,
    setup(props: { name: string }) {
      const field = useStubbedField(props.name);
      // What the real picker does to a range it is handed: it keeps whole minutes only.
      const toMinute = (micros: number) => Math.floor(micros / 60_000_000) * 60_000_000;
      const round = () => {
        const range = field.value.value as { from: number; to: number };
        field.set({ from: toMinute(range.from), to: toMinute(range.to) });
      };
      return { ...field, PICKED, round };
    },
  },
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

function shift(member: string, index: number): UpcomingShift {
  return {
    member,
    startMicros: FROM + index * MICROS_PER_WEEK,
    endMicros: FROM + (index + 1) * MICROS_PER_WEEK,
    // Every swappable week belongs to a rotation: a swap is written against the
    // position the shift rule staffs, and two rotations hand over at the same
    // instant, so the instant alone cannot say which week was picked.
    rotationId: "rot_primary",
    rotationName: "Primary",
  };
}

const SHIFTS: UpcomingShift[] = [
  shift("ana@o2.ai", 0),
  shift("bo@o2.ai", 1),
  shift("ana@o2.ai", 2),
];

function render(shifts: UpcomingShift[] = SHIFTS) {
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

/// A window means nothing without the clock it is on. The dialog showed a UTC
/// team's hours to a reader in IST with no marker at all, so the summary read
/// five and a half hours off the times they had just typed and nothing on
/// screen said why.
describe("OnCallCoverForm — which clock the times are on", () => {
  const MEMBERS = [{ user_email: "ana@o2.ai" }];

  function renderCover(props: Record<string, unknown> = {}) {
    return mount(OnCallCoverForm, {
      props: {
        open: true,
        members: MEMBERS,
        timezone: "UTC",
        shifts: [],
        defaultUser: "ana@o2.ai",
        teamName: "Platform",
        gap: { from: FROM, to: FROM + MICROS_PER_HOUR },
        ...props,
      },
      global: { plugins: [i18n], stubs },
    });
  }

  const summaryOf = (wrapper: ReturnType<typeof renderCover>) =>
    wrapper.find('[data-test="oncall-cover-summary"]').text();

  // S14: the action has one name, and the window field asks "When".
  it("is titled Cover a shift, with the window labelled When", () => {
    const wrapper = renderCover();

    expect(wrapper.findComponent({ name: "ODialog" }).props("title")).toBe("Cover a shift");
    expect(wrapper.findComponent({ name: "OFormDateTimeRange" }).attributes("label")).toBe("When");
  });

  // The closed field states the whole window with times, so nobody opens it just to read it.
  it("shows the window with its times on the team's clock, naming the zone for a reader elsewhere", async () => {
    const wrapper = renderCover({ viewerTimezone: IST });
    await flushPromises();

    expect(fieldText(wrapper)).toContain("→");
    expect(fieldText(wrapper)).toMatch(/\d{2}:\d{2}/);
    expect(fieldText(wrapper).match(/UTC/g)).toHaveLength(1);
    expect(fieldText(wrapper)).toMatch(/ UTC$/);
  });

  /// The picker opens on the team's clock, so its zone and the closed field agree.
  it("opens the picker on the team's zone, without the copy and paste row", () => {
    const wrapper = renderCover({ timezone: IST, viewerTimezone: "UTC" });
    const picker = wrapper.findComponent({ name: "OFormDateTimeRange" });

    expect(picker.attributes("picker-timezone")).toBe(IST);
    expect(picker.attributes()).toHaveProperty("hide-clipboard");
  });

  /// Another zone picked in the picker leaves the field on team time, and the tooltip restates the picked one.
  it("keeps the field on team time when another zone is picked, and names the picked range", async () => {
    const wrapper = renderCover({ timezone: IST, viewerTimezone: IST });
    await flushPromises();
    expect(fieldText(wrapper)).not.toContain("GMT");

    wrapper.findComponent({ name: "OFormDateTimeRange" }).vm.$emit("on:timezone-change", "UTC");
    await flushPromises();

    expect(fieldText(wrapper)).toMatch(/ GMT\+5:30$/);
    const info = wrapper.findComponent({ name: "OnCallZoneInfo" });
    expect(info.props("pickedTimezone")).toBe("UTC");
    expect(info.props("timezone")).toBe(IST);
  });

  // C8: a cover looks ahead, so the calendar runs from today to the 730-day limit, on the picker's clock.
  it("offers today up to 730 days ahead, and says a refusal under the picker", () => {
    const wrapper = renderCover({ timezone: IST, viewerTimezone: "UTC" });
    const day = (micros: number) => toZonedInputValue(micros, IST).slice(0, 10).replace(/-/g, "/");
    const now = Date.now() * 1000;

    const picker = wrapper.findComponent({ name: "OFormDateTimeRange" });
    expect(picker.attributes("min-date")).toBe(day(now));
    expect(picker.attributes("max-date")).toBe(day(now + 730 * MICROS_PER_DAY));
    expect(picker.attributes()).toHaveProperty("show-error");
  });

  /// One clock, said once: the summary names who covers, never the window again.
  it("says the window once, in the field, when the reader is on the team's clock", async () => {
    const wrapper = renderCover({ viewerTimezone: "UTC" });
    await flushPromises();

    expect(fieldText(wrapper)).not.toContain("UTC");
    expect(summaryOf(wrapper)).toContain("ana@o2.ai covers Platform, ");
    expect(summaryOf(wrapper)).not.toMatch(/\d{2}:\d{2}/);
    expect(wrapper.find('[data-test="oncall-cover-summary-team-zone"]').exists()).toBe(false);
  });

  /// The presets set the same field, so the one whose range it still holds is lit until the reader picks by hand.
  it("lights the quick range the window matches, and unlights it on a hand-pick", async () => {
    const wrapper = renderCover();
    const tonight = () => wrapper.findComponent('[data-test="oncall-cover-preset-tonight"]');
    await wrapper.find('[data-test="oncall-cover-preset-tonight"]').trigger("click");
    await flushPromises();
    expect(tonight().attributes("aria-pressed")).toBe("true");

    await wrapper.find('[data-test="window-pick"]').trigger("click");
    await flushPromises();
    expect(tonight().attributes("aria-pressed")).toBe("false");
  });

  /// "Rest of today" and "Next 7 days" start at now, which the picker reads back to the minute.
  it.each(["rest-of-day", "tonight", "tomorrow", "next-7-days"])(
    "keeps %s lit after the picker rounds its range to the minute",
    async (key) => {
      const wrapper = renderCover();
      const button = () => wrapper.findComponent(`[data-test="oncall-cover-preset-${key}"]`);
      await wrapper.find(`[data-test="oncall-cover-preset-${key}"]`).trigger("click");
      await wrapper.find('[data-test="window-round"]').trigger("click");
      await flushPromises();
      expect(button().attributes("aria-pressed")).toBe("true");
      const lit = wrapper
        .findAll('[data-test^="oncall-cover-preset-"]')
        .filter((one) => one.attributes("aria-pressed") === "true");
      expect(lit).toHaveLength(1);
    },
  );
});

/// The header's *Cover a shift* opens this dialog on the reader — the answer
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

  /// Read off the field itself rather than the form's config: what matters is
  /// what the control would show the reader.
  const filledUser = (wrapper: ReturnType<typeof renderCover>) =>
    wrapper.find('[data-test-field="user_email"]').attributes("data-test-value");

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
  /// Opened as a cover from a shift bar, the Swap tab still knows which shift was clicked.
  it("keeps the clicked shift when switching from cover to swap", async () => {
    const wrapper = mount(OnCallCoverForm, {
      props: {
        open: false,
        members: [],
        timezone: "UTC",
        shifts: SHIFTS,
        swapFrom: { rotationId: "rot_primary", at: FROM + MICROS_PER_WEEK },
      },
      global: { plugins: [i18n], stubs },
    });
    await wrapper.setProps({ open: true });
    await intoSwapMode(wrapper);

    const first = wrapper.findAllComponents({ name: "OSelect" })[0];
    expect(first.props("modelValue")).toBe(first.props("options")[1].value);
  });

  /// F6: two people trading weeks is ONE errand. Expressed as two covers it is
  /// two dialogs, two date ranges, and a chance to get the second one backwards.
  it("writes one cover each way, each naming the other person", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);

    await pick(wrapper, 0, 0); // ana's first week
    await pick(wrapper, 1, 0); // bo's week
    await wrapper.find('[data-test="dialog-primary"]').trigger("click");

    const swap = wrapper.emitted("swap")?.[0]?.[0] as any;
    expect(swap).toBeTruthy();
    // Over ana's week, bo covers; over bo's week, ana does. Getting this
    // backwards writes a swap that changes nothing and reads as if it worked.
    expect(swap.first).toMatchObject({
      user_email: "bo@o2.ai",
      start_at: SHIFTS[0].startMicros,
      end_at: SHIFTS[0].endMicros,
      covering_for: "ana@o2.ai",
    });
    expect(swap.second).toMatchObject({
      user_email: "ana@o2.ai",
      start_at: SHIFTS[1].startMicros,
      end_at: SHIFTS[1].endMicros,
      covering_for: "bo@o2.ai",
    });
  });

  /// A cover with no rotation lands on the primary. On a two-rotation team that is
  /// not "the rotation being traded" — it is the primary, whose holder the
  /// swap then silently evicts.
  it("writes each cover onto the rotation its shift came from", async () => {
    const wrapper = render([
      { ...shift("ana@o2.ai", 0), rotationId: "rot_secondary", rotationName: "Secondary" },
      { ...shift("bo@o2.ai", 1), rotationId: "rot_secondary", rotationName: "Secondary" },
    ]);
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 0);
    await pick(wrapper, 1, 0);
    await wrapper.find('[data-test="dialog-primary"]').trigger("click");

    const swap = wrapper.emitted("swap")?.[0]?.[0] as any;
    expect(swap.first.rotation_id).toBe("rot_secondary");
    expect(swap.second.rotation_id).toBe("rot_secondary");
  });

  /// Slots do not compete — both are on call at the same instant — so trading
  /// across them staffs one pool twice instead of exchanging anything.
  it("labels each shift with its start and end time, not only the dates", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    const labels = wrapper
      .findAll("select")[0]
      .findAll("option")
      .map((o) => o.text());
    expect(labels[0]).toMatch(/\d{2}:\d{2}.* – .*\d{2}:\d{2}/);
  });

  it("refuses a swap across two rotations", async () => {
    const wrapper = render([
      { ...shift("ana@o2.ai", 0), rotationId: "rot_primary", rotationName: "Primary" },
      { ...shift("bo@o2.ai", 1), rotationId: "rot_secondary", rotationName: "Secondary" },
    ]);
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 0);
    await pick(wrapper, 1, 0);

    expect(wrapper.find('[data-test="oncall-swap-problem"]').text()).toContain("same rotation");
    expect(wrapper.find('[data-test="oncall-swap-summary"]').exists()).toBe(false);
  });

  /// The summary names both directions, because "Ana and Bo swap" leaves the
  /// reader to work out which week each of them ends up holding.
  it("says which week each person ends up holding", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 0);
    await pick(wrapper, 1, 0);

    // U19: both ranges, with their times when a handover is mid-day, and nothing about reordering.
    const range = (one: UpcomingShift) => formatShiftRange(one.startMicros, one.endMicros, "UTC");
    expect(wrapper.find('[data-test="oncall-swap-summary"]').text()).toBe(
      `bo@o2.ai takes ${range(SHIFTS[0])}; ana@o2.ai takes ${range(SHIFTS[1])}.`,
    );
  });

  /// Two shifts of the same person writes two covers that change nothing —
  /// refused with a reason rather than a disabled button and no explanation.
  it("refuses a swap between one person's own two weeks", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 0); // ana
    await pick(wrapper, 1, 1); // ana again

    expect(wrapper.find('[data-test="oncall-swap-problem"]').text()).toContain("changes nothing");
    expect(wrapper.find('[data-test="oncall-swap-summary"]').exists()).toBe(false);

    await wrapper.find('[data-test="dialog-primary"]').trigger("click");
    expect(wrapper.emitted("swap")).toBeFalsy();
  });

  it("does not offer the picked shift as its own partner", async () => {
    const wrapper = render();
    await intoSwapMode(wrapper);
    await pick(wrapper, 0, 1);

    const partners = wrapper
      .findAll("select")[1]
      .findAll("option")
      .map((o) => o.element.value);
    expect(partners).toHaveLength(SHIFTS.length - 1);
    expect(partners).not.toContain(wrapper.findAll("select")[0].element.value);
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

/// **The half of this dialog nothing tested.** The swap tab bypasses OForm
/// entirely, so all the coverage above ran against a code path that was
/// working — while `Request cover → Save` issued no HTTP request at all,
/// because the schema demanded `start_at`/`end_at` and the form rendered one
/// `window`. Zod failed on two keys with no control to attach an error to, so
/// nothing surfaced on screen and `@submit` never fired.
///
/// Submitting the real `<form>` is the point of every test below: it runs the
/// real validators over the real values, which is the one thing a stubbed
/// OForm cannot do.
describe("OnCallCoverForm — taking a cover", () => {
  const MEMBERS = [{ user_email: "ana@o2.ai" }, { user_email: "bo@o2.ai" }];
  const GAP = { from: FROM, to: FROM + MICROS_PER_DAY };

  function renderCover(props: Record<string, unknown> = {}) {
    return mount(OnCallCoverForm, {
      props: {
        open: true,
        members: MEMBERS,
        timezone: "UTC",
        shifts: [],
        defaultUser: "ana@o2.ai",
        ...props,
      },
      global: { plugins: [i18n], stubs },
    });
  }

  /// TanStack runs the schema through `onDynamicAsync` as well as `onDynamic`,
  /// so a submit settles a macrotask later — one `flushPromises` reads the
  /// form mid-validation and every assertion below would pass for the wrong
  /// reason.
  async function save(wrapper: ReturnType<typeof renderCover>) {
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    return wrapper.emitted("save")?.[0]?.[0] as
      { user_email: string; start_at: number; end_at: number; rotation_id?: string } | undefined;
  }

  // Save stays enabled; submitting with nobody picked names the missing field instead.
  it("refuses a cover with nobody covering, saying so on the person field", async () => {
    const empty = renderCover({ gap: GAP, defaultUser: "" });
    await flushPromises();
    expect(empty.find('[data-test="dialog-primary"]').attributes("disabled")).toBeUndefined();

    expect(await save(empty)).toBeUndefined();
    expect(empty.find('[data-test-field="user_email"]').text()).toBe("Choose who is covering");
  });

  it("emits the window as the start_at / end_at pair the API takes", async () => {
    const saved = await save(renderCover({ gap: GAP }));

    expect(saved).toMatchObject({
      user_email: "ana@o2.ai",
      start_at: GAP.from,
      end_at: GAP.to,
    });
  });

  /// The one sentence that says what Save is about to do, and it named the
  /// wrong person: it read `currentHolder` — whoever is being RELIEVED — as the
  /// one covering, and passed an empty string for the team, so a reader
  /// arranging cover for somebody else was shown their own shift back.
  it("says who is taking the shift, not who is losing it", async () => {
    const wrapper = renderCover({
      gap: GAP,
      currentHolder: "ana@o2.ai",
      defaultUser: "bo@o2.ai",
      teamName: "Platform",
    });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-cover-summary"]').text()).toContain(
      "bo@o2.ai covers ana@o2.ai on Platform, ",
    );
  });

  // Names are what a person recognises; the email tells two namesakes apart, so it is the row's second line and the name's tooltip.
  it("lists and names people by display name, keeping the email beside it", async () => {
    queryClient.setQueryData(orgUsersQuery("default").queryKey, [
      { email: "ana@o2.ai", first_name: "Ana" },
      { email: "bo@o2.ai", first_name: "Bo", last_name: "Lin" },
    ]);
    const wrapper = mount(OnCallCoverForm, {
      props: {
        open: true,
        members: MEMBERS,
        timezone: "UTC",
        shifts: [],
        gap: GAP,
        currentHolder: "ana@o2.ai",
        defaultUser: "bo@o2.ai",
        teamName: "Platform",
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ...stubs,
          OFormSelect: {
            name: "OFormSelect",
            props: ["name"],
            inheritAttrs: false,
            template: "<div />",
          },
        },
      },
    });
    await flushPromises();

    const who = wrapper
      .findAllComponents({ name: "OFormSelect" })
      .find((one) => one.props("name") === "user_email")!;
    // `options` reaches OSelect through attribute fall-through; OFormSelect declares only `name`.
    expect(who.vm.$attrs.options).toEqual([
      expect.objectContaining({ label: "Ana", value: "ana@o2.ai", subLabel: "ana@o2.ai" }),
      expect.objectContaining({ label: "Bo Lin", value: "bo@o2.ai", subLabel: "bo@o2.ai" }),
    ]);
    expect(wrapper.find('[data-test="oncall-cover-currently"]').exists()).toBe(false);
    const summary = wrapper.find('[data-test="oncall-cover-summary"]');
    expect(summary.text()).toContain("Bo Lin covers Ana on Platform");
    expect(summary.findComponent({ name: "OnCallPersonName" }).props("email")).toBe("bo@o2.ai");
    queryClient.removeQueries({ queryKey: orgUsersQuery("default").queryKey });
  });

  /// No person picked yet is the same half-answered state as a half-picked
  /// window: "  covers Platform Sat 18:00 – …" is worse than no sentence.
  it("says nothing until somebody has been picked", async () => {
    const wrapper = renderCover({ gap: GAP, defaultUser: "", teamName: "Platform" });
    await flushPromises();

    expect(wrapper.find('[data-test="oncall-cover-summary"]').exists()).toBe(false);
  });

  /// A preset is the answer almost every time, and it writes the field through
  /// the form rather than a mirror beside it.
  it("saves a window chosen from a quick range", async () => {
    const wrapper = renderCover();
    await wrapper.find('[data-test="oncall-cover-preset-next-7-days"]').trigger("click");

    const saved = await save(wrapper);
    expect(saved?.end_at).toBeGreaterThan(saved!.start_at);
    expect(saved!.end_at - saved!.start_at).toBe(7 * MICROS_PER_DAY);
  });

  /// The failure that made this dialog look broken rather than incomplete: no
  /// request, no message, nothing on screen. An unfilled window must refuse
  /// *visibly*.
  ///
  /// Cleared by hand, because the form no longer OPENS empty — it opens on a
  /// window that has not happened yet.
  it("refuses to save with no window, and says so on the control", async () => {
    const wrapper = renderCover();
    await wrapper.find('[data-test="window-clear"]').trigger("click");

    expect(await save(wrapper)).toBeUndefined();
    expect(wrapper.text()).toContain("Pick when the cover starts and ends");
  });

  /// The P1 this seed exists for. The control is the log-search relative picker,
  /// which defaults to the past half hour and emits it ON MOUNT — so a dialog
  /// nobody touched held a window that had already elapsed, and it saved. The
  /// window a cover opens on must be one somebody can still be asked to work.
  it("opens on a window that has not happened yet", async () => {
    const openedAt = Date.now() * 1000;
    const saved = await save(renderCover());

    expect(saved!.start_at).toBeGreaterThanOrEqual(openedAt);
    expect(saved!.end_at).toBeGreaterThan(saved!.start_at);
  });

  /// Absolute, not relative. A relative window is a period re-resolved against
  /// whenever the picker is read, so seeding one hands the control a rule that
  /// walks backwards from now — which is the defect, not a fix for it. It is
  /// also why a pre-filled gap never survived being opened.
  it("hands the picker instants rather than a period to re-resolve", async () => {
    const wrapper = renderCover({ gap: GAP });
    await flushPromises();

    const field = wrapper.find('[data-test-field="window"]');
    expect(field.attributes("data-test-type")).toBe("absolute");
    // And the reader cannot choose one either: there is no forward-looking
    // reading of "Past 30 Minutes" to offer here.
    expect(field.attributes("disable-relative")).toBeDefined();
  });

  /// Measured on a real save: window 15:56 → 16:26, created at 16:27 — expired
  /// 59 seconds before it was written, and the server took it. A cover over
  /// hours that are gone resolves for nobody and pages nobody.
  it("refuses a window that has already ended", async () => {
    const ended = Date.now() * 1000 - 2 * MICROS_PER_DAY;
    const wrapper = renderCover({ gap: { from: ended, to: ended + MICROS_PER_HOUR } });

    expect(await save(wrapper)).toBeUndefined();
    expect(wrapper.text()).toContain("already ended");
  });

  it("refuses a window that ends before it starts", async () => {
    const wrapper = renderCover({ gap: { from: FROM + MICROS_PER_DAY, to: FROM } });

    expect(await save(wrapper)).toBeUndefined();
    expect(wrapper.text()).toContain("The end must be after the start");
  });

  /// The server refuses a span over 90 days; saying so here costs a round trip
  /// less than finding out.
  it("refuses a span the server would reject", async () => {
    const wrapper = renderCover({ gap: { from: FROM, to: FROM + 91 * MICROS_PER_DAY } });

    expect(await save(wrapper)).toBeUndefined();
    expect(wrapper.text()).toContain("at most 90 days");
  });

  /// The summary read a ref that only the presets and the gap prop ever wrote,
  /// so a range picked by hand left it showing the previous window — the one
  /// element whose whole job is "what this will actually do".
  it("states the window the reader picked, not the one a preset last set", async () => {
    const wrapper = renderCover();
    await flushPromises();
    // The dialog opens on a window, so what proves the field label reads the FIELD is that it follows a hand-pick.
    const opening = fieldText(wrapper);

    await wrapper.find('[data-test="window-pick"]').trigger("click");
    await flushPromises();

    expect(fieldText(wrapper)).not.toBe(opening);
    expect(await save(wrapper)).toMatchObject({ start_at: PICKED.from, end_at: PICKED.to });
  });

  /// A preset is the answer almost every time, and it must land on the TEAM's
  /// day. Flooring the instant to a multiple of a day is midnight UTC, so an
  /// IST team's "tomorrow" began at half past five in the morning.
  it("anchors a quick range to the team's day, not UTC's", async () => {
    const wrapper = renderCover({ timezone: IST });
    await wrapper.find('[data-test="oncall-cover-preset-tomorrow"]').trigger("click");

    const saved = await save(wrapper);
    expect(toZonedInputValue(saved!.start_at, IST)).toMatch(/T00:00$/);
    expect(toZonedInputValue(saved!.end_at, IST)).toMatch(/T00:00$/);
  });

  it('starts "tonight" at the team\'s evening', async () => {
    const wrapper = renderCover({ timezone: IST });
    await wrapper.find('[data-test="oncall-cover-preset-tonight"]').trigger("click");

    const saved = await save(wrapper);
    expect(toZonedInputValue(saved!.start_at, IST)).toMatch(/T18:00$/);
    expect(toZonedInputValue(saved!.end_at, IST)).toMatch(/T06:00$/);
  });

  /// The picker is re-read whenever the value changes from outside it, so a
  /// preset written without the type was re-read as a relative period and
  /// resolved against `now` — putting the past half hour back over the range
  /// the reader had just chosen.
  it("writes a quick range the picker cannot re-resolve", async () => {
    const wrapper = renderCover();
    await wrapper.find('[data-test="oncall-cover-preset-tonight"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test-field="window"]').attributes("data-test-type")).toBe(
      "absolute",
    );
  });

  /// Reopening on a different gap must not inherit the last one's window or
  /// its complaints.
  it("puts a space between the summary's two sentences", async () => {
    const wrapper = renderCover({ gap: GAP, teamName: "Platform" });
    await flushPromises();
    expect(wrapper.find('[data-test="oncall-cover-summary"]').element.textContent).toMatch(
      /\.\s+After that the normal rota continues\.$/,
    );
  });

  describe("whose shift it is", () => {
    const ROTATIONS = [
      { id: "rot_p", name: "Primary", shift_rules: [] },
      { id: "rot_s", name: "Secondary", shift_rules: [] },
    ];
    const POSITIONS = [
      { rotation_id: "rot_p", rotation_name: "Primary", rule: "Base", user_email: "ana@o2.ai" },
      { rotation_id: "rot_s", rotation_name: "Secondary", rule: "Base", user_email: "bo@o2.ai" },
    ];
    const holderLine = (wrapper: ReturnType<typeof renderCover>) =>
      wrapper.find('[data-test="oncall-cover-holder"]');

    it("names the clicked shift's person and sends them as covering_for", async () => {
      const wrapper = renderCover({
        gap: GAP,
        rotations: ROTATIONS,
        positions: POSITIONS,
        defaultRotation: "rot_s",
        currentHolder: "raj@o2.ai",
        defaultUser: "ana@o2.ai",
      });
      await flushPromises();
      expect(holderLine(wrapper).text()).toBe("On call: raj@o2.ai");

      const saved = (await save(wrapper)) as Record<string, unknown>;
      expect(saved).toMatchObject({ rotation_id: "rot_s", covering_for: "raj@o2.ai" });
    });

    // U19: the summary names who covers whom, on which rotation, over which days.
    it("says who covers whom on which rotation, and that the rota then carries on", async () => {
      const wrapper = renderCover({
        gap: GAP,
        rotations: ROTATIONS,
        positions: POSITIONS,
        defaultRotation: "rot_s",
        currentHolder: "raj@o2.ai",
        defaultUser: "ana@o2.ai",
      });
      await flushPromises();
      const words = (text: string) => text.replace(/\s+/g, " ");
      expect(words(wrapper.find('[data-test="oncall-cover-summary"]').text())).toBe(
        words(
          `ana@o2.ai covers raj@o2.ai on Secondary, ${formatDayRange(GAP.from, GAP.to, "UTC")}. After that the normal rota continues.`,
        ),
      );
    });

    it("names the picked rotation's holder now, without claiming whose hours they are", async () => {
      const wrapper = renderCover({
        gap: GAP,
        rotations: ROTATIONS,
        positions: POSITIONS,
        defaultRotation: "rot_s",
      });
      await flushPromises();
      expect(holderLine(wrapper).text()).toBe("On call: bo@o2.ai");
      expect(((await save(wrapper)) as Record<string, unknown>).covering_for).toBeUndefined();
    });

    it("sends no covering_for when the holder covers their own shift", async () => {
      const wrapper = renderCover({ gap: GAP, currentHolder: "ana@o2.ai" });
      await flushPromises();
      expect(((await save(wrapper)) as Record<string, unknown>).covering_for).toBeUndefined();
    });

    describe("following the picked window", () => {
      const run = (user_email: string | null, from: number, to: number) => ({
        rotation_id: "rot_s",
        from,
        to,
        user_email,
      });
      const calls: Array<[string, number, number]> = [];
      /// The clicked shift is raj's; the hand-picked hour is bo's.
      const resolveRuns = async (rotationId: string, from: number, to: number) => {
        calls.push([rotationId, from, to]);
        if (to === PICKED.to) return [run("bo@o2.ai", from - MICROS_PER_HOUR, to)];
        return [run("raj@o2.ai", from, to)];
      };
      const open = (props: Record<string, unknown> = {}) =>
        renderCover({
          gap: GAP,
          rotations: ROTATIONS,
          positions: POSITIONS,
          defaultRotation: "rot_s",
          currentHolder: "raj@o2.ai",
          resolveRuns,
          ...props,
        });

      it("names and relieves whoever holds the window after it changes", async () => {
        calls.length = 0;
        const wrapper = open();
        await flushPromises();
        expect(holderLine(wrapper).text()).toBe("On call: raj@o2.ai");

        await wrapper.find('[data-test="window-pick"]').trigger("click");
        await flushPromises();
        expect(holderLine(wrapper).text()).toBe("On call: bo@o2.ai");
        expect(calls.at(-1)).toEqual(["rot_s", PICKED.from, PICKED.to]);
        expect(await save(wrapper)).toMatchObject({ covering_for: "bo@o2.ai" });
      });

      it("names every holder of a window several share, and relieves nobody", async () => {
        const split = async (_rotation: string, from: number, to: number) => [
          run("raj@o2.ai", from, from + MICROS_PER_HOUR),
          run("bo@o2.ai", from + MICROS_PER_HOUR, to),
        ];
        const wrapper = open({ resolveRuns: split });
        await flushPromises();
        expect(holderLine(wrapper).text()).toBe("On call: raj@o2.ai, bo@o2.ai");
        expect(((await save(wrapper)) as Record<string, unknown>).covering_for).toBeUndefined();
      });

      it("relieves nobody when part of the window has no holder", async () => {
        const holed = async (_rotation: string, from: number, to: number) => [
          run("raj@o2.ai", from, from + MICROS_PER_HOUR),
          run(null, from + MICROS_PER_HOUR, to),
        ];
        const wrapper = open({ resolveRuns: holed });
        await flushPromises();
        expect(holderLine(wrapper).text()).toBe("On call: raj@o2.ai");
        expect(((await save(wrapper)) as Record<string, unknown>).covering_for).toBeUndefined();
      });
    });

    it("shows no holder line when nobody is known to be on call", async () => {
      const wrapper = renderCover({ gap: GAP });
      await flushPromises();
      expect(holderLine(wrapper).exists()).toBe(false);
    });
  });

  it("re-seeds from the gap it was reopened on", async () => {
    const wrapper = renderCover({ gap: GAP });
    expect(await save(wrapper)).toMatchObject({ start_at: GAP.from });

    const next = { from: FROM + MICROS_PER_WEEK, to: FROM + MICROS_PER_WEEK + MICROS_PER_DAY };
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true, gap: next });
    await flushPromises();

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    const second = wrapper.emitted("save")?.[1]?.[0] as { start_at: number };
    expect(second.start_at).toBe(next.from);
  });
});
