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
import {
  meterForEvent,
  netCost,
  type BillingOrg,
  type MeterKey,
  type MeterShare,
  type MeteringDetails,
} from "./meteringModel";
import { orgVolumeSql } from "./usageQueries";
import { useUsageSearch } from "./useUsageSearch";

export interface OrgCost {
  gross: number;
  billed: number;
  /** Megabytes ingested this cycle. */
  ingested: number;
  /** The org's part of each meter; retention writes no usage events, so it is never here. */
  byMeter: Partial<Record<MeterKey, MeterShare>>;
}

export function priceOrgVolumes(
  hits: Record<string, unknown>[],
  cycle: MeteringDetails,
): Record<string, OrgCost> {
  const totals: Partial<Record<MeterKey, number>> = {};
  for (const hit of hits) {
    const meter = meterForEvent(String(hit.event ?? ""))?.key;
    if (meter) totals[meter] = (totals[meter] ?? 0) + (Number(hit.volume) || 0);
  }
  const byOrg: Record<string, OrgCost> = {};
  for (const hit of hits) {
    const event = String(hit.event ?? "");
    const volume = Number(hit.volume) || 0;
    const org = (byOrg[String(hit.name ?? "")] ??= {
      gross: 0,
      billed: 0,
      ingested: 0,
      byMeter: {},
    });
    if (event === "Ingestion") org.ingested += volume;
    const meter = meterForEvent(event)?.key;
    const total = meter ? (totals[meter] ?? 0) : 0;
    if (!meter || total <= 0) continue;
    const share = volume / total;
    const gross = (Number(cycle[meter]?.metered_cost) || 0) * share;
    const billed = netCost(cycle[meter]) * share;
    const part = (org.byMeter[meter] ??= { volume: 0, gross: 0, billed: 0 });
    part.volume += volume;
    part.gross += gross;
    part.billed += billed;
    org.gross += gross;
    org.billed += billed;
  }
  return byOrg;
}

/** One org-cost read, as the Usage page hands it to every tab that shows per-org spend. */
export interface OrgCostsState {
  costs: Record<string, OrgCost>;
  loading: boolean;
  failed: boolean;
}

export function useOrgCosts(
  details: Readonly<Ref<MeteringDetails | null>>,
  billingOrgs: Readonly<Ref<BillingOrg[]>>,
) {
  const { search } = useUsageSearch();
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
    costs.value = {};
    try {
      // The server streams ~one partial aggregate per time slice; showing each beats a long skeleton.
      const hits = await search(orgVolumeSql(), {
        start: window.value.start,
        end: window.value.end,
        size: 1000,
        key: "orgCosts",
        onRows: (rows) => {
          if (id === latest) costs.value = priceOrgVolumes(rows, cycle);
        },
      });
      if (id !== latest) return;
      costs.value = priceOrgVolumes(hits, cycle);
    } catch {
      if (id !== latest) return;
      costs.value = {};
      failed.value = true;
    } finally {
      if (id === latest) loading.value = false;
    }
  };

  // Refresh always brings a new bill, so this re-reads without watching a refresh signal.
  watch([() => billingOrgs.value.length, details], load, { immediate: true });

  return { costs, loading, failed, window };
}
