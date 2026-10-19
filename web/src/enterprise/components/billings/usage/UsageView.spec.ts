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
import { defineComponent, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mounts: Record<string, number> = {};
const stub = (name: string) =>
  defineComponent({
    name,
    props: ["details", "billingOrgs", "cycles"],
    setup: () => {
      mounts[name] = (mounts[name] ?? 0) + 1;
    },
    template: "<div />",
  });

vi.mock("./UsageOverview.vue", () => ({ default: stub("UsageOverview") }));
vi.mock("./UsageOverviewSkeleton.vue", () => ({ default: stub("UsageOverviewSkeleton") }));
vi.mock("./UsageTrends.vue", () => ({ default: stub("UsageTrends") }));
vi.mock("./UsageEstimator.vue", () => ({ default: stub("UsageEstimator") }));
vi.mock("./UsageBudget.vue", () => ({ default: stub("UsageBudget") }));
vi.mock("./UsageSuperBudget.vue", () => ({ default: stub("UsageSuperBudget") }));
const route = reactive<{ query: Record<string, string> }>({ query: {} });
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: vi.fn() }),
}));

const metering = vi.fn();
const members = vi.fn();
const aiUsage = vi.fn();
vi.mock("@/services/billings", () => ({
  default: {
    get_data_usage: (...args: unknown[]) => metering(...args),
    list_billing_group_members: (...args: unknown[]) => members(...args),
    get_ai_usage: (...args: unknown[]) => aiUsage(...args),
  },
}));
vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, isCloud: "true" } };
});

const { default: UsageView } = await import("./UsageView.vue");

const bill = {
  data: {
    price_details: {
      upcoming: { total_cost: 1, cycle_start: 1_700_000_000, cycle_end: 1_702_592_000 },
      past: [],
      oldest_ts: 1_700_000_000,
    },
  },
};

enableAutoUnmount(afterEach);

describe("UsageView", () => {
  it("publishes a super org's bill and org list together, so the meter view never flashes first", async () => {
    let releaseMembers!: (value: unknown) => void;
    metering.mockResolvedValue(bill);
    members.mockReturnValue(new Promise((resolve) => (releaseMembers = resolve)));

    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    // The bill is back but the org list is not: the page must still be loading.
    expect(wrapper.findComponent({ name: "UsageOverview" }).exists()).toBe(false);

    releaseMembers({
      data: [{ payer_org_name: "Payer", member_org_id: "child", member_org_name: "Child" }],
    });
    await flushPromises();

    const overview = wrapper.findComponent({ name: "UsageOverview" });
    expect(overview.props("details")).toMatchObject({ total_cost: 1 });
    expect(overview.props("billingOrgs").map((org: { id: string }) => org.id)).toHaveLength(2);
  });

  it("keeps a visited tab alive, so switching back does not rebuild it or rerun its queries", async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    const before = { ...mounts };

    for (const tab of ["trends", "overview", "trends", "overview"]) {
      route.query = { tab };
      await flushPromises();
    }

    expect(mounts.UsageOverview - before.UsageOverview).toBe(0);
    expect(mounts.UsageTrends - (before.UsageTrends ?? 0)).toBe(1);
    route.query = {};
  });

  it("still shows the bill when the org list fails, as a plain org", async () => {
    metering.mockResolvedValue(bill);
    members.mockRejectedValue(new Error("boom"));

    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    const overview = wrapper.findComponent({ name: "UsageOverview" });
    expect(overview.props("details")).toMatchObject({ total_cost: 1 });
    expect(overview.props("billingOrgs")).toEqual([]);
  });
});

describe("UsageView AI credits warning", () => {
  const usage = (extra: Record<string, unknown>) => ({
    data: { mode: "exhausted", requires_additional_credits: false, payer_org_id: null, ...extra },
  });

  const mountView = async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    return wrapper;
  };

  it("tells a contract org to contact sales once its credits run out", async () => {
    aiUsage.mockResolvedValue(usage({ requires_additional_credits: true }));
    const wrapper = await mountView();
    const banner = wrapper.find('[data-test="billings-usageview-ai-exhausted"]');
    expect(banner.text()).toContain("Contact your account manager");
    expect(wrapper.find('[data-test="billings-usageview-ai-exhausted-action"]').text()).toBe(
      "Contact Sales",
    );
  });

  it("names the paying org for a member, with nothing to click", async () => {
    aiUsage.mockResolvedValue(usage({ payer_org_id: "payer-org" }));
    const wrapper = await mountView();
    expect(wrapper.find('[data-test="billings-usageview-ai-exhausted"]').text()).toContain(
      "payer-org",
    );
    expect(wrapper.find('[data-test="billings-usageview-ai-exhausted-action"]').exists()).toBe(
      false,
    );
  });

  it("stays out of the way while credits remain or the read fails", async () => {
    aiUsage.mockResolvedValue({ data: { mode: "free", requires_additional_credits: false } });
    expect((await mountView()).find('[data-test="billings-usageview-ai-exhausted"]').exists()).toBe(
      false,
    );
    aiUsage.mockRejectedValue(new Error("boom"));
    expect((await mountView()).find('[data-test="billings-usageview-ai-exhausted"]').exists()).toBe(
      false,
    );
  });
});
