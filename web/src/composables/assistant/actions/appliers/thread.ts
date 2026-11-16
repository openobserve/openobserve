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
import { periodMs, timeChipOf } from "../../context/contextChips";
import { footerOf, promptRange, stepsOf, turnAnnotationKey, windowsOf } from "../../evidence";
import { starterPayload, WIDER_PERIOD } from "../../starterPayload";
import { registerApplier, type Applier } from "../registry";
import type { AssistantAction } from "../types";

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

/** Sends the turn's question and chips again over the last hour, once, on the user's click (PO A26). */
export const rerunWiderApplier: Applier<Extract<AssistantAction, { kind: "rerun_wider" }>> = (
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
  const to = env.now();
  const payload = starterPayload(
    {
      prompt: String(turn.prompt.content ?? ""),
      chips: (turn.prompt.chips ?? [])
        .filter((chip) => chip.kind !== "time")
        .map((chip) => ({ ...toRaw(chip) })),
      period: WIDER_PERIOD,
    },
    session.org,
    to,
  );
  const snapshot: ComposerSnapshot = {
    text: payload.text,
    chips: payload.chips,
    images: [...(turn.prompt.images ?? [])],
    mentions: [],
    timeOverride: { from: to - periodMs(WIDER_PERIOD), to, period: WIDER_PERIOD },
  };
  void store.resend(sid, snapshot, "rerun");
  return { ok: true };
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
  registerApplier("rerun_wider", rerunWiderApplier);
}
