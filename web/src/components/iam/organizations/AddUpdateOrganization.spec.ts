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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import AddUpdateOrganization from "./AddUpdateOrganization.vue";

// Default to cloud so the billing-group checkbox branch is reachable; the
// allow-list (canMakeBilledMember) is what we actually exercise here.
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "true",
    isEnterprise: "false",
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

installQuasar();

async function mountComponent(org = "default", allowedOrgs = "default") {
  store.state.selectedOrganization = {
    ...store.state.selectedOrganization,
    identifier: org,
    label: org,
    name: org,
  };
  store.state.zoConfig = {
    ...store.state.zoConfig,
    billing_group_allowed_orgs: allowedOrgs,
  };

  const wrapper = mount(AddUpdateOrganization, {
    global: {
      plugins: [store, i18n, router],
      stubs: { OButton: true },
    },
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("AddUpdateOrganization.vue – billing group gating", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("canMakeBilledMember is true when the org is in billing_group_allowed_orgs", async () => {
    wrapper = await mountComponent("default", "alpha,default,beta");
    expect(wrapper.vm.canMakeBilledMember).toBe(true);
  });

  it("trims whitespace around allow-list entries", async () => {
    wrapper = await mountComponent("default", " alpha , default ");
    expect(wrapper.vm.canMakeBilledMember).toBe(true);
  });

  it("canMakeBilledMember is false when the org is not in the list", async () => {
    wrapper = await mountComponent("default", "alpha,beta");
    expect(wrapper.vm.canMakeBilledMember).toBe(false);
  });

  it("canMakeBilledMember is false for an empty allow-list", async () => {
    wrapper = await mountComponent("default", "");
    expect(wrapper.vm.canMakeBilledMember).toBe(false);
  });

  it("renders the billed-member checkbox only when the org is allowed", async () => {
    wrapper = await mountComponent("default", "default");
    expect(
      wrapper.find('[data-test="org-make-billed-member"]').exists()
    ).toBe(true);
  });

  it("hides the billed-member checkbox when the org is not allowed", async () => {
    wrapper = await mountComponent("default", "other-org");
    expect(
      wrapper.find('[data-test="org-make-billed-member"]').exists()
    ).toBe(false);
  });
});
