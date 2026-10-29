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

import { computed, watch, type ComputedRef } from "vue";
import type { Router } from "vue-router";

import type { ConfirmResponse } from "@/services/assistant";
import { trackAssistant, type AiEventProps, type ApprovalOp } from "@/services/assistantAnalytics";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

import {
  approvalAnnotationKey,
  approvalCardOf,
  type ApprovalDetail,
} from "./actions/appliers/approval";
import type { ActionResult, AssistantAction } from "./actions/types";
import type {
  ApprovalDecision,
  ApprovalOutcome,
  ApprovalResult,
  ApprovalsService,
  AssistantSession,
  AssistantState,
  BlockAnnotation,
  ComposerSnapshot,
  HintChannel,
  PendingApproval,
  Sid,
  TurnEngine,
  TurnInput,
} from "./assistantStore.types";
import type { ConfirmationRequiredFrame, ConfirmationResolvedFrame } from "./frames";
import { buildNavigationRoute } from "./navigationRoutes";
import { approvalOf, type ApprovalBlockData } from "./reducer";
import { runtimeHandle } from "./runtimeHandle";
import { isTerminal } from "./turnStates";

/** o2-ai auto-denies an opencode permission or a CLI confirmation at 30 s; the card says so 5 s early. */
export const PERMISSION_TTL_MS = 25_000;

/** A delete batch has no server TTL, so this tab gives it ten minutes and then declines it. */
export const DELETE_TTL_MS = 10 * 60_000;

/** A server expiry further out than this is clamped: a timer past 2^31 ms would fire at once. */
export const MAX_CARD_MS = 24 * 60 * 60_000;

/** An approve with an unknown outcome re-reads the open lists once, this long after it gave up waiting. */
export const UNCONFIRMED_REREAD_MS = 30_000;

/** A keydown this recent made the decision a keyboard one (`ai_approval_decided.input`). */
const KEYBOARD_INPUT_MS = 1_000;

// The narrowed follow-up names what is kept; model-supplied names are capped like every other list.
const MAX_FOLLOW_UP_NAMES = 20;

const MAX_FOLLOW_UP_NAME_CHARS = 100;

// Entity nouns with their own plural key; anything else is "object".
const ENTITY_KEYS: ReadonlySet<string> = new Set([
  "alert",
  "dashboard",
  "pipeline",
  "function",
  "stream",
  "user",
  "setting",
  "report",
  "folder",
  "panel",
]);

// Ids the routes of `buildNavigationRoute` read, per target type.
const ROUTE_ID_KEY: Record<string, string> = {
  alert: "alert_id",
  dashboard: "dashboard_id",
  incident: "id",
};

/** What the approvals runtime reads and calls; `runtime.ts` provides it, specs pass fakes. */
export interface ApprovalsDeps {
  state(): AssistantState;
  annotate(sid: Sid, blockId: string, patch: BlockAnnotation): void;
  /** Sends a prompt that is not the composer's (Reply, Ask again, a narrowed batch). */
  resend(
    sid: Sid,
    snapshot: ComposerSnapshot,
    input: TurnInput,
    opts: { replyToApproval: string },
  ): Promise<unknown>;
  engine(): Pick<TurnEngine, "approvalDecided" | "approvalExtended" | "approvalSending">;
  /** The registry's approvals-only dispatch: the one path that posts a decision or an undo. */
  dispatch(sid: Sid, action: AssistantAction): Promise<ActionResult>;
  /** The server's `extend`, outside the decision path: it decides nothing. */
  extend(org: string, sid: Sid, id: string): Promise<ConfirmResponse>;
  extendable(): boolean;
  /** An approve or an undo changed objects of these types, so their open lists refresh. */
  changed?(types: string[]): void;
  hints: Pick<HintChannel, "on">;
  now(): number;
  lastKeydownAt(): number;
  t: TranslateFn;
}

/** `ApprovalsService` plus the record's own actions (Send again, Ask again, More time, Undo). */
export interface ApprovalsRuntime extends ApprovalsService {
  /** Holds again a card a reload lost, until its own `expiresAt`; false when it has none left. */
  restore(sid: Sid, card: ApprovalBlockData): boolean;
  /** Lets a restored card go with the record of how the server ended it, without a POST; `unknown` keeps no outcome. */
  release(sid: Sid, approvalId: string, state: ApprovalOutcome["state"] | "unknown"): void;
  extend(sid: Sid): Promise<boolean>;
  sendAgain(sid: Sid, approvalId: string): Promise<void>;
  askAgain(sid: Sid, approvalId: string): Promise<void>;
  undo(sid: Sid, ledgerId: string): Promise<ActionResult>;
  dispose(): void;
}

// The one undelivered decision of a session that Send again may repeat, while its card is still the turn's.
interface Retry {
  id: string;
  turnId: string | null;
  decision: ApprovalDecision;
  override?: ApprovalOutcome["state"];
  /** The card's expiry when it was first sent, so a resend that fails again re-arms it. */
  until?: number;
}

/** The pending card of one session and its decision, for the container that shows it. */
export function useAssistantApprovals(sid: Sid): {
  pending: ComputedRef<PendingApproval | null>;
  decide(d: ApprovalDecision, approvalId?: string): Promise<ApprovalResult>;
} {
  const handle = runtimeHandle();
  return {
    pending: computed(() => handle.value?.store.state.sessions[sid]?.pendingApproval ?? null),
    decide: (d, approvalId) =>
      handle.value
        ? handle.value.store.decideApproval(sid, d, approvalId)
        : Promise.resolve(emptyResult("failed", "", Date.now())),
  };
}

/** The built runtime's approvals, for the cards and records that act on it; `null` before it exists. */
export function assistantApprovals(): ApprovalsRuntime | null {
  return runtimeHandle().value?.approvals ?? null;
}

/** The approvals runtime: the pending card per session, its expiry, every decision and its record. */
export function createApprovalsRuntime(deps: ApprovalsDeps): ApprovalsRuntime {
  // Two sessions can hold cards with the same id, so everything per card is keyed by both.
  const keyOf = (sid: Sid, id: string) => `${sid}\u0001${id}`;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Map<string, Promise<ApprovalResult>>();
  const shownAt = new Map<string, number>();
  const retries = new Map<Sid, Retry>();
  const sessionOf = (sid: Sid) => deps.state().sessions[sid] as AssistantSession | undefined;
  const followUps = createFollowUps(deps, sessionOf);

  const clearTimer = (sid: Sid, id: string) => {
    const timer = timers.get(keyOf(sid, id));
    if (timer) clearTimeout(timer);
    timers.delete(keyOf(sid, id));
  };

  const armTimer = (sid: Sid, id: string, expiresAt: number) => {
    clearTimer(sid, id);
    const delay = Math.min(Math.max(0, expiresAt - deps.now()), MAX_CARD_MS);
    timers.set(
      keyOf(sid, id),
      setTimeout(() => expire(sid, id), delay),
    );
  };

  // A card this tab can no longer answer leaves its record without a POST: the server already let it go.
  const drop = (session: AssistantSession, state: ApprovalOutcome["state"] | "unknown") => {
    const pending = session.pendingApproval;
    if (!pending) return;
    clearTimer(session.sid, pending.id);
    shownAt.delete(keyOf(session.sid, pending.id));
    session.pendingApproval = null;
    if (state === "unknown") return;
    deps.annotate(session.sid, approvalAnnotationKey(pending.id), {
      approvalOutcome: { state, at: deps.now() },
    });
  };

  const run = (
    sid: Sid,
    id: string,
    decision: ApprovalDecision,
    override?: ApprovalOutcome["state"],
    retryUntil?: number,
  ): Promise<ApprovalResult> => {
    const key = keyOf(sid, id);
    const running = inFlight.get(key);
    if (running) return running;
    const card = approvalCardOf(sessionOf(sid), id);
    if (!card) return Promise.resolve(emptyResult("failed", "", deps.now()));
    // A server that sent an untyped card takes no subset: the batch is declined and the kept items are asked for again.
    const narrowed =
      decision.approved &&
      !!decision.items &&
      !card.typed &&
      decision.items.length < card.targets.length;
    const wire: ApprovalDecision = narrowed ? { approved: false, reason: "edited" } : decision;
    const state = narrowed ? "narrowed" : override;
    const pending = sessionOf(sid)?.pendingApproval;
    const until = pending?.id === id ? pending.expiresAt : retryUntil;
    retries.delete(sid);
    deps.engine().approvalSending?.(sid);
    const promise = deps
      .dispatch(sid, { kind: "approval", decision: wire, approvalId: id })
      .then((result) => settle(sid, id, { wire, asked: decision, state, until }, result, card))
      .then((result) => {
        if (result.status !== "failed") followUps.send(sid, id, decision, card, narrowed);
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };

  const settle = (
    sid: Sid,
    id: string,
    sent: {
      wire: ApprovalDecision;
      asked: ApprovalDecision;
      state?: ApprovalOutcome["state"];
      until?: number;
    },
    result: ActionResult,
    card: ApprovalBlockData,
  ): ApprovalResult => {
    const session = sessionOf(sid);
    const key = keyOf(sid, id);
    // A decision the registry refused never left this tab, so the card stays to be answered.
    if (!result.ok && (result.reason === "other_org" || result.reason === "gated")) {
      deps.engine().approvalExtended?.(sid);
      return emptyResult("failed", "", deps.now());
    }
    trackDecision(sid, sent.asked, deps, shownAt.get(key));
    shownAt.delete(key);
    clearTimer(sid, id);
    if (session?.pendingApproval?.id === id) session.pendingApproval = null;
    const detail = result.ok ? (result.detail as ApprovalDetail | undefined) : undefined;
    const outcome = approvalOutcomeOf(session, id).outcome;
    // Stop is followed by the cancel, which declines on the server whatever this POST answered.
    if (sent.state && outcome && (result.ok || sent.state === "stopped"))
      deps.annotate(sid, approvalAnnotationKey(id), {
        approvalOutcome: { ...outcome, state: sent.state },
      });
    else if (outcome?.state === "delivery_failed" && session)
      retries.set(sid, {
        id,
        turnId: session.turnMeta.turnId,
        decision: sent.wire,
        ...(sent.state && { override: sent.state }),
        ...(sent.until !== undefined && { until: sent.until }),
      });
    // A decision that was sent but not confirmed may have run, so the turn stops waiting on the card; one that never landed keeps the card's expiry.
    const unknown = outcome?.state === "unconfirmed";
    if (result.ok || unknown) deps.engine().approvalDecided?.(sid);
    else deps.engine().approvalExtended?.(sid, sent.until);
    if (sent.wire.approved) {
      trackResult(sid, id, detail, session);
      if (result.ok) deps.changed?.(changedTypes(card, detail));
      // An approve that may still be running on the server gets one later re-read of the lists, never a loop.
      else if (unknown) rereadLater(key, changedTypes(card, detail));
    }
    return detail?.result ?? emptyResult(result.ok ? "done" : "failed", "", deps.now());
  };

  const rereadLater = (key: string, types: string[]) => {
    const timer = setTimeout(() => {
      timers.delete(`${key}\u0002reread`);
      deps.changed?.(types);
    }, UNCONFIRMED_REREAD_MS);
    timers.set(`${key}\u0002reread`, timer);
  };

  const expire = (sid: Sid, id: string) => {
    timers.delete(keyOf(sid, id));
    const pending = sessionOf(sid)?.pendingApproval;
    if (pending?.id !== id) return;
    trackAssistant(
      "ai_approval_expired",
      { op: opOf(pending.kind), resource_kind: approvalEntity(pending) },
      { sid, turnId: pending.turnId || "unknown" },
    );
    void run(sid, id, { approved: false, reason: "expired" });
  };

  const offs: (() => void)[] = [
    // The server's TTL decides what a signed-out tab left pending; nothing is approved or posted on the way out.
    deps.hints.on("signed_out", () => {
      for (const session of Object.values(deps.state().sessions)) {
        if (!session.pendingApproval) continue;
        clearTimer(session.sid, session.pendingApproval.id);
        session.pendingApproval = null;
      }
      retries.clear();
    }),
  ];

  // Started with the first card: the store does not exist yet when the runtime is built.
  let turnsWatched = false;

  const hold = (session: AssistantSession, block: ApprovalBlockData, expiresAt: number) => {
    if (!turnsWatched) offs.push(watchEndedTurns(deps, (key) => inFlight.has(key), keyOf, drop));
    turnsWatched = true;
    // No id goes to `/confirm`, so a deny for the old card would answer the new one; the old one is let go here only.
    if (session.pendingApproval) drop(session, "withdrawn");
    retries.delete(session.sid);
    session.pendingApproval = pendingOf(
      block,
      session.sid,
      session.turnMeta.turnId ?? "",
      expiresAt,
    );
    shownAt.set(keyOf(session.sid, block.id), deps.now());
    armTimer(session.sid, block.id, expiresAt);
  };

  const runtime: ApprovalsRuntime = {
    onConfirmationRequired(sid: Sid, frame: ConfirmationRequiredFrame) {
      const session = sessionOf(sid);
      const block = approvalOf(frame);
      if (!session || !block.id || session.pendingApproval?.id === block.id) return;
      const now = deps.now();
      const ttl = block.tool === "o2_delete" ? DELETE_TTL_MS : PERMISSION_TTL_MS;
      hold(session, block, Math.min(block.expiresAt ?? now + ttl, now + MAX_CARD_MS));
      trackShown(block, sid, session.turnMeta.turnId);
    },
    restore(sid, card) {
      const session = sessionOf(sid);
      const now = deps.now();
      // Only the server's own expiry is trusted after a reload; a card without one, or past it, is not answerable.
      if (!session || !card.id || typeof card.expiresAt !== "number" || card.expiresAt <= now)
        return false;
      if (session.pendingApproval?.id === card.id) return true;
      hold(session, card, Math.min(card.expiresAt, now + MAX_CARD_MS));
      return true;
    },
    release(sid, approvalId, state) {
      const session = sessionOf(sid);
      if (!session || session.pendingApproval?.id !== approvalId) return;
      if (inFlight.has(keyOf(sid, approvalId))) return;
      drop(session, state);
    },
    decide(sid, decision, approvalId) {
      const pending = sessionOf(sid)?.pendingApproval;
      // A click answers the card it was made on, and an approve always names it; a card that changed since is never decided for it.
      const named = approvalId === undefined ? !decision.approved : pending?.id === approvalId;
      if (!pending || !named) return Promise.resolve(emptyResult("failed", "", deps.now()));
      return run(sid, pending.id, decision);
    },
    async withdraw(sid, reason) {
      const pending = sessionOf(sid)?.pendingApproval;
      if (!pending) return;
      // Stop declines as a plain deny; its record says the answer was stopped.
      const decision: ApprovalDecision =
        reason === "stopped" ? { approved: false, reason: "deny" } : { approved: false, reason };
      await run(sid, pending.id, decision, reason === "stopped" ? "stopped" : undefined);
    },
    onResolved(sid: Sid, frame: ConfirmationResolvedFrame) {
      const session = sessionOf(sid);
      if (!session || session.pendingApproval?.id !== frame.id) return;
      if (inFlight.has(keyOf(sid, frame.id))) return;
      clearTimer(sid, frame.id);
      session.pendingApproval = null;
      deps.annotate(sid, approvalAnnotationKey(frame.id), {
        approvalOutcome: {
          state: frame.approved ? "approved_elsewhere" : "declined_elsewhere",
          at: typeof frame.at === "number" ? frame.at : deps.now(),
          ...(typeof frame.by === "string" && { by: frame.by.slice(0, 200) }),
        },
      });
      deps.engine().approvalDecided?.(sid);
    },
    async extend(sid) {
      const session = sessionOf(sid);
      const pending = session?.pendingApproval;
      if (!session || !pending || !deps.extendable()) return false;
      try {
        const response = await deps.extend(session.org, pending.sessionId, pending.id);
        const until = epochMs(response.expires_at);
        const current = sessionOf(sid)?.pendingApproval;
        if (until === null || current?.id !== pending.id) return false;
        current.expiresAt = Math.min(until, deps.now() + MAX_CARD_MS);
        armTimer(sid, pending.id, current.expiresAt);
        deps.engine().approvalExtended?.(sid);
        return true;
      } catch {
        return false;
      }
    },
    async sendAgain(sid, approvalId) {
      const entry = retries.get(sid);
      const session = sessionOf(sid);
      // Only the card that is still the turn's own goes again; anything else would answer whatever is pending now.
      if (!entry || !session || entry.id !== approvalId || session.pendingApproval) return;
      if (entry.turnId !== session.turnMeta.turnId) return;
      await run(sid, approvalId, entry.decision, entry.override, entry.until);
    },
    async askAgain(sid, approvalId) {
      const card = approvalCardOf(sessionOf(sid), approvalId);
      if (!card) return;
      const heading = approvalHeading(deps.t, card, card.total ?? card.targets.length);
      await deps.resend(
        sid,
        snapshotOf(deps.t("assistant.approval.askAgainPrompt", { heading })),
        "retry",
        { replyToApproval: approvalId },
      );
    },
    async undo(sid, ledgerId) {
      const entry = sessionOf(sid)?.ledger.find((candidate) => candidate.id === ledgerId);
      const result = await deps.dispatch(sid, { kind: "undo", ledgerId });
      if (result.ok && entry) deps.changed?.([entry.resource.type]);
      return result;
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      followUps.dispose();
      offs.forEach((off) => off());
    },
  };
  return runtime;
}

/** A card's time left as `m:ss`. */
export function approvalClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The plural entity noun key of a card's targets; mixed or unknown types read "object". */
export function approvalEntity(card: Pick<ApprovalBlockData, "targets">): string {
  // A redacted record keeps no targets.
  const types = new Set((card.targets ?? []).map((target) => target.type));
  return types.size === 1 ? entityKeyOf([...types][0]) : "object";
}

/** The entity noun key of one resource type; a type without its own noun reads "object". */
export function entityKeyOf(type: string | undefined): string {
  return type && ENTITY_KEYS.has(type) ? type : "object";
}

/** The card's heading: operation, count and entity in one sentence. */
export function approvalHeading(
  t: TranslateFn,
  card: Pick<ApprovalBlockData, "kind" | "targets" | "tool" | "args">,
  count: number,
): I18nText {
  const entity = approvalEntity(card);
  const noun = t(`assistant.entity.${entity}`, count);
  const toolset = typeof card.args?.toolset === "string" ? card.args.toolset : card.tool;
  switch (card.kind) {
    case "delete":
      return t("assistant.approval.heading.delete", { count, entity: noun }, count);
    case "update":
      return t("assistant.approval.heading.update", {
        entity: t(`assistant.entity.${entity}`, 1),
        name: raw(card.targets[0]?.name ?? ""),
      });
    case "create":
      return t("assistant.approval.heading.create", { entity: t(`assistant.entity.${entity}`, 1) });
    case "run_command":
      return t("assistant.approval.heading.runCommand", { toolset: raw(toolset) });
    default:
      return t("assistant.approval.heading.permission", { tool: raw(card.tool) });
  }
}

/** The in-app href of a target with an id, or of its type's list without one; `null` when this build has no such route. */
export function approvalTargetHref(
  router: Pick<Router, "resolve">,
  org: string,
  target: { type: string; id?: string; name?: string },
): string | null {
  const key = ROUTE_ID_KEY[target.type];
  if (target.id && !key) return null;
  const link = buildNavigationRoute(
    {
      resource_type: target.type,
      action: "navigate_direct",
      target: target.id ? { [key]: target.id, name: target.name ?? "" } : {},
    },
    org,
  );
  if (!link) return null;
  try {
    return router.resolve(link.route).href;
  } catch {
    return null;
  }
}

/** The record of an approval id in a session's annotations, or `null` when it was never decided here. */
export function approvalOutcomeOf(
  session: Pick<AssistantSession, "annotations"> | null | undefined,
  approvalId: string,
): { outcome: ApprovalOutcome | null; result: ApprovalResult | null } {
  const annotation = session?.annotations[approvalAnnotationKey(approvalId)];
  return {
    outcome: annotation?.approvalOutcome ?? null,
    result: annotation?.approvalResult ?? null,
  };
}

// A prompt that follows a decision (a reply, a narrowed batch) waits for the turn the decision resumed to end, and for the store to let it go.
function createFollowUps(
  deps: Pick<ApprovalsDeps, "resend" | "t">,
  sessionOf: (sid: Sid) => AssistantSession | undefined,
): {
  send(
    sid: Sid,
    id: string,
    decision: ApprovalDecision,
    card: ApprovalBlockData,
    narrowed: boolean,
  ): void;
  dispose(): void;
} {
  const waiting = new Set<() => void>();
  const afterTurn = (sid: Sid, send: () => void) => {
    const idle = () => {
      const turn = sessionOf(sid)?.turn;
      return !turn || turn.state === "idle" || isTerminal(turn);
    };
    const later = () => setTimeout(() => sessionOf(sid) && send(), 0);
    if (idle()) return void later();
    const stop = watch(
      () => sessionOf(sid)?.turn.state,
      () => {
        if (!idle()) return;
        stop();
        waiting.delete(stop);
        later();
      },
    );
    waiting.add(stop);
  };
  return {
    send(sid, id, decision, card, narrowed) {
      const text =
        narrowed && decision.approved
          ? deps.t("assistant.plan.onlyThese", { names: raw(namesOf(card, decision.items ?? [])) })
          : !decision.approved && decision.reason === "reply"
            ? raw(decision.reply ?? "")
            : null;
      if (!text?.trim()) return;
      afterTurn(
        sid,
        () => void deps.resend(sid, snapshotOf(text), "typed", { replyToApproval: id }),
      );
    },
    dispose() {
      waiting.forEach((stop) => stop());
      waiting.clear();
    },
  };
}

// A turn that ended under its card (stopped, failed, cancelled elsewhere) takes the card with it; a late batch on a done answer stays.
function watchEndedTurns(
  deps: Pick<ApprovalsDeps, "state">,
  inFlight: (key: string) => boolean,
  keyOf: (sid: Sid, id: string) => string,
  drop: (session: AssistantSession, state: ApprovalOutcome["state"]) => void,
): () => void {
  return watch(
    () =>
      Object.values(deps.state().sessions)
        .filter((session) => session.pendingApproval)
        .map((session) => `${session.sid}:${session.turn.state}`)
        .join(),
    () => {
      for (const session of Object.values(deps.state().sessions)) {
        const pending = session.pendingApproval;
        const turn = session.turn;
        if (!pending || !isTerminal(turn) || turn.state === "done") continue;
        if (inFlight(keyOf(session.sid, pending.id))) continue;
        const expired = turn.state === "failed" && turn.error.code === "approval_expired";
        drop(session, turn.state === "stopped" ? "stopped" : expired ? "expired" : "withdrawn");
      }
    },
  );
}

function pendingOf(
  block: ApprovalBlockData,
  sid: Sid,
  turnId: string,
  expiresAt: number,
): PendingApproval {
  return {
    id: block.id,
    sessionId: sid,
    turnId,
    kind: block.kind,
    destructive: block.destructive,
    operation: block.operation,
    tool: block.tool,
    targets: block.targets,
    ...(block.before !== undefined && { before: block.before }),
    ...(block.after !== undefined && { after: block.after }),
    ...(block.impact && { impact: block.impact }),
    expiresAt,
    askedIn: "here",
    grantable: block.grantable,
    editable: block.editable,
    question: block.question,
  };
}

function trackShown(block: ApprovalBlockData, sid: Sid, turnId: string | null): void {
  trackAssistant(
    "ai_approval_shown",
    {
      op: opOf(block.kind),
      resource_kind: approvalEntity(block),
      destructive: block.destructive,
      grantable: block.grantable,
      asked_in: "here",
      count: block.total ?? block.targets.length,
    },
    { sid, turnId: turnId ?? "unknown" },
  );
}

function trackDecision(
  sid: Sid,
  decision: ApprovalDecision,
  deps: Pick<ApprovalsDeps, "now" | "lastKeydownAt" | "state">,
  shown: number | undefined,
): void {
  const kind = decisionKind(decision);
  if (!kind) return;
  const now = deps.now();
  const pending = (deps.state().sessions[sid] as AssistantSession | undefined)?.pendingApproval;
  trackAssistant(
    "ai_approval_decided",
    {
      decision: kind,
      ...(decision.approved && { scope: decision.scope }),
      items_count: decision.approved ? (decision.items?.length ?? pending?.targets.length ?? 0) : 0,
      latency_ms: shown === undefined ? 0 : Math.max(0, now - shown),
      input: now - deps.lastKeydownAt() < KEYBOARD_INPUT_MS ? "keyboard" : "click",
    },
    { sid, turnId: pending?.turnId || "unknown" },
  );
}

function trackResult(
  sid: Sid,
  id: string,
  detail: ApprovalDetail | undefined,
  session: AssistantSession | undefined,
): void {
  const items = detail?.result?.items ?? [];
  const succeeded = items.filter((item) => item.status === "done").length;
  const status: AiEventProps["ai_approval_result"]["status"] = !detail
    ? "undelivered"
    : detail.result?.status === "partial"
      ? "partial"
      : detail.result?.status === "failed"
        ? "failed"
        : "succeeded";
  trackAssistant(
    "ai_approval_result",
    { status, succeeded_count: succeeded, failed_count: items.length - succeeded },
    { sid, turnId: session?.turnMeta.turnId ?? `approval:${id}` },
  );
}

function decisionKind(
  decision: ApprovalDecision,
): AiEventProps["ai_approval_decided"]["decision"] | null {
  if (decision.approved) return "approve";
  if (decision.reason === "deny" || decision.reason === "escape" || decision.reason === "reply")
    return decision.reason;
  return decision.reason === "edited" ? "edit_then_approve" : null;
}

function opOf(kind: ApprovalBlockData["kind"]): ApprovalOp {
  if (kind === "delete" || kind === "update" || kind === "create") return kind;
  return "run";
}

function namesOf(card: ApprovalBlockData, ids: string[]): string {
  const kept = new Set(ids);
  const names = card.targets
    .filter((target) => kept.has(target.id ?? target.name))
    .map((target) => target.name.slice(0, MAX_FOLLOW_UP_NAME_CHARS));
  const shown = names.slice(0, MAX_FOLLOW_UP_NAMES).join(", ");
  return names.length > MAX_FOLLOW_UP_NAMES
    ? `${shown} +${names.length - MAX_FOLLOW_UP_NAMES}`
    : shown;
}

// What an approve changed: the types of the rows that went through, or of the card's targets when it answers no rows.
function changedTypes(card: ApprovalBlockData, detail: ApprovalDetail | undefined): string[] {
  const items = detail?.result?.items.filter((item) => item.status === "done");
  return [...new Set((items ?? card.targets).map((item) => item.type))];
}

function epochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

function snapshotOf(text: string): ComposerSnapshot {
  return { text, chips: [], images: [], mentions: [], timeOverride: null };
}

function emptyResult(status: ApprovalResult["status"], by: string, at: number): ApprovalResult {
  return { status, items: [], resolvedBy: by, resolvedAt: at };
}
