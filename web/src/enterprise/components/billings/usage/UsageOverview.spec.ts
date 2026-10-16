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
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { mockMeteringResponse } from "./meteringMock";

const route = reactive<{ query: Record<string, string | undefined> }>({ query: {} });
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    replace: ({ query }: { query: Record<string, string | undefined> }) => {
      route.query = query;
    },
  }),
}));

const search = vi.fn();
const cancel = vi.fn();
vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search, cancel }) }));

vi.mock("./useOrgCosts", async () => {
  const { ref: vueRef } = await import("vue");
  return {
    useOrgCosts: () => ({
      costs: vueRef({}),
      loading: vueRef(false),
      failed: vueRef(false),
      window: vueRef({ start: 1, end: 2 }),
    }),
  };
});

const { default: UsageOverview } = await import("./UsageOverview.vue");

const billingOrgs = [
  { id: "payer", name: "Payer", isSelf: true },
  { id: "child", name: "Child", isSelf: false },
];

enableAutoUnmount(afterEach);

describe("UsageOverview org drilldown", () => {
  beforeEach(() => {
    route.query = {};
    search.mockReset().mockResolvedValue([{ name: "Ingestion", volume: 10 }]);
    cancel.mockReset();
  });

  const mountAt = (org: string) => {
    route.query = { org };
    return mount(UsageOverview, {
      props: {
        details: mockMeteringResponse().upcoming,
        billingOrgs,
        lastLoadedAt: 1,
        refreshing: false,
      },
      global: {
        plugins: [i18n, store],
        stubs: { UsageCachedChart: true, UsageMeterBreakdown: true, UsageBillStrip: true },
      },
    });
  };

  it("queries an org once and serves it from memory when the user comes back to it", async () => {
    mountAt("child");
    await flushPromises();
    expect(search).toHaveBeenCalledTimes(1);

    route.query = {};
    await flushPromises();
    route.query = { org: "child" };
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(1);
    // A cache hit stops any other org's stream, so its rows cannot land on this table.
    expect(cancel).toHaveBeenCalledWith("orgVolumes");
  });

  it("queries the org again once a new bill arrives", async () => {
    const wrapper = mountAt("child");
    await flushPromises();

    await wrapper.setProps({ details: { ...mockMeteringResponse().upcoming } });
    await flushPromises();
    route.query = {};
    await flushPromises();
    route.query = { org: "child" };
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(2);
  });
});
