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

import type { ChatMessage } from "@/ts/interfaces/chat";

import { isRunning } from "../../assistantStore";
import type { AssistantSession, ComposerSnapshot } from "../../assistantStore.types";
import { timeChipOf } from "../../context/contextChips";
import { footerOf, promptRange, stepsOf, turnAnnotationKey, windowsOf } from "../../evidence";
import { registerApplier, type Applier } from "../registry";
import type { AssistantAction } from "../types";

// Findings' "Was this the cause?" rides the feedback action as a 1-5 rating, the scale o2-ai's `value` takes.
const CAUSE_VALUES: Record<string, number> = { "cause:yes": 5, "cause:unsure": 3, "cause:no": 1 };

const MAX_COMMENT_CHARS = 500;

const inFlight = new Set<string>();

/** Expands a step; the caller scrolls, focuses and highlights it. */
export const openStepApplier: Applier<Extract<AssistantAction, { kind: "open_step" }>> = (
  sid,
  action,
  env,
) => {
  const session = env.store().state.sessions[sid];
  if (!session) return { ok: false, reason: "failed" };
  if (!session.ui.expandedSteps.includes(action.callId)) env.store().toggleStep(sid, action.callId);
  return { ok: true };
};

/** The same text and chips over a window of the same length ending now; the draft is untouched. */
export const rerunApplier: Applier<Extract<AssistantAction, { kind: "rerun_now" }>> = (
  sid,
  action,
  env,
) => {
  const store = env.store();
  const session = store.state.sessions[sid];
  const turn = session ? turnOf(session, action.turnId) : null;
  if (!session || !turn?.prompt) return { ok: false, reason: "failed" };
  // A second send while a turn runs would join that turn, not start this one.
  if (isRunning(session.turn)) return { ok: false, reason: "gated" };
  const asked = session.annotations[turnAnnotationKey(action.turnId, "window")]?.window;
  const window = windowsOf(stepsOf(turn.answer, session.org))[0] ?? promptRange(turn.prompt, asked);
  if (!window) return { ok: false, reason: "failed" };
  const to = env.now();
  const from = to - (window.to - window.from);
  const time = timeChipOf({ from, to, source: "custom" }, session.org, env.t);
  const chips = (turn.prompt.chips ?? []).map((chip) =>
    chip.kind === "time" ? time : { ...toRaw(chip) },
  );
  const snapshot: ComposerSnapshot = {
    text: String(turn.prompt.content ?? ""),
    chips: chips.some((chip) => chip.kind === "time") ? chips : [time, ...chips],
    images: [...(turn.prompt.images ?? [])],
    mentions: [],
    timeOverride: { from, to },
  };
  void store.resend(sid, snapshot, "rerun");
  return { ok: true };
};

/** A vote on a done answer, sent with that turn's own trace id, server turn id and position. */
export const feedbackApplier: Applier<Extract<AssistantAction, { kind: "feedback" }>> = async (
  sid,
  action,
  env,
) => {
  const store = env.store();
  const session = store.state.sessions[sid];
  const turn = session ? turnOf(session, action.messageId) : null;
  const footer = footerOf(turn?.answer);
  if (!session || !turn || !footer) return { ok: false, reason: "failed" };
  const key = `${sid}\u0000${action.messageId}`;
  if (inFlight.has(key)) return { ok: false, reason: "failed" };
  const cause = action.reason?.startsWith("cause:") ? action.reason : null;
  const detail = action.comment?.trim().slice(0, MAX_COMMENT_CHARS);
  const reason = cause ? cause.replace(":", "_") : action.reason;
  const comment = reason ? (detail ? `${reason}: ${detail}` : reason) : detail;
  inFlight.add(key);
  try {
    await env.feedback(session.org, sid, {
      feedback_type: cause ? "rating" : action.vote === "up" ? "thumbs_up" : "thumbs_down",
      query_index: turn.index,
      ...(footer.traceId && { trace_id: footer.traceId }),
      turn_id: footer.serverTurnId ?? action.messageId,
      ...(cause && { value: CAUSE_VALUES[cause] }),
      ...(comment && { comment }),
    });
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(key);
  }
  store.annotate(sid, turnAnnotationKey(action.messageId, cause ? "findings" : "feedback"), {
    feedback: { rating: action.vote, ...(action.reason && { reason: action.reason }) },
  });
  return { ok: true, detail: cause ? {} : { turnId: action.messageId } };
};

/** A turn's prompt, its answer (the one `complete` closed) and its 0-based position. */
export function turnOf(
  session: Pick<AssistantSession, "messages">,
  turnId: string,
): { prompt: ChatMessage | null; answer: ChatMessage | null; index: number } | null {
  let index = -1;
  let found: { prompt: ChatMessage | null; answer: ChatMessage | null; index: number } | null =
    null;
  let inside = false;
  for (const message of session.messages) {
    if (message.role === "user") {
      index += 1;
      if (found && inside) break;
      inside = message.turnId === turnId;
      if (inside) found = { prompt: message, answer: null, index };
      continue;
    }
    // A legacy record may hold several answers for one prompt; the one `complete` closed carries the turn's data.
    if (inside && found && (!footerOf(found.answer) || footerOf(message))) found.answer = message;
    else if (message.turnId === turnId)
      found = { prompt: null, answer: message, index: Math.max(index, 0) };
  }
  return found;
}

export function registerThreadAppliers(): void {
  registerApplier("open_step", openStepApplier);
  registerApplier("rerun_now", rerunApplier);
  registerApplier("feedback", feedbackApplier);
}
