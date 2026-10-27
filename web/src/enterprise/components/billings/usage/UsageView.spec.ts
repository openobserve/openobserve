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
import { resetAssistantV2ForTests } from "@/composables/assistant/flags";
import assistantService, { parseAiUsage } from "@/services/assistant";
import { assistantKeys } from "@/services/assistant.querykeys";
import { queryClient } from "@/composables/query/queryClient";

const mounts: Record<string, number> = {};
const stub = (name: string) =>
  defineComponent({
    name,
    props: [
      "details",
      "billingOrgs",
      "cycles",
      "projected",
      "volumeOnly",
      "orgCosts",
      "refreshing",
    ],
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
const membership = vi.fn().mockResolvedValue({ data: { membership: null } });
const search = vi.fn().mockResolvedValue([]);
vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search }) }));
vi.mock("@/services/billings", () => ({
  default: {
    get_data_usage: (...args: unknown[]) => metering(...args),
    list_billing_group_members: (...args: unknown[]) => members(...args),
    get_ai_usage: (...args: unknown[]) => aiUsage(...args),
    get_billing_group_membership: (...args: unknown[]) => membership(...args),
  },
}));
vi.mock("@/services/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistant")>()),
  default: { usage: vi.fn() },
}));
vi.mock("@/services/paidOverage", () => ({
  default: { get: vi.fn(async () => Promise.reject(new Error("no overage"))) },
}));
vi.mock("@/composables/assistant", async (importOriginal) => {
  const { computed } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/assistant")>()),
    useAssistantCapability: () => computed(() => ({ isAdmin: true })),
  };
});
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

  it("gives every tab the same projected total, from the bill as it was loaded", async () => {
    // $1 by day 10 of a 30-day cycle projects to $3.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((1_700_000_000 + 10 * 86_400) * 1000);
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(wrapper.findComponent({ name: "UsageOverview" }).props("projected")).toBeCloseTo(3, 6);

    // Budget opened five days later still shows the loaded bill's figure, not a new one.
    vi.setSystemTime((1_700_000_000 + 15 * 86_400) * 1000);
    route.query = { tab: "budget" };
    await flushPromises();
    expect(wrapper.findComponent({ name: "UsageBudget" }).props("projected")).toBeCloseTo(3, 6);
    route.query = {};
    vi.useRealTimers();
  });

  it("keeps a super org's orgs when the org list fails on Refresh", async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({
      data: [{ payer_org_name: "Payer", member_org_id: "child", member_org_name: "Child" }],
    });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    members.mockRejectedValue(new Error("Network Error"));
    wrapper.findComponent({ name: "UsageOverview" }).vm.$emit("refresh");
    await flushPromises();

    const orgs = wrapper.findComponent({ name: "UsageOverview" }).props("billingOrgs");
    expect(orgs.map((org: { id: string }) => org.id)).toEqual([
      store.state.selectedOrganization.identifier,
      "child",
    ]);
  });

  it("keeps the newest bill when an older Refresh answers last", async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    // Two Refreshes overlap; the first one's answer arrives after the second's.
    const withCost = (total_cost: number) => ({
      data: {
        price_details: {
          ...bill.data.price_details,
          upcoming: { ...bill.data.price_details.upcoming, total_cost },
        },
      },
    });
    let releaseOld!: (value: unknown) => void;
    metering.mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)));
    metering.mockResolvedValueOnce(withCost(3));
    const overview = () => wrapper.findComponent({ name: "UsageOverview" });
    overview().vm.$emit("refresh");
    overview().vm.$emit("refresh");
    await flushPromises();
    expect(overview().props("details")).toMatchObject({ total_cost: 3 });

    releaseOld(withCost(2));
    await flushPromises();
    expect(overview().props("details")).toMatchObject({ total_cost: 3 });
  });

  it("does not raise a stale failure over a newer good bill, and stops loading only when the newest load ends", async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    let failOld!: (error: unknown) => void;
    let releaseNew!: (value: unknown) => void;
    metering.mockReturnValueOnce(new Promise((_, reject) => (failOld = reject)));
    metering.mockReturnValueOnce(new Promise((resolve) => (releaseNew = resolve)));
    const overview = () => wrapper.findComponent({ name: "UsageOverview" });
    overview().vm.$emit("refresh");
    overview().vm.$emit("refresh");
    await flushPromises();

    failOld(new Error("Network Error"));
    await flushPromises();
    // The newer load is still running: no banner, and the page still says it is loading.
    expect(wrapper.find('[data-test="billings-usageview-refresh-failed"]').exists()).toBe(false);
    expect(overview().props("refreshing")).toBe(true);

    releaseNew(bill);
    await flushPromises();
    expect(wrapper.find('[data-test="billings-usageview-refresh-failed"]').exists()).toBe(false);
    expect(overview().props("refreshing")).toBe(false);
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

describe("UsageView org costs", () => {
  it("reads them once for Overview and Budget, and past the cache after a Refresh", async () => {
    search.mockClear();
    // A fresh object per response, as a real reload brings.
    metering.mockReset().mockImplementation(async () => structuredClone(bill));
    members.mockResolvedValue({
      data: [{ payer_org_name: "Payer", member_org_id: "child", member_org_name: "Child" }],
    });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    const orgCostReads = () => search.mock.calls.filter((call) => call[1]?.key === "orgCosts");
    expect(orgCostReads()).toHaveLength(1);
    const shown = wrapper.findComponent({ name: "UsageOverview" }).props("orgCosts");

    // Budget judges spend on the same read, so opening it sends no second query.
    route.query = { tab: "budget" };
    await flushPromises();
    expect(orgCostReads()).toHaveLength(1);
    expect(wrapper.findComponent({ name: "UsageSuperBudget" }).props("orgCosts")).toEqual(shown);

    route.query = {};
    await flushPromises();
    wrapper.findComponent({ name: "UsageOverview" }).vm.$emit("refresh");
    await flushPromises();
    expect(orgCostReads()).toHaveLength(2);
  });
});

describe("UsageView for an org with no bill of its own", () => {
  const tabs = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAllComponents({ name: "OTab" }).map((tab) => tab.props("name"));
  const reporting = (on: boolean) => {
    store.state.organizationData.organizationSettings = {
      ...store.state.organizationData.organizationSettings,
      usage_stream_enabled: on,
    };
  };

  afterEach(() => {
    route.query = {};
    membership.mockResolvedValue({ data: { membership: null } });
    reporting(false);
  });

  it("keeps every tab and the bill for a Stripe-billed org, from the first frame", async () => {
    let releaseBill!: (value: unknown) => void;
    metering.mockReturnValue(new Promise((resolve) => (releaseBill = resolve)));
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    // Still loading: which tabs this org has is not known yet, so a placeholder bar holds their place.
    expect(tabs(wrapper)).toEqual([]);
    expect(wrapper.find('[data-test="billings-usageview-tabs-loading"]').exists()).toBe(true);

    releaseBill(bill);
    await flushPromises();

    expect(tabs(wrapper)).toEqual(["overview", "trends", "budget", "estimation"]);
    const overview = wrapper.findComponent({ name: "UsageOverview" });
    expect(overview.props("volumeOnly")).toBe(false);
    expect(overview.props("details")).toMatchObject({ total_cost: 1 });
  });

  it("shows only Overview, with 30 days of usage, when no bill comes back", async () => {
    reporting(true);
    metering.mockResolvedValue({ data: {} });
    members.mockResolvedValue({ data: [] });
    search.mockResolvedValue([
      { event: "Ingestion", volume: 2048 },
      { event: "AiCredits", volume: 7 },
    ]);
    // An old link to Budget still lands on Overview.
    route.query = { tab: "budget" };
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    // Overview is the only view, so there is no one-tab bar, and the placeholder is gone too.
    expect(tabs(wrapper)).toEqual([]);
    expect(wrapper.find('[data-test="billings-usageview-tabs-loading"]').exists()).toBe(false);
    const overview = wrapper.findComponent({ name: "UsageOverview" });
    expect(overview.props("volumeOnly")).toBe(true);
    expect(overview.props("details").ingestion.metered_amount).toBe(2048);
    expect(overview.props("details").ai.metered_amount).toBe(7);
    expect(overview.props("details").total_cost).toBe(0);
  });

  it("treats a member org as one with no bill, since its super org pays", async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    membership.mockResolvedValue({
      data: { membership: { payer_org_id: "payer", payer_org_name: "Payer Org" } },
    });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    expect(tabs(wrapper)).toEqual([]);
    // Reporting is off, so Overview offers to turn it on instead of reading a stream.
    expect(wrapper.findComponent({ name: "UsageOverview" }).props("details")).toBeNull();
    // The page says who pays, and where the costs are.
    expect(wrapper.find('[data-test="billings-usageview-payer"]').text()).toContain(
      "Billed through Payer Org",
    );
  });

  it("names no payer for an org that pays its own bill", async () => {
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    expect(wrapper.find('[data-test="billings-usageview-payer"]').exists()).toBe(false);
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
      "Contact sales",
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

describe("UsageView load failures", () => {
  const retryButton = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll("button").find((button) => button.text() === "Retry");

  it("shows a retryable error in plain words, not the raw message, when the bill cannot load", async () => {
    metering.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    const error = wrapper.find('[data-test="billings-usageview-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).not.toContain("Network Error");
    expect(error.text()).toContain("network connection");

    await retryButton(wrapper)!.trigger("click");
    await flushPromises();
    expect(wrapper.findComponent({ name: "UsageOverview" }).exists()).toBe(true);
  });

  it("says the billing service failed when the server answers with an error", async () => {
    metering.mockRejectedValue(
      Object.assign(new Error("Request failed"), { response: { status: 500 } }),
    );
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(wrapper.find('[data-test="billings-usageview-error"]').text()).toContain(
      "billing service returned an error",
    );
  });

  it("keeps the last bill on screen when a Refresh fails, and offers Retry", async () => {
    metering.mockResolvedValueOnce(bill).mockRejectedValueOnce(new Error("Network Error"));
    members.mockResolvedValue({ data: [] });
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();

    wrapper.findComponent({ name: "UsageOverview" }).vm.$emit("refresh");
    await flushPromises();

    const overview = wrapper.findComponent({ name: "UsageOverview" });
    expect(overview.exists()).toBe(true);
    expect(overview.props("details")).toMatchObject({ total_cost: 1 });
    expect(wrapper.find('[data-test="billings-usageview-refresh-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="billings-usageview-error"]').exists()).toBe(false);
  });
});

describe("UsageView AI credits summary", () => {
  const PAYG = { mode: "pay_as_you_go", credits_used: 1200, credits_limit: 1000 };

  // The unit setup installs the app client and clears it after each test.
  const mountView = async (body: Record<string, unknown>) => {
    vi.mocked(assistantService.usage).mockClear();
    metering.mockResolvedValue(bill);
    members.mockResolvedValue({ data: [] });
    aiUsage.mockResolvedValue({ data: { ...body, requires_additional_credits: false } });
    vi.mocked(assistantService.usage).mockResolvedValue(parseAiUsage(body));
    const wrapper = mount(UsageView, { global: { plugins: [i18n, store] } });
    await flushPromises();
    return wrapper;
  };
  const meterText = (wrapper: Awaited<ReturnType<typeof mountView>>) =>
    wrapper
      .get('[data-test="billings-usage-ai-summary"] [data-test="assistant-credit-meter-text"]')
      .text();
  const modeTag = (wrapper: Awaited<ReturnType<typeof mountView>>) =>
    wrapper.find(
      '[data-test="billings-usage-ai-summary"] [data-test="assistant-credit-meter-mode"]',
    );

  const v2 = (on: boolean) => {
    if (on) window.__O2_ASSISTANT_V2__ = true;
    else delete window.__O2_ASSISTANT_V2__;
    resetAssistantV2ForTests();
  };

  afterEach(() => v2(false));

  it("shows the Plans card's meter text and mode with the new assistant on", async () => {
    v2(true);
    const wrapper = await mountView(PAYG);
    expect(assistantService.usage).toHaveBeenCalledWith("default");
    expect(meterText(wrapper)).toBe("1,000 included credits used · 200 billed · paid usage on");
    expect(modeTag(wrapper).text()).toBe("Paid usage on");
  });

  it("reads the shared usage, so an invalidation after a turn shows the new numbers", async () => {
    v2(true);
    const wrapper = await mountView({ mode: "free", credits_used: 100, credits_limit: 1000 });
    expect(meterText(wrapper)).toBe("100 of 1,000 included credits · they don't renew");
    vi.mocked(assistantService.usage).mockResolvedValue(
      parseAiUsage({ mode: "free", credits_used: 800, credits_limit: 1000 }),
    );
    await queryClient.invalidateQueries({ queryKey: assistantKeys.usage("default") });
    await flushPromises();
    expect(meterText(wrapper)).toBe("800 of 1,000 included credits · they don't renew");
  });

  it("gives free usage no mode badge, as on Plans", async () => {
    v2(true);
    const wrapper = await mountView({ mode: "free", credits_used: 100, credits_limit: 1000 });
    expect(modeTag(wrapper).exists()).toBe(false);
    expect(wrapper.get('[data-test="billings-usage-ai-summary"]').text()).not.toContain("Free");
  });

  it("says No included credits for a zero limit, never 0 of 0", async () => {
    v2(true);
    const wrapper = await mountView({ mode: "pay_as_you_go", credits_used: 0, credits_limit: 0 });
    expect(meterText(wrapper)).toBe("No included credits");
    expect(wrapper.get('[data-test="billings-usage-ai-summary"]').text()).not.toContain("0 of 0");
  });

  it("leaves the page unchanged and reads nothing extra with the new assistant off", async () => {
    v2(false);
    const wrapper = await mountView(PAYG);
    expect(wrapper.find('[data-test="billings-usage-ai-summary"]').exists()).toBe(false);
    expect(assistantService.usage).not.toHaveBeenCalled();
  });
});
