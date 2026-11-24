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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import { dropdownStubs } from "@/test/unit/helpers/dropdownStubs";

const awsConfig = vi.hoisted(() => ({ isCloud: "false" }) as Record<string, string>);

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: Object.assign(awsConfig, actual.default, { isCloud: "false" }) };
});

import SolutionSwitcher from "./SolutionSwitcher.vue";

const mountSwitcher = (mode: "observability" | "security") => {
  store.state.solutionMode = mode;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }],
  });
  return mount(SolutionSwitcher, {
    global: { plugins: [store, router], stubs: dropdownStubs },
  });
};

afterEach(() => {
  awsConfig.isCloud = "false";
  store.state.solutionMode = "observability";
});

describe("SolutionSwitcher alpha tag", () => {
  it("tags the Security option and the security trigger as alpha on Cloud", () => {
    awsConfig.isCloud = "true";
    const w = mountSwitcher("security");
    const option = w.get('[data-test="solution-security"]');
    expect(option.get('[data-test="alpha-badge"]').text()).toBe("Alpha");
    expect(
      w.get('[data-test="solution-observability"]').find('[data-test="alpha-badge"]').exists(),
    ).toBe(false);
    const trigger = w.get('[data-test="solution-switcher"]');
    expect(trigger.get('[data-test="alpha-badge"]').text()).toBe("Alpha");
    expect(trigger.text()).toContain("Security");
  });

  it("keeps the trigger untagged on Cloud while the mode is observability", () => {
    awsConfig.isCloud = "true";
    const w = mountSwitcher("observability");
    expect(
      w.get('[data-test="solution-switcher"]').find('[data-test="alpha-badge"]').exists(),
    ).toBe(false);
    expect(
      w.get('[data-test="solution-security"]').find('[data-test="alpha-badge"]').exists(),
    ).toBe(true);
  });

  it("shows no alpha tag anywhere off Cloud", () => {
    const w = mountSwitcher("security");
    expect(w.get('[data-test="solution-security"]').text()).toContain("Security");
    expect(w.findAll('[data-test="alpha-badge"]')).toHaveLength(0);
  });
});
