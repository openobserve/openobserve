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

import type {
  AssistantError,
  AssistantErrorAction,
  AssistantErrorCode,
} from "./assistantStore.types";

// WP-01's AssistantError has no slot for the provider reason the `provider_error` title names (`80` §1.3).
declare module "./assistantStore.types" {
  interface AssistantError {
    reason?: ProviderReason;
    /** Which switch an `rca_disabled` refusal names. */
    rcaReason?: RcaDisabledReason;
  }
}

/** Every `assistant.error.<code>` namespace; a spec pins it to `en-US.json`. */
export const ASSISTANT_ERROR_CODES = [
  "offline",
  "unreachable",
  "session_expired",
  "permission_denied",
  "not_enabled",
  "credits_exhausted",
  "subscription_required",
  "consent_declined",
  "consent_still_required",
  "stopped_before_send",
  "authorization_unavailable",
  "turn_limit",
  "rate_limited",
  "turn_busy",
  "already_submitted",
  "agent_unavailable",
  "provider_error",
  "stream_dropped",
  "session_owner_unavailable",
  "restore_required",
  "stale_epoch",
  "empty_response",
  "persistence_failed",
  "cancelled_elsewhere",
  "signed_out",
  "approval_expired",
  "approval_delivery_failed",
  "stream_oversized",
  "unknown",
  "history_unavailable",
  "off_for_org",
  "data_level_blocked",
  "permission_denied_tool",
  "approval_elsewhere",
  "account_changed",
  "rca_disabled",
  "analysis_in_progress",
] as const satisfies readonly AssistantErrorCode[];

/** `80` §1.3; role-split codes carry the admin action, the member one is `.actionMember`. */
export const ERROR_LEDGER: Record<AssistantErrorCode, ErrorLedgerRow> = {
  offline: { phase: "pre_admission", retryable: true, action: "retry" },
  unreachable: { phase: "pre_admission", retryable: true, action: "retry" },
  session_expired: { phase: "pre_admission", retryable: false, action: "sign_in" },
  permission_denied: { phase: "pre_admission", retryable: false, action: "open_iam_roles" },
  not_enabled: { phase: "pre_admission", retryable: false, action: "open_settings" },
  credits_exhausted: { phase: "pre_admission", retryable: false, action: "manage_usage" },
  subscription_required: { phase: "pre_admission", retryable: false, action: "view_plans" },
  consent_declined: { phase: "pre_admission", retryable: false, action: "none" },
  consent_still_required: { phase: "pre_admission", retryable: false, action: "manage_usage" },
  stopped_before_send: { phase: "pre_admission", retryable: true, action: "retry" },
  authorization_unavailable: { phase: "pre_admission", retryable: true, action: "retry" },
  turn_limit: { phase: "pre_admission", retryable: true, action: "retry" },
  rate_limited: { phase: "pre_admission", retryable: true, action: "retry" },
  turn_busy: { phase: "pre_admission", retryable: false, action: "stop_it" },
  already_submitted: { phase: "pre_admission", retryable: false, action: "reload_chat" },
  agent_unavailable: { phase: "post_admission", retryable: true, action: "retry" },
  provider_error: { phase: "post_admission", retryable: true, action: "retry" },
  stream_dropped: { phase: "post_admission", retryable: true, action: "retry" },
  session_owner_unavailable: { phase: "post_admission", retryable: true, action: "retry" },
  restore_required: { phase: "post_admission", retryable: false, action: "reload_chat" },
  stale_epoch: { phase: "post_admission", retryable: false, action: "reload_chat" },
  empty_response: { phase: "post_admission", retryable: true, action: "retry" },
  persistence_failed: { phase: "post_admission", retryable: false, action: "retry_save" },
  cancelled_elsewhere: { phase: "post_admission", retryable: false, action: "none" },
  signed_out: { phase: "post_admission", retryable: false, action: "sign_in" },
  approval_expired: { phase: "post_admission", retryable: false, action: "ask_again" },
  approval_delivery_failed: { phase: "post_admission", retryable: true, action: "send_again" },
  stream_oversized: { phase: "post_admission", retryable: true, action: "retry" },
  unknown: { phase: "post_admission", retryable: true, action: "retry" },
  history_unavailable: { phase: "pre_admission", retryable: true, action: "retry" },
  off_for_org: { phase: "pre_admission", retryable: false, action: "open_settings" },
  data_level_blocked: { phase: "post_admission", retryable: false, action: "change_level" },
  permission_denied_tool: { phase: "post_admission", retryable: false, action: "open_settings" },
  approval_elsewhere: { phase: "pre_admission", retryable: false, action: "none" },
  account_changed: { phase: "pre_admission", retryable: false, action: "none" },
  rca_disabled: { phase: "pre_admission", retryable: false, action: "ask_admin" },
  analysis_in_progress: { phase: "pre_admission", retryable: false, action: "none" },
};

/** The closed `action` vocabulary of the B-01 envelope; the client words every button from the code (WP-17). */
export const WIRE_ACTIONS = [
  "retry",
  "sign_in",
  "enable_paid_usage",
  "manage_billing",
  "ask_admin",
  "reload",
  "none",
] as const;

// Refusals this tab makes itself under a cross-tab lock; the server never sends them, so the wire never yields them.
const CLIENT_ONLY_CODES: ReadonlySet<string> = new Set(["approval_elsewhere", "account_changed"]);

const CODES: ReadonlySet<string> = new Set(ASSISTANT_ERROR_CODES);

const WIRE_ACTION_SET: ReadonlySet<string> = new Set(WIRE_ACTIONS);

// Read only when the code names no button of its own (`unknown`); every ledger code keeps its row's action.
const WIRE_ACTION_MEANING: Record<WireAction, AssistantErrorAction> = {
  retry: "retry",
  sign_in: "sign_in",
  enable_paid_usage: "manage_usage",
  manage_billing: "manage_usage",
  ask_admin: "ask_admin",
  reload: "reload_chat",
  none: "none",
};

/** B-01 and stored-turn spellings that name a ledger code differently. */
const CODE_ALIASES: Record<string, AssistantErrorCode> = {
  agent_unreachable: "agent_unavailable",
  consent_required: "consent_declined",
  credit_exhausted: "credits_exhausted",
  lease_conflict: "turn_busy",
};

const AGENT_DOWN_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

// The fixed reason map of HT §0.2, read from the typed `error_type`/`category`, never the message.
const PROVIDER_REASONS: [RegExp, ProviderReason][] = [
  [/overload|capacity|rate_limit/i, "overloaded"],
  [/timeout|timed_out/i, "timed_out"],
  [/model_(not_found|unavailable)/i, "model_unavailable"],
  [/too_large|context_length|too_long/i, "request_too_large"],
];

export type WireAction = (typeof WIRE_ACTIONS)[number];

export type ProviderReason = "overloaded" | "timed_out" | "model_unavailable" | "request_too_large";

export type RcaDisabledReason = "rca_off" | "priority_off";

/** One row of the ledger of `80` §1.3: the code's phase, whether Retry applies and its one action. */
export interface ErrorLedgerRow {
  phase: "pre_admission" | "post_admission";
  retryable: boolean;
  action: AssistantErrorAction;
}

/** The raw fields a wire body may carry; every one is optional. */
interface WireBody {
  type?: unknown;
  code?: unknown;
  category?: unknown;
  error_code?: unknown;
  error_type?: unknown;
  remedy?: unknown;
  message?: unknown;
  error?: unknown;
  recoverable?: unknown;
  retryable?: unknown;
  retry_after?: unknown;
  action?: unknown;
  trace_id?: unknown;
  turn_id?: unknown;
  session_id?: unknown;
  active_turn_id?: unknown;
  consent?: unknown;
  reason?: unknown;
}

interface ErrorInput {
  status?: number;
  body: WireBody;
}

/** Maps a fetch rejection, `{status, body}`, an axios error, an `error` frame or a stored turn error to one ledger entry. */
export function toAssistantError(
  input: unknown,
  ctx: { phase?: AssistantError["phase"]; turnId?: string; traceId?: string } = {},
): AssistantError {
  if (isAssistantError(input)) return input;
  if (isFetchRejection(input)) {
    const code = isOffline() ? "offline" : "unreachable";
    return build(code, { status: undefined, body: {} }, ctx);
  }
  const normalised = normalise(input);
  return build(codeOf(normalised), normalised, ctx);
}

export function isWireAction(value: unknown): value is WireAction {
  return typeof value === "string" && WIRE_ACTION_SET.has(value);
}

export function isAssistantErrorCode(value: unknown): value is AssistantErrorCode {
  return typeof value === "string" && CODES.has(value) && !CLIENT_ONLY_CODES.has(value);
}

/** A 412 with `error_type` and a `consent` payload is the consent prompt, never a refusal (constraint 30). */
export function isConsentPrompt(status: number | undefined, body: unknown): boolean {
  const b = (body ?? {}) as WireBody;
  if (status !== 412) return false;
  if (b.code === "consent_required") return true;
  return b.error_type === "paid_overage_consent_required" && !!b.consent;
}

function build(
  code: AssistantErrorCode,
  { status, body }: ErrorInput,
  ctx: { phase?: AssistantError["phase"]; turnId?: string; traceId?: string },
): AssistantError {
  const row = ERROR_LEDGER[code];
  const error: AssistantError = {
    code,
    phase: phaseOf(code, row, ctx.phase),
    retryable: retryableOf(code, row, body),
    action: actionOf(code, row, body),
  };
  if (status !== undefined) error.httpStatus = status;
  const serverMessage = textOf(body.message) ?? textOf(body.error);
  if (serverMessage) error.serverMessage = serverMessage;
  const traceId = textOf(body.trace_id) ?? ctx.traceId;
  if (traceId) error.traceId = traceId;
  // For `turn_busy` the turn id is the running one, so "Stop it" never cancels the refused turn instead (B-03).
  const turnId =
    code === "turn_busy" ? textOf(body.active_turn_id) : (textOf(body.turn_id) ?? ctx.turnId);
  if (turnId) error.turnId = turnId;
  const sessionId = textOf(body.session_id);
  if (sessionId) error.sessionId = sessionId;
  if (code === "rate_limited" && typeof body.retry_after === "number")
    error.retryAfterMs = body.retry_after * 1000;
  const reason = code === "provider_error" ? providerReason(body) : null;
  if (reason) error.reason = reason;
  if (code === "rca_disabled" && (body.reason === "rca_off" || body.reason === "priority_off"))
    error.rcaReason = body.reason;
  return error;
}

function phaseOf(
  code: AssistantErrorCode,
  row: ErrorLedgerRow,
  phase: AssistantError["phase"] | undefined,
): AssistantError["phase"] {
  if (phase === "read" || phase === "mutation" || phase === "client") return phase;
  return code === "unknown" && phase ? phase : row.phase;
}

function retryableOf(code: AssistantErrorCode, row: ErrorLedgerRow, body: WireBody): boolean {
  if (typeof body.retryable === "boolean") return body.retryable;
  if (code === "provider_error" && typeof body.recoverable === "boolean") return body.recoverable;
  return row.retryable;
}

function actionOf(
  code: AssistantErrorCode,
  row: ErrorLedgerRow,
  body: WireBody,
): AssistantErrorAction {
  // A provider failure that would fail again unchanged offers Edit and resend; the wire says `retryable:false`, today's body `recoverable:false`.
  if (code === "provider_error" && (body.recoverable === false || body.retryable === false))
    return "edit_resend";
  if (code === "unknown" && isWireAction(body.action)) return WIRE_ACTION_MEANING[body.action];
  return row.action;
}

function codeOf({ status, body }: ErrorInput): AssistantErrorCode {
  // Constraint 12: a 403 is the role, whatever the body says.
  if (status === 403) return "permission_denied";
  if (isConsentPrompt(status, body)) return "consent_declined";
  const named = namedCode(body);
  if (named) return named;
  if (status !== undefined) return statusCode(status, body);
  return frameCode(body);
}

// B-01 envelope codes, the string `code`/`category` of shapes C/M1/M2 and the `error_code` of D/F/I2.
function namedCode(body: WireBody): AssistantErrorCode | null {
  for (const value of [body.code, body.category, body.error_code]) {
    if (typeof value !== "string") continue;
    if (CODE_ALIASES[value]) return CODE_ALIASES[value];
    if (isAssistantErrorCode(value)) return value;
  }
  return null;
}

function statusCode(status: number, body: WireBody): AssistantErrorCode {
  const message = textOf(body.message) ?? "";
  if (status === 401) return "session_expired";
  if (status === 402)
    return body.remedy === "subscribe" ? "subscription_required" : "credits_exhausted";
  if (status === 429) return "rate_limited";
  // The 409s and the 400 differ only by their fixed server sentence until B-01 (`80` §1.3).
  if (status === 409)
    return message.includes("already submitted") ? "already_submitted" : "turn_busy";
  if (status === 400) return message.startsWith("AI is not enabled") ? "not_enabled" : "unknown";
  if (status === 500)
    return message.startsWith("Confirmation failed") ? "approval_delivery_failed" : "unknown";
  // Shape A (`trial_quota.rs:1284`) carries `message`; shape B (the upstream proxy) carries `error`.
  if (status === 503 && body.error === undefined && message) return "authorization_unavailable";
  if (AGENT_DOWN_STATUSES.has(status)) return "agent_unavailable";
  return "unknown";
}

// Shapes H/I1/I2/J: an `error` frame with no ledger code is the provider when typed, else the transport.
function frameCode(body: WireBody): AssistantErrorCode {
  if (body.type !== "error") return "unknown";
  if (typeof body.error_type === "string" && body.error_type.startsWith("llm"))
    return "provider_error";
  if (body.category === "llm") return "provider_error";
  return textOf(body.error) || textOf(body.message) ? "agent_unavailable" : "unknown";
}

function normalise(input: unknown): ErrorInput {
  if (!input || typeof input !== "object") return { status: undefined, body: {} };
  const value = input as {
    status?: unknown;
    body?: unknown;
    response?: { status?: unknown; data?: unknown };
  };
  if (value.response && typeof value.response === "object") {
    return { status: numberOf(value.response.status), body: bodyOf(value.response.data) };
  }
  if ("body" in value && !("type" in value))
    return { status: numberOf(value.status), body: bodyOf(value.body) };
  return { status: undefined, body: bodyOf(value) };
}

function bodyOf(value: unknown): WireBody {
  return value && typeof value === "object" ? (value as WireBody) : {};
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isAssistantError(input: unknown): input is AssistantError {
  const value = input as Partial<AssistantError> | null;
  return (
    !!value &&
    typeof value === "object" &&
    isAssistantErrorCode(value.code) &&
    typeof value.phase === "string" &&
    typeof value.action === "string"
  );
}

function isFetchRejection(input: unknown): boolean {
  return input instanceof TypeError || (input instanceof Error && input.name === "NetworkError");
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function providerReason(body: WireBody): ProviderReason | null {
  const typed = [body.error_type, body.category].filter((v): v is string => typeof v === "string");
  for (const [pattern, reason] of PROVIDER_REASONS)
    if (typed.some((value) => pattern.test(value))) return reason;
  return null;
}
