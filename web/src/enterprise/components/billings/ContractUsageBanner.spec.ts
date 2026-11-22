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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import ContractUsageBanner from "./ContractUsageBanner.vue";

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push }),
}));

vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(() => "2026-11-02 00:00"),
}));

const mountWith = (zoConfig: Record<string, unknown>) =>
  mount(ContractUsageBanner, {
    global: {
      plugins: [
        i18n,
        createStore({
          state: { zoConfig, selectedOrganization: { identifier: "acme" } },
        }),
      ],
    },
  });

describe("ContractUsageBanner", () => {
  beforeEach(() => push.mockClear());

  it("shows nothing while the org has no usage block", () => {
    expect(mountWith({}).find('[data-test="contract-usage-banner"]').exists()).toBe(false);
    expect(
      mountWith({ contract_usage_block: null })
        .find('[data-test="contract-usage-banner"]')
        .exists(),
    ).toBe(false);
  });

  it("names the meters and the UTC end of the block", () => {
    const wrapper = mountWith({
      contract_usage_block: { meters: ["ingestion", "query"], until: 1793577600000000 },
    });
    expect(wrapper.find('[data-test="contract-usage-banner"]').text()).toContain(
      "over a usage limit on its contract (ingestion, query). Ingestion, search, pipelines, AI and synthetics are blocked until 2026-11-02 00:00 UTC.",
    );
  });

  it("opens billing for the current org", async () => {
    const wrapper = mountWith({ contract_usage_block: { meters: ["ingestion"], until: 1 } });
    await wrapper.find('[data-test="contract-usage-banner-billing"]').trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "billings", query: { org_identifier: "acme" } });
  });
});
