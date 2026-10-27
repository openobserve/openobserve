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

import { queryOptions } from "@tanstack/vue-query";

import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { orgKey } from "@/composables/query/keys";

import BillingService, { type AiUsage } from "./billings";

/** Another org's AI credit usage, as an operator reads it beside that org's allowance. */
export const orgAiUsageQuery = (org: string) =>
  queryOptions({
    queryKey: orgKey(org, "billing", "aiUsage"),
    queryFn: async (): Promise<AiUsage> => (await BillingService.get_ai_usage(org)).data,
    staleTime: LIVE_STALE_TIME,
    retry: false,
    enabled: !!org,
  });

/** The typed refusal a floor-checking server sends for a limit below current usage; `null` for anything else. */
export function belowUsageOf(err: unknown): { used: number; limit: number } | null {
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  if (res?.status !== 409 || !res.data || typeof res.data !== "object") return null;
  const body = res.data as Record<string, unknown>;
  const inner = (body.error && typeof body.error === "object" ? body.error : body) as Record<
    string,
    unknown
  >;
  if (inner.code !== "below_usage") return null;
  const used = typeof inner.used === "number" ? inner.used : NaN;
  const limit = typeof inner.limit === "number" ? inner.limit : NaN;
  return Number.isFinite(used) && Number.isFinite(limit) ? { used, limit } : null;
}
