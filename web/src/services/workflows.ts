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

import http from "./http";
import analytics from "./product_analytics";
import { newWebhookId, signWebhook } from "@/plugins/workflows/httpSigning";

// HTTP endpoint shapes mirror src/core/src/workflows/http_trigger/manage.rs and request/workflows/{http_trigger,mod}.rs.
export type HttpAuthMode = "token" | "signature";
export type HttpCredentialKind = "token" | "signing_secret";
export type HttpCredentialState = "active" | "retiring" | "revoked";
export type HookRunStatus = "queued" | "running" | "succeeded" | "failed" | "expired";
export type HookReasonCode =
  | "invalid_token"
  | "invalid_signature"
  | "stale_timestamp"
  | "credential_in_url"
  | "endpoint_disabled"
  | "workflow_disabled"
  | "workflow_not_published"
  | "payload_too_large"
  | "invalid_idempotency_key"
  | "idempotency_key_reused"
  | "rate_limited"
  | "queue_full"
  | "worker_unavailable";

export interface HttpTriggerPermissions {
  edit: boolean;
  test: boolean;
  /** PUT on the workflow and credential access (Admin/Root when OpenFGA is off). */
  reveal: boolean;
}

/** Times are Unix microseconds. */
export interface HttpCredential {
  id: string;
  kind: HttpCredentialKind;
  display_prefix: string;
  state: HttpCredentialState;
  expires_at: number | null;
  created_by: string;
  creator_in_org: boolean;
  created_at: number;
  last_used_at: number | null;
}

export interface HttpRejection {
  count_24h: number;
  last_at: number;
  last_ip: string;
  window_start: number;
}

export interface HttpLastCall {
  run_id: string;
  status: HookRunStatus;
  received_at: number;
}

export interface HttpTriggerConfig {
  configured: true;
  id: string;
  url: string;
  region_host: string | null;
  enabled: boolean;
  auth_mode: HttpAuthMode;
  max_body_bytes: number;
  rate_limit_per_minute: number;
  org_rate_limit_per_minute: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  last_invoked_at: number | null;
  last_call: HttpLastCall | null;
  secrets_encrypted_at_rest: boolean;
  rejections: Partial<Record<HookReasonCode, HttpRejection>>;
  credentials: HttpCredential[];
  permissions: HttpTriggerPermissions;
}

export interface HttpTriggerAbsent {
  configured: false;
  org_rate_limit_per_minute: number;
  secrets_encrypted_at_rest: boolean;
  permissions: HttpTriggerPermissions;
}

export type HttpTriggerState = HttpTriggerConfig | HttpTriggerAbsent;

export interface PutHttpTriggerPayload {
  enabled: boolean;
  auth_mode: HttpAuthMode;
  max_body_bytes?: number;
  rate_limit_per_minute?: number;
}

/** The server flattens `SecretResponse` (`#[serde(flatten)]`), so the secret sits beside the body. */
export type WithSecret<T> = T & { secret: string | null };

export interface HttpCredentialSecret {
  id: string;
  kind: HttpCredentialKind;
  display_prefix: string;
  state: HttpCredentialState;
  expires_at: number | null;
  secret: string;
}

export interface HttpRequestFacts {
  credential_prefix: string;
  caller_ip: string;
  idempotency_key: string | null;
  content_type: string | null;
  body_bytes: number;
  status: HookRunStatus;
  error: string | null;
}

/** One history row; `status` is normalised by the server, `error` is display text only. */
export interface WorkflowHistoryRow {
  _timestamp: number;
  org: string;
  start_time: number;
  end_time: number;
  evaluation_took_in_secs: number;
  source_node: string;
  key: string;
  error: string | null;
  /** `WorkflowTriggerType` name: AlertFired, IncidentEvent, Webhook, Manual, Test, Retry, … */
  event_type: string;
  source_id: string;
  run_id: string;
  status: HookRunStatus;
  http_request?: HttpRequestFacts;
}

/** The list API's per-row endpoint flag; false whenever hooks are off on the server. */
export interface WorkflowListHttpFields {
  http_endpoint_enabled?: boolean;
}

export interface DryRunResult {
  status: number;
  reason: HookReasonCode | "unauthorized" | null;
  input: { meta: Record<string, unknown>; data: unknown[] } | null;
  bodyBytes: number;
}

export type OverlapSeconds = 0 | 3600 | 86400 | 604800;

export interface HttpTriggerRef {
  org_identifier: string;
  id: string;
}

export interface WorkflowHttpTriggerApi {
  getHttpTrigger(args: HttpTriggerRef): Promise<HttpTriggerState>;
  putHttpTrigger(
    args: HttpTriggerRef & { payload: PutHttpTriggerPayload },
  ): Promise<WithSecret<HttpTriggerConfig>>;
  deleteHttpTrigger(args: HttpTriggerRef): Promise<void>;
  rotateHttpCredential(
    args: HttpTriggerRef & { overlap_seconds: OverlapSeconds },
  ): Promise<WithSecret<HttpCredential>>;
  revokeHttpCredential(args: HttpTriggerRef & { credential_id: string }): Promise<void>;
  revealHttpCredentialSecret(
    args: HttpTriggerRef & { credential_id: string },
  ): Promise<HttpCredentialSecret>;
}

const HOOK_REASON_CODES: ReadonlySet<string> = new Set<HookReasonCode | "unauthorized">([
  "unauthorized",
  "invalid_token",
  "invalid_signature",
  "stale_timestamp",
  "credential_in_url",
  "endpoint_disabled",
  "workflow_disabled",
  "workflow_not_published",
  "payload_too_large",
  "invalid_idempotency_key",
  "idempotency_key_reused",
  "rate_limited",
  "queue_full",
  "worker_unavailable",
]);

const triggerUrl = ({ org_identifier, id }: HttpTriggerRef) =>
  `/api/${org_identifier}/workflows/${id}/http_trigger`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

// The 404 body still carries what the caller may do, so the off state can render without a second read.
const notConfigured = (err: unknown): HttpTriggerAbsent | null => {
  const response = asRecord(asRecord(err)?.response);
  const data = asRecord(response?.data);
  if (response?.status !== 404 || data?.error_detail !== "not_configured") return null;
  return {
    configured: false,
    permissions: data.permissions as HttpTriggerPermissions,
    org_rate_limit_per_minute: data.org_rate_limit_per_minute as number,
    secrets_encrypted_at_rest: data.secrets_encrypted_at_rest as boolean,
  };
};

const httpTriggerApi: WorkflowHttpTriggerApi = {
  // A 200 body is `TriggerView`, which has no `configured` field of its own.
  getHttpTrigger: async (target) => {
    try {
      const res = await http().get(triggerUrl(target));
      return { ...res.data, configured: true };
    } catch (err) {
      const absent = notConfigured(err);
      if (absent) return absent;
      throw err;
    }
  },

  putHttpTrigger: async ({ payload, ...target }) => {
    const res = await http().put(triggerUrl(target), payload);
    return { ...res.data, configured: true };
  },

  deleteHttpTrigger: async (target) => {
    await http().delete(triggerUrl(target));
  },

  rotateHttpCredential: async ({ overlap_seconds, ...target }) =>
    (await http().post(`${triggerUrl(target)}/credentials`, { overlap_seconds })).data,

  revokeHttpCredential: async ({ credential_id, ...target }) => {
    await http().delete(`${triggerUrl(target)}/credentials/${credential_id}`);
  },

  // Sent with `Cache-Control: no-store`; callers read it once and drop it (AC-WEB-10).
  revealHttpCredentialSecret: async ({ credential_id, ...target }) =>
    (await http().get(`${triggerUrl(target)}/credentials/${credential_id}/secret`)).data,
};

const workflows = {
  // List the org's workflows in one folder. Omitting `folder` lets the backend
  // fall back to the default folder, which is what pre-folders clients sent.
  // `allFolders` lists across every folder the caller may see and takes
  // precedence over `folder`. `searchSubstring` is matched against name and
  // description in the database, so a cross-folder search does not require
  // loading every workflow first.
  listWorkflows: (
    org_identifier: string,
    folder?: string,
    allFolders = false,
    searchSubstring?: string,
  ) => {
    const params = new URLSearchParams();
    if (allFolders) params.set("all_folders", "true");
    else if (folder) params.set("folder", folder);
    if (searchSubstring) params.set("search_substring", searchSubstring);
    const qs = params.toString();
    return http().get(`/api/${org_identifier}/workflows${qs ? `?${qs}` : ""}`);
  },

  // Save a new workflow. `draft=true` saves to the drafts table WITHOUT the
  // backend graph validation (no terminating node / orphan checks) — a draft can
  // be an incomplete graph. Omit or false for a validated, published workflow.
  // `folder` is the destination folder's id and applies to drafts too: a draft
  // without one lands in the default folder rather than the one being viewed.
  createWorkflow: ({
    org_identifier,
    data,
    draft = false,
    folder,
  }: {
    org_identifier: string;
    data: object;
    draft?: boolean;
    folder?: string;
  }) => {
    const params = new URLSearchParams();
    if (draft) params.set("draft", "true");
    if (folder) params.set("folder", folder);
    const qs = params.toString();
    return http()
      .post(`/api/${org_identifier}/workflows${qs ? `?${qs}` : ""}`, data)
      .then((res) => {
        analytics.track("workflow_created", { draft: !!draft });
        return res;
      });
  },

  // Update an existing workflow by id. `draft=true` updates the drafts-table row
  // (no validation); false updates the published workflow (validated).
  updateWorkflow: ({
    org_identifier,
    id,
    data,
    draft = false,
  }: {
    org_identifier: string;
    id: string;
    data: object;
    draft?: boolean;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}${draft ? "?draft=true" : ""}`;
    return http().put(url, data);
  },

  // Delete a workflow by id. `draft=true` deletes from the drafts table.
  deleteWorkflow: ({
    org_identifier,
    id,
    draft = false,
  }: {
    org_identifier: string;
    id: string;
    draft?: boolean;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}${draft ? "?draft=true" : ""}`;
    return http()
      .delete(url)
      .then((res) => {
        analytics.track("workflow_deleted", { draft: !!draft, count: 1 });
        return res;
      });
  },

  // Promote a draft into a proper (published) workflow. The backend re-validates
  // the graph and returns 400 if it's still incomplete; on success it moves the
  // row from the drafts table to the workflows table KEEPING the same id.
  // `trigger_type` (AlertFired | IncidentEvent) mirrors the create payload's
  // trigger_type and drives the incident association. Omitting `folder` publishes
  // the draft into the folder it already sits in.
  promoteWorkflow: ({
    org_identifier,
    id,
    trigger_type,
    folder,
  }: {
    org_identifier: string;
    id: string;
    trigger_type: string;
    folder?: string;
  }) => {
    const params = new URLSearchParams({ trigger_type });
    if (folder) params.set("folder", folder);
    return http()
      .post(`/api/${org_identifier}/workflows/promote/${id}?${params.toString()}`)
      .then((res) => {
        analytics.track("workflow_published");
        return res;
      });
  },

  // Enable/disable (pause/resume) a workflow.
  enableWorkflow: ({
    org_identifier,
    id,
    value,
  }: {
    org_identifier: string;
    id: string;
    value: boolean;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/enable?value=${value}`;
    return http().put(url);
  },

  // Dry-run a workflow against a sample payload WITHOUT persisting it — the full
  // in-memory `workflow` graph is sent in the body, so testing works whether the
  // workflow is saved or not. `from_node` re-runs from a specific node. The
  // backend generates a throwaway id/org for the run, so no workflow id is sent.
  testWorkflow: ({
    org_identifier,
    workflow,
    inputs,
    from_node,
    draft = false,
    suppress_destinations = true,
  }: {
    org_identifier: string;
    workflow: any;
    inputs: any[];
    from_node?: string;
    // `draft=true` when dry-running a draft / unsaved graph, so the backend skips
    // the strict published-workflow validation for the test run.
    draft?: boolean;
    // Defaults to true so a caller that forgets the flag cannot page on-call.
    suppress_destinations?: boolean;
  }) => {
    const url = `/api/${org_identifier}/workflows/test${draft ? "?draft=true" : ""}`;
    return http()
      .post(url, { workflow, inputs, from_node, suppress_destinations })
      .then((res) => {
        analytics.track("workflow_test_run_completed", { from_node: !!from_node });
        return res;
      });
  },

  // Run history for a workflow. `start_time`/`end_time` are Unix microseconds;
  // the backend defaults to the last 7 days when omitted. Returns an array of
  // runs ({ _timestamp, start_time, end_time, evaluation_took_in_secs, error,
  // event_type, source_id, run_id, ... }); `error` is null on success.
  getWorkflowHistory: ({
    org_identifier,
    id,
    start_time,
    end_time,
  }: {
    org_identifier: string;
    id: string;
    start_time?: number;
    end_time?: number;
  }) => {
    const params = new URLSearchParams();
    if (start_time != null) params.set("start_time", String(start_time));
    if (end_time != null) params.set("end_time", String(end_time));
    const qs = params.toString();
    const url = `/api/${org_identifier}/workflows/${id}/history${qs ? `?${qs}` : ""}`;
    return http().get(url);
  },

  // Detail of a single run — errors (per errored node) plus the run's input
  // data (`complete` = full workflow input, `error_node_map` = per-node input the
  // node processed/errored on). Powers the read-only run inspection in the
  // editor (click a run in history -> error nodes show Input/Output).
  getWorkflowRun: ({
    org_identifier,
    id,
    run_id,
  }: {
    org_identifier: string;
    id: string;
    run_id: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/errors/${run_id}`;
    return http().get(url);
  },

  // Re-run a failed run, optionally from a specific node.
  retryWorkflow: ({
    org_identifier,
    id,
    run_id,
    from_node,
  }: {
    org_identifier: string;
    id: string;
    run_id: string;
    from_node?: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/retry`;
    return http()
      .post(url, { run_id, from_node })
      .then((res) => {
        analytics.track("workflow_run_retried", { from_node: !!from_node });
        return res;
      });
  },

  ...httpTriggerApi,
};

/** Calls the public hook URL with `X-O2-Dry-Run`; plain fetch, so a 401/403 never reaches the app client's logout, refresh or 403 toast. */
export async function dryRunHook(args: {
  url: string;
  auth: { mode: "token"; token: string } | { mode: "signature"; secret: string };
  body: string;
  contentType: string;
}): Promise<DryRunResult> {
  const headers: Record<string, string> = {
    "Content-Type": args.contentType,
    "X-O2-Dry-Run": "true",
  };
  if (args.auth.mode === "token") {
    headers.Authorization = `Bearer ${args.auth.token}`;
  } else {
    const id = newWebhookId();
    const timestamp = Math.floor(Date.now() / 1000);
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = String(timestamp);
    headers["webhook-signature"] = await signWebhook(args.auth.secret, id, timestamp, args.body);
  }
  const res = await fetch(args.url, {
    method: "POST",
    headers,
    body: args.body,
    credentials: "omit",
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(await res.text()));
  } catch {
    parsed = null;
  }
  const ok = res.status >= 200 && res.status < 300;
  const detail = parsed?.error_detail;
  const input = asRecord(parsed?.input);
  return {
    status: res.status,
    reason:
      !ok && typeof detail === "string" && HOOK_REASON_CODES.has(detail)
        ? (detail as DryRunResult["reason"])
        : null,
    input:
      ok && input && Array.isArray(input.data)
        ? { meta: asRecord(input.meta) ?? {}, data: input.data }
        : null,
    bodyBytes: new TextEncoder().encode(args.body).length,
  };
}

export default workflows;
