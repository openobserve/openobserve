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
  ApprovalScope,
  AssistantErrorCode,
  AssistantHint,
  CreditMode,
  DockHostId,
  EntryKind,
  EntryVerb,
  GateCode,
  GateReason,
  ObjectKind,
  Sid,
  TelemetryContainer,
  TurnInput,
  ChipKind,
} from "@/composables/assistant";
import analytics from "@/services/product_analytics";

declare global {
  interface Window {
    __O2_TELEMETRY_SINK__?: boolean;
    __o2telemetry?: TrackedEvent[];
  }
}

/** Every event of `99` §3.3; a name not listed here does not exist. */
export const AI_EVENT_NAMES = [
  "ai_entry_clicked",
  "ai_gate_blocked",
  "ai_container_opened",
  "ai_container_moved",
  "ai_container_closed",
  "ai_panel_resized",
  "ai_panel_mode_changed",
  "ai_sheet_snap",
  "ai_toast",
  "ai_turn_busy",
  "ai_leave_guard",
  "ai_status_light",
  "ai_context_changed",
  "ai_context_inspected",
  "ai_composer_recall",
  "ai_composer_cap_hit",
  "ai_composer_enter_blocked",
  "ai_composer_cleared",
  "ai_turn_sent",
  "ai_turn_first_byte",
  "ai_turn_state",
  "ai_turn_ended",
  "ai_turn_recovered",
  "ai_stop",
  "ai_scroll_jump",
  "ai_transcript_window",
  "ai_block_invalid",
  "ai_evidence_action",
  "ai_downstream_saved",
  "ai_approval_shown",
  "ai_approval_decided",
  "ai_approval_result",
  "ai_approval_expired",
  "ai_policy_notice",
  "ai_undo",
  "ai_navigation",
  "ai_nl_proposal",
  "ai_nl_decided",
  "ai_feedback",
  "ai_thread_action",
  "ai_history_open",
  "ai_history_search",
  "ai_share",
  "ai_shared_view",
  "ai_fork",
  "ai_local_import",
  "ai_consent",
  "ai_credit_notice",
  "ai_shortcut",
  "ai_welcome_shown",
  "ai_welcome_starter",
  "ai_admin",
  "ai_org_switch_with_turns",
  "ai_sign_out_with_turns",
  "ai_cross_tab_hint",
  "ai_frame_unknown",
] as const;

/** Events that belong to one turn and must carry its `turn_id`. */
export const TURN_SCOPED_EVENTS = [
  "ai_turn_sent",
  "ai_turn_first_byte",
  "ai_turn_state",
  "ai_turn_ended",
  "ai_turn_recovered",
  "ai_stop",
  "ai_turn_busy",
  "ai_feedback",
  "ai_approval_shown",
  "ai_approval_decided",
  "ai_approval_result",
  "ai_approval_expired",
] as const;

/** `99` §3.4: a property with one of these names could carry user content. */
export const BANNED_PROPERTY_NAMES = [
  "text",
  "prompt",
  "query",
  "sql",
  "value",
  "message",
  "answer",
  "title",
  "name",
  "email",
  "content",
  "url",
] as const;

export const MAX_STRING_PROPERTY_LENGTH = 64;

/** Held sends kept at once; a turn abandoned without admission or `ai_turn_ended` is evicted oldest first. */
export const MAX_PENDING_ADMISSIONS = 50;

// `ai_feedback.value` is the catalogue's own enum (up | down), so the banned name is pinned there by type instead.
const BANNED_NAME_EXEMPTIONS: ReadonlySet<string> = new Set(["ai_feedback.value"]);

const TURN_SCOPED: ReadonlySet<string> = new Set(TURN_SCOPED_EVENTS);

const DOOR_FIELDS = ["entry_kind", "entry_verb", "object_kind"] as const;

// A lost stream ends the answer the way the legacy stream failure did.
const FAILED_OUTCOMES: ReadonlySet<string> = new Set(["failed", "lost", "refused"]);

// Context and scope own these; a property of the same name would silently override the envelope.
const ENVELOPE_FIELDS: ReadonlySet<string> = new Set([
  "schema",
  "container",
  "route",
  "viewport",
  "edition",
  "credit_mode",
  "role",
  "org",
  "gate",
  "ui_version",
  "session_id",
  "turn_id",
  "trace_id",
]);

// The catalogue's own properties that share an envelope name: the event's value is the one that happened.
const ENVELOPE_OVERRIDES: ReadonlySet<string> = new Set([
  "ai_entry_clicked.gate",
  "ai_panel_resized.viewport",
]);

// `ai_turn_sent` fires at `queued`, but its legacy event waits for admission (`99` §3.4), so the send is held per turn.
const pendingAdmission = new Map<string, PendingSend>();

let context: TelemetryContextGetters = {
  getContainer: () => "home",
  getRoute: () => "",
  getViewport: viewportFromWidth,
  getEdition: () => "oss",
  getCreditMode: () => "none",
  getRole: () => "unknown",
  getOrg: () => "",
  getGate: () => "loading",
  uiVersion: "unknown",
};

export type AiEventName = (typeof AI_EVENT_NAMES)[number];

export type TurnScopedEventName = (typeof TURN_SCOPED_EVENTS)[number];

/** The `ai_turn_ended.error_code` enum: the codes of `99` §3.5 plus `stopped_before_send`, a Stop while still queued. */
export type AiErrorCode = Exclude<
  AssistantErrorCode,
  | "history_unavailable"
  | "off_for_org"
  | "data_level_blocked"
  | "permission_denied_tool"
  | "approval_elsewhere"
  | "account_changed"
>;

export type Viewport = "mobile" | "tablet" | "desktop";

export type TelemetryRole = "admin" | "editor" | "viewer" | "custom" | "unknown";

export type PlacementMode = "pinned" | "floating" | "sheet" | "docked" | "full";

export type LengthBucket = "0" | "1_20" | "21_100" | "101_500" | "500_plus";

export type StarterKind = "ingest" | "page" | "recent" | "object" | "learn";

export type QueryLanguage = "sql" | "promql" | "vrl" | "json" | "regex" | "js";

export type HelperHost = DockHostId | "logs" | "dashboard" | "anomaly" | "alert";

export type BlockKind =
  | "approval"
  | "approval_result"
  | "plan"
  | "findings"
  | "query"
  | "link"
  | "policy"
  | "turn_outcome"
  | "attachment"
  | "trail";

export type ApprovalOp = "create" | "update" | "delete" | "run";

/** Property types per event, so an unknown property or value is a compile error. */
export interface AiEventProps {
  ai_entry_clicked: {
    entry_kind: EntryKind;
    entry_verb: EntryVerb;
    object_kind: ObjectKind;
    sends: boolean;
    gate: GateCode;
    queued: boolean;
    host?: HelperHost;
    language?: QueryLanguage;
    text_len_bucket?: LengthBucket;
    /** The door's builder threw or went over the chip cap, so nothing opened. */
    error?: boolean;
  };
  ai_gate_blocked: {
    reason: GateReason;
    cta?:
      | "see_plans"
      | "setup"
      | "open_settings"
      | "try_again"
      | "ask_admin"
      | "ask_admin_copy"
      | "ask_admin_email"
      | "learn_more"
      | "reload"
      | "deep_link";
  };
  ai_container_opened: {
    from: "door" | "header" | "shortcut" | "restore" | "route" | "launcher" | "handoff" | "toast";
    placement_mode: PlacementMode;
    turn_running: boolean;
    latency_ms: number;
  };
  ai_container_moved: { from: PlacementMode; to: PlacementMode; turn_running: boolean };
  ai_container_closed: { reason: "close" | "escape" | "host_closed" | "route" };
  ai_panel_resized: { width_rem: number; viewport: Viewport };
  ai_panel_mode_changed: { mode: "pinned" | "floating"; forced: boolean };
  ai_sheet_snap: { snap: "peek" | "half" | "full" };
  ai_toast: { kind: "ready" | "needs_you"; action: "open" | "dismiss" };
  ai_turn_busy: Record<string, never>;
  ai_leave_guard: { host: DockHostId | "alert" | "settings"; choice: "keep" | "discard" };
  ai_status_light: { state: "needs_you" | "working" | "unread" | "failed" | "open" | "idle" };
  ai_context_changed: {
    action: "add" | "remove" | "swap_time" | "trim" | "mention" | "add_back";
    kind: ChipKind;
    count: number;
    bytes: number;
  };
  ai_context_inspected: { target: "sees" | "chip" | "hints"; kind?: ChipKind };
  ai_composer_recall: { direction: "older" | "newer"; index: number };
  ai_composer_cap_hit: { cap: "images" | "rows" | "bytes" | "type" | "size" };
  ai_composer_enter_blocked: { reason: "running" | "inert" | "empty" | "elsewhere" };
  ai_composer_cleared: { reason: "new_chat" | "org_switch"; undone: boolean };
  ai_turn_sent: {
    input: TurnInput;
    chip_count: number;
    chip_kinds: ChipKind[];
    image_count: number;
    attached_bytes: number;
    prompt_chars: number;
    new_session: boolean;
  };
  ai_turn_first_byte: { ttfb_ms: number };
  ai_turn_state: {
    state: "running_tool" | "awaiting_approval" | "awaiting_consent" | "reconnecting" | "stall";
    tool?: string;
    elapsed_ms: number;
  };
  ai_turn_ended: {
    outcome: "done" | "done_not_saved" | "stopped" | "failed" | "refused" | "lost";
    error_code: AiErrorCode | null;
    http_status: number | null;
    recoverable: boolean;
    duration_ms: number;
    ttfb_ms: number | null;
    tool_calls: number;
    tool_errors: number;
    tokens_in: number | null;
    tokens_out: number | null;
    credits: number | null;
    container_at_end: TelemetryContainer;
    seen: boolean;
  };
  ai_turn_recovered: {
    action:
      | "retry"
      | "ask_again"
      | "edit_resend"
      | "manual_route"
      | "sign_in"
      | "ask_admin"
      | "manage_usage"
      | "reload"
      | "retry_save";
    succeeded: boolean;
  };
  ai_stop: {
    surface: "chat" | "inline_helper" | "rca";
    server_cancel_ms: number | null;
    partial_kept: boolean;
  };
  ai_scroll_jump: { unseen: number };
  ai_transcript_window: { turns_mounted: number };
  ai_block_invalid: { block_kind: BlockKind };
  ai_evidence_action: {
    action:
      | "run_inline"
      | "open_explorer"
      | "copy_query"
      | "insert_diff"
      | "insert_rejected"
      | "add_dashboard"
      | "create_alert"
      | "rerun_now"
      | "open_claim_step"
      | "expand_step"
      | "open_step_logs"
      | "copy_step_query";
    block_kind: "query" | "trail" | "claim" | "findings" | "footer";
    language?: QueryLanguage;
  };
  ai_downstream_saved: {
    object: "dashboard" | "alert" | "pipeline" | "function" | "regex";
    origin_turn_id: string;
  };
  ai_approval_shown: {
    op: ApprovalOp;
    resource_kind: string;
    destructive: boolean;
    grantable: boolean;
    asked_in: "here" | "other_tab";
    count: number;
  };
  ai_approval_decided: {
    decision: "approve" | "edit_then_approve" | "reply" | "deny" | "escape";
    scope?: ApprovalScope;
    items_count: number;
    latency_ms: number;
    input: "click" | "keyboard";
  };
  ai_approval_result: {
    status: "succeeded" | "partial" | "failed" | "undelivered";
    succeeded_count: number;
    failed_count: number;
  };
  ai_approval_expired: { op: ApprovalOp; resource_kind: string };
  ai_policy_notice: { kind: "permission_denied" | "unreviewed_change" };
  ai_undo: { op: ApprovalOp; resource_kind: string; succeeded: boolean };
  ai_navigation: { mode: "link_card"; taken: boolean; blocked_unsaved: boolean };
  ai_nl_proposal: {
    outcome: "proposal" | "no_query" | "handoff_offered" | "failed";
    language: QueryLanguage;
    host: HelperHost;
    validated: "ok" | "error" | "skipped";
    scan_estimate_bucket?: LengthBucket;
  };
  ai_nl_decided: {
    decision: "accept" | "accept_run" | "reject" | "revert" | "edited_before_accept";
    validated: "ok" | "error" | "skipped";
  };
  ai_feedback: {
    value: "up" | "down";
    reason?: "wrong_data" | "wrong_query" | "too_slow" | "wrong_action" | "other";
    outcome: "done";
  };
  ai_thread_action: {
    action:
      | "new"
      | "reopen"
      | "rename"
      | "pin"
      | "unpin"
      | "delete"
      | "clear_all"
      | "download"
      | "import"
      | "open_in"
      | "edit_resend"
      | "regenerate"
      | "copy_answer"
      | "copy_markdown"
      | "copy_thread"
      | "continue"
      | "version_switch";
    had_running?: boolean;
    had_draft?: boolean;
    scope?: "server" | "browser";
    format?: "markdown" | "json";
    to?: PlacementMode;
    count?: number;
  };
  ai_history_open: { placement: "popover" | "rail" | "drawer" };
  ai_history_search: { length_bucket: LengthBucket; server: boolean };
  ai_share: {
    action: "create" | "update" | "revoke" | "copy_link" | "refresh";
    visibility: "org" | "public";
    mode: "snapshot" | "live";
    scope?: "chat" | "mine" | "all";
  };
  ai_shared_view: {
    visibility: "org" | "public";
    mode: "snapshot" | "live";
    state: "ready" | "running" | "not_found" | "forbidden" | "offline" | "rate_limited";
    redacted: boolean;
    truncated: boolean;
  };
  ai_fork: { result: "ok" | "unavailable" | "failed" };
  ai_local_import: {
    result: "done" | "partial" | "failed" | "unavailable" | "forbidden" | "offline";
    count: number;
  };
  ai_consent: {
    step:
      | "shown"
      | "enabled"
      | "declined"
      | "resolved_elsewhere"
      | "ask_admin"
      | "still_required"
      | "view_billing";
    surface: "chat" | "helper" | "rca" | "dialog";
    org_match: boolean;
    plan_type: "direct" | "payer";
  };
  ai_credit_notice: {
    threshold: 70 | 90 | 100;
    mode: CreditMode;
    action: "shown" | "dismiss" | "manage" | "ask_admin";
    had_prior_warning: boolean;
  };
  ai_shortcut: { shortcut_id: string; effect: "open" | "focus" | "helper" | "history" };
  ai_welcome_shown: { fresh_org: boolean; starter_kinds: StarterKind[] };
  ai_welcome_starter: { starter_kind: StarterKind; index: number; via: "click" | "ghost" };
  ai_admin: { section: string; action: string; result: "ok" | "failed" | "cancelled" };
  ai_org_switch_with_turns: { count: number; choice: "stop" | "keep" | "cancel" };
  ai_sign_out_with_turns: { count: number; choice: "proceed" | "cancel" };
  ai_cross_tab_hint: { type: AssistantHint["type"] };
  ai_frame_unknown: { type: string };
}

/** Stamped on every event (`99` §3.2). */
export interface AiEnvelope {
  schema: 1;
  container: TelemetryContainer;
  route: string;
  viewport: Viewport;
  edition: "oss" | "ee" | "cloud";
  credit_mode: CreditMode | "none";
  role: TelemetryRole;
  org: string;
  gate: GateCode;
  ui_version: string;
  session_id?: string;
  turn_id?: string;
  trace_id?: string;
  entry_kind?: EntryKind;
  entry_verb?: EntryVerb;
  object_kind?: ObjectKind;
}

/** Injected once by the runtime; the emitter never imports the store or Vuex. */
export interface TelemetryContextGetters {
  getContainer(): TelemetryContainer;
  /** Route name, never a localised title. */
  getRoute(): string;
  getViewport(): Viewport;
  getEdition(): AiEnvelope["edition"];
  getCreditMode(): AiEnvelope["credit_mode"];
  getRole(): TelemetryRole;
  getOrg(): string;
  getGate(): GateCode;
  uiVersion: string;
}

export interface TelemetryScope {
  sid?: Sid;
  turnId?: string;
  traceId?: string;
}

export type TurnTelemetryScope = TelemetryScope & { sid: Sid; turnId: string };

export type TrackArgs<N extends AiEventName> = N extends TurnScopedEventName
  ? [props: AiEventProps[N], scope: TurnTelemetryScope]
  : [props: AiEventProps[N], scope?: TelemetryScope];

/** What the incident RCA's legacy `incident_rca_requested` keeps from the old request. */
export interface AdmissionLegacyOptions {
  buildOnPrevious?: boolean;
}

export interface TrackedEvent {
  name: string;
  properties: Record<string, unknown>;
}

interface PendingSend {
  props: Record<string, unknown>;
  container: unknown;
}

export function setAssistantTelemetryContext(ctx: TelemetryContextGetters): void {
  context = ctx;
}

/** The only builder of `ai_*` events (`00` §13); RUM decides whether anything is sent. */
export function trackAssistant<N extends AiEventName>(name: N, ...args: TrackArgs<N>): void {
  const [rawProps, scope] = args as [Record<string, unknown>, TelemetryScope | undefined];
  const props = name === "ai_frame_unknown" ? truncateType(rawProps) : rawProps;
  const problems = assistantEventProblems(name, props, scope);
  if (problems.length) {
    // Dev and tests fail loudly; production drops the event rather than ship content.
    if (import.meta.env.DEV) throw new Error(`trackAssistant(${name}): ${problems.join("; ")}`);
    return;
  }
  const properties = { ...buildEnvelope(props, scope), ...props };
  emit({ name, properties });
  for (const legacy of legacyEventsFor(name, props)) emit(legacy);
  if (scope?.turnId && name === "ai_turn_sent") holdSend(scope.turnId, props, properties.container);
  if (scope?.turnId && name === "ai_turn_ended") pendingAdmission.delete(scope.turnId);
}

/** The server admitted the turn: the only place the legacy send events fire for assistant turns (`99` §3.4). */
export function trackAssistantAdmitted(
  scope: TurnTelemetryScope,
  options: AdmissionLegacyOptions = {},
): void {
  const pending = pendingAdmission.get(scope.turnId);
  if (!pending) {
    if (import.meta.env.DEV)
      throw new Error("trackAssistantAdmitted: no ai_turn_sent for this turn");
    return;
  }
  pendingAdmission.delete(scope.turnId);
  for (const legacy of admissionLegacyEvents(pending.props, pending.container, options)) {
    emit(legacy);
  }
}

/** Every content-rule violation of one event (`99` §3.4); empty when it may be sent. */
export function assistantEventProblems(
  name: string,
  props: Record<string, unknown>,
  scope?: TelemetryScope,
): string[] {
  const problems: string[] = [];
  if (TURN_SCOPED.has(name) && !scope?.turnId) problems.push("turn-scoped event without turn_id");
  if (TURN_SCOPED.has(name) && !scope?.sid) problems.push("turn-scoped event without session_id");
  if (name === "ai_feedback" && props.outcome !== "done") problems.push("feedback outside done");
  for (const [key, value] of Object.entries(props)) {
    if (isBannedName(name, key)) problems.push(`banned property "${key}"`);
    if (ENVELOPE_FIELDS.has(key) && !ENVELOPE_OVERRIDES.has(`${name}.${key}`)) {
      problems.push(`property "${key}" would override the envelope`);
    }
    if (hasLongString(value)) problems.push(`property "${key}" is over 64 characters`);
  }
  return problems;
}

/** The one-release continuity events built from the new ones (`99` §3.4). */
export function legacyEventsFor(name: string, props: Record<string, unknown>): TrackedEvent[] {
  if (name === "ai_turn_ended" && props.outcome === "done") {
    return [{ name: "ai_assistant_answer_completed", properties: {} }];
  }
  if (name === "ai_turn_ended" && FAILED_OUTCOMES.has(String(props.outcome))) {
    const stage = props.outcome === "refused" ? "request" : "stream";
    return [{ name: "ai_assistant_answer_failed", properties: { stage } }];
  }
  if (name === "ai_stop" && props.surface === "chat") {
    return [{ name: "ai_assistant_answer_aborted", properties: {} }];
  }
  if (name === "ai_approval_decided") {
    const approved = props.decision === "approve" || props.decision === "edit_then_approve";
    return [{ name: "ai_assistant_tool_call_answered", properties: { approved } }];
  }
  if (name === "ai_feedback") {
    return [{ name: "ai_assistant_feedback_given", properties: { type: props.value } }];
  }
  if (name === "ai_nl_proposal" && props.outcome === "proposal") {
    return [{ name: "ai_query_generated", properties: {} }];
  }
  return [];
}

/** The legacy send event of one admitted `ai_turn_sent`, from its props and its container. */
export function admissionLegacyEvents(
  sent: Record<string, unknown>,
  container: unknown,
  options: AdmissionLegacyOptions = {},
): TrackedEvent[] {
  if (container === "rca") {
    return [
      {
        name: "incident_rca_requested",
        properties: { build_on_previous: options.buildOnPrevious === true },
      },
    ];
  }
  return [
    {
      name: "ai_assistant_message_sent",
      properties: { has_images: Number(sent.image_count) > 0, new_session: sent.new_session },
    },
  ];
}

function buildEnvelope(props: Record<string, unknown>, scope?: TelemetryScope): AiEnvelope {
  const envelope: AiEnvelope = {
    schema: 1,
    container: context.getContainer(),
    route: context.getRoute(),
    viewport: context.getViewport(),
    edition: context.getEdition(),
    credit_mode: context.getCreditMode(),
    role: context.getRole(),
    org: context.getOrg(),
    gate: context.getGate(),
    ui_version: context.uiVersion,
  };
  if (scope?.sid) envelope.session_id = scope.sid;
  if (scope?.turnId) envelope.turn_id = scope.turnId;
  if (scope?.traceId) envelope.trace_id = scope.traceId;
  for (const field of DOOR_FIELDS) {
    if (typeof props[field] === "string") Object.assign(envelope, { [field]: props[field] });
  }
  return envelope;
}

function holdSend(turnId: string, props: Record<string, unknown>, container: unknown): void {
  // Re-inserting moves a retried turn to the newest end, so eviction always drops the oldest send.
  pendingAdmission.delete(turnId);
  pendingAdmission.set(turnId, { props, container });
  if (pendingAdmission.size > MAX_PENDING_ADMISSIONS) {
    pendingAdmission.delete(pendingAdmission.keys().next().value as string);
  }
}

function emit(event: TrackedEvent): void {
  analytics.track(event.name, event.properties);
  if (typeof window === "undefined" || window.__O2_TELEMETRY_SINK__ !== true) return;
  (window.__o2telemetry ??= []).push(event);
}

function isBannedName(event: string, key: string): boolean {
  return (
    (BANNED_PROPERTY_NAMES as readonly string[]).includes(key) &&
    !BANNED_NAME_EXEMPTIONS.has(`${event}.${key}`)
  );
}

function hasLongString(value: unknown): boolean {
  if (typeof value === "string") return value.length > MAX_STRING_PROPERTY_LENGTH;
  return Array.isArray(value) && value.some(hasLongString);
}

function truncateType(props: Record<string, unknown>): Record<string, unknown> {
  return { ...props, type: String(props.type).slice(0, 32) };
}

function viewportFromWidth(): Viewport {
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  if (width < 768) return "mobile";
  return width < 1024 ? "tablet" : "desktop";
}
