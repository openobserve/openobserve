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

import type { ComputedRef, Ref } from "vue";

import type { PaidOverageFeature, PaidOverageStatus } from "@/services/paidOverage";
import type { ChatMessage, ImageAttachment, TurnSpan } from "@/ts/interfaces/chat";
import type { I18nKey, I18nText } from "@/types/i18n";

import type { ActionResult, AssistantAction } from "./actions/types";
import type { ClientContext, ContextChip, PageContext } from "./context/types";
import type { ConfirmationRequiredFrame, ConfirmationResolvedFrame } from "./frames";
import type { TurnState, TurnTerminal } from "./turnStates";

/** UUIDv7, the server session id. */
export type Sid = string;

export type DockHostId = "alert_query" | "json_editor" | "function" | "scheduled_query" | "regex";

/** Editors that take the inline helper but never dock a chat. */
export type InlineHostId = "logs" | "dashboard" | "anomaly" | "alert";

/** Every editor a proposal can land in. */
export type ProposalHostId = DockHostId | InlineHostId;

export type Placement =
  | { kind: "hidden" }
  | { kind: "sidebar"; mode: "pinned" | "floating" }
  | { kind: "full" }
  | { kind: "docked"; hostId: DockHostId };

/** Telemetry and the `context.client` envelope name containers with this enum (gap-2 §3.2). */
export type Container =
  "sidebar" | "full_view" | "sheet" | `docked.${DockHostId}` | "nl_bar" | "rca" | "shared_page";

/** The telemetry envelope also names surfaces that host no session (`99` §3.2). */
export type TelemetryContainer = Container | "home" | "settings" | "billing";

export interface ShellState {
  placement: Placement;
  /** Restored when a docked host closes (SH-02 AC 4). */
  previousPlacement: Placement | null;
  activeSid: Sid | null;
  /** clamp(22rem, 30vw, 32rem) by default; persisted by `prefs.ts`. */
  sidebarWidthRem: number;
  sidebarMode: "pinned" | "floating";
  sheetSnap: "peek" | "half" | "full";
  /** Focus returns here on close (IW-09). */
  invoker: { el: WeakRef<HTMLElement>; sid: Sid } | null;
}

export interface ComposerState {
  text: string;
  chips: ContextChip[];
  images: ImageAttachment[];
  /** -1 is the live draft. */
  recallIndex: number;
  recallDraft: ComposerSnapshot | null;
  timeOverride: { from: number; to: number; period?: string } | null;
  /** Ghost "Add back" chips for this chat. */
  removedPageKeys: string[];
  mode: "compose" | "reply";
  replyApprovalId?: string;
  /** The draft set aside while Reply mode holds the box; it comes back when Reply ends. */
  replyStash?: string;
  /** One send per id, so an IME Enter cannot send twice. */
  sendId: string;
}

/** Captured at `queued` and given back whole on a refusal (HT-03, constraint 13). */
export interface ComposerSnapshot {
  text: string;
  chips: ContextChip[];
  images: ImageAttachment[];
  mentions: { chipId: string; start: number; end: number }[];
  timeOverride: ComposerState["timeOverride"];
  /** The page fields removed at Send, so a retry sends what was on screen then. */
  removedPageKeys?: string[];
}

/** Token counters from `usage`/`complete.usage`; never credits (constraint 33). */
export interface TurnUsage {
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  llmCalls?: number;
}

export interface TurnMeta {
  /** `x-o2-assistant-turn-id` of the current or last turn. */
  turnId: string | null;
  /** From `turn_started` (B-02) or `complete`. */
  serverTurnId: string | null;
  /** False when `active_turn` or a hint says the turn runs elsewhere. */
  ownedByThisTab: boolean;
  /** Elapsed is computed from this, never from a component timer. */
  startedAt: number | null;
  firstByteAt: number | null;
  traceId: string | null;
  /** For the resumable tail. */
  lastSeq: number | null;
  usage: TurnUsage | null;
  /** B-09 `context_used` echo. */
  contextUsed: string[] | null;
}

/** The fork seed kept with a continued shared chat (`50` §9). */
export interface ForkSeed {
  token: string;
  title: string;
  ownerName: string;
  asOf: number;
  turns: unknown[];
  redacted?: boolean;
  hidden?: Record<string, { reason: "stream_forbidden"; stream: string }>;
}

export interface RecordMeta {
  serverBacked: boolean;
  cachedLastSeq: number | null;
  stateVersion: string | null;
  turnSpans: TurnSpan[];
  liveTurnId: string | null;
  liveSavedAt: number | null;
  forkedFromShare: string | null;
  historyUnavailable: boolean;
  ephemeral: boolean;
  pinned: boolean;
  seed?: ForkSeed;
}

export type BlockId = string;

/** Run state of an inline query block (`30` §6.1). */
export interface QueryRunState {
  status: "idle" | "running" | "done" | "failed" | "stopped";
  startedAt?: number;
  rows?: number;
}

/** Post-completion data on an immutable block (`00` §4.2 rule 10). */
export interface BlockAnnotation {
  linkOutcome?: { openedAt: number };
  approvalResult?: ApprovalResult;
  approvalOutcome?: ApprovalOutcome;
  /** The timeline entries an approval made, kept with its record so a reload has them. */
  ledger?: ActionLedgerEntry[];
  feedback?: { rating: "up" | "down"; reason?: string };
  versionIndex?: number;
  run?: QueryRunState;
  /** The page's window when the turn was asked, epoch ms. */
  window?: { from: number; to: number };
}

/** Closed enum; the envelope test pins it (gap-2 §3.2). */
export type EntryKind =
  | "header_button"
  | "shortcut"
  | "home_launcher"
  | "deep_link"
  | "share_fork"
  | "toast"
  | "thread_new"
  | "object_verb"
  | "empty_state"
  | "editor_toggle"
  | "editor_button"
  | "hint"
  | "nl_toggle"
  | "oncall_card"
  | "autoobserve_card"
  | "legacy_relay";

/** Id slugs: `add_to_chat` → `add`, `generate_query` → `generate`. */
export type EntryVerb =
  "ask" | "explain" | "troubleshoot" | "fix" | "add_to_chat" | "generate_query";

export type ObjectKind =
  | "log_row"
  | "log_field"
  | "span"
  | "trace"
  | "panel"
  | "dashboard"
  | "alert"
  | "alert_firing"
  | "incident"
  | "pipeline_node"
  | "function"
  | "regex"
  | "metric_series"
  | "service_edge"
  | "query"
  | "query_error"
  | "empty_result"
  | "ingestion"
  | "dbm_finding"
  | "none";

export interface SessionOrigin {
  entryKind: EntryKind;
  objectKind: ObjectKind;
  container: Container;
}

export interface OpenAssistantArgs {
  entryKind: EntryKind;
  entryVerb: EntryVerb;
  objectKind: ObjectKind;
  /** `send` only for explain | troubleshoot | fix and the launcher's typed line (`10` §3). */
  intent: "open" | "stage" | "send";
  payload?: {
    chips: ContextChip[];
    text?: string;
    title?: I18nText;
    /** The helper hand-off's first message (`60` §4.6). */
    transcript?: { role: "assistant"; text: string }[];
  };
  /** RCA interactive mode (`60` §5.1), forwarded on `PromptRequest`. */
  mode?: "chat";
  /** `auto` appends when the active session's last turn is under 30 min old (`04` §2). */
  thread?: "new" | "current" | "auto";
  container?: "auto" | "sidebar" | "full" | "docked";
  dockHost?: DockHostId;
  invoker?: HTMLElement | null;
}

export type OpenAssistantResult =
  | { ok: true; sid: Sid; container: Container; staged: number; sent: boolean; queued: boolean }
  | {
      ok: false;
      reason: GateCode | "turn_running_no_autosend" | "approval_pending" | "org_changed";
    };

export type ApprovalKind = "delete" | "update" | "create" | "run_command" | "permission";

/** `tool` = always for this tool; never offered for destructive operations. */
export type ApprovalScope = "once" | "chat" | "tool";

export interface ApprovalTarget {
  type: string;
  id?: string;
  name: string;
  /** In-app route. */
  link?: string;
}

export interface PendingApproval {
  /** `call_id` or batch id from the server; the key for resolve and withdraw. */
  id: string;
  /** Originating session; `/confirm` is always posted here (constraint 6). */
  sessionId: string;
  turnId: string;
  kind: ApprovalKind;
  /** Delete, retention, billing, IAM: scope choices hidden, Enter never approves. */
  destructive: boolean;
  operation: string;
  tool: string;
  targets: ApprovalTarget[];
  before?: unknown;
  after?: unknown;
  /** Blast-radius lines from the server, rendered verbatim as list items. */
  impact?: string[];
  scanEstimate?: { bytes: number; rows?: number };
  /** Epoch ms; absent means no TTL is known (`o2_delete` batch today). */
  expiresAt?: number;
  askedIn: "here" | "other_tab";
  /** False until B-05. */
  grantable: boolean;
  editable: boolean;
  /** The server's text, shown only behind Details when a typed body exists. */
  question: string;
}

export type ApprovalDecision =
  | { approved: true; scope: ApprovalScope; items?: string[] }
  | {
      approved: false;
      reason: "deny" | "escape" | "new_chat" | "reply" | "expired" | "withdrawn" | "edited";
      reply?: string;
    };

export interface ApprovalResultItem {
  id?: string;
  type: string;
  name: string;
  status: "done" | "failed" | "skipped";
  code?: string;
  message?: string;
  link?: string;
  undoable?: boolean;
  /** The server's action-ledger id, which Undo posts. */
  ledgerId?: string;
}

export interface ApprovalResult {
  status: "done" | "partial" | "failed";
  items: ApprovalResultItem[];
  resolvedBy: string;
  resolvedAt: number;
  ledgerId?: string;
}

/** What became of an approval card; the record the transcript shows in the card's place. */
export interface ApprovalOutcome {
  state:
    | "sending"
    | "approved"
    | "done"
    | "partial"
    | "failed"
    | "declined"
    | "new_chat"
    | "stopped"
    | "replied"
    | "editing"
    | "narrowed"
    | "expired"
    | "withdrawn"
    | "delivery_failed"
    | "unconfirmed"
    | "approved_elsewhere"
    | "declined_elsewhere";
  at: number;
  decision?: ApprovalDecision;
  /** The `/confirm` status behind a failed or undelivered decision. */
  httpStatus?: number;
  /** Who decided elsewhere, from `confirmation_resolved.by`. */
  by?: string;
}

/** A mutation this chat made (AA-10); undo only where the object's API allows it. */
export interface ActionLedgerEntry {
  id: string;
  approvalId?: string;
  turnId: string;
  tool: string;
  op: "create" | "update" | "delete" | "run_command";
  resource: { type: string; id?: string; name: string; link?: string };
  status: "done" | "failed" | "undone";
  undoable: boolean;
  at: number;
  undoneAt?: number;
  /** An undo of this entry is on its way; a second one is refused. */
  undoing?: boolean;
  undoFailed?: boolean;
  /** An undo was sent and never answered (a timeout, or a reload while it ran): it may have restored the object. */
  undoUnconfirmed?: boolean;
}

/** A 412 consent prompt held on its session (`00` §11). */
export interface PendingConsent {
  org: string;
  feature: PaidOverageFeature;
  status: PaidOverageStatus;
  turnId: string;
  snapshot: ComposerSnapshot;
}

export interface ShareSummary {
  id: string;
  visibility: "org" | "public";
  mode: "snapshot" | "live";
  expiresAt: number | null;
  outOfDate: boolean;
  count: number;
}

export type EntryOrigin = "editor" | "alert" | "incident" | "none";

export interface HistoryRow {
  sid: Sid;
  chatId: number | null;
  title: I18nText;
  titleSource: AssistantSession["titleSource"];
  createdAt: number;
  updatedAt: number;
  origin: EntryOrigin;
  originContainer: Container;
  pinned: boolean;
  activeTurn: boolean;
  pendingApproval: boolean;
  share: ShareSummary | null;
  local: boolean;
  ephemeral: boolean;
  agentType: string | null;
}

export interface HistoryFilter {
  kind: "all" | "pinned" | "editor" | "alert" | "incident" | "shared";
  q: string;
}

export type ImportState = "idle" | "offered" | "running" | "done" | "failed" | "dismissed";

/** In gate order; the first match wins. */
export type GateCode =
  | "loading"
  | "not_entitled"
  | "not_configured"
  | "off_for_org"
  | "unhealthy"
  | "no_permission"
  | "available";

export type GateReason =
  | "not_entitled"
  | "not_configured"
  | "off_for_org"
  | "unhealthy"
  | "no_permission"
  | "no_share"
  | "no_share_read";

export type Tri = "yes" | "no" | "unknown";

export type CreditMode = "free" | "consent_required" | "pay_as_you_go" | "exhausted";

export interface AssistantCapability {
  gate: GateCode;
  edition: "oss" | "ee" | "cloud";
  configured: boolean;
  health: "unknown" | "ok" | "down";
  canChat: Tri;
  canWrite: Tri;
  canShare: Tri;
  canShareRead: Tri;
  persistence: boolean;
  publicLinks: boolean;
  publicMaxExpiryDays: number;
  retentionDays?: number;
  /** B-09: the server takes typed `attachments` and echoes `context_used`. */
  attachments?: boolean;
  /** `/confirm {id, extend:true}` gives a card more time. */
  approvalExtend?: boolean;
  /** Each used only when advertised: server search `q`, server pins, browser-chat import. */
  historySearch?: boolean;
  historyPins?: boolean;
  historyImport?: boolean;
  /** The server answers a turn's versions (`turn_versions`). */
  turnVersions?: boolean;
  /** The server stores a vote with its turn (`feedback_stored`). */
  feedbackStored?: boolean;
  /** `mode: "chat"` with `incident_id` reaches the interactive incident agent (`rca_chat_mode`). */
  rcaChatMode?: boolean;
  /** Absent off Cloud; doors read it for the cost line (`80` §3.3). */
  creditMode?: CreditMode;
  isAdmin: boolean;
  rcaEnabled: boolean;
  source: "config" | "capabilities" | "heuristic" | "probe" | "cached_403";
  reasonCode: GateCode | "no_share" | "no_share_read" | "local_only";
}

export type AssistantErrorCode =
  | "offline"
  | "unreachable"
  | "session_expired"
  | "permission_denied"
  | "not_enabled"
  | "credits_exhausted"
  | "subscription_required"
  | "consent_declined"
  | "consent_still_required"
  | "stopped_before_send"
  | "authorization_unavailable"
  | "turn_limit"
  | "rate_limited"
  | "turn_busy"
  | "already_submitted"
  | "agent_unavailable"
  | "provider_error"
  | "stream_dropped"
  | "session_owner_unavailable"
  | "restore_required"
  | "stale_epoch"
  | "empty_response"
  | "persistence_failed"
  | "cancelled_elsewhere"
  | "signed_out"
  | "approval_expired"
  | "approval_delivery_failed"
  | "stream_oversized"
  | "unknown"
  | "history_unavailable"
  | "off_for_org"
  | "data_level_blocked"
  | "permission_denied_tool"
  | "approval_elsewhere"
  | "account_changed"
  | "rca_disabled"
  | "analysis_in_progress";

/** The one action a terminal block offers (`80` §1.3); `none` renders Details only. */
export type AssistantErrorAction =
  | "retry"
  | "sign_in"
  | "ask_admin"
  | "open_iam_roles"
  | "open_settings"
  | "manage_usage"
  | "view_plans"
  | "stop_it"
  | "reload_chat"
  | "edit_resend"
  | "retry_save"
  | "ask_again"
  | "send_again"
  | "change_level"
  | "none";

export interface AssistantError {
  code: AssistantErrorCode;
  /** `read`, `mutation` and `client` serve history, shares, billing and settings and never enter `TurnState`. */
  phase: "pre_admission" | "post_admission" | "read" | "mutation" | "client";
  retryable: boolean;
  retryAfterMs?: number;
  action: AssistantErrorAction;
  httpStatus?: number;
  /** Raw server text, shown in Details only. */
  serverMessage?: string;
  traceId?: string;
  turnId?: string;
  sessionId?: string;
}

export interface AssistantSession {
  sid: Sid;
  /** IndexedDB id (ms from the UUIDv7). */
  chatId: number | null;
  /** Captured at creation and never recomputed (constraint 17). */
  userOrgKey: string;
  org: string;
  title: I18nText | null;
  /** A rename beats later `title` frames (constraint 21). */
  titleSource: "generated" | "renamed" | "object";
  origin: SessionOrigin;
  /** Reducer output; block ids are stable. */
  messages: ChatMessage[];
  record: RecordMeta;
  composer: ComposerState;
  scroll: { top: number | "bottom" };
  /** View state that survives a container move and is never persisted (`30` §1.3, §5, §8.2). */
  ui: {
    expandedSteps: string[];
    follow: boolean;
    unseen: number;
    activeVersion: Record<string, number>;
  };
  turn: TurnState;
  turnMeta: TurnMeta;
  pendingApproval: PendingApproval | null;
  pendingConsent: PendingConsent | null;
  annotations: Record<BlockId, BlockAnnotation>;
  share: ShareSummary | null;
  ledger: ActionLedgerEntry[];
  /** Set when a turn ends while no container shows the session. */
  unread: boolean;
}

export interface AssistantState {
  /** `/config` resolved and the module initialised for this `userOrgKey`. */
  ready: boolean;
  userOrgKey: string | null;
  capability: AssistantCapability;
  shell: ShellState;
  sessions: Record<Sid, AssistantSession>;
  /** MRU for the launcher and the hand-off survivor. */
  recent: Sid[];
  /** Per tab, owned by `useAssistantHistory` (`50` §4). */
  history: {
    filter: HistoryFilter;
    cursor: string | null;
    hasMore: boolean;
    importState: ImportState;
  };
}

/** Ids, enums and timestamps only; a receiver re-reads and never applies the payload as state. */
export type AssistantHint =
  | {
      v: 1;
      type: "turn_started";
      org: string;
      sid: string;
      turnId: string;
      origin: "chat" | "rca";
      at: number;
    }
  | {
      v: 1;
      type: "turn_ended";
      org: string;
      sid: string;
      turnId: string;
      status: "completed" | "cancelled" | "failed" | "interrupted";
      at: number;
    }
  | {
      v: 1;
      type: "approval_pending";
      sid: string;
      turnId: string;
      callId?: string;
      /** The card's own expiry, when the server gave one; the other tabs drop it then at the latest. */
      expiresAt?: number;
      at: number;
    }
  | { v: 1; type: "approval_resolved"; sid: string; callId?: string; approved: boolean; at: number }
  /** Stop from a tab waiting on another tab's card: the holder declines it and stops the turn. */
  | { v: 1; type: "approval_stop"; sid: string; at: number }
  | { v: 1; type: "consent_granted"; org: string; feature: "ai_credits"; at: number }
  | { v: 1; type: "signed_out"; at: number }
  | {
      v: 1;
      type: "prefs_changed";
      key: "prompt_history" | "sidebar_width" | "sidebar_mode";
      at: number;
    }
  | {
      v: 1;
      type: "history_changed";
      sid: string;
      op: "create" | "rename" | "pin" | "delete" | "clear";
      at: number;
    }
  | { v: 1; type: "share_changed"; sid: string; at: number };

export interface AssistantStoreApi {
  /** Reactive; components read through `computed()`. */
  readonly state: Readonly<AssistantState>;

  /** Returns the active session unchanged when it has no messages and no draft (`50` §2). */
  createSession(init: { origin: SessionOrigin; title?: I18nText; thread?: "new" }): Sid;
  /** Loads through history and never resets. */
  openSession(ref: { sid: Sid } | { chatId: number }, opts?: { focus?: boolean }): Promise<Sid>;
  dropSession(
    sid: Sid,
    reason: "deleted" | "deleted_elsewhere" | "org_switch" | "pruned" | "cleared",
  ): void;
  setTitle(sid: Sid, title: I18nText, source: "generated" | "renamed" | "object"): void;
  setActive(sid: Sid | null): void;
  markRead(sid: Sid): void;

  open(
    target: Placement,
    opts: { sid?: Sid; focus: "composer" | "none"; invoker?: HTMLElement | null },
  ): void;
  close(reason: "close" | "escape" | "host_closed" | "route"): void;
  moveTo(target: Placement): void;
  setSidebarWidth(rem: number): void;
  setSidebarMode(mode: "pinned" | "floating"): void;
  setSheetSnap(snap: "peek" | "half" | "full"): void;

  stage(
    sid: Sid,
    payload: { chips?: ContextChip[]; text?: string; mode: "append" | "replace" },
  ): void;
  setDraft(sid: Sid, patch: Partial<ComposerState>): void;
  /** After a refusal (constraint 13). */
  restoreDraft(sid: Sid, snapshot: ComposerSnapshot): void;
  addChip(
    sid: Sid,
    chip: ContextChip,
  ): { ok: true } | { ok: false; cap: "rows" | "bytes" | "images" | "type" | "size" };
  removeChip(sid: Sid, chipId: string): void;
  addBackChip(sid: Sid, key: string): void;
  addImage(
    sid: Sid,
    image: ImageAttachment,
  ): { ok: true } | { ok: false; cap: "images" | "type" | "size" };
  removeImage(sid: Sid, id: string): void;
  setTimeOverride(sid: Sid, range: ComposerState["timeOverride"]): void;
  startReply(sid: Sid, approvalId: string): void;
  cancelReply(sid: Sid): void;
  /** Returns an undo token, or null across orgs. */
  clearDraft(sid: Sid, reason: "new_chat" | "org_switch"): string | null;
  undoClear(sid: Sid, token: string): void;
  recall(sid: Sid, direction: "older" | "newer"): void;

  toggleStep(sid: Sid, callId: string): void;
  setFollow(sid: Sid, follow: boolean): void;
  selectVersion(sid: Sid, turnId: string, n: number): void;

  send(
    sid: Sid,
    opts?: { turnId?: string; mode?: "chat" | "generate_query"; ephemeral?: boolean },
  ): Promise<TurnTerminal>;
  /** Abort plus a keepalive cancel on the route of `session.origin`, then stopping → stopped. */
  stop(sid: Sid): Promise<void>;
  /** Pre-admission keeps the turn id; post-admission mints a new one. */
  retry(sid: Sid): Promise<TurnTerminal>;
  /** Stages `assistant.turn.continuePrefill` and the previous chips; never sends. */
  continueTurn(sid: Sid): void;
  /** Re-POSTs a not-saved turn (server mode only). */
  retrySave(sid: Sid, turnId: string): Promise<void>;
  /** Posts on `sessions[sid].sid`. */
  decideApproval(
    sid: Sid,
    decision: ApprovalDecision,
    approvalId?: string,
  ): Promise<ApprovalResult>;
  resolveConsent(sid: Sid, accepted: boolean, acknowledged?: boolean): Promise<void>;

  dispatch(sid: Sid, action: AssistantAction): Promise<ActionResult>;

  /** Internal: called by `effects.ts` only, never exported from the barrel. */
  announce(sid: Sid, key: I18nKey, params?: Record<string, unknown>): void;
  /** Internal: a local write failed (`50` §5.3). */
  markNotSaved(sid: Sid): void;

  /** Re-reads; never applies the payload as state. */
  applyHint(hint: AssistantHint): void;
  onOrgSwitch(next: { org: string; userOrgKey: string }): Promise<"proceed" | "cancel">;
  onSignOut(): Promise<"proceed" | "cancel">;
  reset(): void;
}

export interface AssistantHostAdapter {
  id: DockHostId;
  objectKind: ObjectKind;
  /** Thread title "Alert · {name}" (`04` §14 docked thread rule). */
  objectTitle: () => I18nText;
  language: "sql" | "promql" | "vrl" | "json" | "regex" | "js";
  /** Current editor text (the `query` chip). */
  getBuffer(): string;
  /** Merged over the page provider (pushed on the stack). */
  getContext(): Partial<PageContext>;
  /** The diff shows in the editor; nothing lands until accept. */
  previewInsert(
    text: string,
    mode: "replace" | "append",
  ): Promise<{ accept(): void; reject(): void }>;
  /** `AiLabel` revert. */
  revert(token: string): void;
  /** Leave guard (SH-06). */
  isDirty(): boolean;
  /** The host's test or preview action for "Accept and run" (`60` §1.1). */
  run?(): void;
  schemaFields?(): string[];
  focusEditor(cursor?: { line: number; column: number }): void;
  /** Default 20; a host that cannot give it refuses to dock (SH-05 edge). */
  minWidthRem?: number;
  /** The row width the host gives the editor and the dock together once docked; the slot's own width by default. */
  dockRowRem?(): number;
  /** The flex column the dock fills. */
  dockSlot: Ref<HTMLElement | null>;
}

/** The subset the inline helper needs on hosts that never dock (Logs, dashboards, anomaly). */
export type InlineHostAdapter = Pick<
  AssistantHostAdapter,
  "language" | "getBuffer" | "previewInsert" | "run" | "schemaFields" | "focusEditor"
> & {
  /** The editor's proposal controller key and the door's `data-host`. */
  id?: ProposalHostId;
  /** `""` when the host needs a stream and none is selected; absent where streams do not apply. */
  stream?: string;
  /** Every selected stream where the host takes several; one chip and one request entry each. */
  streams?: string[];
  streamType?: string;
  timeRange?: { from: number; to: number; period?: string };
  /** The chips point at the host's own pickers; they never change the range or stream themselves. */
  focusPicker?(kind: "time" | "stream"): void;
  /** "Use proposed range": the host's picker takes the range a proposal names. */
  setTimeRange?(range: { from: number; to: number }): void;
  /** What the request carries beyond the chips ("SQL mode", "interesting fields"). */
  alsoSends?(): I18nText[];
};

/** Where the turn came from (`ai_turn_sent.input`, `99` §3.3). */
export type TurnInput =
  | "typed"
  | "door"
  | "starter"
  | "ghost"
  | "recall"
  | "rerun"
  | "continue"
  | "retry"
  | "regenerate"
  | "edit_resend";

/** The whitelist fields of `PageContext` that go on the wire. */
export type PageContextWire = Partial<PageContext>;

/** One chat_stream request (`00` §5.1). */
export interface SendRequest {
  org: string;
  sid: Sid;
  /** UUIDv7, reused exactly once on a consent, restore or pre-admission retry (constraint 16). */
  turnId: string;
  /** Only the new message; history goes by `knownSeq` when persisted (constraint 18). */
  message: { text: string; images?: ImageAttachment[] };
  knownSeq?: number;
  context: PageContextWire & { client: ClientContext; user_timezone: string; locale?: string };
  mode?: "chat" | "generate_query";
  ephemeral?: boolean;
  /** B-09: the chips as typed attachments instead of delimiter blocks in `message.text`. */
  attachments?: WireAttachment[];
  /** The approval card a Reply or Ask again answers. */
  replyToApproval?: string;
}

/** One B-09 attachment (`00` §6.3). */
export interface WireAttachment {
  kind: ContextChip["kind"];
  ref?: ContextChip["ref"];
  data: unknown;
}

/** What the engine knows of the turn being built: the page context captured at `queued` and the server flags. */
export interface RequestTurn {
  pageContext: PageContext | null;
  turnId: string;
  mode?: "chat" | "generate_query";
  ephemeral?: boolean;
  /** Index of this turn's user message, for the browser-only transcript. */
  userIndex: number;
  persisted: boolean;
  /** B-09 `attachments` capability. */
  attachments: boolean;
  /** A chat about an incident names `mode: "chat"`, or the server runs the autonomous analysis agent. */
  rcaChatMode?: boolean;
  now: number;
  replyToApproval?: string;
}

export type RequestBuilder = (
  session: AssistantSession,
  snapshot: ComposerSnapshot,
  client: ClientContext,
  turn?: RequestTurn,
) => SendRequest;

export interface TurnEngine {
  send(
    sid: Sid,
    opts?: {
      turnId?: string;
      mode?: "chat" | "generate_query";
      ephemeral?: boolean;
      /** `regenerate` resends the latest prompt as a new attempt of the same turn; the composer is untouched. */
      input?: TurnInput;
      /** Edit and resend: the text and chips to send instead of the composer's. */
      snapshot?: ComposerSnapshot;
      /** Edit and resend: the 1-based user message the edit came from (EB-09 AC 4). */
      editedFrom?: number;
      replyToApproval?: string;
    },
  ): Promise<TurnTerminal>;
  stop(sid: Sid): Promise<void>;
  stopAll(reason: "sign_out" | "org_switch" | "new_turn_elsewhere"): Promise<void>;
  /** Another tab signed out: every running turn here cancels and ends `failed{signed_out}`, never a reload. */
  signedOutElsewhere?(): Promise<void>;
  retry(sid: Sid): Promise<TurnTerminal>;
  continueTurn(sid: Sid): void;
  retrySave(sid: Sid, turnId: string): Promise<void>;
  /** The last ended turn still has the snapshot a Retry resends (HT-03 AC 5). */
  canRetry?(sid: Sid): boolean;
  /** The running turn's frames so far, for a browser-only save of the turn as `StoredTurn`. */
  turnFrames?(sid: Sid): { turnId: string; frames: unknown[] } | null;
  /** `turn_busy`'s Stop it: cancels a turn this tab is not running (`80` §1.3). */
  cancelTurn?(sid: Sid, turnId: string | null): Promise<boolean>;
  /** WP-05 installs `serialize.ts`. */
  setRequestBuilder(builder: RequestBuilder): void;
  /** The pending card was answered, so the turn stops waiting on it and its TTL no longer applies. */
  approvalDecided?(sid: Sid): void;
  /** The pending card's expiry moved, so the turn's own TTL timer follows it (to `until` when given). */
  approvalExtended?(sid: Sid, until?: number): void;
  /** A decision on the card is on its way, so its expiry does not end the turn meanwhile. */
  approvalSending?(sid: Sid): void;
  /** A turn waiting on consent ends unsent with its prompt back, as a Stop before sending does. */
  consentWithdrawn?(sid: Sid): void;
  /** WP-10 installs `consent.ts`. */
  setConsentHandler(handler: (sid: Sid, err: AssistantError) => void): void;
}

export type MutationResult = { ok: true } | { ok: false; error: AssistantError };

export interface HistoryService {
  open(ref: { sid: Sid } | { chatId: number }): Promise<Sid>;
  create(): Sid;
  recent(n: number): ComputedRef<HistoryRow[]>;
  save(sid: Sid): Promise<"server" | "local" | "not_saved">;
  rename(sid: Sid, title: string): Promise<MutationResult>;
  pin(sid: Sid, pinned: boolean): Promise<MutationResult>;
  remove(sid: Sid): Promise<MutationResult>;
  clearAll(): Promise<MutationResult>;
  importLocal(): AsyncGenerator<{ done: number; total: number; failed: string[] }>;
  rows: ComputedRef<HistoryRow[]>;
  /** False while `open` cannot re-read a transcript, so the store never releases one. */
  canReload: ComputedRef<boolean>;
  mode: ComputedRef<"server" | "local">;
  hasMore: ComputedRef<boolean>;
  loadOlder(): Promise<void>;
}

export interface HintChannel {
  post(hint: AssistantHint): void;
  on<T extends AssistantHint["type"]>(
    type: T,
    handler: (hint: Extract<AssistantHint, { type: T }>) => void,
  ): () => void;
  rebind(userOrgKey: string): void;
  close(): void;
}

export interface ApprovalsService {
  onConfirmationRequired(sid: Sid, frame: ConfirmationRequiredFrame): void;
  /** With `approvalId`, refused unless that card is the one pending. */
  decide(sid: Sid, decision: ApprovalDecision, approvalId?: string): Promise<ApprovalResult>;
  withdraw(sid: Sid, reason: "new_chat" | "withdrawn" | "stopped"): Promise<void>;
  onResolved(sid: Sid, frame: ConfirmationResolvedFrame): void;
}

export interface ConsentService {
  onConsentRequired(sid: Sid, err: AssistantError): void;
  /** An accept turns paid usage on only with the card's acknowledgement ticked. */
  resolve(sid: Sid, accepted: boolean, acknowledged?: boolean): Promise<void>;
  cancel(sid: Sid, reason: "container_closed" | "org_switch" | "sign_out" | "stopped"): void;
  /** True while an Enable is on its way; a cancel then waits for its answer. */
  busy?(sid: Sid): boolean;
}

export interface ActionDispatcher {
  apply(sid: Sid, action: AssistantAction): Promise<ActionResult>;
}

/** The mounted dock hosts, with reactive membership (WP-09). */
export interface HostRegistry {
  register(adapter: AssistantHostAdapter): void;
  unregister(id: DockHostId): void;
  get(id: DockHostId): AssistantHostAdapter | undefined;
  has(id: DockHostId): boolean;
  readonly mounted: ComputedRef<DockHostId[]>;
}

export interface AssistantStoreDeps {
  getOrg(): { identifier: string; name: string } | null;
  getUser(): { email: string; role: string } | null;
  now(): number;
  uuid(): string;
  engine: TurnEngine;
  history: HistoryService;
  hints: HintChannel;
  approvals: ApprovalsService;
  consent: ConsentService;
  actions: ActionDispatcher;
}
