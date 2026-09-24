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

import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { TranslateFn } from "@/types/i18n";
import { buildPasswordRequirements, DEFAULT_COMPLEXITY } from "@/utils/passwordComplexity";

import PasswordRequirementList from "./PasswordRequirementList.vue";

// Echoes the key so assertions read against stable ids rather than English copy.
const t = ((key: string) => key) as unknown as TranslateFn;

// Four rows: min length, uppercase, lowercase, digit.
const requirements = buildPasswordRequirements(
  { ...DEFAULT_COMPLEXITY, require_uppercase: true, require_lowercase: true, require_digit: true },
  t,
);

const mountList = (props: { password?: string; showStrength?: boolean }) =>
  mount(PasswordRequirementList, { props: { requirements, ...props } });

describe("PasswordRequirementList", () => {
  it("renders the strength meter as progress over the policy's own requirements", () => {
    const wrapper = mountList({ password: "ab", showStrength: true });

    const bar = wrapper.findComponent(OProgressBar);
    expect(bar.exists()).toBe(true);
    expect(bar.attributes("data-test")).toBe("password-requirements-strength");
    // One of four rows is met: only lowercase.
    expect(bar.props("value")).toBeCloseTo(1 / 4);
    expect(bar.props("variant")).toBe("default");
    expect(bar.props("size")).toBe("xs");
  });

  it("turns the meter green only once every requirement is met", () => {
    const wrapper = mountList({ password: "Abcdefg1", showStrength: true });

    expect(wrapper.findComponent(OProgressBar).props("value")).toBe(1);
    expect(wrapper.findComponent(OProgressBar).props("variant")).toBe("success");
  });

  it("shows no meter unless asked for", () => {
    const wrapper = mountList({ password: "Abcdefg1" });

    expect(wrapper.findComponent(OProgressBar).exists()).toBe(false);
    expect(wrapper.find('[data-test="password-requirements-strength"]').exists()).toBe(false);
  });
});
