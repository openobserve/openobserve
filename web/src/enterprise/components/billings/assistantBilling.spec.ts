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

import {
  creditsLineOf,
  dayOf,
  exhaustedContractKey,
  modeLineKey,
  modeOf,
  orgNameOf,
} from "./assistantBilling";

describe("assistantBilling", () => {
  it("names an org from the org list and falls back to the id", () => {
    const list = [{ identifier: "o1", name: "Acme prod" }];
    expect(orgNameOf(list, "o1")).toBe("Acme prod");
    expect(orgNameOf(list, "o2", "Other")).toBe("Other");
    expect(orgNameOf(null, "o3")).toBe("o3");
  });

  it("reads only known modes", () => {
    expect(modeOf({ mode: "pay_as_you_go" })).toBe("pay_as_you_go");
    expect(modeOf({ mode: "weird" })).toBe("unknown");
    expect(modeOf(null)).toBe("unknown");
  });

  it("picks one line per mode", () => {
    const base = { resets: false, payer: false, isAdmin: true };
    expect(modeLineKey("free", base)).toBe("assistant.billing.mode.freeNoRenew");
    expect(modeLineKey("free", { ...base, resets: true })).toBe(
      "assistant.billing.mode.freeResets",
    );
    expect(modeLineKey("consent_required", base)).toBe("assistant.billing.mode.consentRequired");
    expect(modeLineKey("pay_as_you_go", { ...base, payer: true })).toBe(
      "paidUsage.payerBillingCycle",
    );
    expect(modeLineKey("exhausted", { ...base, billing: "subscription_required" })).toBe(
      "assistant.billing.mode.exhaustedSubscribe",
    );
    expect(modeLineKey("exhausted", { ...base, billing: "additional_credits_required" })).toBe(
      "assistant.billing.mode.exhaustedContract",
    );
    expect(
      modeLineKey("exhausted", { ...base, isAdmin: false, billing: "additional_credits_required" }),
    ).toBe("assistant.billing.mode.exhaustedContractMember");
    expect(modeLineKey("unknown", base)).toBeNull();
    expect(exhaustedContractKey(false)).toBe("assistant.billing.mode.exhaustedContractMember");
  });

  it("formats a day only from a usable timestamp", () => {
    expect(dayOf("2026-11-01T00:00:00Z")).not.toBe("");
    expect(dayOf("not a date")).toBe("");
    expect(dayOf(null)).toBe("");
  });

  it("words pay-as-you-go past the pool as billed, never as over the limit", () => {
    expect(
      creditsLineOf({ credits_used: 1200, credits_limit: 1000, mode: "pay_as_you_go" }),
    ).toEqual({
      key: "assistant.billing.usedBilled",
      params: { limit: "1,000", billed: "200" },
    });
    expect(creditsLineOf({ credits_used: 400, credits_limit: 1000, mode: "free" }).key).toBe(
      "assistant.billing.usedOf",
    );
  });
});
