// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import store from "@/stores";
import useHttpStreaming from "@/composables/useStreamingSearch";
import {
  isAutoObserveBuild,
  pickField,
  SERVICE_FIELDS,
  type ServiceScope,
  SPAN_CLUSTER_FIELDS,
  SPAN_NAMESPACE_FIELDS,
  sqlField,
  sqlLiteral,
  sqlStream,
} from "@/utils/alerts/prefill/fromAutoObserve";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";

/** G10 reads a day of server spans; older addresses may no longer answer. */
export const ADDRESS_LOOKBACK_US = 24 * 3_600_000_000;

const HEALTH_ROUTES = ["health", "ready", "live"];

// The address, the route and the span kind, in the order serviceAddressSql reads them.
const REQUIRED_FIELDS = ["server_address", "http_route", "span_kind"];

/** The service with its traces stream; any other stream type has no server spans to read. */
export type AddressScope = ServiceScope;

export interface ServiceAddress {
  url: string;
  from: "traces" | "logs";
}

export type AddressState = "idle" | "loading" | "ready" | "error";

/** The newest server span with an address and a health route, null when the schema cannot carry one; span_kind '2' is SERVER. */
export const serviceAddressSql = (scope: AddressScope): string | null => {
  const has = (field: string) => !scope.schema || scope.schema.includes(field);
  const service = pickField(SERVICE_FIELDS, scope.schema);
  if (!service || !REQUIRED_FIELDS.every(has)) return null;
  const filters: [string | null, string[]][] = [
    [scope.cluster, SPAN_CLUSTER_FIELDS],
    [scope.namespace, SPAN_NAMESPACE_FIELDS],
  ];
  const where = [`${sqlField(service)} = ${sqlLiteral(scope.service)}`];
  for (const [value, candidates] of filters) {
    const field = value ? pickField(candidates, scope.schema) : null;
    if (field && value) where.push(`${sqlField(field)} = ${sqlLiteral(value)}`);
  }
  const [address, route, kind] = REQUIRED_FIELDS.map(sqlField);
  where.push(
    `${kind} = '2'`,
    `${address} IS NOT NULL`,
    `(${HEALTH_ROUTES.map((r) => `lower(${route}) LIKE '%${r}%'`).join(" OR ")})`,
  );
  // A stream that records no port still yields a default-port URL, so the port is optional.
  const port = has("server_port") ? sqlField("server_port") : null;
  const groups = [address, ...(port ? [port] : []), route].join(", ");
  return (
    `SELECT ${address}, ${port ?? "NULL AS server_port"}, ${route}, max(_timestamp) AS seen_at` +
    ` FROM ${sqlStream(scope.stream.name)} WHERE ${where.join(" AND ")}` +
    ` GROUP BY ${groups} ORDER BY seen_at DESC LIMIT 1`
  );
};

/** Port 443 reads as https and a default port is left out, so the URL looks like one a person would type. */
export const addressFromRow = (row: Record<string, unknown> | undefined): ServiceAddress | null => {
  const host = typeof row?.server_address === "string" ? row.server_address.trim() : "";
  const route = typeof row?.http_route === "string" ? row.http_route.trim() : "";
  if (!host || !route) return null;
  const port = Number(row?.server_port);
  const https = port === 443;
  const shownPort =
    Number.isInteger(port) && port > 0 && port !== 80 && port !== 443 ? `:${port}` : "";
  const path = route.startsWith("/") ? route : `/${route}`;
  return { url: `${https ? "https" : "http"}://${host}${shownPort}${path}`, from: "traces" };
};

/** One streaming query for the service's health address; empty when the spans carry none. */
export const useServiceAddress = (scope: MaybeRefOrGetter<AddressScope | null>) => {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const address: Ref<ServiceAddress | null> = shallowRef(null);
  const state = ref<AddressState>("idle");
  let running: { traceId: string; org: string } | null = null;

  const cancel = () => {
    if (running)
      cancelStreamQueryBasedOnRequestId({ trace_id: running.traceId, org_id: running.org });
    running = null;
  };

  const load = (current: AddressScope | null) => {
    cancel();
    address.value = null;
    if (!isAutoObserveBuild() || !current?.service || current.stream?.type !== "traces") {
      state.value = "idle";
      return;
    }
    const sql = serviceAddressSql(current);
    if (!sql) {
      state.value = "ready";
      return;
    }
    const org = String(store.state.selectedOrganization?.identifier ?? "");
    const { traceId } = generateTraceContext();
    const mine = { traceId, org };
    running = mine;
    state.value = "loading";
    const end = Date.now() * 1000;
    const settle = (next: AddressState) => {
      if (running !== mine) return;
      running = null;
      state.value = next;
    };
    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(sql),
            start_time: end - ADDRESS_LOOKBACK_US,
            end_time: end,
            from: 0,
            size: 1,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: org,
        pageType: "traces",
        searchType: "ui",
      },
      {
        data: (_payload: unknown, response: any) => {
          if (running !== mine || response?.type !== "search_response_hits") return;
          address.value = addressFromRow(response.content?.results?.hits?.[0]) ?? address.value;
        },
        error: () => settle("error"),
        complete: () => settle("ready"),
      },
    );
  };

  watch(() => toValue(scope), load, { immediate: true, deep: true });
  if (getCurrentScope()) onScopeDispose(cancel);

  return { address, state };
};
