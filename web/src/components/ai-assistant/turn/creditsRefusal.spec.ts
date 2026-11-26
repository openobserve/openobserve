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

import { describe, expect, it } from "vitest";

import { creditsRefusal } from "./creditsRefusal";

const day = () => "1 Nov";
const refuse = (ctx: Parameters<typeof creditsRefusal>[3], role: "admin" | "member" = "admin") =>
  creditsRefusal("credits_exhausted", role, "acme-prod", ctx, day);

describe("creditsRefusal", () => {
  it("leaves every other code to the generic block", () => {
    expect(creditsRefusal("rate_limited", "admin", "acme", {}, day)).toBeNull();
  });

  it("sends an eligible admin to paid usage and says the credits don't renew", () => {
    expect(refuse({ canManage: true, billingStatus: "eligible" })).toMatchObject({
      bodyKey: "assistant.error.credits_exhausted.body",
      action: "manage_usage",
    });
    expect(refuse({ canManage: true, resetsAt: Date.UTC(2026, 10, 1) })).toMatchObject({
      bodyKey: "assistant.error.credits_exhausted.bodyResets",
      params: { date: "1 Nov" },
    });
  });

  it("words subscription and contract admins by the billing status", () => {
    expect(refuse({ canManage: true, billingStatus: "subscription_required" })).toMatchObject({
      titleKey: "assistant.error.subscription_required.title",
      action: "view_plans",
    });
    expect(refuse({ canManage: true, billingStatus: "additional_credits_required" })).toMatchObject(
      { bodyKey: "assistant.error.credits_exhausted.bodyContract", action: "copy_request" },
    );
  });

  it("lets a subscription_required code win over a cached eligible read", () => {
    const sub = (ctx: Parameters<typeof creditsRefusal>[3]) =>
      creditsRefusal("subscription_required", "admin", "acme-prod", ctx, day);
    expect(sub({ canManage: true, billingStatus: "eligible" })).toMatchObject({
      titleKey: "assistant.error.subscription_required.title",
      bodyKey: "assistant.error.subscription_required.body",
      action: "view_plans",
    });
    expect(
      sub({ canManage: true, billingStatus: "eligible", payer: "acme-billing" }),
    ).toMatchObject({
      titleKey: "assistant.error.credits_exhausted.titlePayer",
      bodyKey: "assistant.error.subscription_required.body",
      params: { payer: "acme-billing" },
      action: "view_plans",
    });
  });

  it("lets the overage read decide the role over the org role", () => {
    expect(refuse({ canManage: false }, "admin")).toMatchObject({
      bodyKey: "assistant.error.credits_exhausted.bodyMember",
      action: "ask_admin",
    });
    expect(refuse({}, "member").action).toBe("ask_admin");
    expect(refuse({}, "admin").action).toBe("manage_usage");
  });

  it("names the payer, and a member asks the payer's admins", () => {
    expect(refuse({ canManage: true, payer: "acme-billing" })).toMatchObject({
      titleKey: "assistant.error.credits_exhausted.titlePayer",
      action: "manage_usage",
    });
    expect(refuse({ canManage: false, payer: "acme-billing" })).toMatchObject({
      bodyKey: "assistant.error.credits_exhausted.bodyPayerMember",
      action: "ask_admin",
      payer: "acme-billing",
    });
  });
});
