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
import type { ResolvedVariable } from "./resolved";
import SyntheticsInheritedVariables from "./SyntheticsInheritedVariables.vue";

const OBadgeStub = {
  props: ["variant", "size"],
  template: '<span v-bind="$attrs"><slot /></span>',
};
const OButtonStub = {
  props: ["variant", "size"],
  emits: ["click"],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};
const OIconStub = { props: ["name", "size"], template: '<i v-bind="$attrs" :data-icon="name" />' };
const OTooltipStub = { props: ["content", "side"], template: "<span><slot /></span>" };

function v(over: Partial<ResolvedVariable> = {}): ResolvedVariable {
  return {
    name: "BASE_URL",
    kind: "plain",
    scope: "staging",
    overridden: false,
    example: "",
    description: "",
    has_value: true,
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
        OButton: OButtonStub,
        OIcon: OIconStub,
        OTooltip: OTooltipStub,
      },
    },
  }) as VueWrapper;
}

describe("SyntheticsInheritedVariables", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders one row per inherited variable, never the check's own", () => {
    wrapper = mountInherited({
      rows: [v({ name: "A" }), v({ name: "B", scope: "check" }), v({ name: "C", scope: "" })],
    });
    const rows = wrapper.findAll('[data-test="synthetics-inherited-variable"]');
    expect(rows.map((r) => r.text())).toEqual(
      expect.arrayContaining([expect.stringContaining("A")]),
    );
    expect(rows).toHaveLength(2);
  });

  it("strikes an overridden row, with the relation on its accessible name only", () => {
    wrapper = mountInherited({ rows: [v({ name: "USER", overridden: true })] });
    const struck = wrapper.find("span.line-through");
    expect(struck.text()).toBe("USER");
    expect(struck.attributes("aria-label")).toBe("Overridden by local variable");
  });

  it("names the environments a variable is missing from, on the triangle's label", () => {
    wrapper = mountInherited({
      rows: [v({ name: "API_KEY" })],
      gaps: new Map([["API_KEY", ["qa", "dev"]]]),
    });
    expect(
      wrapper.find('[data-test="synthetics-inherited-gap-badge"]').attributes("aria-label"),
    ).toBe("Not in qa, dev");
  });

  it("collapses more than two missing environments into a count", () => {
    wrapper = mountInherited({
      rows: [v({ name: "API_KEY" })],
      gaps: new Map([["API_KEY", ["qa", "dev", "prod"]]]),
    });
    expect(
      wrapper.find('[data-test="synthetics-inherited-gap-badge"]').attributes("aria-label"),
    ).toBe("Not in 3 environments");
  });

  it("shows no gap badge for a fully covered variable", () => {
    wrapper = mountInherited({ rows: [v({ name: "ORG", scope: "global" })], gaps: new Map() });
    expect(wrapper.find('[data-test="synthetics-inherited-gap-badge"]').exists()).toBe(false);
  });

  it("shows the rail's scope icons — public for Global, layers for an environment", () => {
    wrapper = mountInherited({
      rows: [v({ name: "ORG", scope: "global" }), v({ name: "BASE_URL", scope: "staging" })],
    });
    const icons = wrapper.findAll('[data-test="synthetics-inherited-scope-icon"]');
    expect(icons.map((i) => i.attributes("data-icon"))).toEqual(["public", "layers"]);
    expect(icons.map((i) => i.attributes("aria-label"))).toEqual(["Global", "staging"]);
  });

  it("marks a secret with the lock and shows no value-like content", () => {
    wrapper = mountInherited({ rows: [v({ name: "TOKEN", kind: "secret", example: "sk-****" })] });
    expect(wrapper.find('[data-test="synthetics-inherited-secret-lock"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("••••••");
    expect(wrapper.text()).not.toContain("sk-****");
  });
});
