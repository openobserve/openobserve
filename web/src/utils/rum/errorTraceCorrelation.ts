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

import { normalizeTraceId, rumField } from "./fields";

type RumEvent = Record<string, unknown>;

const REQUEST_TIME_TOLERANCE_US = 1_000_000;

function isRecord(value: unknown): value is RumEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string {
  return (
    values
      .find((value): value is string => typeof value === "string" && value.trim() !== "")
      ?.trim() ?? ""
  );
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function resourceField(event: RumEvent, name: string): unknown {
  return event[`resource_${name}`] ?? (isRecord(event.resource) ? event.resource[name] : undefined);
}

function requestMatches(left: string, right: string): boolean {
  try {
    const expected = new URL(left, "http://rum.invalid");
    const actual = new URL(right, "http://rum.invalid");
    const sameOrigin =
      expected.origin === "http://rum.invalid" || expected.origin === actual.origin;
    return (
      sameOrigin &&
      expected.pathname === actual.pathname &&
      (!expected.search || expected.search === actual.search)
    );
  } catch {
    return false;
  }
}

export function errorTraceId(error: RumEvent): string {
  const directTrace = normalizeTraceId(rumField<unknown>(error, "trace_id"));
  if (directTrace) return directTrace;

  const errorResource =
    isRecord(error.error) && isRecord(error.error.resource) ? error.error.resource : {};
  const context = isRecord(error.context) ? error.context : {};
  const url = firstString(
    error.error_resource_url,
    errorResource.url,
    error.context_request_url,
    error.context_url,
    context.url,
  );
  const method = firstString(
    error.error_resource_method,
    errorResource.method,
    error.context_request_method,
    error.context_method,
    context.method,
  ).toUpperCase();
  const status = [
    error.error_resource_status_code,
    errorResource.status_code,
    error.context_http_status,
    error.context_responsestatus,
  ]
    .map(numeric)
    .find((value) => value !== undefined);
  const timestamp = numeric(error._timestamp);
  if (!url || !method || timestamp === undefined || !Array.isArray(error.events)) return "";

  const traces = new Set<string>();
  for (const event of error.events) {
    if (!isRecord(event) || event.type !== "resource") continue;
    if (!["xhr", "fetch"].includes(firstString(resourceField(event, "type")))) continue;
    if (firstString(resourceField(event, "method")).toUpperCase() !== method) continue;
    if (!requestMatches(url, firstString(resourceField(event, "url")))) continue;
    if (status !== undefined && numeric(resourceField(event, "status_code")) !== status) continue;

    const resourceTime = numeric(event._timestamp);
    if (resourceTime === undefined) continue;
    const durationUs = Math.max(0, numeric(resourceField(event, "duration")) ?? 0) / 1000;
    const distance = Math.min(
      Math.abs(timestamp - resourceTime),
      Math.abs(timestamp - resourceTime - durationUs),
    );
    if (distance > REQUEST_TIME_TOLERANCE_US) continue;
    const trace = normalizeTraceId(rumField<unknown>(event, "trace_id"));
    if (!trace) return "";
    traces.add(trace);
  }

  // A session can contain concurrent requests to the same endpoint; ambiguous evidence must not select a trace.
  return traces.size === 1 ? (traces.values().next().value ?? "") : "";
}
