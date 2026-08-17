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

import OnCallL0Editor from "@/components/oncall/OnCallL0Editor.vue";
import i18n from "@/locales";
import type { L0Policy } from "@/ts/interfaces/oncall";
import store from "@/test/unit/helpers/store";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OSelect: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    template: `<select :value="modelValue" />`,
  },
  OInput: {
    name: "OInput",
    props: ["modelValue", "error", "errorMessage"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  OSwitch: {
    name: "OSwitch",
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    template: `<button :aria-checked="!!modelValue" @click="$emit('update:modelValue', !modelValue)" />`,
  },
};

function l0(over: Partial<L0Policy> = {}): L0Policy {
  return {
    mode: { P1: "parallel", P2: "gate", P3: "gate", P4: "only" },
    triage_budget_seconds: 90,
    allow_promotion: true,
    max_promotion_steps: 2,
    allow_downgrade: true,
    allow_suppress: false,
    ...over,
  };
}

function render(value: L0Policy | null = l0()) {
  return mount(OnCallL0Editor, {
    props: { l0: value },
    global: { plugins: [i18n, store], stubs },
  });
}

type Wrapper = ReturnType<typeof render>;

const lastL0 = (w: Wrapper) => {
  const events = w.emitted("update:l0");
  return events?.[events.length - 1]?.[0] as L0Policy | undefined;
};
const lastValid = (w: Wrapper) => {
  const events = w.emitted("update:valid");
  return events?.[events.length - 1]?.[0] as boolean | undefined;
};

describe("OnCallL0Editor", () => {
  /// P1 and P4 are invariants of the engine, not settings — the server 400s
  /// any other value. Rendering them as controls would offer a choice the
  /// product does not have.
  it("renders P1 and P4/P5 as facts, with controls only for P2 and P3", () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-l0-mode-p2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-l0-mode-p3"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-l0-mode-p1"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-l0-mode-p4"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-l0-p1"]').text()).toContain("Pages now");
    expect(wrapper.find('[data-test="oncall-l0-p4"]').text()).toContain("nobody is paged");
  });

  it("emits the whole block when a mode changes, P1/P4 untouched", async () => {
    const wrapper = render();
    await wrapper
      .findComponent('[data-test="oncall-l0-mode-p2"]')
      .vm.$emit("update:modelValue", "parallel");
    const emitted = lastL0(wrapper);
    expect(emitted?.mode).toEqual({ P1: "parallel", P2: "parallel", P3: "gate", P4: "only" });
  });

  /// The server REFUSES an out-of-range budget rather than clamping — an
  /// operator who typed 900 has a belief about how long their page is held.
  /// The editor mirrors that: no clamping, an error, and a false validity
  /// signal the parent uses to block Save.
  it("flags a budget outside 30-600 instead of clamping it", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-l0-budget"]').setValue("900");
    expect(lastValid(wrapper)).toBe(false);
    expect(lastL0(wrapper)?.triage_budget_seconds).toBe(900);
    expect(
      wrapper.findComponent('[data-test="oncall-l0-budget"]').props("error"),
    ).toBe(true);

    await wrapper.find('[data-test="oncall-l0-budget"]').setValue("120");
    expect(lastValid(wrapper)).toBe(true);
  });

  it("hides the promotion bound when promotion is off", async () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="oncall-l0-max-steps"]').exists()).toBe(true);
    await wrapper.find('[data-test="oncall-l0-allow-promotion"]').trigger("click");
    expect(wrapper.find('[data-test="oncall-l0-max-steps"]').exists()).toBe(false);
    expect(lastL0(wrapper)?.allow_promotion).toBe(false);
  });

  /// A policy that predates L0 carries no block; the draft starts from the
  /// engine's own defaults so a save configures what auto-creation would have.
  it("seeds from the engine defaults when the stored policy has no block", () => {
    const wrapper = render(null);
    expect(wrapper.findComponent('[data-test="oncall-l0-budget"]').props("modelValue")).toBe(
      "90",
    );
    expect(
      wrapper.findComponent('[data-test="oncall-l0-mode-p2"]').props("modelValue"),
    ).toBe("gate");
  });
});
