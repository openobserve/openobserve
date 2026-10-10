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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import O2AICreditsNotice from "./O2AICreditsNotice.vue";

const mockGetAiUsage = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("@/services/billings", () => ({ default: { get_ai_usage: mockGetAiUsage } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "org1" } } }),
}));

const usage = (over: Record<string, unknown>) => ({
  data: {
    mode: "free",
    credits_used: 0,
    credits_limit: 5,
    credits_remaining: 5,
    requires_additional_credits: false,
    costs: { chat: 1, incident: 50, incident_reanalysis: 50 },
    ...over,
  },
});

async function mountNotice(busy = false) {
  const w = mount(O2AICreditsNotice, { global: { plugins: [i18n] }, props: { busy } });
  await flushPromises();
  return w;
}

describe("O2AICreditsNotice", () => {
  beforeEach(() => {
    mockGetAiUsage.mockReset();
    mockPush.mockReset();
  });

  it("stays hidden while most free credits remain", async () => {
    mockGetAiUsage.mockResolvedValue(usage({ credits_used: 3, credits_remaining: 2 }));
    expect((await mountNotice()).text()).toBe("");
  });

  it("warns with balance and configured costs once 80% is used", async () => {
    mockGetAiUsage.mockResolvedValue(usage({ credits_used: 4, credits_remaining: 1 }));
    const text = (await mountNotice()).text();
    expect(text).toContain("1 of 5 free AI credits left");
    expect(text).toContain("Incident analysis uses 50");
  });

  it("shows the subscribe remedy before the user sends, with Plans and Refresh", async () => {
    mockGetAiUsage.mockResolvedValue(usage({ mode: "exhausted", credits_remaining: 0 }));
    const w = await mountNotice();
    expect(w.text()).toContain(
      "Subscribe to keep using AI. Further usage is billed on this organization's invoice.",
    );

    await w.find('[data-test="o2-ai-credits-plans"]').trigger("click");
    expect(mockPush).toHaveBeenCalledWith({ name: "plans", query: { org_identifier: "org1" } });

    mockGetAiUsage.mockResolvedValue(usage({ mode: "pay_as_you_go", credits_remaining: 0 }));
    await w.find('[data-test="o2-ai-credits-recheck"]').trigger("click");
    await flushPromises();
    expect(w.text()).toBe("");
  });

  it("points contract orgs to their account manager, without Plans", async () => {
    mockGetAiUsage.mockResolvedValue(
      usage({ mode: "exhausted", credits_remaining: 0, requires_additional_credits: true }),
    );
    const w = await mountNotice();
    expect(w.text()).toContain("Contact your account manager");
    expect(w.find('[data-test="o2-ai-credits-plans"]').exists()).toBe(false);
  });

  it("rechecks the balance when a turn finishes", async () => {
    mockGetAiUsage.mockResolvedValue(usage({}));
    const w = await mountNotice(true);
    await w.setProps({ busy: false });
    expect(mockGetAiUsage).toHaveBeenCalledTimes(2);
  });
});
