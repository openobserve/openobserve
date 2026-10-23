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

import { raw } from "@/types/i18n";
import type { WorkflowFieldOption } from "./alertFields";

/** The headers a run keeps, in the server's order (`payload.rs` HEADER_ALLOWLIST). */
export const HTTP_HEADER_ALLOWLIST = [
  "content-type",
  "content-length",
  "user-agent",
  "x-request-id",
  "x-correlation-id",
  "traceparent",
  "tracestate",
  "webhook-id",
  "webhook-timestamp",
  "idempotency-key",
  "x-github-event",
  "x-github-delivery",
  "x-event-type",
  "x-o2-dry-run",
] as const;

const SAMPLE_RECEIVED_AT = 1792575542418000;

const field = (path: string): WorkflowFieldOption => ({
  label: raw(path),
  value: path.replace(/\./g, "_"),
  type: "Utf8",
});

// No `data.*`: `data` is always an array and condition column lookup only walks objects.
export const HTTP_REQUEST_PAYLOAD_FIELDS: WorkflowFieldOption[] = [
  field("meta.trigger_source"),
  field("meta.event_type"),
  field("meta.trigger_id"),
  ...HTTP_HEADER_ALLOWLIST.map((name) => field(`meta.headers.${name}`)),
];

/** The fixed fields plus `meta.query.<key>` for each query key the caller sends. */
export function httpRequestPayloadFields(queryKeys: readonly string[] = []): WorkflowFieldOption[] {
  return [...HTTP_REQUEST_PAYLOAD_FIELDS, ...queryKeys.map((key) => field(`meta.query.${key}`))];
}

/** True when a JSON input's first record is an HTTP request (`meta.trigger_source = "http"`). */
export function isHttpRequestInput(text: string | undefined): boolean {
  return httpRequestMeta(text) !== null;
}

/** The query keys of a JSON HTTP request input, so the field pickers can offer `meta.query.<key>`. */
export function httpQueryKeys(text: string | undefined): string[] {
  const query = httpRequestMeta(text)?.query;
  return query && typeof query === "object" && !Array.isArray(query) ? Object.keys(query) : [];
}

/** What every step of an HTTP run receives (`payload.rs` build_input); `received_at` is in µs. */
export function buildHttpRequestSample(
  opts: { trigger_id?: string; run_id?: string; received_at?: number; data?: unknown[] } = {},
): unknown[] {
  return [
    {
      meta: {
        event_type: "webhook",
        trigger_source: "http",
        trigger_id: opts.trigger_id ?? "7fT2kQ9xLmN4pR8sV1wY3z",
        run_id: opts.run_id ?? "0199f3c2-7d1e-7a4b-9c2d-5e6f7a8b9c0d",
        received_at: opts.received_at ?? SAMPLE_RECEIVED_AT,
        query: {},
        headers: { "content-type": "application/json" },
      },
      data: opts.data ?? [{ service: "checkout", deploy_id: "d-4821", reason: "canary failed" }],
    },
  ];
}

function httpRequestMeta(text: string | undefined): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    return null;
  }
  const first: unknown = Array.isArray(parsed) ? parsed[0] : null;
  const meta: unknown =
    first && typeof first === "object" ? (first as { meta?: unknown }).meta : undefined;
  if (!meta || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  return record.trigger_source === "http" ? record : null;
}
