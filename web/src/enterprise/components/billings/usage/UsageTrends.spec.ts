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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";

const post = vi.fn();
vi.mock("@/services/organizations", () => ({
  default: { post_organization_settings: (...args: unknown[]) => post(...args) },
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("./useUsageSearch", () => ({
  useUsageSearch: () => ({ search: vi.fn().mockResolvedValue([]) }),
}));

const { default: UsageTrends } = await import("./UsageTrends.vue");

enableAutoUnmount(afterEach);

describe("UsageTrends usage reporting", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: {} });
    // The page's copy of the settings, loaded earlier; another admin may have changed them since.
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: false,
      scrape_interval: 15,
      budget_config: [{ org_id: "o", total_budget_amount: 100 }],
    };
  });

  it("turns reporting on without writing back the page's older copy of the other settings", async () => {
    const upcoming = mockMeteringResponse().upcoming!;
    const wrapper = mount(UsageTrends, {
      props: { details: upcoming, cycles: [upcoming], billingOrgs: [] },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();

    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toEqual({ usage_stream_enabled: true });
    // The page still learns the new value straight away.
    expect(store.state.organizationData.organizationSettings.usage_stream_enabled).toBe(true);
    expect(store.state.organizationData.organizationSettings.scrape_interval).toBe(15);
  });
});
