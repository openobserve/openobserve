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
import SectionHub from "./SectionHub.vue";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const openUpgradeDialog = vi.fn();
vi.mock("@/composables/useEnterpriseUpgradeDialog", () => ({
  useEnterpriseUpgradeDialog: () => ({ open: openUpgradeDialog }),
}));

describe("SectionHub", () => {
  it("draws the lock on a license-locked card and still opens its page", async () => {
    const wrapper = mount(SectionHub, {
      props: {
        groups: [
          {
            label: "Access",
            items: [
              { key: "roles", label: "Roles", to: { name: "roles" }, licenseLocked: true },
              { key: "users", label: "Users", to: { name: "users" } },
            ],
          },
        ] as any,
      },
      global: {
        stubs: {
          ConstrainedPage: { template: "<div><slot /></div>" },
          OIcon: { props: ["name"], template: "<i :data-icon='name' />" },
        },
      },
    });
    const card = wrapper.get('[data-test="section-hub-card-roles"]');
    expect(card.find('[data-icon="lock"]').exists()).toBe(true);
    expect(
      wrapper.get('[data-test="section-hub-card-users"]').find('[data-icon="lock"]').exists(),
    ).toBe(false);
    await card.trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "roles" });
    expect(openUpgradeDialog).not.toHaveBeenCalled();
  });
});
