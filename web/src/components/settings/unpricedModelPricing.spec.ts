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
import type { PricingMatch } from "@/services/model_pricing";
import {
  buildKeepPricesPayload,
  buildMutePayload,
  defaultTier,
  exactModelPattern,
} from "./unpricedModelPricing";

describe("exactModelPattern", () => {
  it("anchors the name and escapes regex metacharacters", () => {
    expect(exactModelPattern("gpt-5.4-mini")).toBe("^gpt-5\\.4-mini$");
    expect(exactModelPattern("acme-internal-llm")).toBe("^acme-internal-llm$");
  });

  it("matches only the model it names, whatever characters it holds", () => {
    const names = ["gpt-5.4-mini", "a+b(c)[d]{1}|e*f?^$\\g", "models/gemini-2.5-pro:latest"];
    for (const name of names) {
      const re = new RegExp(exactModelPattern(name));
      expect(re.test(name)).toBe(true);
      expect(re.test(`${name}-2`)).toBe(false);
      expect(re.test(`x${name}`)).toBe(false);
    }
    // An unescaped dot would also match this sibling.
    expect(new RegExp(exactModelPattern("gpt-5.4-mini")).test("gpt-5x4-mini")).toBe(false);
  });
});

const gpt54: PricingMatch = {
  name: "GPT-5.4",
  match_pattern: "^gpt-5\\.4",
  source: "built_in",
  tiers: [
    {
      name: "Long context",
      condition: { usage_key: "input", operator: "gt", value: 200000 },
      prices: { input: 5e-6, output: 2.25e-5 },
    },
    { name: "Default", condition: null, prices: { input: 2.5e-6, output: 1.5e-5 } },
  ],
};

describe("defaultTier", () => {
  it("picks the unrestricted tier over a conditional first tier", () => {
    expect(defaultTier(gpt54.tiers)?.name).toBe("Default");
  });

  it("falls back to the first tier when every tier is restricted", () => {
    expect(defaultTier([gpt54.tiers[0]])?.name).toBe("Long context");
  });
});

describe("buildKeepPricesPayload", () => {
  it("prices the model exactly with a copy of the tiers it matches today", () => {
    const payload = buildKeepPricesPayload("gpt-5.4-mini", gpt54);
    expect(payload).toMatchObject({
      name: "gpt-5.4-mini",
      match_pattern: "^gpt-5\\.4-mini$",
      enabled: true,
      tiers: gpt54.tiers,
    });
    expect(payload.description).toContain("GPT-5.4");
  });

  it("copies the tiers, so editing the new price leaves the source untouched", () => {
    const payload = buildKeepPricesPayload("gpt-5.4-mini", gpt54);
    payload.tiers[1].prices.input = 1;
    expect(gpt54.tiers[1].prices.input).toBe(2.5e-6);
  });
});

describe("buildMutePayload", () => {
  it("prices the model exactly at zero under a muted name", () => {
    expect(buildMutePayload("acme-internal-llm")).toEqual({
      name: "acme-internal-llm (muted)",
      match_pattern: "^acme-internal-llm$",
      enabled: true,
      tiers: [{ name: "Default", condition: null, prices: { input: 0, output: 0 } }],
      description: "Muted from the Unpriced tab: this model is treated as free.",
    });
  });
});
