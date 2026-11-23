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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import OrganizationSelector from "@/components/OrganizationSelector.vue";

const mountSelector = (current: { label: string; identifier: string } | null) =>
  mount(OrganizationSelector, {
    props: { organizations: current ? [current] : [], current },
    global: { plugins: [i18n] },
  });

describe("OrganizationSelector trigger", () => {
  it("shows a placeholder in place of the name until the organization is known", () => {
    const wrapper = mountSelector(null);
    expect(wrapper.find('[data-test="navbar-organizations-select-placeholder"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("shows the organization name once it is known", () => {
    const wrapper = mountSelector({ label: "default", identifier: "default" });
    expect(wrapper.find('[data-test="navbar-organizations-select-placeholder"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="navbar-organizations-select-trigger"]').text()).toContain(
      "default",
    );
    wrapper.unmount();
  });
});
