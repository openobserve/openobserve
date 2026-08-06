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

/**
 * Settings list pages: cipher keys, custom regex patterns, AI toolsets, model pricing.
 *
 * Client-paginated: the page filters, sorts and pages in the browser, so none
 * of that reaches the query key.
 */

import CipherKeysService from "@/services/cipher_keys";
import regexPatternsService from "@/services/regex_pattern";
import aiToolsetsService from "@/services/ai_toolsets";
import modelPricingService from "@/services/model_pricing";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";
import { createDetailQuery } from "../createDetailQuery";

// These endpoints paginate, but the page wants the whole list — one big page.
const ALL = 100000;

export const cipherKeysQuery = createOrgListQuery<any>({
  key: (org) => qk.settings.cipherKeys(org),
  fetch: async (org) => (await CipherKeysService.list(org)).data?.keys ?? [],
  tier: "ORG_CONFIG",
  // Key material is a secret — cached in memory, never written to storage.
  persist: "none",
});

export const regexPatternsQuery = createOrgListQuery<any>({
  key: (org) => qk.settings.regexPatterns(org),
  fetch: async (org) => (await regexPatternsService.list(org)).data?.patterns ?? [],
  tier: "ORG_CONFIG",
});

export const aiToolsetsQuery = createOrgListQuery<any>({
  key: (org) => qk.settings.aiToolsets(org),
  fetch: async (org) => (await aiToolsetsService.list(org, { limit: ALL })).data?.toolsets ?? [],
  tier: "ORG_CONFIG",
});

export const modelPricingQuery = createOrgListQuery<any>({
  key: (org) => qk.settings.modelPricing(org),
  fetch: async (org) => (await modelPricingService.list(org)).data ?? [],
  tier: "ORG_CONFIG",
});

export const cipherKeyDetailQuery = createDetailQuery<[name: string]>({
  key: (org, name) => [...qk.settings.cipherKeys(org), "detail", name] as const,
  fetch: async (org, name) => (await CipherKeysService.get_by_name(org, name)).data,
  root: (org) => qk.settings.cipherKeys(org),
});
