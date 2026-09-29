// @vitest-environment jsdom
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
import type { SyntheticsEnvironment } from "@/types/synthetics";
import SyntheticsScopeRail from "./SyntheticsScopeRail.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const stubs = {
  OTabs: { template: "<div><slot /></div>" },
  OTab: { props: ["name"], template: '<div v-bind="$attrs" :data-tab="name"><slot /></div>' },
  OIcon: { props: ["name"], template: '<i :data-icon="name" />' },
  OButton: { template: '<button v-bind="$attrs"><slot /></button>' },
  OSearchInput: true,
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: { template: '<button v-bind="$attrs"><slot /></button>' },
  ODropdownSeparator: true,
};

function env(name: string, over: Partial<SyntheticsEnvironment> = {}): SyntheticsEnvironment {
  return {
    id: `id-${name}`,
    name,
    description: "",
    is_global: false,
    created_at: 0,
    updated_at: 0,
    checks_count: 0,
    variables: [],
    ...over,
  };
}

function mountRail(environments: SyntheticsEnvironment[]) {
  return mount(SyntheticsScopeRail, {
    props: { modelValue: "global", environments, globalCount: 3 },
    global: { stubs },
  });
}

describe("SyntheticsScopeRail", () => {
  const environments = [
    env("staging"),
    env("global", { id: "global_acme", is_global: true }),
    env("prod"),
  ];

  it("shows exactly one Global entry, pinned first, from the global environment", () => {
    const wrapper = mountRail(environments);
    const rows = wrapper.findAll("[data-tab]");

    expect(wrapper.findAll('[data-test="synthetics-scope-global"]')).toHaveLength(1);
    expect(rows[0].attributes("data-test")).toBe("synthetics-scope-global");
    expect(rows[0].text()).toContain("synthetics.variables.global");
    // Its count comes from /variables, not the inline list.
    expect(rows[0].text()).toContain("3");
  });

  it("offers no delete on Global and keeps it on other environments", () => {
    const wrapper = mountRail(environments);

    expect(wrapper.find('[data-test="synthetics-scope-delete-global"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="synthetics-scope-delete-staging"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="synthetics-scope-delete-prod"]').exists()).toBe(true);
  });
});
