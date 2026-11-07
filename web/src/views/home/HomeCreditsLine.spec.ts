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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import type { PaidOverageStatus } from "@/services/paidOverage";
import store from "@/test/unit/helpers/store";

import HomeCreditsLine from "./HomeCreditsLine.vue";

const mocks = vi.hoisted(() => ({ get: vi.fn(), prompt: vi.fn() }));

vi.mock("@/services/paidOverage", () => ({ default: { get: mocks.get, update: vi.fn() } }));
vi.mock("@/composables/usePaidOverageConsent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/usePaidOverageConsent")>()),
  usePaidOverageConsent: () => ({ promptForConsent: mocks.prompt }),
}));
vi.mock("@/components/ai-assistant/credits/AssistantCreditManage.vue", () => ({
  default: { name: "CreditManage", template: '<div data-test="credit-manage-stub" />' },
}));
vi.mock("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue", () => ({
  default: {
    name: "AskAdmin",
    props: ["kind", "org", "payer"],
    template: '<div data-test="ask-admin-stub" :data-payer="payer"><slot name="trigger" /></div>',
  },
}));

const org = (id: string, enabled: boolean, canManage: boolean) => ({
  org_id: id,
  enabled,
  can_manage: canManage,
});

const status = (over: Partial<PaidOverageStatus>): PaidOverageStatus =>
  ({
    feature: "ai_credits",
    organization: org("child", false, true),
    payer: org("payer", false, true),
    effective: false,
    billing_status: "active",
    ...over,
  }) as PaidOverageStatus;

const mountLine = async (answer: PaidOverageStatus) => {
  mocks.get.mockResolvedValue({ data: answer });
  const wrapper = mount(HomeCreditsLine, {
    props: { org: `org-${Math.random()}` },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

describe("HomeCreditsLine", () => {
  let originalCloud: string;

  beforeEach(() => {
    originalCloud = config.isCloud;
    config.isCloud = "true";
    mocks.prompt.mockReset();
  });

  afterEach(() => {
    config.isCloud = originalCloud;
    queryClient.clear();
  });

  it("offers Enable when the child and the payer are missing and both manageable", async () => {
    const answer = status({});
    const wrapper = await mountLine(answer);
    expect(wrapper.attributes("data-state")).toBe("enable");
    mocks.prompt.mockResolvedValue(false);
    await wrapper.get('[data-test="home-credits-line-enable"]').trigger("click");
    expect(mocks.prompt).toHaveBeenCalledWith(expect.any(String), "ai_credits", answer);
  });

  it("invalidates paid usage and capabilities after the dialog enables, and nothing when it is dismissed", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = await mountLine(status({}));
    mocks.prompt.mockResolvedValue(false);
    await wrapper.get('[data-test="home-credits-line-enable"]').trigger("click");
    await flushPromises();
    expect(spy).not.toHaveBeenCalled();
    mocks.prompt.mockResolvedValue(true);
    await wrapper.get('[data-test="home-credits-line-enable"]').trigger("click");
    await flushPromises();
    const keys = spy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys.some((key) => key.includes("paidOverage"))).toBe(true);
    expect(keys.some((key) => key.includes("capabilities"))).toBe(true);
    spy.mockRestore();
  });

  it("names the payer for Ask an admin when only a payer this user cannot manage is missing", async () => {
    const wrapper = await mountLine(
      status({ organization: org("child", true, true), payer: org("payer", false, false) }),
    );
    expect(wrapper.attributes("data-state")).toBe("ask");
    expect(wrapper.get('[data-test="ask-admin-stub"]').attributes("data-payer")).toBe("payer");
    expect(wrapper.text()).toContain("payer");
  });

  it("offers Manage once paid usage is effective", async () => {
    const wrapper = await mountLine(
      status({ organization: org("child", true, true), payer: null, effective: true }),
    );
    expect(wrapper.attributes("data-state")).toBe("manage");
    expect(wrapper.find('[data-test="credit-manage-stub"]').exists()).toBe(true);
  });

  it("asks an admin when no consent dialog is mounted", async () => {
    config.isCloud = "false";
    const wrapper = await mountLine(status({}));
    expect(wrapper.attributes("data-state")).toBe("ask");
  });
});
