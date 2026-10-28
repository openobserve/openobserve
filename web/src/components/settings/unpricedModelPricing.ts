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

import type { NewPricingDefinition, PricingMatch, PricingTier } from "@/services/model_pricing";

/** A pattern that matches exactly `model` and nothing else, e.g. `^gpt-5\.4-mini$`. */
export function exactModelPattern(model: string): string {
  return `^${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/** Mirrors the backend: the tier with no usage condition, UTC window or attribute rule, else the first. */
export function defaultTier(tiers: PricingTier[]): PricingTier | undefined {
  return tiers.find((t) => !t.condition && !t.utc_windows?.length && !t.rules?.length) ?? tiers[0];
}

// The descriptions below are persisted with the definition, so they stay English
// for every locale, like the editor's "Default" tier name.

/** An exact org price for `model` that copies the prices it matches approximately today; a side the match leaves unpriced stays unset, never $0. */
export function buildKeepPricesPayload(model: string, matched: PricingMatch): NewPricingDefinition {
  return {
    name: model,
    match_pattern: exactModelPattern(model),
    enabled: true,
    // JSON round-trip, not structuredClone: query data may be a Vue proxy, which structuredClone rejects.
    tiers: (JSON.parse(JSON.stringify(matched.tiers)) as PricingTier[]).map((tier) => ({
      ...tier,
      prices: Object.fromEntries(
        Object.entries(tier.prices ?? {}).filter(([, price]) => Number.isFinite(price)),
      ),
    })),
    description: `Prices copied from "${matched.name}" from the Unpriced tab.`,
  };
}

/** An exact org price of $0 for new spans; historical gaps keep their recorded cost. */
export function buildMutePayload(model: string): NewPricingDefinition {
  return {
    name: `${model} (muted)`,
    match_pattern: exactModelPattern(model),
    enabled: true,
    tiers: [{ name: "Default", condition: null, prices: { input: 0, output: 0 } }],
    description: "Muted from the Unpriced tab: this model is treated as free.",
  };
}
