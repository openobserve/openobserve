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

import {
  trackAssistant,
  trackAssistantAdmitted,
  type AiErrorCode,
  type AiEventProps,
} from "@/services/assistantAnalytics";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { sessionView, type AssistantStoreInternal } from "./assistantStore";
import type {
  AssistantError,
  AssistantSession,
  ComposerSnapshot,
  HistoryService,
  Sid,
  TelemetryContainer,
  TurnInput,
} from "./assistantStore.types";
import type { StreamEffect } from "./reducer";
import { elapsedMs, type TurnEffect } from "./turnStateMachine";

/** Saves while a turn streams are at most one per this long, plus the terminal one (`00` §14). */
export const SAVE_INTERVAL_MS = 3_000;

// Ended turn ids kept for the once-per-turn rule; only a late duplicate of a recent turn needs one.
const ENDED_MEMORY = 200;
// A server-generated title is untrusted text; the history and the header both cap a title here.
const GENERATED_TITLE_MAX = 200;

/** The reducer and state-machine output of one commit; animate, segment, dashboard, navigate and confirm effects are dropped (`00` §5.6). */
export interface Effects {
  stream: StreamEffect[];
  turn: TurnEffect[];
}

/** One frame's or event's change to the session; runs inside the batch's single commit. */
export type SessionWork = (session: AssistantSession) => Effects;

/** Where a turn's prompt came from; a Retry keeps it, so a retried Regenerate stays a new version. */
export type TurnSource = "composer" | "regenerate" | "edit";

/** What the engine knows about the turn an effect belongs to. */
export interface EffectScope {
  turnId: string;
  snapshot: ComposerSnapshot | null;
  /** Index of this turn's user message; a refusal removes it again (constraint 13). */
  userIndex: number;
  newSession: boolean;
  input: TurnInput;
  source: TurnSource;
  surface: "chat" | "inline_helper" | "rca";
  toolCalls: number;
  toolErrors: number;
  /** Milliseconds the cancel took to be acknowledged; `null` when it was not (HT-04 AC 4). */
  cancelMs: number | null;
  /** Regenerate: the answer the refused attempt replaced, put back as it was. */
  replaced?: ChatMessage[] | null;
}

export interface EffectsDeps {
  store: () => AssistantStoreInternal;
  history: () => Pick<HistoryService, "save">;
  now(): number;
  /** One callback per animation frame; injectable for specs. */
  raf?: (cb: () => void) => void;
  /** The telemetry container a turn ended in (`container_at_end`). */
  container?: () => TelemetryContainer;
  /** Wraps the store write of one batch; specs count it. */
  commit?: (sid: Sid, write: (session: AssistantSession) => void) => void;
  /** Engine-owned effects: the network, timers and the capability notes. */
  engine(sid: Sid, effect: TurnEffect): void;
  scope(sid: Sid): EffectScope | null;
}

export interface EffectsRunner {
  /** Queues work for the next animation frame; a burst of frames becomes one commit (HT-08 AC 2). */
  schedule(sid: Sid, work: SessionWork): void;
  /** Runs the queued work and `work` now in one commit; admissions and terminals cannot wait a frame. */
  flush(sid: Sid, work?: SessionWork): void;
  applyEffects(sid: Sid, effects: Effects): void;
  trackUnknown(type: string): void;
  trackStall(sid: Sid): void;
  /** A session's sid changed (browser-only restore); queued work follows it. */
  rename(oldSid: Sid, newSid: Sid): void;
  forget(sid: Sid): void;
}

interface SaveSlot {
  lastAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** The only place reducer effects reach the store, storage, telemetry or the engine's network side. */
export function createEffectsRunner(deps: EffectsDeps): EffectsRunner {
  const raf = deps.raf ?? defaultRaf;
  const queues = new Map<Sid, SessionWork[]>();
  const saves = new Map<Sid, SaveSlot>();
  const ended = new Set<string>();
  // Sent turn ids not yet admitted or ended; the legacy send event fires once, at admission (`99` §3.4).
  const held = new Set<string>();
  let scheduled = false;

  const commit =
    deps.commit ??
    ((sid: Sid, write: (session: AssistantSession) => void) => {
      const session = deps.store().state.sessions[sid] as AssistantSession | undefined;
      if (session) write(session);
    });

  // Session writes the effects ask for land in the batch's own commit, so a burst stays one commit.
  const run = (sid: Sid, works: SessionWork[]): Effects => {
    const effects: Effects = { stream: [], turn: [] };
    commit(sid, (session) => {
      for (const work of works) {
        const out = work(session);
        effects.stream.push(...out.stream);
        effects.turn.push(...out.turn);
      }
      effects.turn = effects.turn.filter((effect) => !applyMeta(session, effect, deps.now()));
      if (effects.stream.some((effect) => effect.kind === "scroll") && !session.ui.follow)
        session.ui.unseen += 1;
    });
    return effects;
  };

  const flushAll = () => {
    scheduled = false;
    const batch = [...queues.entries()];
    queues.clear();
    for (const [sid, works] of batch) runner.applyEffects(sid, run(sid, works));
  };

  const save = (sid: Sid, force: boolean) => {
    // Helper and analysis sessions are never written or listed.
    if (deps.store().state.sessions[sid]?.record.ephemeral) return;
    const slot = saves.get(sid) ?? { lastAt: -Infinity };
    saves.set(sid, slot);
    const wait = slot.lastAt + SAVE_INTERVAL_MS - deps.now();
    if (!force && wait > 0) {
      slot.timer ??= setTimeout(() => {
        slot.timer = undefined;
        save(sid, true);
      }, wait);
      return;
    }
    clearTimeout(slot.timer);
    slot.timer = undefined;
    slot.lastAt = deps.now();
    const store = deps.store();
    const pending = deps.history().save(sid);
    store.trackSave(sid, pending);
    void pending.catch(() => undefined);
  };

  const telemetry = (sid: Sid, effect: TurnEffect, scope: EffectScope | null) => {
    const session = deps.store().state.sessions[sid] as AssistantSession | undefined;
    if (!session || !scope) return;
    const ids = { sid, turnId: scope.turnId, traceId: session.turnMeta.traceId ?? undefined };
    if (effect.kind === "track_sent") {
      // A pre-admission Retry reuses the turn id (constraint 16); each attempt ends once.
      ended.delete(scope.turnId);
      held.add(scope.turnId);
      trackAssistant("ai_turn_sent", sentProps(scope), ids);
    } else if (effect.kind === "track_admitted" && held.delete(scope.turnId))
      trackAssistantAdmitted(ids);
    else if (effect.kind === "track_first_byte")
      trackAssistant("ai_turn_first_byte", { ttfb_ms: ttfbOf(session) ?? 0 }, ids);
    else if (effect.kind === "track_state") {
      const props = { state: effect.state, elapsed_ms: elapsedMs(session.turnMeta, deps.now()) };
      trackAssistant("ai_turn_state", effect.tool ? { ...props, tool: effect.tool } : props, ids);
    } else if (effect.kind === "track_stop")
      trackAssistant("ai_stop", stopProps(scope, effect.partial), ids);
    else if (effect.kind === "track_ended" && !ended.has(scope.turnId)) {
      // HT-11 AC 2: exactly once per turn id, whatever path ended it.
      ended.add(scope.turnId);
      held.delete(scope.turnId);
      if (ended.size > ENDED_MEMORY) ended.delete(ended.values().next().value as string);
      trackAssistant("ai_turn_ended", endedProps(session, scope, effect, deps), ids);
    }
  };

  const applyTurnEffect = (sid: Sid, effect: TurnEffect, scope: EffectScope | null) => {
    const store = deps.store();
    if (effect.kind.startsWith("track_")) return telemetry(sid, effect, scope);
    if (effect.kind === "announce") return store.announce(sid, effect.key, effect.params);
    if (effect.kind === "save") return save(sid, true);
    if (effect.kind === "meta" || effect.kind === "pause" || effect.kind === "resume")
      return commit(sid, (session) => void applyMeta(session, effect, deps.now()));
    if (effect.kind === "restore_draft" && scope) return restoreDraft(store, sid, scope);
    deps.engine(sid, effect);
  };

  const applyStreamEffect = (sid: Sid, effect: StreamEffect) => {
    if (effect.kind === "save" || effect.kind === "throttledSave") save(sid, false);
    else if (
      effect.kind === "animateTitle" &&
      typeof effect.title === "string" &&
      effect.title.trim()
    )
      deps
        .store()
        .setTitle(sid, raw(effect.title.trim().slice(0, GENERATED_TITLE_MAX)), "generated");
  };

  const runner: EffectsRunner = {
    schedule(sid, work) {
      const queue = queues.get(sid) ?? [];
      queue.push(work);
      queues.set(sid, queue);
      if (scheduled) return;
      scheduled = true;
      raf(flushAll);
    },
    flush(sid, work) {
      const works = queues.get(sid) ?? [];
      queues.delete(sid);
      if (work) works.push(work);
      if (works.length) runner.applyEffects(sid, run(sid, works));
    },
    applyEffects(sid, effects) {
      const scope = deps.scope(sid);
      for (const effect of effects.stream) applyStreamEffect(sid, effect);
      for (const effect of effects.turn) applyTurnEffect(sid, effect, scope);
    },
    trackUnknown(type) {
      trackAssistant("ai_frame_unknown", { type });
    },
    trackStall(sid) {
      const scope = deps.scope(sid);
      const session = deps.store().state.sessions[sid] as AssistantSession | undefined;
      if (!scope || !session) return;
      const elapsed = elapsedMs(session.turnMeta, deps.now());
      const ids = { sid, turnId: scope.turnId, traceId: session.turnMeta.traceId ?? undefined };
      trackAssistant("ai_turn_state", { state: "stall", elapsed_ms: elapsed }, ids);
    },
    rename(oldSid, newSid) {
      const queue = queues.get(oldSid);
      if (queue) {
        queues.delete(oldSid);
        queues.set(newSid, queue);
      }
      const slot = saves.get(oldSid);
      if (slot) {
        saves.delete(oldSid);
        saves.set(newSid, slot);
      }
    },
    forget(sid) {
      queues.delete(sid);
      const slot = saves.get(sid);
      clearTimeout(slot?.timer);
      saves.delete(sid);
    },
  };

  return runner;
}

function defaultRaf(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => cb());
  else setTimeout(cb, 16);
}

// True when the effect was a `turnMeta` write and is now applied.
function applyMeta(session: AssistantSession, effect: TurnEffect, now: number): boolean {
  const meta = session.turnMeta;
  if (effect.kind === "meta") Object.assign(meta, effect.patch);
  else if (effect.kind === "pause") meta.pausedAt ??= now;
  else if (effect.kind === "resume" && typeof meta.pausedAt === "number") {
    meta.pausedMs = (meta.pausedMs ?? 0) + (now - meta.pausedAt);
    meta.pausedAt = null;
  } else return effect.kind === "resume";
  return true;
}

// Constraint 13: the composer gets the snapshot back and the optimistic user message goes, so nothing is stored.
function restoreDraft(store: AssistantStoreInternal, sid: Sid, scope: EffectScope): void {
  const session = store.state.sessions[sid] as AssistantSession | undefined;
  if (!session) return;
  // A refused regenerate keeps the prompt and its answer; nothing came from the composer, so nothing goes back to it.
  if (scope.source === "regenerate") {
    if (scope.userIndex >= 0)
      session.messages.splice(scope.userIndex + 1, Infinity, ...(scope.replaced ?? []));
    return;
  }
  if (scope.userIndex >= 0 && session.messages.length > scope.userIndex)
    session.messages.splice(scope.userIndex);
  // An edit never overwrites the user's draft; Retry still resends the edit's own snapshot.
  if (scope.source === "edit" && !composerEmpty(session)) return;
  if (scope.snapshot) store.restoreDraft(sid, scope.snapshot);
}

function composerEmpty(session: AssistantSession): boolean {
  const { text, chips, images } = session.composer;
  return !text.trim() && chips.length === 0 && images.length === 0;
}

function sentProps(scope: EffectScope): AiEventProps["ai_turn_sent"] {
  const snapshot = scope.snapshot;
  const chips = snapshot?.chips ?? [];
  const images = snapshot?.images ?? [];
  const bytes =
    chips.reduce((sum, chip) => sum + chip.sizeBytes, 0) +
    images.reduce((sum, image) => sum + image.size, 0);
  return {
    input: scope.input,
    chip_count: chips.length,
    chip_kinds: [...new Set(chips.map((chip) => chip.kind))],
    image_count: images.length,
    attached_bytes: bytes,
    prompt_chars: snapshot?.text.length ?? 0,
    new_session: scope.newSession,
  };
}

function stopProps(scope: EffectScope, partial: boolean): AiEventProps["ai_stop"] {
  return { surface: scope.surface, server_cancel_ms: scope.cancelMs, partial_kept: partial };
}

function endedProps(
  session: AssistantSession,
  scope: EffectScope,
  effect: Extract<TurnEffect, { kind: "track_ended" }>,
  deps: EffectsDeps,
): AiEventProps["ai_turn_ended"] {
  const { error } = effect;
  const meta = session.turnMeta;
  const store = deps.store();
  return {
    outcome: effect.outcome,
    error_code: turnErrorCode(error),
    http_status: error?.httpStatus ?? null,
    recoverable: error?.retryable ?? false,
    duration_ms: meta.startedAt === null ? 0 : Math.max(0, deps.now() - meta.startedAt),
    ttfb_ms: ttfbOf(session),
    tool_calls: scope.toolCalls,
    tool_errors: scope.toolErrors,
    tokens_in: meta.usage?.tokensIn ?? null,
    tokens_out: meta.usage?.tokensOut ?? null,
    credits: null,
    container_at_end: deps.container?.() ?? "home",
    seen: sessionView(session, store.state.shell).visible,
  };
}

// `history_unavailable` is a read code outside the `99` §3.5 enum; on a turn the agent could not serve it.
function turnErrorCode(error: AssistantError | null): AiErrorCode | null {
  if (!error) return null;
  return error.code === "history_unavailable" ? "agent_unavailable" : (error.code as AiErrorCode);
}

function ttfbOf(session: AssistantSession): number | null {
  const { startedAt, firstByteAt } = session.turnMeta;
  return startedAt === null || firstByteAt === null ? null : Math.max(0, firstByteAt - startedAt);
}
