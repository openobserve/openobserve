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

import { generateNavigationFromToolResult } from "@/components/O2AIChat.navigation";
import type { PageContext } from "@/composables/contextProviders/types";
import { gt, raw, type TranslateFn } from "@/types/i18n";

import { ERROR_LEDGER, isConsentPrompt } from "./assistantErrors";
import type { AssistantStoreInternal } from "./assistantStore";
import type {
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
import { createEffectsRunner, type EffectScope, type Effects, type EffectsRunner } from "./effects";
import type { AssistantFrame } from "./frames";
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
  mode?: "chat" | "generate_query" | "rca";
  ephemeral?: boolean;
  userIndex: number;
  newSession: boolean;
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
  notSaved: boolean;
  streamEnded: boolean;
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
  idSends: number;
  mode?: "chat" | "generate_query" | "rca";
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
      const { turn, effects } = turnReducer(session.turn, event, reducerCtx(rec));
      session.turn = askAgainIfMutated(turn, rec.stream);
      if (session.turn.state !== "awaiting_approval") clearApproval(rec);
      // HT-05 AC 4: whatever ended the turn, a step without its result is interrupted.
      if (isTerminal(session.turn)) interruptSteps(rec.stream);
      return { stream: [], turn: effects };
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
      if (acceptsFrames(session.turn)) {
        rec.stream.messages = session.messages;
        out.stream.push(...reduce(rec.stream, frame, liveCtx(t)));
        mirrorExtras(session.turnMeta, rec.stream);
      }
      if (frame.type === "complete") {
        const used = contextUsedOf(frame);
        if (used) session.turnMeta.contextUsed = used;
      }
      const event =
        frame.type === "complete" && rec.notSaved ? { ...frame, persisted: false } : frame;
      const next = turnReducer(session.turn, event, reducerCtx(rec));
      session.turn = askAgainIfMutated(next.turn, rec.stream);
      out.turn.push(...next.effects);
      if (session.turn.state !== "awaiting_approval") clearApproval(rec);
      else if (frame.type === "confirmation_required") watchApproval(rec, frame.expires_at);
      return out;
    };

  const sinkFor = (rec: TurnRecord, tail = false): FrameSink => {
    const generation = (rec.generation += 1);
    const current = () => rec.generation === generation && !rec.settled;
    return {
      onAdmitted(result) {
        // A tail resumes an admitted turn; its own 200 is not a second admission (HT-06 caught up).
        if (!tail && current()) admit(rec, generation, result);
      },
      onFrame(frame, id) {
        if (!current()) return;
        // A frame proves admission, whatever order the transport reported them in.
        if (!tail) admit(rec, generation, { ok: true, status: 200, traceId: null });
        const seq = id === null ? NaN : Number(id);
        const session = sessionOf(rec.sid);
        // A tail replays from `from_seq`; a frame at or before the last seen seq is already applied (HT-06 AC 2).
        if (Number.isFinite(seq) && session && (session.turnMeta.lastSeq ?? -1) >= seq) return;
        if (Number.isFinite(seq) && session) session.turnMeta.lastSeq = seq;
        if (session?.turn.state === "reconnecting") dispatch(rec, { type: "tail_caught_up" });
        runner.schedule(rec.sid, frameWork(rec, frame));
        watchSilence(rec, true);
        if (frame.type === "complete" || frame.type === "error" || frame.type === "cancelled") {
          runner.flush(rec.sid);
          settleIfEnded(rec);
        }
      },
      onKeepalive() {
        if (!current()) return;
        runner.schedule(rec.sid, eventWork(rec, { type: "keepalive" }));
        watchSilence(rec, false);
      },
      onUnknown(type) {
        if (current()) runner.trackUnknown(type);
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
      Math.max(0, expiresAt - deps.now()),
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
      if (restored) session.turnMeta.restored = true;
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
      session.messages.splice(rec.userIndex + 1);
      // The replacement turn numbers its frames afresh; an old seq would drop them as replays.
      session.turnMeta.lastSeq = null;
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
    const fromSeq = session.turnMeta.lastSeq ?? 0;
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
    snapshotOverride: ComposerSnapshot | null = null,
  ): Promise<TurnTerminal> => {
    const store = deps.store();
    const session = sessionOf(sid);
    if (!session || !store.state.ready) return refusedUnknown();
    const snapshot = snapshotOverride ?? snapshotOf(session.composer);
    if (!snapshot.text.trim() && !snapshot.chips.length && !snapshot.images.length)
      return refusedUnknown();
    const rec = newRecord(session, opts, snapshot, deps);
    const previous = last.get(sid);
    if (previous && previous.turnId === rec.turnId) rec.idSends = previous.idSends;
    runtime.set(sid, { controller: new AbortController(), turn: rec });
    runner.flush(sid, (s) => queueTurn(s, rec, deps.now()));
    store.drafts.remove(session.userOrgKey, sid);
    rec.rawContext = await safePageContext(deps);
    rec.pageContext = whitelist(rec.rawContext, snapshot);
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
    async stop(sid) {
      const rec = record(sid);
      const session = sessionOf(sid);
      if (!rec || !session) return;
      if (session.turn.state === "awaiting_consent") session.pendingConsent = null;
      dispatch(rec, { type: "stop" });
      await rec.promise.then(() => undefined);
    },
    async stopAll(reason) {
      // Every stream stops reading at once; the cancels and the stopped states follow per turn.
      const sids = runtime.abortAll(reason);
      await Promise.all(sids.map((sid) => engine.stop(sid)));
    },
    retry(sid) {
      const session = sessionOf(sid);
      const previous = last.get(sid);
      if (!session || !previous || record(sid)) return Promise.resolve(refusedUnknown());
      const turn = session.turn;
      if (turn.state !== "refused" && turn.state !== "failed")
        return Promise.resolve(isTerminal(turn) ? turn : refusedUnknown());
      // An edited composer is a new message: its text wins, the snapshot's chips and images stay.
      const typed = session.composer.text;
      const edited = typed.trim() !== "" && typed !== previous.snapshot.text;
      const snapshot = edited ? { ...previous.snapshot, text: typed } : previous.snapshot;
      // Pre-admission Retry is the same turn: same id (once) and the queued snapshot (HT-03 AC 5).
      const sameTurn = turn.state === "refused" && !edited && previous.idSends < MAX_ID_SENDS;
      const opts = {
        turnId: sameTurn ? previous.turnId : undefined,
        input: "retry" as const,
        mode: previous.mode,
      };
      return start(sid, opts, snapshot);
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
      ...(rec?.mode && { mode: rec.mode }),
      ...(rec?.ephemeral && { ephemeral: true }),
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
    ...(rec.mode && { mode: rec.mode }),
    ...(rec.ephemeral && { ephemeral: true }),
    userIndex: rec.userIndex,
    persisted: capability.persistence(),
    attachments: capability.attachments?.() ?? false,
    now: deps.now(),
  };
}

function newRecord(
  session: AssistantSession,
  opts: Parameters<TurnEngine["send"]>[1] & object,
  snapshot: ComposerSnapshot,
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
    mode: opts.mode,
    ephemeral: opts.ephemeral,
    userIndex: -1,
    newSession: session.messages.length === 0,
    stream: freshStream(session.messages),
    generation: 0,
    admittedGeneration: 0,
    idSends: 0,
    restoreUsed: false,
    restoring: false,
    consentRetried: false,
    notSaved: false,
    streamEnded: false,
    cancelMs: null,
    settled: false,
    lingering: false,
    resolve,
    promise,
  };
}

// `queued`: snapshot taken, user message appended, composer cleared; nothing is saved before admission (constraint 13).
function queueTurn(session: AssistantSession, rec: TurnRecord, now: number): Effects {
  const { turn, effects } = turnReducer(
    session.turn,
    { type: "send", turnId: rec.turnId },
    { now },
  );
  session.turn = turn;
  session.turnMeta = freshMeta(rec.turnId, now);
  session.pendingConsent = null;
  const images = rec.snapshot.images;
  session.messages.push({
    role: "user",
    content: raw(rec.snapshot.text),
    ...(images.length > 0 && { images: [...images] }),
  });
  rec.userIndex = session.messages.length - 1;
  rec.stream.messages = session.messages;
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
  if (stream.lastTraceId) meta.traceId = stream.lastTraceId;
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
    surface: rec.client.container === "rca" ? "rca" : "chat",
    toolCalls: extras.toolCalls,
    toolErrors: extras.toolErrors,
    cancelMs: rec.cancelMs,
  };
}

function stopTarget(session: AssistantSession, rec: TurnRecord) {
  const incidentId = rec.pageContext.incident_id;
  return {
    sid: rec.sid,
    origin: session.origin,
    record: session.record,
    turnId: rec.turnId,
    ...(typeof incidentId === "string" && { incidentId }),
  };
}

function clientContextOf(session: AssistantSession, uiVersion: string): ClientContext {
  return {
    container: session.origin.container,
    entry_kind: session.origin.entryKind,
    entry_verb: "ask",
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
