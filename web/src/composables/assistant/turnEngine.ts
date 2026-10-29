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

import { toRaw } from "vue";

import type { PageContext } from "@/composables/contextProviders/types";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { gt, raw, type TranslateFn } from "@/types/i18n";
import { epochMs } from "@/utils/assistant/explorerRoutes";

import { ERROR_LEDGER, isConsentPrompt } from "./assistantErrors";
import type { AssistantStoreInternal } from "./assistantStore";
import type {
  ApprovalsService,
  AssistantError,
  AssistantSession,
  AssistantState,
  ComposerSnapshot,
  HistoryService,
  RequestBuilder,
  RequestTurn,
  Sid,
  TelemetryContainer,
  TurnEngine,
  TurnInput,
  TurnMeta,
} from "./assistantStore.types";
import { contextUsedOf, transcriptOf } from "./context/serialize";
import type { ClientContext, PageContext as AssistantPageContext } from "./context/types";
import {
  createEffectsRunner,
  type EffectScope,
  type Effects,
  type EffectsRunner,
  type TurnSource,
} from "./effects";
import { turnAnnotationKey } from "./evidence";
import type { AssistantFrame } from "./frames";
import { generateNavigationFromToolResult } from "./navigationRoutes";
import { useAssistantName } from "./useAssistantName";
import {
  answerProgress,
  emptyExtras,
  interruptSteps,
  reduce,
  type ReducerCtx,
  type StreamState,
} from "./reducer";
import { createTurnRuntime, type TurnRuntime } from "./turnRuntime";
import {
  STALL_MS,
  STOP_TIMEOUT_MS,
  elapsedMs,
  outcomeRecordOf,
  turnReducer,
  type TurnEffect,
  type TurnReducerCtx,
} from "./turnStateMachine";
import { isTerminal, type TurnEvent, type TurnState, type TurnTerminal } from "./turnStates";
import type {
  AssistantClient,
  ClientSendRequest,
  FrameSink,
  SendResult,
} from "./useAssistantClient";

/** Back-off of the three read-only reconnects (HT-06 AC 2). */
export const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000] as const;

/** No frame at all (keepalives included) for this long on a resumable turn starts a reconnect (HT-06 AC 1). */
export const SILENCE_MS = 20_000;

/** A `done` turn whose stream stays open this long after `complete` is closed by the client. */
const LINGER_MS = 3_000;

/** A turn id goes on the wire at most twice: the send and one reuse (constraint 16). */
const MAX_ID_SENDS = 2;

const MAX_TIMER_MS = 2 ** 31 - 1;

// The card's own expiry declines it on the server first; the turn's timer ends the turn only after that had its chance.
const APPROVAL_GRACE_MS = 1_000;

// Mutating tools turn Retry into "Ask again" (`80` §1.3): rerunning cannot undo what they changed.
const MUTATING_TOOL = /^(o2_)?(delete|update|create|confirm)/i;

const PAGE_CONTEXT_FIELDS = [
  "org_id",
  "currentPage",
  "pageTitle",
  "selectedStreams",
  "streamType",
  "timeRange",
  "currentSQLQuery",
  "currentVRLQuery",
  "currentQuery",
  "dashboardId",
  "panelId",
  "alertId",
  "pipelineId",
  "incident_id",
] as const;

/** The capability notes and the one flag the engine reads (`00` §9). */
export interface EngineCapability {
  noteForbidden(): void;
  noteAgentUnavailable(): void;
  noteAdmitted(): void;
  persistence(): boolean;
  /** B-09 typed attachments; absent means delimiter blocks. */
  attachments?(): boolean;
  /** The server routes an explicit `mode: "chat"` past an incident's RCA default. */
  rcaChatMode?(): boolean;
}

export interface TurnEngineDeps {
  client: AssistantClient;
  store: () => AssistantStoreInternal;
  capability: () => EngineCapability;
  history: () => Pick<HistoryService, "save">;
  now(): number;
  uuid(): string;
  t?: TranslateFn;
  /** The active page provider's context, captured once at `queued` (S&S D16). */
  pageContext?: () => Promise<PageContext | AssistantPageContext | null>;
  uiVersion?: () => string;
  container?: () => TelemetryContainer;
  /** B-03: the resumable tail exists on this server. */
  tailEnabled?: () => boolean;
  raf?: (cb: () => void) => void;
  visibility?: { hidden(): boolean; onVisible(cb: () => void): () => void };
  /** The approvals runtime the reducer's card frames go to. */
  approvals?: () => Pick<ApprovalsService, "onConfirmationRequired" | "onResolved">;
}

/** The engine's record of one running turn; lives in `turnRuntime`, never in reactive state. */
interface TurnRecord {
  sid: Sid;
  org: string;
  turnId: string;
  snapshot: ComposerSnapshot;
  pageContext: Partial<AssistantPageContext>;
  /** The provider's context as captured at `queued`; the request builder applies the whitelist. */
  rawContext: PageContext | AssistantPageContext | null;
  client: ClientContext;
  input: TurnInput;
  source: TurnSource;
  mode?: "chat" | "generate_query";
  ephemeral?: boolean;
  userIndex: number;
  newSession: boolean;
  /** Regenerate: the answer this attempt replaces, put back if the attempt is refused. */
  replaced: ChatMessage[] | null;
  /** Edit and resend: the 1-based user message the text came from. */
  editedFrom?: number;
  stream: StreamState;
  /** Frames of an aborted request are ignored by comparing this. */
  generation: number;
  /** The generation whose admission already reached the state machine. */
  admittedGeneration: number;
  /** Times `turnId` went on the wire, across consent, restore and a same-id Retry. */
  idSends: number;
  restoreUsed: boolean;
  restoring: boolean;
  consentRetried: boolean;
  /** The approval card this turn's prompt answers (Reply, Ask again). */
  replyToApproval?: string;
  notSaved: boolean;
  streamEnded: boolean;
  /** Frames applied up to the resume cursor `turnMeta.lastSeq`: what a tail from the cursor builds on (WP-18). */
  throughSeq: AssistantFrame[];
  /** Frames applied since the cursor last moved; a tail from the cursor sends their content again. */
  sinceSeq: AssistantFrame[];
  cancelConfirmed?: boolean;
  cancelMs: number | null;
  silenceTimer?: ReturnType<typeof setTimeout>;
  /** An approval's TTL; apart from `expiryTimer`, which the stop timeout and the linger use. */
  approvalTimer?: ReturnType<typeof setTimeout>;
  settled: boolean;
  lingering: boolean;
  resolve(terminal: TurnTerminal): void;
  promise: Promise<TurnTerminal>;
}

/** What retry and continue need from a turn that already ended. */
interface LastTurn {
  turnId: string;
  snapshot: ComposerSnapshot;
  source: TurnSource;
  editedFrom?: number;
  idSends: number;
  mode?: "chat" | "generate_query";
}

/** A Retry's own snapshot and source; `clearsComposer` when the composer held what is resent. */
interface RetryOf {
  snapshot: ComposerSnapshot;
  source: TurnSource;
  clearsComposer: boolean;
}

/** `TurnEngine` of WP-01: the one place a turn is sent, streamed, stopped and retried. */
export function createTurnEngine(deps: TurnEngineDeps): TurnEngine {
  const runtime: TurnRuntime<TurnRecord> = createTurnRuntime<TurnRecord>();
  const last = new Map<Sid, LastTurn>();
  const t = deps.t ?? gt;
  let builder: RequestBuilder = defaultRequestBuilder(deps, runtime);
  let consentHandler: ((sid: Sid, err: AssistantError) => void) | null = null;

  const record = (sid: Sid) => runtime.get(sid)?.turn;
  const sessionOf = (sid: Sid) => deps.store().state.sessions[sid] as AssistantSession | undefined;

  const runner: EffectsRunner = createEffectsRunner({
    store: deps.store,
    history: deps.history,
    now: deps.now,
    raf: deps.raf,
    container: deps.container,
    scope: (sid) => scopeOf(record(sid)),
    engine: (sid, effect) => onEngineEffect(sid, effect),
  });

  const { product } = useAssistantName();
  const reducerCtx = (rec: TurnRecord): TurnReducerCtx => {
    const now = deps.now();
    const meta = sessionOf(rec.sid)?.turnMeta;
    return {
      now,
      ...progressOf(rec.stream),
      canRestore: !rec.restoreUsed && rec.idSends < MAX_ID_SENDS,
      cancelConfirmed: rec.cancelConfirmed,
      copy: { t, org: rec.org, product, elapsedMs: meta ? elapsedMs(meta, now) : 0 },
    };
  };

  const eventWork =
    (rec: TurnRecord, event: TurnEvent) =>
    (session: AssistantSession): Effects => {
      const before = session.turn;
      const { turn, effects } = turnReducer(session.turn, event, reducerCtx(rec));
      session.turn = askAgainIfMutated(turn, rec.stream);
      noteOutcome(session, rec, before);
      if (session.turn.state !== "awaiting_approval") clearApproval(rec);
      // HT-05 AC 4: whatever ended the turn, a step without its result is interrupted.
      if (isTerminal(session.turn)) interruptSteps(rec.stream);
      return { stream: [], turn: effects };
    };

  // The end of a turn that did not simply answer is written into its answer, so a reload renders the same block (HT-01 AC 7).
  const noteOutcome = (session: AssistantSession, rec: TurnRecord, before: TurnState) => {
    if (isTerminal(before) || !isTerminal(session.turn)) return;
    const now = deps.now();
    const record = outcomeRecordOf(session.turn, {
      at: now,
      turnId: rec.turnId,
      sessionId: rec.sid,
      traceId: session.turnMeta.traceId,
      cancelUnconfirmed: rec.cancelConfirmed === false,
      elapsedMs: elapsedMs(session.turnMeta, now),
    });
    if (record) appendToAnswer(session, rec, { type: "turn_outcome", outcome: record });
    stampDuration(session, rec, elapsedMs(session.turnMeta, now));
  };

  const invalidFindingsWork =
    (rec: TurnRecord) =>
    (session: AssistantSession): Effects => {
      if (acceptsFrames(session.turn))
        appendToAnswer(session, rec, { type: "findings", findings: null });
      return { stream: [], turn: [] };
    };

  const dispatch = (rec: TurnRecord, event: TurnEvent) => {
    // A late timer or callback of a turn that already ended must never touch the next turn's state.
    if (rec.settled) return;
    runner.flush(rec.sid, eventWork(rec, event));
    settleIfEnded(rec);
  };

  const frameWork =
    (rec: TurnRecord, frame: AssistantFrame) =>
    (session: AssistantSession): Effects => {
      const out: Effects = { stream: [], turn: [] };
      const ctx = reducerCtx(rec);
      if (session.turn.state === "connecting") {
        const first = turnReducer(session.turn, { type: "first_byte" }, ctx);
        session.turn = first.turn;
        out.turn.push(...first.effects);
      }
      session.turnMeta.lastFrameAt = deps.now();
      // A delete batch is proposed once the answer is complete, so its card still lands on that answer.
      const lateCard = frame.type === "confirmation_required" && session.turn.state === "done";
      if (acceptsFrames(session.turn) || lateCard) {
        rec.stream.messages = session.messages;
        const live = { ...liveCtx(t), pendingApprovalId: session.pendingApproval?.id ?? null };
        for (const effect of reduce(rec.stream, frame, live)) {
          if (effect.kind === "approval") {
            deps.approvals?.().onConfirmationRequired(rec.sid, effect.frame);
            // The stream pauses on the card, so no later save would keep it for a reload to restore.
            out.turn.push({ kind: "save" });
          } else if (effect.kind === "approval_resolved")
            deps.approvals?.().onResolved(rec.sid, effect.frame);
          else out.stream.push(effect);
        }
        mirrorExtras(session.turnMeta, rec.stream);
      }
      if (frame.type === "complete") {
        const used = contextUsedOf(frame);
        if (used) session.turnMeta.contextUsed = used;
      }
      const event =
        frame.type === "complete" && rec.notSaved ? { ...frame, persisted: false } : frame;
      const before = session.turn;
      const next = turnReducer(session.turn, event, reducerCtx(rec));
      session.turn = askAgainIfMutated(next.turn, rec.stream);
      noteOutcome(session, rec, before);
      out.turn.push(...next.effects);
      if (session.turn.state !== "awaiting_approval") clearApproval(rec);
      else if (frame.type === "confirmation_required")
        watchApproval(rec, session.pendingApproval?.expiresAt ?? frame.expires_at);
      return out;
    };

  const sinkFor = (rec: TurnRecord, tail = false): FrameSink => {
    const generation = (rec.generation += 1);
    const current = () => rec.generation === generation && !rec.settled;
    // A tail's first message proves it delivers; only then is what came since the cursor taken back, so a failed tail keeps the text.
    let resumed = !tail;
    const resume = () => {
      if (!resumed) rollBack(rec);
      resumed = true;
    };
    return {
      onAdmitted(result) {
        // A tail resumes an admitted turn; its own 200 is not a second admission (HT-06 caught up).
        if (!tail && current()) admit(rec, generation, result);
      },
      onFrame(frame, id) {
        if (!current()) return;
        // A frame proves admission, whatever order the transport reported them in.
        if (!tail) admit(rec, generation, { ok: true, status: 200, traceId: null });
        resume();
        const session = sessionOf(rec.sid);
        if (session?.turn.state === "reconnecting") dispatch(rec, { type: "tail_caught_up" });
        const fresh = session ? cursorFrame(rec, session.turnMeta, frame, id, tail) : frame;
        watchSilence(rec, true);
        if (!fresh) return;
        runner.schedule(rec.sid, frameWork(rec, fresh));
        if (fresh.type === "complete" || fresh.type === "error" || fresh.type === "cancelled") {
          runner.flush(rec.sid);
          settleIfEnded(rec);
        }
      },
      onKeepalive() {
        if (!current()) return;
        runner.schedule(rec.sid, eventWork(rec, { type: "keepalive" }));
        watchSilence(rec, false);
      },
      onBoundary(id) {
        if (!current()) return;
        resume();
        const meta = sessionOf(rec.sid)?.turnMeta;
        const seq = Number(id);
        // Everything through `seq` was sent: the tail resumes from here.
        if (meta && Number.isFinite(seq) && (meta.lastSeq === null || seq > meta.lastSeq))
          advance(rec, meta, seq);
        runner.schedule(rec.sid, eventWork(rec, { type: "keepalive" }));
        watchSilence(rec, false);
      },
      onUnknown(type) {
        if (!current()) return;
        runner.trackUnknown(type);
        // A findings frame that fails its schema still tells the reader the card could not be shown.
        if (type === "findings") runner.schedule(rec.sid, invalidFindingsWork(rec));
      },
      onEnd(reason) {
        if (!current()) return;
        runner.flush(rec.sid);
        // Stop, restore and reconnect abort on purpose and own what happens next.
        if (reason === "abort" && sessionOf(rec.sid)?.turn.state !== "done") return;
        rec.streamEnded = true;
        clearTimeout(rec.silenceTimer);
        if (reason === "oversized" || reason === "error") {
          const error = ledgerError(reason === "oversized" ? "stream_oversized" : "unknown");
          return dispatch(rec, { type: "fetch_error", error });
        }
        dispatch(rec, { type: "eof", hasTail: hasTail(rec) });
      },
    };
  };

  // The SSE id rule (WP-18): a frame tagged N comes after seq N and several frames share N, so a repeated id is never a reason to drop one.
  const cursorFrame = (
    rec: TurnRecord,
    meta: TurnMeta,
    frame: AssistantFrame,
    id: string | null,
    tail: boolean,
  ): AssistantFrame | null => {
    const seq = id === null ? NaN : Number(id);
    // A tail starts at the cursor; content before it was applied in full.
    if (tail && Number.isFinite(seq) && meta.lastSeq !== null && seq < meta.lastSeq) return null;
    // A frame tagged N also proves seq N complete; the first ids of a turn (`-1`) come before any boundary.
    if (Number.isFinite(seq) && (meta.lastSeq === null || seq > meta.lastSeq))
      advance(rec, meta, seq);
    rec.sinceSeq.push(frame);
    return frame;
  };

  const advance = (rec: TurnRecord, meta: TurnMeta, seq: number) => {
    meta.lastSeq = seq;
    rec.throughSeq.push(...rec.sinceSeq);
    rec.sinceSeq = [];
  };

  // The tail resends everything past the cursor, merged and without transient frames, so the answer is rebuilt from the frames through the cursor and the tail applies on top (WP-18).
  const rollBack = (rec: TurnRecord) => {
    if (!rec.sinceSeq.length) return;
    rec.sinceSeq = [];
    runner.flush(rec.sid, (session) => {
      // The engine's own blocks (the restored marker written at admission) are no frames, so they are kept and put back first, where they were.
      const kept = session.messages
        .slice(rec.userIndex + 1)
        .flatMap((message) => message.contentBlocks ?? [])
        .filter((block) => block.type === "turn_outcome");
      truncateAnswer(session, rec);
      for (const block of kept) appendToAnswer(session, rec, block);
      rec.stream = freshStream(session.messages);
      for (const frame of rec.throughSeq) reduce(rec.stream, frame, liveCtx(t));
      mirrorExtras(session.turnMeta, rec.stream);
      return { stream: [], turn: [] };
    });
  };

  const hasTail = (rec: TurnRecord) =>
    !!deps.tailEnabled?.() &&
    deps.capability().persistence() &&
    typeof sessionOf(rec.sid)?.turnMeta.lastSeq === "number";

  // The 30 s stall line is derived from `lastFrameAt`; this timer only emits its event and starts reconnects.
  const watchSilence = (rec: TurnRecord, progress: boolean) => {
    const entry = runtime.get(rec.sid);
    if (!entry || rec.settled) return;
    if (progress) {
      clearTimeout(entry.keepaliveTimer);
      entry.keepaliveTimer = setTimeout(() => runner.trackStall(rec.sid), STALL_MS);
    }
    clearTimeout(rec.silenceTimer);
    if (!hasTail(rec)) return;
    rec.silenceTimer = setTimeout(() => {
      runtime.renew(rec.sid);
      rec.streamEnded = true;
      dispatch(rec, { type: "eof", hasTail: true });
    }, SILENCE_MS);
  };

  const watchApproval = (rec: TurnRecord, expiresAt: number | undefined) => {
    clearApproval(rec);
    if (typeof expiresAt !== "number") return;
    const callId = (sessionOf(rec.sid)?.turn as { callId?: string }).callId ?? "";
    rec.approvalTimer = setTimeout(
      () => {
        rec.approvalTimer = undefined;
        dispatch(rec, { type: "approval_expired", callId });
      },
      // A delay past the timer's range would fire at once, so a far-off expiry waits as long as a timer can.
      Math.min(Math.max(0, expiresAt - deps.now()) + APPROVAL_GRACE_MS, MAX_TIMER_MS),
    );
  };

  const clearApproval = (rec: TurnRecord) => {
    clearTimeout(rec.approvalTimer);
    rec.approvalTimer = undefined;
  };

  const settleIfEnded = (rec: TurnRecord) => {
    const session = sessionOf(rec.sid);
    if (rec.settled) return;
    // Sign-out resets the store while a stop is still settling; the turn ends with what it had.
    if (!session) return release(rec, { state: "stopped", steps: 0, partial: false });
    if (!isTerminal(session.turn)) return;
    if (session.turn.state === "done" && !rec.streamEnded) {
      // The answer is in, so the caller (and the store's in-flight guard) is released now; the record lingers.
      rec.resolve(toRaw(session.turn) as TurnTerminal);
      return lingerAfterComplete(rec);
    }
    if (session.turn.state === "failed" && session.turn.error.code === "approval_expired")
      void cancelQuietly(rec, session);
    last.set(rec.sid, {
      turnId: rec.turnId,
      snapshot: rec.snapshot,
      source: rec.source,
      ...(rec.editedFrom && { editedFrom: rec.editedFrom }),
      idSends: rec.idSends,
      mode: rec.mode,
    });
    release(rec, toRaw(session.turn) as TurnTerminal);
  };

  const release = (rec: TurnRecord, terminal: TurnTerminal) => {
    rec.settled = true;
    if (runtime.get(rec.sid) && !rec.streamEnded) runtime.abort(rec.sid, "ended");
    clearTimeout(rec.silenceTimer);
    clearApproval(rec);
    runtime.delete(rec.sid);
    runner.forget(rec.sid);
    rec.resolve(terminal);
  };

  const lingerAfterComplete = (rec: TurnRecord) => {
    const entry = runtime.get(rec.sid);
    if (!entry || rec.lingering) return;
    rec.lingering = true;
    clearTimeout(entry.expiryTimer);
    entry.expiryTimer = setTimeout(() => {
      entry.expiryTimer = undefined;
      closeLingering(rec);
    }, LINGER_MS);
  };

  // The answer is complete, so a stream the server keeps open is closed by us, never left reading.
  const closeLingering = (rec: TurnRecord) => {
    runtime.abort(rec.sid, "ended");
    rec.streamEnded = true;
    dispatch(rec, { type: "eof", hasTail: false });
  };

  const cancelQuietly = (rec: TurnRecord, session: AssistantSession) =>
    deps.client.stop(rec.org, stopTarget(session, rec)).catch(() => undefined);

  const attempt = async (rec: TurnRecord): Promise<void> => {
    const entry = runtime.get(rec.sid);
    const session = sessionOf(rec.sid);
    if (!entry || !session || rec.settled) return;
    try {
      const request = builder(
        session,
        rec.snapshot,
        rec.client,
        requestTurnOf(rec, deps),
      ) as ClientSendRequest;
      rec.streamEnded = false;
      rec.idSends += 1;
      const sink = sinkFor(rec);
      const generation = rec.generation;
      const result = await deps.client.send(request, sink, entry.controller.signal);
      if (rec.settled) return;
      if (result.ok) return admit(rec, generation, result);
      if (result.aborted) return;
      dispatch(rec, { type: "admitted", result: { ok: false, error: refusalOf(rec, result) } });
    } catch {
      // The client turns network failures into results, so a throw here is our bug: `unknown`, never offline.
      const queued = sessionOf(rec.sid)?.turn.state === "queued";
      const error = {
        ...ledgerError("unknown"),
        phase: queued ? ("pre_admission" as const) : ("post_admission" as const),
        turnId: rec.turnId,
      };
      dispatch(rec, { type: "fetch_error", error });
    }
  };

  const admit = (
    rec: TurnRecord,
    generation: number,
    result: Extract<SendResult, { ok: true }>,
  ) => {
    if (rec.admittedGeneration >= generation || rec.settled) return;
    rec.admittedGeneration = generation;
    const restored = rec.restoring;
    rec.restoring = false;
    runner.flush(rec.sid, (session) => {
      if (result.traceId) session.turnMeta.traceId = result.traceId;
      if (restored) {
        session.turnMeta.restored = true;
        appendToAnswer(session, rec, {
          type: "turn_outcome",
          outcome: { kind: "restored", at: deps.now(), turnId: rec.turnId },
        });
      }
      return { stream: [], turn: [] };
    });
    dispatch(rec, { type: "admitted", result: { ok: true, status: result.status } });
    // Constraint 11: the restore is announced only once the replacement request was admitted.
    if (restored) deps.store().announce(rec.sid, "assistant.turn.restored");
    watchSilence(rec, true);
  };

  // The 412 is the consent prompt the first time and a refusal on the same-turn retry (`80` §1.3).
  const refusalOf = (rec: TurnRecord, result: Extract<SendResult, { ok: false }>) => {
    const { error } = result;
    if (!isConsentPrompt(error.httpStatus, result.body)) return error;
    if (rec.consentRetried)
      return {
        ...error,
        code: "consent_still_required" as const,
        ...ERROR_LEDGER.consent_still_required,
      };
    const session = sessionOf(rec.sid);
    const consent = (result.body as { consent?: unknown } | null)?.consent;
    if (session && consent) {
      session.pendingConsent = {
        org: rec.org,
        feature: "ai_credits",
        status: consent as NonNullable<AssistantSession["pendingConsent"]>["status"],
        turnId: rec.turnId,
        snapshot: rec.snapshot,
      };
    }
    return error;
  };

  const onEngineEffect = (sid: Sid, effect: TurnEffect) => {
    const rec = record(sid);
    if (effect.kind === "capability") return noteCapability(effect.note);
    if (!rec) return;
    if (effect.kind === "cancel") return void cancel(rec);
    if (effect.kind === "restore") return void restore(rec);
    if (effect.kind === "reconnect") return void reconnect(rec, effect.attempt);
    if (effect.kind === "not_saved") rec.notSaved = true;
    if (effect.kind === "consent") consentHandler?.(sid, effect.error);
  };

  const noteCapability = (note: "forbidden" | "agent_unavailable" | "admitted") => {
    const capability = deps.capability();
    if (note === "forbidden") capability.noteForbidden();
    else if (note === "agent_unavailable") capability.noteAgentUnavailable();
    else capability.noteAdmitted();
  };

  // Stop = abort + keepalive cancel on the session's route; stopped after the ack or 3 s (HT-04 AC 2-4).
  const cancel = async (rec: TurnRecord) => {
    const entry = runtime.get(rec.sid);
    const session = sessionOf(rec.sid);
    if (!entry || !session) return;
    const started = deps.now();
    runtime.abort(rec.sid);
    runner.flush(rec.sid, () => {
      interruptSteps(rec.stream);
      return { stream: [], turn: [] };
    });
    const acked = deps.client.stop(rec.org, stopTarget(session, rec));
    clearTimeout(entry.expiryTimer);
    // A failed cancel is known to be unconfirmed at once; only a silent one waits out the 3 s.
    const confirmed = await new Promise<boolean>((resolve) => {
      entry.expiryTimer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS);
      acked.then(
        () => resolve(true),
        () => resolve(false),
      );
    });
    clearTimeout(entry.expiryTimer);
    entry.expiryTimer = undefined;
    rec.cancelConfirmed = confirmed;
    rec.cancelMs = confirmed ? deps.now() - started : null;
    dispatch(rec, { type: "cancel_acked" });
  };

  const restore = async (rec: TurnRecord) => {
    rec.restoreUsed = true;
    rec.restoring = true;
    runtime.renew(rec.sid);
    // A browser-only chat cannot be restored under its old id; the replacement gets a new one (constraint 7).
    if (!deps.capability().persistence()) renameSession(rec, deps.uuid());
    runner.flush(rec.sid, (session) => {
      truncateAnswer(session, rec);
      // The replacement turn numbers its frames afresh; an old seq would drop them as replays.
      session.turnMeta.lastSeq = null;
      rec.throughSeq = [];
      rec.sinceSeq = [];
      rec.stream = freshStream(session.messages);
      return { stream: [], turn: [] };
    });
    await attempt(rec);
  };

  const renameSession = (rec: TurnRecord, newSid: Sid) => {
    const state = deps.store().state as AssistantState;
    const session = state.sessions[rec.sid];
    if (!session) return;
    const oldSid = rec.sid;
    session.sid = newSid;
    state.sessions[newSid] = session;
    delete state.sessions[oldSid];
    state.recent = state.recent.map((id) => (id === oldSid ? newSid : id));
    if (state.shell.activeSid === oldSid) state.shell.activeSid = newSid;
    runtime.rename(oldSid, newSid);
    runner.rename(oldSid, newSid);
    rec.sid = newSid;
  };

  const reconnect = async (rec: TurnRecord, attemptNo: number) => {
    await delay(RECONNECT_DELAYS_MS[attemptNo - 1] ?? RECONNECT_DELAYS_MS[2]);
    await whenVisible(deps.visibility);
    const session = sessionOf(rec.sid);
    const entry = runtime.get(rec.sid);
    if (rec.settled || session?.turn.state !== "reconnecting" || !entry || entry.tailLock) return;
    const controller = runtime.renew(rec.sid);
    if (!controller) return;
    rec.streamEnded = false;
    const turnId = session.turnMeta.serverTurnId ?? rec.turnId;
    const fromSeq = session.turnMeta.lastSeq ?? -1;
    const tail = deps.client.tail(
      rec.org,
      rec.sid,
      turnId,
      fromSeq,
      sinkFor(rec, true),
      controller.signal,
    );
    entry.tailLock = tail;
    const result = await tail.finally(() => {
      entry.tailLock = undefined;
    });
    if (result.ok || result.aborted || rec.settled) return;
    if (result.error.code === "signed_out")
      return dispatch(rec, { type: "fetch_error", error: result.error });
    rec.streamEnded = true;
    dispatch(rec, { type: "eof", hasTail: true });
  };

  const start = async (
    sid: Sid,
    opts: Parameters<TurnEngine["send"]>[1] = {},
    retryOf: RetryOf | null = null,
  ): Promise<TurnTerminal> => {
    const store = deps.store();
    const session = sessionOf(sid);
    if (!session || !store.state.ready) return refusedUnknown();
    const source = retryOf?.source ?? sourceOf(opts);
    const fromComposer = retryOf ? retryOf.clearsComposer : source === "composer";
    const snapshot =
      retryOf?.snapshot ??
      opts.snapshot ??
      (source === "regenerate" ? lastPromptSnapshot(session) : snapshotOf(session.composer));
    if (!snapshot || (!snapshot.text.trim() && !snapshot.chips.length && !snapshot.images.length))
      return refusedUnknown();
    const rec = newRecord(session, opts, snapshot, source, deps);
    const previous = last.get(sid);
    if (previous && previous.turnId === rec.turnId) rec.idSends = previous.idSends;
    runtime.set(sid, { controller: new AbortController(), turn: rec });
    runner.flush(sid, (s) => queueTurn(s, rec, deps.now(), fromComposer));
    if (fromComposer) store.drafts.remove(session.userOrgKey, sid);
    rec.rawContext = await safePageContext(deps);
    rec.pageContext = whitelist(rec.rawContext, snapshot);
    const asked = noteSentWindow(sessionOf(rec.sid), rec);
    if (asked) store.annotate(rec.sid, turnAnnotationKey(rec.turnId, "window"), { window: asked });
    if (sessionOf(rec.sid)?.turn.state === "queued") await attempt(rec);
    return rec.promise;
  };

  const resumeConsent = (rec: TurnRecord) => {
    rec.consentRetried = true;
    const session = sessionOf(rec.sid);
    if (session) session.pendingConsent = null;
    // Nothing was admitted, so a fresh id is safe once the current one has had its one reuse.
    if (rec.idSends >= MAX_ID_SENDS) {
      rec.turnId = deps.uuid();
      rec.idSends = 0;
      if (session) session.turnMeta.turnId = rec.turnId;
    }
    dispatch(rec, { type: "consent_enable" });
    void attempt(rec);
  };

  const engine: TurnEngine = {
    send(sid, opts = {}) {
      const rec = record(sid);
      const current = sessionOf(sid)?.turn;
      // A turn lingering after `complete` is over; close it so the new Send is not swallowed.
      if (rec && current && isTerminal(current)) closeLingering(rec);
      if (!rec || record(sid) !== rec) return start(sid, opts);
      // WP-10's Enable resends the waiting turn with its own id, exactly once (constraint 16).
      if (
        sessionOf(sid)?.turn.state === "awaiting_consent" &&
        opts.turnId === rec.turnId &&
        !rec.consentRetried
      )
        resumeConsent(rec);
      return rec.promise;
    },
    approvalDecided(sid) {
      const rec = record(sid);
      const turn = sessionOf(sid)?.turn;
      if (rec && turn?.state === "awaiting_approval")
        dispatch(rec, { type: "approval_decided", callId: turn.callId, approved: true });
    },
    consentWithdrawn(sid) {
      const rec = record(sid);
      const session = sessionOf(sid);
      if (!rec || session?.turn.state !== "awaiting_consent") return;
      session.pendingConsent = null;
      dispatch(rec, { type: "consent_enable" });
      dispatch(rec, { type: "stop" });
    },
    approvalExtended(sid, until) {
      const rec = record(sid);
      const session = sessionOf(sid);
      if (rec && session?.turn.state === "awaiting_approval")
        watchApproval(rec, until ?? session.pendingApproval?.expiresAt);
    },
    // A decision on its way must never meet a cancel from the card's own expiry; the runtime re-arms it if the decision does not land.
    approvalSending(sid) {
      const rec = record(sid);
      if (rec) clearApproval(rec);
    },
    async stop(sid) {
      const rec = record(sid);
      const session = sessionOf(sid);
      if (!rec || !session) return;
      if (session.turn.state === "awaiting_consent") session.pendingConsent = null;
      // A persisted turn the server already took keeps running and saving after the abort, so it is cancelled too.
      if (session.turn.state === "queued" && rec.idSends > 0 && deps.capability().persistence())
        void cancelQuietly(rec, session);
      dispatch(rec, { type: "stop" });
      await rec.promise.then(() => undefined);
    },
    async stopAll(reason) {
      // Every stream stops reading at once; the cancels and the stopped states follow per turn.
      const sids = runtime.abortAll(reason);
      await Promise.all(sids.map((sid) => engine.stop(sid)));
    },
    async signedOutElsewhere() {
      // The session is gone: each stream stops reading, its cancel goes out, and the turn ends with Sign in.
      for (const sid of runtime.abortAll("signed_out")) {
        const rec = record(sid);
        const session = sessionOf(sid);
        if (!rec || !session) continue;
        deps.client.stop(rec.org, stopTarget(session, rec)).catch(() => undefined);
        dispatch(rec, { type: "signed_out" });
      }
    },
    retry(sid) {
      const session = sessionOf(sid);
      const previous = last.get(sid);
      if (!session || !previous || record(sid)) return Promise.resolve(refusedUnknown());
      const turn = session.turn;
      if (turn.state !== "refused" && turn.state !== "failed")
        return Promise.resolve(isTerminal(turn) ? turn : refusedUnknown());
      const typed = session.composer.text;
      // Only a composer turn reads the composer: an edited one is a new message, the snapshot's chips and images stay.
      const edited =
        previous.source === "composer" && typed.trim() !== "" && typed !== previous.snapshot.text;
      const snapshot = edited ? { ...previous.snapshot, text: typed } : previous.snapshot;
      // A refusal gave the snapshot back to the composer; resending it empties the composer again.
      const restored =
        previous.source !== "regenerate" && typed.trim() !== "" && typed === previous.snapshot.text;
      // Pre-admission Retry is the same turn: same id (once) and the queued snapshot (HT-03 AC 5).
      const sameTurn = turn.state === "refused" && !edited && previous.idSends < MAX_ID_SENDS;
      const opts = {
        turnId: sameTurn ? previous.turnId : undefined,
        input: "retry" as const,
        mode: previous.mode,
        ...(previous.editedFrom && { editedFrom: previous.editedFrom }),
      };
      const clearsComposer = edited || restored;
      return start(sid, opts, { snapshot, source: previous.source, clearsComposer });
    },
    continueTurn(sid) {
      const chips = last.get(sid)?.snapshot.chips ?? [];
      deps
        .store()
        .stage(sid, { text: t("assistant.turn.continuePrefill"), chips, mode: "replace" });
    },
    async retrySave(sid, turnId) {
      const session = sessionOf(sid);
      if (!session || !deps.capability().persistence()) return;
      if (session.turnMeta.turnId !== turnId || session.turn.state !== "done") return;
      const saved = await deps.history().save(sid);
      const current = sessionOf(sid);
      if (saved === "server" && current?.turn.state === "done")
        current.turn = { state: "done", saved };
    },
    turnFrames(sid) {
      const rec = runtime.get(sid)?.turn;
      return rec ? { turnId: rec.turnId, frames: [...rec.throughSeq, ...rec.sinceSeq] } : null;
    },
    canRetry(sid) {
      const session = sessionOf(sid);
      return !!last.get(sid) && !record(sid) && !!session && isTerminal(session.turn);
    },
    async cancelTurn(sid, turnId) {
      const session = sessionOf(sid);
      if (!session) return false;
      const target = {
        sid,
        origin: session.origin,
        record: session.record,
        turnId,
      };
      return deps.client.stop(session.org, target).then(
        () => true,
        () => false,
      );
    },
    setRequestBuilder(next) {
      builder = next;
    },
    setConsentHandler(handler) {
      consentHandler = handler;
    },
  };
  return engine;
}

// The default body until WP-05 installs `serialize.ts`: typed text, this message's images, whitelisted page context.
function defaultRequestBuilder(
  deps: Pick<TurnEngineDeps, "capability">,
  runtime: Pick<TurnRuntime<TurnRecord>, "get">,
): RequestBuilder {
  return (session, snapshot, client) => {
    const rec = runtime.get(session.sid)?.turn;
    const persisted = deps.capability().persistence();
    const request: ClientSendRequest = {
      org: session.org,
      sid: session.sid,
      turnId: session.turnMeta.turnId ?? rec?.turnId ?? "",
      message: {
        text: snapshot.text,
        ...(snapshot.images.length > 0 && { images: [...snapshot.images] }),
      },
      context: {
        ...(rec?.pageContext ?? {}),
        client,
        user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      ...wireModeOf(rec?.mode, deps.capability()),
      ...(rec?.ephemeral && { ephemeral: true }),
      ...(rec?.replyToApproval && { replyToApproval: rec.replyToApproval }),
    };
    if (persisted) {
      const seq = session.record.cachedLastSeq;
      return typeof seq === "number" ? { ...request, knownSeq: seq } : request;
    }
    // Without server persistence the server keeps no history, so the transcript still goes, text only (P-20).
    return { ...request, transcript: transcriptOf(session.messages, rec?.userIndex) };
  };
}

function requestTurnOf(rec: TurnRecord, deps: TurnEngineDeps): RequestTurn {
  const capability = deps.capability();
  return {
    pageContext: rec.rawContext as PageContext | null,
    turnId: rec.turnId,
    ...wireModeOf(rec.mode, capability),
    ...(rec.ephemeral && { ephemeral: true }),
    userIndex: rec.userIndex,
    persisted: capability.persistence(),
    attachments: capability.attachments?.() ?? false,
    ...(capability.rcaChatMode?.() && { rcaChatMode: true }),
    now: deps.now(),
    ...(rec.replyToApproval && { replyToApproval: rec.replyToApproval }),
  };
}

// A server without the capability predates explicit chat mode, so the turn keeps its default route.
function wireModeOf(
  mode: TurnRecord["mode"],
  capability: EngineCapability,
): { mode?: "chat" | "generate_query" } {
  if (mode === "generate_query") return { mode };
  return capability.rcaChatMode?.() === true ? { mode: "chat" } : {};
}

function newRecord(
  session: AssistantSession,
  opts: Parameters<TurnEngine["send"]>[1] & object,
  snapshot: ComposerSnapshot,
  source: TurnSource,
  deps: TurnEngineDeps,
): TurnRecord {
  let resolve: (terminal: TurnTerminal) => void = () => undefined;
  const promise = new Promise<TurnTerminal>((r) => {
    resolve = r;
  });
  return {
    sid: session.sid,
    org: session.org,
    turnId: opts.turnId ?? deps.uuid(),
    snapshot,
    pageContext: {},
    rawContext: null,
    client: clientContextOf(session, deps.uiVersion?.() ?? ""),
    input: opts.input ?? "typed",
    source,
    mode: opts.mode,
    ephemeral: opts.ephemeral,
    userIndex: -1,
    newSession: session.messages.length === 0,
    replaced: null,
    ...(opts.editedFrom && { editedFrom: opts.editedFrom }),
    stream: freshStream(session.messages),
    generation: 0,
    admittedGeneration: 0,
    idSends: 0,
    restoreUsed: false,
    restoring: false,
    consentRetried: false,
    ...(opts.replyToApproval && { replyToApproval: opts.replyToApproval }),
    notSaved: false,
    streamEnded: false,
    throughSeq: [],
    sinceSeq: [],
    cancelMs: null,
    settled: false,
    lingering: false,
    resolve,
    promise,
  };
}

function sourceOf(opts: Parameters<TurnEngine["send"]>[1] = {}): TurnSource {
  if (opts.input === "regenerate") return "regenerate";
  return opts.snapshot || opts.input === "edit_resend" ? "edit" : "composer";
}

// `queued`: snapshot taken, user message appended, composer cleared; nothing is saved before admission (constraint 13).
function queueTurn(
  session: AssistantSession,
  rec: TurnRecord,
  now: number,
  fromComposer: boolean,
): Effects {
  const { turn, effects } = turnReducer(
    session.turn,
    { type: "send", turnId: rec.turnId },
    { now },
  );
  session.turn = turn;
  session.turnMeta = freshMeta(rec.turnId, now);
  session.pendingConsent = null;
  if (rec.source === "regenerate") queueAttempt(session, rec);
  else queuePrompt(session, rec, now);
  rec.stream.messages = session.messages;
  // Regenerate and Edit and resend send their own text; the composer draft stays as it is (EB-09 AC 2).
  if (!fromComposer) return { stream: [], turn: effects };
  Object.assign(session.composer, {
    text: "",
    chips: [],
    images: [],
    timeOverride: null,
    recallIndex: -1,
    recallDraft: null,
  });
  return { stream: [], turn: effects };
}

function queuePrompt(session: AssistantSession, rec: TurnRecord, now: number): void {
  const { images, chips } = rec.snapshot;
  session.messages.push({
    role: "user",
    content: raw(rec.snapshot.text),
    sentAt: now,
    turnId: rec.turnId,
    ...(images.length > 0 && { images: [...images] }),
    ...(chips.length > 0 && { chips: chips.map((chip) => ({ ...toRaw(chip) })) }),
    ...(rec.editedFrom && { editedFrom: rec.editedFrom }),
    ...(rec.input === "rerun" &&
      rec.snapshot.timeOverride && {
        rerunFor: { from: rec.snapshot.timeOverride.from, to: rec.snapshot.timeOverride.to },
      }),
  });
  rec.userIndex = session.messages.length - 1;
}

// The window the turn asked about, so a query block or "Open in Logs instead" opens an absolute range.
function noteSentWindow(
  session: AssistantSession | undefined,
  rec: TurnRecord,
): { from: number; to: number } | null {
  const prompt = session?.messages[rec.userIndex];
  const range = rec.pageContext?.timeRange;
  const from = epochMs(range?.startTime);
  const to = epochMs(range?.endTime);
  if (prompt?.role !== "user" || from === null || to === null || to <= from) return null;
  prompt.sentWindow = { from, to };
  return prompt.sentWindow;
}

// The trail header's duration is the turn's own, kept beside its footer.
function stampDuration(session: AssistantSession, rec: TurnRecord, durationMs: number): void {
  const answer = session.messages
    .slice(rec.userIndex + 1)
    .reverse()
    .find((message) => message.role === "assistant");
  const footer = answer?.contentBlocks?.find((block) => block.type === "footer");
  if (footer?.footer) footer.footer = { ...footer.footer, durationMs };
}

// A regenerated attempt keeps the user message; the previous answer becomes a version of the new one (`30` §8.2).
function queueAttempt(session: AssistantSession, rec: TurnRecord): void {
  const userIndex = lastUserIndex(session.messages);
  rec.userIndex = userIndex;
  // The new attempt is the one shown, even when the reader was on an older version.
  delete session.ui.activeVersion[session.messages[userIndex]?.turnId ?? `m${userIndex}`];
  const replaced = session.messages.splice(userIndex + 1);
  rec.replaced = replaced;
  const previous = replaced.filter((message) => message.role === "assistant");
  // An attempt that failed with nothing said is a banner, not an answer, so it never becomes a version.
  const versions = previous.flatMap((message) => [
    ...(message.versions ?? []),
    ...(isOutcomeOnly(message) ? [] : [{ ...toRaw(message), versions: undefined }]),
  ]);
  session.messages.push({
    role: "assistant",
    content: raw(""),
    contentBlocks: [],
    turnId: rec.turnId,
    ...(versions.length > 0 && { versions }),
  });
}

// A rebuilt answer starts from frames, which carry no earlier versions, so a regenerated answer's versions move onto the new shell.
function truncateAnswer(session: AssistantSession, rec: TurnRecord): void {
  const answer = session.messages
    .slice(rec.userIndex + 1)
    .find((message) => message.role === "assistant");
  session.messages.splice(rec.userIndex + 1);
  if (!answer?.versions?.length) return;
  session.messages.push({
    role: "assistant",
    content: raw(""),
    contentBlocks: [],
    turnId: answer.turnId,
    versions: answer.versions,
  });
}

function isOutcomeOnly(message: ChatMessage): boolean {
  return (
    !String(message.content ?? "").trim() &&
    (message.contentBlocks ?? []).every((block) => block.type === "turn_outcome")
  );
}

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
  return -1;
}

// The prompt of the latest turn as a snapshot; Regenerate resends exactly it.
function lastPromptSnapshot(session: AssistantSession): ComposerSnapshot | null {
  const index = lastUserIndex(session.messages);
  const prompt = session.messages[index];
  if (!prompt) return null;
  return {
    text: String(prompt.content ?? ""),
    chips: (prompt.chips ?? []).map((chip) => ({ ...toRaw(chip) })),
    images: [...(prompt.images ?? [])],
    mentions: [],
    timeOverride: null,
  };
}

// The turn's answer, created when the turn ended before writing one (a failure or Stop with nothing streamed).
function appendToAnswer(
  session: AssistantSession,
  rec: TurnRecord,
  block: NonNullable<ChatMessage["contentBlocks"]>[number],
): void {
  if (rec.userIndex < 0) return;
  const after = session.messages.slice(rec.userIndex + 1);
  let answer = [...after].reverse().find((message) => message.role === "assistant");
  if (!answer) {
    answer = { role: "assistant", content: raw(""), contentBlocks: [], turnId: rec.turnId };
    session.messages.push(answer);
  }
  answer.contentBlocks = [...(answer.contentBlocks ?? []), block];
}

function freshMeta(turnId: string, now: number): TurnMeta {
  return {
    turnId,
    serverTurnId: null,
    ownedByThisTab: true,
    startedAt: now,
    firstByteAt: null,
    traceId: null,
    lastSeq: null,
    usage: null,
    contextUsed: null,
    lastFrameAt: now,
    pausedAt: null,
    pausedMs: 0,
    caughtUpAt: null,
    cancelUnconfirmed: false,
    restored: false,
    compacted: false,
  };
}

function freshStream(messages: AssistantSession["messages"]): StreamState {
  return {
    messages,
    activeToolCall: null,
    textSegment: "",
    streamingMsg: "",
    title: undefined,
    lastTraceId: null,
    ownerUnavailable: false,
    pendingConfirmation: null,
    messageComplete: false,
    halted: false,
    extras: emptyExtras(),
  };
}

function liveCtx(t: TranslateFn): ReducerCtx {
  return {
    isActive: true,
    autoNavigationEnabled: false,
    phase: "live",
    t,
    generateNavigation: (tool, args, body) => generateNavigationFromToolResult(tool, args, body, t),
  };
}

// HT-07 AC 8: `usage`, `compacted` and the trace id of `complete` are kept on the turn.
function mirrorExtras(meta: TurnMeta, stream: StreamState): void {
  const extras = stream.extras;
  const traceId = stream.lastTraceId ?? extras?.traceId;
  if (traceId) meta.traceId = traceId;
  if (!extras) return;
  if (extras.serverTurnId) meta.serverTurnId = extras.serverTurnId;
  if (extras.compacted) meta.compacted = true;
  const usage = extras.usage;
  if (usage)
    meta.usage = {
      tokensIn: usage.input_tokens ?? 0,
      tokensOut: usage.output_tokens ?? 0,
      ...(typeof usage.cached_tokens === "number" && { cachedTokens: usage.cached_tokens }),
      ...(typeof usage.llm_calls === "number" && { llmCalls: usage.llm_calls }),
    };
}

function progressOf(stream: StreamState): { steps: number; partial: boolean } {
  const progress = answerProgress(stream);
  const last = stream.messages[stream.messages.length - 1];
  // A card (approval or navigation) is an answer too, so it never reads as an empty turn.
  const card =
    last?.role === "assistant" && !!last.contentBlocks?.some((b) => b.pendingConfirmation);
  return { steps: progress.steps, partial: progress.partial || card };
}

function askAgainIfMutated(turn: TurnState, stream: StreamState): TurnState {
  if (turn.state !== "failed" || turn.error.action !== "retry") return turn;
  const last = stream.messages[stream.messages.length - 1];
  const mutated = last?.contentBlocks?.some(
    (block) => block.stepState === "done" && !!block.tool && MUTATING_TOOL.test(block.tool),
  );
  return mutated ? { ...turn, error: { ...turn.error, action: "ask_again" } } : turn;
}

function acceptsFrames(turn: TurnState): boolean {
  return (
    turn.state !== "idle" &&
    !isTerminal(turn) &&
    turn.state !== "stopping" &&
    turn.state !== "awaiting_consent"
  );
}

function scopeOf(rec: TurnRecord | undefined): EffectScope | null {
  if (!rec) return null;
  const extras = rec.stream.extras ?? emptyExtras();
  return {
    turnId: rec.turnId,
    snapshot: rec.snapshot,
    userIndex: rec.userIndex,
    newSession: rec.newSession,
    input: rec.input,
    source: rec.source,
    replaced: rec.replaced,
    surface: surfaceOf(rec.client.container),
    toolCalls: extras.toolCalls,
    toolErrors: extras.toolErrors,
    cancelMs: rec.cancelMs,
  };
}

function surfaceOf(container: ClientContext["container"]): EffectScope["surface"] {
  if (container === "rca") return "rca";
  return container === "nl_bar" ? "inline_helper" : "chat";
}

function stopTarget(session: AssistantSession, rec: TurnRecord) {
  return { sid: rec.sid, origin: session.origin, record: session.record, turnId: rec.turnId };
}

function clientContextOf(session: AssistantSession, uiVersion: string): ClientContext {
  return {
    container: session.origin.container,
    entry_kind: session.origin.entryKind,
    entry_verb: session.origin.container === "nl_bar" ? "generate_query" : "ask",
    object_kind: session.origin.objectKind,
    ui_version: uiVersion,
  };
}

function snapshotOf(composer: AssistantSession["composer"]): ComposerSnapshot {
  const raw = toRaw(composer);
  return {
    text: raw.text,
    chips: raw.chips.map((chip) => ({ ...toRaw(chip) })),
    images: [...raw.images],
    mentions: [],
    timeOverride: raw.timeOverride ? { ...raw.timeOverride } : null,
    removedPageKeys: [...raw.removedPageKeys],
  };
}

function whitelist(
  context: PageContext | AssistantPageContext | null,
  snapshot: ComposerSnapshot,
): Partial<AssistantPageContext> {
  const out: Record<string, unknown> = {};
  for (const field of PAGE_CONTEXT_FIELDS) {
    const value = (context as Record<string, unknown> | null)?.[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  if (snapshot.timeOverride) out.timeRange = { ...snapshot.timeOverride };
  return out as Partial<AssistantPageContext>;
}

async function safePageContext(
  deps: Pick<TurnEngineDeps, "pageContext">,
): Promise<PageContext | AssistantPageContext | null> {
  try {
    return (await deps.pageContext?.()) ?? null;
  } catch {
    return null;
  }
}

function ledgerError(code: "stream_oversized" | "unknown"): AssistantError {
  return { code, ...ERROR_LEDGER[code] };
}

function refusedUnknown(): TurnTerminal {
  return {
    state: "refused",
    error: { code: "unknown", phase: "pre_admission", retryable: false, action: "none" },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// HT-06 AC 8: a hidden tab waits and reconnects the moment it is visible again.
function whenVisible(visibility: TurnEngineDeps["visibility"]): Promise<void> {
  const watch = visibility ?? documentVisibility();
  if (!watch.hidden()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch.onVisible(() => {
      stop();
      resolve();
    });
  });
}

function documentVisibility(): NonNullable<TurnEngineDeps["visibility"]> {
  return {
    hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    onVisible(cb) {
      const listener = () => {
        if (document.visibilityState === "visible") cb();
      };
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}
