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

import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query";
import { alertDependenciesQuery } from "@/services/alerts.queries";
import { anomalyConfigsQuery } from "@/services/anomaly_detection.queries";
import { syntheticsMonitorsQuery } from "@/services/synthetics.queries";
import { slosQuery } from "@/services/slos.queries";
import type { TargetModule } from "@/services/downtimes";

export interface DowntimeItem {
  id: string;
  name: string;
  folderId: string;
  tags: string[];
}

const itemId = (module: TargetModule, row: any): string =>
  String(
    module === "alerts"
      ? (row.alert_id ?? row.id)
      : module === "anomaly_detections"
        ? (row.anomaly_id ?? row.id)
        : row.id,
  );

const itemFolder = (row: any): string =>
  String(row.folder_id ?? row.folder_name?.id ?? row.folder ?? "default");

/** One shape for the four list endpoints; alert-list anomaly rows belong to the anomaly module. */
export function normalizeItems(module: TargetModule, rows: any[]): DowntimeItem[] {
  return rows
    .filter((row) => module !== "alerts" || row.alert_type !== "anomaly_detection")
    .map((row) => ({
      id: itemId(module, row),
      name: String(row.name ?? ""),
      folderId: itemFolder(row),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    }))
    .filter((item) => item.id !== "undefined" && item.id !== "");
}

// Every declaration resolves to `any[]`; only the key tuple types differ.
type ItemsQuery = ReturnType<typeof alertDependenciesQuery>;

const itemsQuery = (module: TargetModule, org: string): ItemsQuery => {
  switch (module) {
    case "anomaly_detections":
      return anomalyConfigsQuery(org) as unknown as ItemsQuery;
    case "synthetics":
      return syntheticsMonitorsQuery(org) as unknown as ItemsQuery;
    case "slos":
      return slosQuery(org) as unknown as ItemsQuery;
    default:
      return alertDependenciesQuery(org);
  }
};

/** The module's own list, every folder, read through its declared query (D18: no new endpoint). */
export function useDowntimeItems(
  module: MaybeRefOrGetter<TargetModule>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const orgId = useOrgId();
  const query = useQuery(() =>
    Object.assign(itemsQuery(toValue(module), orgId.value), {
      enabled: !!orgId.value && toValue(enabled),
    }),
  );
  const items = computed(() => normalizeItems(toValue(module), query.data.value ?? []));
  return { items, query };
}
