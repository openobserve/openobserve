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

import { escapeSingleQuotes } from "@/utils/zincutils";

/**
 * Payload emitted by ServiceGraph / ServicesCatalog `view-traces`. Every field
 * is optional: the graph sends the richest form (operation, pod, caller,
 * duration bounds), the catalog often sends only a service name.
 */
export interface ViewTracesPayload {
  serviceName?: string;
  serviceType?: string;
  operationName?: string;
  nodeName?: string;
  podName?: string;
  callerService?: string;
  resourceFilter?: { value?: string; field?: string; fields?: string[] };
  errorsOnly?: boolean;
  minDurationMicros?: number;
  maxDurationMicros?: number;
  mode?: string;
  stream?: string;
  timeRange?: { startTime: number; endTime: number };
}

/**
 * Build the traces search-bar filter (a bare WHERE condition — no SELECT/ORDER
 * BY, since the traces editor is not in SQL mode) from a `view-traces` payload.
 *
 * Shared by the embedded Service Graph and Services Catalog tabs so both build
 * the same filter before returning to the traces search view.
 *
 * @returns the filter string, or "" when the payload names no service (there is
 *          nothing to filter on without one).
 */
export function buildViewTracesFilter(data: ViewTracesPayload): string {
  if (!data.serviceName) return "";

  const escapedServiceName = escapeSingleQuotes(data.serviceName);
  const serviceField = data.serviceType ? "infer_service_name" : "service_name";
  let filterQuery = `${serviceField} = '${escapedServiceName}'`;

  if (data.operationName) {
    filterQuery += ` AND operation_name = '${escapeSingleQuotes(data.operationName)}'`;
  }
  if (data.nodeName) {
    filterQuery += ` AND service_k8s_node_name = '${escapeSingleQuotes(data.nodeName)}'`;
  }
  if (data.podName) {
    filterQuery += ` AND service_k8s_pod_name = '${escapeSingleQuotes(data.podName)}'`;
  }
  if (data.callerService) {
    filterQuery += ` AND service_name = '${escapeSingleQuotes(data.callerService)}'`;
  }
  if (data.resourceFilter?.value) {
    const escapedValue = escapeSingleQuotes(data.resourceFilter.value);
    if (data.resourceFilter.fields?.length) {
      // Fallback chain: (field1 = 'val' OR field2 = 'val')
      const clauses = data.resourceFilter.fields
        .map((f: string) => `${f} = '${escapedValue}'`)
        .join(" OR ");
      filterQuery += ` AND (${clauses})`;
    } else if (data.resourceFilter.field) {
      filterQuery += ` AND ${data.resourceFilter.field} = '${escapedValue}'`;
    }
  }
  if (data.errorsOnly) {
    filterQuery += ` AND span_status = 'ERROR'`;
  }
  if (data.minDurationMicros && data.minDurationMicros > 0) {
    filterQuery += ` AND duration >= ${data.minDurationMicros}`;
  }
  if (data.maxDurationMicros && data.maxDurationMicros > 0) {
    filterQuery += ` AND duration <= ${data.maxDurationMicros}`;
  }
  return filterQuery;
}

/**
 * Normalize a `view-traces` payload. The catalog emits a plain service-name
 * string in its legacy path; everything else emits an object.
 */
export function normalizeViewTracesPayload(data: string | ViewTracesPayload): ViewTracesPayload {
  return typeof data === "string" ? { serviceName: data, mode: "traces" } : data;
}
