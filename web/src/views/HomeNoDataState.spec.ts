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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import HomeNoDataState from "./HomeNoDataState.vue";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

describe("HomeNoDataState", () => {
  it("sends the Profiles chip to the profiles setup page, as every other chip goes to setup", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, profiling_enabled: true };
    const wrapper = mount(HomeNoDataState, {
      props: { tab: "overview" },
      global: { plugins: [i18n, store] },
    });

    await wrapper.find('[data-test="home-no-data-profiles-btn"]').trigger("click");

    expect(push).toHaveBeenCalledWith({
      name: "ingestProfiles",
      query: expect.objectContaining({
        org_identifier: store.state.selectedOrganization.identifier,
      }),
    });
  });

  it("disables the Profiles chip with a lock when continuous profiling is license-locked", async () => {
    push.mockClear();
    store.state.zoConfig = {
      ...store.state.zoConfig,
      profiling_enabled: true,
      features: { continuous_profiling: "locked" },
    };
    const wrapper = mount(HomeNoDataState, {
      props: { tab: "overview" },
      global: { plugins: [i18n, store] },
    });

    const chip = wrapper.find('[data-test="home-no-data-profiles-btn"]');
    expect(chip.attributes("disabled")).toBeDefined();
    const chipComponent = wrapper
      .findAllComponents({ name: "EmptyStateIngestionChip" })
      .find((c) => c.attributes("data-test") === "home-no-data-profiles-btn")!;
    expect(chipComponent.props("icon")).toBe("lock");
    await chip.trigger("click");
    expect(push).not.toHaveBeenCalled();
    store.state.zoConfig = { ...store.state.zoConfig, features: {} };
  });
});
