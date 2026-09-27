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

import { computed, ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";
import {
  meterForEvent,
  type BillingOrg,
  type MeterKey,
  type MeteringDetails,
} from "./meteringModel";
import { orgCostSql } from "./usageQueries";
import { cyclePrices } from "./trendsModel";

export interface OrgCost {
  gross: number;
  billed: number;
  /** Megabytes ingested this cycle. */
  ingested: number;
  /** Billed cost per meter; retention writes no usage events, so it is never here. */
  byMeter: Partial<Record<MeterKey, number>>;
}

/**
 * A super org's cost per org for the current cycle.
 *
 * Stripe itemises a super org's bill for the super org only, but every member's usage
 * also lands in the super org's `usage` stream with its own org_id. So each org's cost
 * is its usage priced at this bill's rates and discounts: an estimate that tracks the bill.
 */
export function useOrgCosts(
  details: Ref<MeteringDetails | null>,
  billingOrgs: Ref<BillingOrg[]>,
  refreshToken: Ref<number>,
) {
  const store = useStore();
  const costs = ref<Record<string, OrgCost>>({});
  const loading = ref(false);
  /** A failed read shows as an error, never as every org at $0.00. */
  const failed = ref(false);

  /** This cycle so far, in microseconds. */
  const window = computed(() => {
    const start = (details.value?.cycle_start ?? 0) * 1_000_000;
    const end = Math.min((details.value?.cycle_end ?? 0) * 1_000_000, Date.now() * 1000);
    return { start, end: Math.max(end, start) };
  });

  let latest = 0;

  const load = async () => {
    const cycle = details.value;
    if (!billingOrgs.value.length || !cycle) return;
    const id = ++latest;
    loading.value = true;
    failed.value = false;
    try {
      const response = await searchService.search({
        org_identifier: store.state.selectedOrganization.identifier,
        page_type: "logs",
        query: {
          query: {
            sql: orgCostSql(cyclePrices([cycle]), cyclePrices([cycle], true)),
            start_time: window.value.start,
            end_time: window.value.end,
            from: 0,
            size: 1000,
          },
        },
      });
      if (id !== latest) return;
      const hits = (response?.data?.hits ?? []) as Record<string, unknown>[];
      const byOrg: Record<string, OrgCost> = {};
      for (const hit of hits) {
        const org = (byOrg[String(hit.name ?? "")] ??= {
          gross: 0,
          billed: 0,
          ingested: 0,
          byMeter: {},
        });
        const billed = Number(hit.billed) || 0;
        org.gross += Number(hit.gross) || 0;
        org.billed += billed;
        org.ingested += Number(hit.ingested) || 0;
        const meter = meterForEvent(String(hit.event ?? ""))?.key;
        if (meter) org.byMeter[meter] = (org.byMeter[meter] ?? 0) + billed;
      }
      costs.value = byOrg;
    } catch {
      if (id !== latest) return;
      costs.value = {};
      failed.value = true;
    } finally {
      if (id === latest) loading.value = false;
    }
  };

  watch([() => billingOrgs.value.length, details, refreshToken], load, { immediate: true });

  return { costs, loading, failed, window };
}
