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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type { AssistantUsage } from "@/services/assistant";
import type { PaidOverageStatus } from "@/services/paidOverage";

import { fakeRouter } from "../__tests__/fakeAssistant";
import AssistantCreditMeter, { type AssistantCreditMeterProps } from "./AssistantCreditMeter.vue";

const routes = [{ path: "/billings/plans", name: "plans", component: {} }];

const usage = (
  mode: AssistantUsage["mode"],
  used: number,
  limit = 1000,
  extra: Partial<AssistantUsage> = {},
): AssistantUsage => ({ mode, credits_used: used, credits_limit: limit, ...extra });

const overage = (effective: boolean): PaidOverageStatus => ({
  feature: "ai_credits",
  organization: { org_id: "acme-prod", enabled: effective, can_manage: true },
  payer: null,
  effective,
  billing_status: "eligible",
});

function mountMeter(props: Partial<AssistantCreditMeterProps>) {
  return mount(AssistantCreditMeter, {
    props: {
      usage: null,
      overage: null,
      status: "ready",
      canManage: false,
      orgName: "acme-prod",
      size: "card",
      ...props,
    },
    global: { plugins: [fakeRouter(routes)] },
  });
}

const part = (wrapper: ReturnType<typeof mountMeter>, id: string) =>
  wrapper.find(`[data-test="assistant-credit-meter-${id}"]`);

describe("AssistantCreditMeter", () => {
  it("reads free usage with the locale separator and no tag, as one named group", () => {
    const wrapper = mountMeter({ usage: usage("free", 412) });
    const root = wrapper.get('[data-test="assistant-credit-meter"]');
    expect(root.attributes("role")).toBe("group");
    expect(root.attributes("aria-label")).toBe("412 of 1,000 included credits · they don't renew");
    expect(part(wrapper, "bar").attributes("aria-valuenow")).toBe("41");
    expect(part(wrapper, "bar").attributes("aria-valuetext")).toContain("412 of 1,000");
    expect(part(wrapper, "mode").exists()).toBe(false);
    expect(part(wrapper, "manage").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Free");
  });

  it("names the renewal date only when the server sends one", () => {
    const wrapper = mountMeter({
      usage: usage("free", 412, 1000, { resetsAt: Date.UTC(2026, 10, 1, 12) }),
    });
    expect(part(wrapper, "text").text()).toMatch(/· resets (1 Nov|Nov 1)$/);
  });

  it("offers an admin Manage in a new tab from 70 % on", () => {
    const wrapper = mountMeter({ usage: usage("free", 712), canManage: true });
    const manage = part(wrapper, "manage");
    expect(manage.attributes("target")).toBe("_blank");
    expect(manage.attributes("rel")).toContain("noopener");
    expect(manage.attributes("aria-label")).toBe("Manage paid usage (opens in a new tab)");
  });

  it("speaks the sentence once: the compact stop and the bar carry only the value", () => {
    const wrapper = mountMeter({ usage: usage("free", 712), size: "compact" });
    const stop = wrapper.get('[tabindex="0"]');
    expect(stop.attributes("role")).toBe("img");
    expect(stop.attributes("aria-label")).toBe("712 of 1,000 credits");
    expect(part(wrapper, "bar").attributes("aria-label")).toBe("Included AI credits");
    expect(wrapper.findAll('[aria-label*="don\'t renew"]')).toHaveLength(1);
  });

  it("caps pay-as-you-go at the limit and never shows a raw ratio", () => {
    const wrapper = mountMeter({ usage: usage("pay_as_you_go", 1200), size: "compact" });
    expect(part(wrapper, "bar").attributes("aria-valuenow")).toBe("100");
    expect(part(wrapper, "mode").text()).toBe("Paid usage on");
    expect(part(wrapper, "text").exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-credit-meter"]').attributes("aria-label")).toBe(
      "1,000 included credits used · 200 billed · paid usage on",
    );
    expect(wrapper.html()).not.toContain("1200 / 1000");
  });

  it("tags consent required and exhausted, never as free", () => {
    const consent = mountMeter({ usage: usage("consent_required", 1000) });
    expect(part(consent, "mode").text()).toBe("Consent required");
    expect(consent.text()).toContain("Included credits used · paid usage needs consent");
    const exhausted = mountMeter({ usage: usage("exhausted", 1000), size: "compact" });
    expect(part(exhausted, "mode").text()).toBe("Exhausted");
    expect(part(exhausted, "text").text()).toBe("Used up");
  });

  it("says there are no included credits instead of 0 of 0", () => {
    const wrapper = mountMeter({ usage: usage("pay_as_you_go", 0, 0) });
    expect(part(wrapper, "bar").exists()).toBe(false);
    expect(wrapper.text()).toContain("No included credits");
    expect(wrapper.text()).not.toContain("0 of 0");
  });

  it("reserves its line with a skeleton while loading", () => {
    const wrapper = mountMeter({ status: "loading" });
    expect(wrapper.get('[data-test="assistant-credit-meter"]').attributes("data-state")).toBe(
      "loading",
    );
    expect(wrapper.text()).toBe("");
  });

  it("stays on a failed usage read with Retry, keeping the tag the overage read implies", async () => {
    const wrapper = mountMeter({ status: "partial", overage: overage(true), size: "compact" });
    expect(part(wrapper, "text").text()).toBe("Credits unavailable");
    expect(part(wrapper, "mode").text()).toBe("Paid usage on");
    await part(wrapper, "retry").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    const both = mountMeter({ status: "error" });
    expect(both.text()).toContain("Credit usage unavailable");
    expect(part(both, "mode").exists()).toBe(false);
  });
});
