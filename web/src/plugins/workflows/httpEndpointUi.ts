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

import { inject, reactive, type InjectionKey } from "vue";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { HookReasonCode, HookRunStatus, OverlapSeconds } from "@/services/workflows";
import { buildHttpRequestSample } from "./httpRequestSample";
import { bodySizeParts } from "./runStatus";
import type { useWorkflowHttpEndpoint } from "./useWorkflowHttpEndpoint";

export type PayloadFrom = "trigger" | "http";

export type WorkflowHttpEndpoint = ReturnType<typeof useWorkflowHttpEndpoint>;

/** The section provides its endpoint so the reveal, steady and advanced parts share one instance. */
export const HTTP_ENDPOINT_KEY: InjectionKey<WorkflowHttpEndpoint> = Symbol("workflowHttpEndpoint");

const MIB = 1024 * 1024;

/** The default per-org queue cap (`ZO_WORKFLOW_HOOK_ORG_QUEUE_MAX`), named by the `queue_full` fix text. */
export const ORG_QUEUE_MAX = 1000;

/** Editor-wide endpoint state shared by the header, canvas badge, step dialog and Test drawer. */
export const httpEditorState = reactive({
  panelOpen: false,
  endpointOn: false,
  payloadFrom: "trigger" as PayloadFrom,
});

export const HOOK_REASON_KEYS: Record<HookReasonCode, { title: I18nKey; fix: I18nKey }> = {
  invalid_token: {
    title: "workflow.http.reason.invalid_token.title",
    fix: "workflow.http.reason.invalid_token.fix",
  },
  invalid_signature: {
    title: "workflow.http.reason.invalid_signature.title",
    fix: "workflow.http.reason.invalid_signature.fix",
  },
  stale_timestamp: {
    title: "workflow.http.reason.stale_timestamp.title",
    fix: "workflow.http.reason.stale_timestamp.fix",
  },
  credential_in_url: {
    title: "workflow.http.reason.credential_in_url.title",
    fix: "workflow.http.reason.credential_in_url.fix",
  },
  endpoint_disabled: {
    title: "workflow.http.reason.endpoint_disabled.title",
    fix: "workflow.http.reason.endpoint_disabled.fix",
  },
  workflow_disabled: {
    title: "workflow.http.reason.workflow_disabled.title",
    fix: "workflow.http.reason.workflow_disabled.fix",
  },
  workflow_not_published: {
    title: "workflow.http.reason.workflow_not_published.title",
    fix: "workflow.http.reason.workflow_not_published.fix",
  },
  payload_too_large: {
    title: "workflow.http.reason.payload_too_large.title",
    fix: "workflow.http.reason.payload_too_large.fix",
  },
  invalid_idempotency_key: {
    title: "workflow.http.reason.invalid_idempotency_key.title",
    fix: "workflow.http.reason.invalid_idempotency_key.fix",
  },
  idempotency_key_reused: {
    title: "workflow.http.reason.idempotency_key_reused.title",
    fix: "workflow.http.reason.idempotency_key_reused.fix",
  },
  rate_limited: {
    title: "workflow.http.reason.rate_limited.title",
    fix: "workflow.http.reason.rate_limited.fix",
  },
  queue_full: {
    title: "workflow.http.reason.queue_full.title",
    fix: "workflow.http.reason.queue_full.fix",
  },
  worker_unavailable: {
    title: "workflow.http.reason.worker_unavailable.title",
    fix: "workflow.http.reason.worker_unavailable.fix",
  },
};

/** The status code each stored reason answered with (design §7). */
export const HOOK_REASON_STATUS: Record<HookReasonCode, number> = {
  invalid_token: 401,
  invalid_signature: 401,
  stale_timestamp: 401,
  credential_in_url: 400,
  endpoint_disabled: 403,
  workflow_disabled: 403,
  workflow_not_published: 403,
  payload_too_large: 413,
  invalid_idempotency_key: 400,
  idempotency_key_reused: 422,
  rate_limited: 429,
  queue_full: 503,
  worker_unavailable: 503,
};

export const LAST_CALL_STATUS_KEYS: Record<HookRunStatus, I18nKey> = {
  queued: "workflow.http.lastCallStatus.queued",
  running: "workflow.http.lastCallStatus.running",
  succeeded: "workflow.http.lastCallStatus.succeeded",
  failed: "workflow.http.lastCallStatus.failed",
  expired: "workflow.http.lastCallStatus.expired",
};

export const OVERLAP_OPTIONS: { value: OverlapSeconds; labelKey: I18nKey }[] = [
  { value: 0, labelKey: "workflow.http.overlapNow" },
  { value: 3600, labelKey: "workflow.http.overlapHour" },
  { value: 86400, labelKey: "workflow.http.overlapDay" },
  { value: 604800, labelKey: "workflow.http.overlapWeek" },
];

export function openHttpPanel(): void {
  httpEditorState.panelOpen = true;
}

export function resetHttpEditorState(): void {
  httpEditorState.panelOpen = false;
  httpEditorState.endpointOn = false;
  httpEditorState.payloadFrom = "trigger";
}

/** True while the author previews steps with the HTTP request instead of the kind's event. */
export function usesHttpPayload(): boolean {
  return httpEditorState.endpointOn && httpEditorState.payloadFrom === "http";
}

/** The HTTP request an author previews before any run; the Test drawer uses trigger id "test". */
export function httpPreviewSample(triggerId?: string): unknown[] {
  return buildHttpRequestSample(triggerId ? { trigger_id: triggerId } : {});
}

export function useHttpEndpoint(): WorkflowHttpEndpoint {
  const endpoint = inject(HTTP_ENDPOINT_KEY);
  if (!endpoint) throw new Error("useHttpEndpoint needs WorkflowHttpEndpointSection");
  return endpoint;
}

/** The server's message when it sent one, else the generic unknown-error copy. */
export function httpErrorText(err: unknown, t: TranslateFn): I18nText {
  const e = err as { response?: { data?: { message?: string } }; message?: string } | null;
  return raw(e?.response?.data?.message ?? e?.message) || t("common.unknownError");
}

/** Whole mebibytes read as MiB, everything else through the run view's B / KiB formatter. */
export function formatBodySize(bytes: number, t: TranslateFn): I18nText {
  if (bytes >= MIB && bytes % MIB === 0)
    return t("workflow.http.bodySizeMiB", { size: bytes / MIB });
  const { key, size } = bodySizeParts(bytes);
  return t(key, { size });
}
