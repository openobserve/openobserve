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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import HomeNoDataState from "./HomeNoDataState.vue";

const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const awsConfig = vi.hoisted(() => ({ isEnterprise: "false", isCloud: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));
const orgData = vi.hoisted(() => ({ has: false as boolean | undefined }));
vi.mock("@/composables/useOrgHasUserData", async () => {
  const { ref } = await import("vue");
  return {
    useOrgHasUserData: () => ({ hasUserData: ref(orgData.has), isFetching: ref(false) }),
  };
});

describe("HomeNoDataState", () => {
  afterEach(() => {
    awsConfig.isCloud = "false";
    orgData.has = false;
    push.mockReset();
  });

  const clickCard = async (card: string) => {
    const wrapper = mount(HomeNoDataState, {
      props: { tab: "overview" },
      global: { plugins: [i18n, store] },
    });
    await wrapper.find(`[data-test="home-no-data-${card}-card"]`).trigger("click");
    wrapper.unmount();
    return push.mock.calls.at(-1)?.[0];
  };
  const org = { org_identifier: store.state.selectedOrganization.identifier };

  it.each([
    ["logs", "logs"],
    ["traces", "backend"],
    ["metrics", "infrastructure"],
  ])(
    "on cloud, starts onboarding from the %s card for an org with no data",
    async (card, choice) => {
      awsConfig.isCloud = "true";

      expect(await clickCard(card)).toEqual({
        name: "onboarding",
        params: { path: [choice] },
        query: org,
      });
    },
  );

  it.each([
    ["logs", "curl"],
    ["traces", "tracesOTLP"],
    ["metrics", "prometheus"],
  ])("off cloud, keeps the %s card's setup page", async (card, route) => {
    expect(await clickCard(card)).toEqual({ name: route, query: org });
  });

  it("on cloud, keeps the setup page once the org has data", async () => {
    awsConfig.isCloud = "true";
    orgData.has = true;

    expect(await clickCard("logs")).toEqual({ name: "curl", query: org });
  });

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
});
