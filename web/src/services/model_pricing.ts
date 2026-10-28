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

import http from "./http";

/** One pricing tier in its wire shape: per-token prices keyed by usage type. */
export interface PricingTier {
  name: string;
  condition?: { usage_key: string; operator: string; value: number } | null;
  prices: Record<string, number>;
  utc_windows?: { start_minute: number; end_minute: number }[];
  rules?: { keys: string[]; op: string; values?: string[]; value?: number }[];
}

/** A price definition as the pricing API returns it. */
export interface PricingMatch {
  name: string;
  match_pattern: string;
  source: "built_in" | "meta_org" | "org";
  tiers: PricingTier[];
}

/** The body the create endpoint takes for an org price definition. */
export interface NewPricingDefinition {
  name: string;
  match_pattern: string;
  enabled: boolean;
  tiers: PricingTier[];
  description: string;
}

/** A model seen in spans that matched no price, or only part of a pattern. */
export interface UnpricedModel {
  /** Null for spans that carry tokens but no model name: nothing to price. */
  model: string | null;
  status: "unpriced" | "approximate";
  spans: number;
  tokens: number;
  cost: number;
  agents: string[];
  /** The definition the model resolves to today: set when approximate, null when unpriced. */
  matched: PricingMatch | null;
}

export interface BuiltInPricingResponse {
  models: PricingMatch[];
  source_url: string;
  /** Unix seconds of this server's last successful online sync; 0 = none since startup. */
  last_updated: number;
  /** Date (YYYY-MM-DD) of the seed price list compiled into the binary. */
  seed_date: string;
}

const modelPricing = {
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/llm/models`);
  },
  get: (org_identifier: string, model_id: string) => {
    return http().get(`/api/${org_identifier}/llm/models/${model_id}`);
  },
  create: (org_identifier: string, data: any) => {
    return http().post(`/api/${org_identifier}/llm/models`, data);
  },
  update: (org_identifier: string, model_id: string, data: any) => {
    return http().put(`/api/${org_identifier}/llm/models/${model_id}`, data);
  },
  delete: (org_identifier: string, model_id: string) => {
    return http().delete(`/api/${org_identifier}/llm/models/${model_id}`);
  },
  getBuiltIn: (org_identifier: string, search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    return http().get<BuiltInPricingResponse>(
      `/api/${org_identifier}/llm/models/built-in${params}`,
    );
  },
  /** Models in `stream_name` spans between the µs bounds that have no price or an approximate one. */
  listUnpriced: (
    org_identifier: string,
    params: { stream_name: string; start_time: number; end_time: number },
  ) => {
    return http().get<{ models: UnpricedModel[] }>(`/api/${org_identifier}/llm/models/unpriced`, {
      params,
    });
  },
  refreshBuiltIn: (org_identifier: string) => {
    return http().post(`/api/${org_identifier}/llm/models/refresh-built-in`, {});
  },
  /** Test which rule prices `model_name`. With `match_pattern`, the response's
   *  `captured_models` lists the known models that pattern would price if saved;
   *  `rule_id` leaves the rule being edited out of that preview. */
  test: (
    org_identifier: string,
    data: {
      model_name: string;
      usage?: Record<string, number>;
      timestamp?: number | null;
      attributes?: Record<string, string | number | boolean>;
      match_pattern?: string;
      rule_id?: string;
    },
  ) => {
    return http().post(`/api/${org_identifier}/llm/models/test`, data);
  },
};

export default modelPricing;
