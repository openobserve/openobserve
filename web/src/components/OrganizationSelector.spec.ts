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

import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { routeLocationKey } from "vue-router";
import i18n from "@/locales";
import OrganizationSelector from "@/components/OrganizationSelector.vue";

const mountSelector = (current: { label: string; identifier: string } | null, urlOrg?: string) =>
  mount(OrganizationSelector, {
    props: { organizations: current ? [current] : [], current },
    global: {
      plugins: [i18n],
      provide: {
        [routeLocationKey as symbol]: { query: urlOrg ? { org_identifier: urlOrg } : {} },
      },
    },
  });

describe("OrganizationSelector trigger", () => {
  beforeEach(() => window.localStorage.removeItem("o2.topBar"));

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

  it("is a compact ghost dropdown named for the organization, like every top bar control (R5)", () => {
    const wrapper = mountSelector({ label: "payments-prod", identifier: "payments" });
    const trigger = wrapper.find('[data-test="navbar-organizations-select-trigger"]');
    expect(trigger.attributes("data-o2-variant")).toBe("ghost");
    expect(trigger.attributes("data-o2-size")).toBe("md");
    expect(trigger.attributes("aria-label")).toBe("Organization: payments-prod");
    expect(trigger.classes()).toContain("max-w-56");
    wrapper.unmount();
  });

  it("shows the last name seen for the URL's organization while the list loads", () => {
    window.localStorage.setItem(
      "o2.topBar",
      JSON.stringify({ org: { identifier: "payments", label: "payments-prod" } }),
    );
    const wrapper = mountSelector(null, "payments");
    expect(wrapper.find('[data-test="navbar-organizations-select-placeholder"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('[data-test="navbar-organizations-select-trigger"]').text()).toContain(
      "payments-prod",
    );
    wrapper.unmount();
  });

  it("keeps the placeholder when the remembered name belongs to another organization", () => {
    window.localStorage.setItem(
      "o2.topBar",
      JSON.stringify({ org: { identifier: "payments", label: "payments-prod" } }),
    );
    const wrapper = mountSelector(null, "default");
    expect(wrapper.find('[data-test="navbar-organizations-select-placeholder"]').exists()).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("remembers the organization's name once it is known", () => {
    const wrapper = mountSelector({ label: "payments-prod", identifier: "payments" });
    expect(JSON.parse(window.localStorage.getItem("o2.topBar") ?? "{}").org).toEqual({
      identifier: "payments",
      label: "payments-prod",
    });
    wrapper.unmount();
  });
});
