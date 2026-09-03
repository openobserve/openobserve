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
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import type { InheritedUnionRow } from "./resolved";
import SyntheticsInheritedVariables from "./SyntheticsInheritedVariables.vue";

const OBadgeStub = {
  props: ["variant", "size"],
  template: '<span v-bind="$attrs"><slot /></span>',
};
const OIconStub = { props: ["name", "size"], template: '<i v-bind="$attrs" :data-icon="name" />' };
const OTooltipStub = {
  props: ["content", "side"],
  template:
    '<span :data-tip="content"><slot /><span v-if="$slots.content" class="tip-slot"><slot name="content" /></span></span>',
};
const OSelectStub = {
  props: ["modelValue", "options"],
  emits: ["update:modelValue"],
  template: `<select v-bind="$attrs" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>`,
};

function row(over: Partial<InheritedUnionRow> = {}): InheritedUnionRow {
  return {
    name: "BASE_URL",
    envs: ["staging"],
    global: false,
    secret: false,
    overridden: false,
    hints: [{ source: "staging", example: "", has_value: true }],
    ...over,
  };
}

function mountInherited(props: Record<string, unknown>) {
  return mount(SyntheticsInheritedVariables, {
    props: { rows: [], ...props },
    global: {
      plugins: [i18n],
      stubs: {
        OBadge: OBadgeStub,
        OIcon: OIconStub,
        OSelect: OSelectStub,
        OTooltip: OTooltipStub,
      },
    },
  }) as VueWrapper;
}

const rowSel = '[data-test="synthetics-inherited-variable"]';

describe("SyntheticsInheritedVariables", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders one row per distinct name with the rail's scope icons", () => {
    wrapper = mountInherited({
      rows: [
        row({ name: "ORG", envs: [], global: true }),
        row({ name: "BASE_URL", envs: ["staging", "qa"] }),
      ],
    });
    const icons = wrapper.findAll('[data-test="synthetics-inherited-scope-icon"]');
    expect(icons.map((i) => i.attributes("data-icon"))).toEqual(["public", "layers"]);
    expect(icons.map((i) => i.attributes("aria-label"))).toEqual(["Global", "staging, qa"]);
  });

  it("strikes a shadowed name, with the relation on its accessible name", () => {
    wrapper = mountInherited({ rows: [row({ name: "USER", overridden: true })] });
    const struck = wrapper.find("span.line-through");
    // The tooltip stub inlines its content into the span's text.
    expect(struck.text().startsWith("USER")).toBe(true);
    expect(struck.attributes("aria-label")).toBe("Overridden by local variable");
  });

  it("puts per-source value hints on the name's hover", () => {
    wrapper = mountInherited({
      rows: [
        row({
          name: "BASE_URL",
          envs: ["staging", "qa"],
          hints: [
            { source: "staging", example: "stage.shop.com", has_value: true },
            { source: "qa", example: "", has_value: false },
          ],
        }),
      ],
    });
    expect(wrapper.find(`${rowSel} .tip-slot`).text()).toBe(
      "BASE_URL — staging: stage.shop.com · qa: Not set",
    );
  });

  it("leads a shadowed name's tooltip with the overridden line, in warning colour", () => {
    wrapper = mountInherited({
      rows: [
        row({
          name: "USER",
          overridden: true,
          hints: [{ source: "staging", example: "u@stage", has_value: true }],
        }),
      ],
    });
    const tip = wrapper.find(`${rowSel} .tip-slot`);
    expect(tip.text().indexOf("Overridden by local variable")).toBe(0);
    expect(tip.text()).toContain("USER — staging: u@stage");
    expect(tip.find("div").classes()).toContain("text-warning");
  });

  it("masks a secret's hints and marks the row with the lock", () => {
    wrapper = mountInherited({
      rows: [
        row({
          name: "API_KEY",
          secret: true,
          hints: [{ source: "staging", example: "sk-****", has_value: true }],
        }),
      ],
    });
    expect(wrapper.find('[data-test="synthetics-inherited-secret-lock"]').exists()).toBe(true);
    expect(wrapper.find(`${rowSel} .tip-slot`).text()).toBe("API_KEY — staging: ••••••");
  });

  it("names the environments a variable is missing from, on the triangle's label", () => {
    wrapper = mountInherited({
      rows: [row({ name: "API_KEY" })],
      gaps: new Map([["API_KEY", ["qa", "dev"]]]),
    });
    expect(
      wrapper.find('[data-test="synthetics-inherited-gap-badge"]').attributes("aria-label"),
    ).toBe("Not in qa, dev");
  });

  it("shows no gap badge for a fully covered variable", () => {
    wrapper = mountInherited({ rows: [row({ name: "ORG", envs: [], global: true })] });
    expect(wrapper.find('[data-test="synthetics-inherited-gap-badge"]').exists()).toBe(false);
  });

  it("filters by source, with an explicit empty state per environment", async () => {
    wrapper = mountInherited({
      environments: ["staging", "qa"],
      rows: [
        row({ name: "ONLY_STAGING", envs: ["staging"] }),
        row({ name: "ORG", envs: [], global: true }),
      ],
    });
    const filter = wrapper.find('[data-test="synthetics-inherited-filter"]');
    expect(filter.findAll("option").map((o) => o.text())).toEqual([
      "All",
      "Global",
      "staging",
      "qa",
    ]);

    expect(wrapper.findAll(rowSel)).toHaveLength(2);
    await filter.setValue("__global__");
    const globalRows = wrapper.findAll(rowSel);
    expect(globalRows).toHaveLength(1);
    expect(globalRows[0].text().startsWith("ORG")).toBe(true);
    await filter.setValue("qa");
    expect(wrapper.find('[data-test="synthetics-inherited-empty"]').text()).toBe(
      "No inherited variables in qa.",
    );
  });
});
