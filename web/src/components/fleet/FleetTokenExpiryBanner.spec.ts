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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetTokenExpiryBanner from "./FleetTokenExpiryBanner.vue";
import { apiCollector } from "./fleet.fixtures";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listCollectors: vi.fn(), listTokens: vi.fn() },
}));

const DAY = 86_400_000;
const token = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "k8s-helm",
  prefix: "o2ft_Qm7x",
  created_at: Date.now() - DAY,
  expires_at: Date.now() + 3 * DAY,
  uses: 2,
  max_uses: null,
  fleet: { id: "f1", name: "edge" },
  revoked: false,
  ...over,
});

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 50));
  await flushPromises();
};

async function mountBanner(tokens: unknown[], collectors: unknown[]) {
  vi.mocked(fleet.listTokens).mockResolvedValue({ data: { items: tokens } } as any);
  vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { items: collectors } } as any);
  const wrapper = mount(FleetTokenExpiryBanner, { global: { plugins: [i18n, store] } });
  await settle();
  return wrapper;
}

describe("FleetTokenExpiryBanner", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    queryClient.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("names the token, its days left and each collector still on it, soonest first", async () => {
    wrapper = await mountBanner(
      [
        token(),
        token({
          id: "t2",
          name: "legacy",
          expires_at: Date.now() - DAY,
          fleet: { id: "f2", name: "lab" },
        }),
      ],
      [
        apiCollector({ id: "c1", name: "web-01", token_id: "t1" }),
        apiCollector({ id: "c2", name: "web-02", token_id: "t1" }),
        apiCollector({ id: "c3", name: "old-01", token_id: "t2" }),
      ],
    );
    const banner = wrapper.find('[data-test="fleet-token-expiry-banner"]');
    expect(banner.text()).toContain("2 enrollment tokens expire within 7 days");
    const rows = wrapper.findAll("li").map((li) => li.text());
    expect(rows[0]).toContain("legacy");
    expect(rows[0]).toContain("expired");
    expect(rows[1]).toContain("k8s-helm");
    expect(rows[1]).toContain("edge");
    expect(rows[1]).toContain("expires in 3 days");
    expect(rows[1]).toContain("still used by 2 collectors");
    expect(rows[1]).toContain("web-01");
    expect(rows[1]).toContain("web-02");
  });

  it("stays hidden for a token nobody uses, one far from expiry, or one already revoked", async () => {
    wrapper = await mountBanner(
      [
        token({ id: "unused" }),
        token({ id: "far", expires_at: Date.now() + 30 * DAY }),
        token({ id: "gone", revoked: true }),
        token({ id: "forever", expires_at: null }),
      ],
      [
        apiCollector({ id: "c1", token_id: "far" }),
        apiCollector({ id: "c2", token_id: "gone" }),
        apiCollector({ id: "c3", token_id: "forever" }),
      ],
    );
    expect(wrapper.find('[data-test="fleet-token-expiry-banner"]').exists()).toBe(false);
  });

  it("opens a collector or the fleet's tokens from the banner", async () => {
    wrapper = await mountBanner(
      [token()],
      [apiCollector({ id: "c1", name: "web-01", token_id: "t1" })],
    );
    await wrapper.find('[data-test="fleet-token-expiry-collector-c1"]').trigger("click");
    await wrapper.find('[data-test="fleet-token-expiry-manage"]').trigger("click");
    expect(wrapper.emitted("open-collector")?.[0]?.[0]).toMatchObject({
      id: "c1",
      fleetId: "default",
    });
    expect(wrapper.emitted("open-tokens")).toEqual([["f1"]]);
  });
});
