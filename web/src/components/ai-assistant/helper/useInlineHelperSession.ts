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

import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from "vue";

import { isRunning, useAssistantStore } from "@/composables/assistant";
import { answerTextOf, lastAnswerOf } from "@/composables/assistant/pure";
import type {
  AssistantError,
  AssistantSession,
  ContextChip,
  EntryKind,
  InlineHostAdapter,
  QueryBlockData,
  Sid,
  TurnMeta,
  TurnState,
} from "@/composables/assistant/pure";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import { extractProposal, firstAnswerLine, helperRequest, questionOf } from "./helperText";

/** Prompts kept for ↑/↓ in one helper instance; never written anywhere. */
export const RECALL_LIMIT = 10;

/** Page fields the helper never sends: its chips name the stream and range, and edit mode sends the query. */
export const HELPER_SUPPRESSED_PAGE_KEYS = [
  "selectedStreams",
  "currentSQLQuery",
  "currentVRLQuery",
  "currentQuery",
];

/** What the helper row shows for the session's latest turn. */
export type HelperState =
  | { kind: "idle" }
  | { kind: "running"; turn: TurnState; meta: TurnMeta }
  | { kind: "consent"; turn: TurnState; meta: TurnMeta }
  | { kind: "stopped" }
  | { kind: "not_sent" }
  | { kind: "failed"; error: AssistantError; refused: boolean; elapsedMs: number }
  | {
      kind: "proposal";
      text: string;
      validated?: boolean;
      timeRange?: { from: number; to: number };
    }
  | { kind: "needs_chat"; line: string; answer: string }
  | { kind: "needs_detail"; question: string; answer: string }
  | { kind: "wanted_change"; answer: string };

/** The store calls the helper makes; the runtime store by default, a fake in specs. */
export type HelperStore = Pick<
  ReturnType<typeof useAssistantStore>,
  | "state"
  | "createSession"
  | "stage"
  | "setDraft"
  | "send"
  | "stop"
  | "retry"
  | "dropSession"
  | "decideApproval"
>;

/** What one helper send carries beyond the prompt. */
export interface HelperSendOptions {
  /** The editor text an edit request modifies; `null` replaces it. */
  current?: string | null;
  /** The chips the row shows; the request carries these instead of the page's own. */
  chips?: ContextChip[];
  window?: { from: number; to: number; period?: string } | null;
}

export interface InlineHelperSession {
  sid: ComputedRef<Sid | null>;
  send(prompt: string, opts?: HelperSendOptions): Promise<void>;
  stop(): Promise<void>;
  /** Sends the failed turn again under the engine's retry rule (same id before admission). */
  retry(): Promise<void>;
  state: ComputedRef<HelperState>;
  /** The prompt ↑ (older) or ↓ (newer) lands on; `null` past either end. */
  recall(direction: "older" | "newer"): string | null;
  /** Forgets the latest outcome, so the row reads as a fresh one. */
  reset(): void;
}

export interface InlineHelperSessionOptions {
  store?: HelperStore;
  entryKind?: () => EntryKind;
  now?: () => number;
}

/** The helper's ephemeral mini session of origin `nl_bar`: one engine, the shared parser, never saved or listed. */
export function useInlineHelperSession(
  host: InlineHostAdapter,
  opts: InlineHelperSessionOptions = {},
): InlineHelperSession {
  const store = opts.store ?? useAssistantStore();
  const now = opts.now ?? Date.now;
  const sid = ref<Sid | null>(null);
  const outcome = ref<HelperState>({ kind: "idle" });
  const history: string[] = [];
  let cursor = -1;
  const denied = new Set<string>();
  let deniedThisTurn = false;
  let disposed = false;

  const session = computed<AssistantSession | null>(() =>
    sid.value ? (store.state.sessions[sid.value] ?? null) : null,
  );

  const state = computed<HelperState>(() => {
    const current = session.value;
    if (current && current.turn.state === "awaiting_consent")
      return { kind: "consent", turn: current.turn, meta: current.turnMeta };
    if (current && isRunning(current.turn))
      return { kind: "running", turn: current.turn, meta: current.turnMeta };
    return outcome.value;
  });

  // The helper never renders an approval: a card on its session is answered deny at once.
  watch(
    () => session.value?.pendingApproval?.id ?? null,
    (id) => {
      const current = sid.value;
      if (!id || !current || denied.has(id)) return;
      denied.add(id);
      deniedThisTurn = true;
      void store.decideApproval(current, { approved: false, reason: "deny" }, id);
    },
  );

  const ensureSession = (): Sid => {
    if (sid.value && store.state.sessions[sid.value]) return sid.value;
    sid.value = store.createSession({
      origin: {
        entryKind: opts.entryKind?.() ?? "editor_button",
        objectKind: "query",
        container: "nl_bar",
      },
      title: raw(""),
      ephemeral: true,
    });
    return sid.value;
  };

  const send = async (prompt: string, sendOpts: HelperSendOptions = {}) => {
    const text = prompt.trim();
    if (!text || (session.value && isRunning(session.value.turn))) return;
    remember(text);
    const id = ensureSession();
    const startedAt = now();
    outcome.value = { kind: "idle" };
    deniedThisTurn = false;
    const window = sendOpts.window;
    store.setDraft(id, {
      chips: [],
      timeOverride: window
        ? { from: window.from, to: window.to, ...(window.period && { period: window.period }) }
        : null,
      removedPageKeys: [...HELPER_SUPPRESSED_PAGE_KEYS],
    });
    store.stage(id, {
      text: helperRequest(text, host.language, sendOpts.current ?? null),
      mode: "replace",
      ...(sendOpts.chips?.length && { chips: sendOpts.chips }),
    });
    const terminal = await store.send(id, { mode: "generate_query", ephemeral: true });
    if (disposed) return;
    outcome.value = outcomeOf(terminal, lastAnswerOf(store.state.sessions[id]), now() - startedAt);
  };

  const retry = async () => {
    const id = sid.value;
    if (!id || !session.value || isRunning(session.value.turn)) return;
    const startedAt = now();
    outcome.value = { kind: "idle" };
    deniedThisTurn = false;
    const terminal = await store.retry(id);
    if (disposed) return;
    outcome.value = outcomeOf(terminal, lastAnswerOf(store.state.sessions[id]), now() - startedAt);
  };

  const stop = async () => {
    const id = sid.value;
    if (!id || !session.value || !isRunning(session.value.turn)) return;
    await store.stop(id);
  };

  const recall = (direction: "older" | "newer"): string | null => {
    if (!history.length) return null;
    if (direction === "older") cursor = Math.min(cursor + 1, history.length - 1);
    else cursor -= 1;
    if (cursor < 0) {
      cursor = -1;
      return null;
    }
    return history[history.length - 1 - cursor] ?? null;
  };

  function remember(text: string): void {
    cursor = -1;
    if (history[history.length - 1] === text) return;
    history.push(text);
    if (history.length > RECALL_LIMIT) history.shift();
  }

  function outcomeOf(
    terminal: Awaited<ReturnType<HelperStore["send"]>>,
    answer: ChatMessage | null,
    elapsedMs: number,
  ): HelperState {
    if (terminal.state === "stopped") return { kind: "stopped" };
    if (terminal.state === "refused" && terminal.error.code === "consent_declined")
      return { kind: "not_sent" };
    if (terminal.state === "failed" || terminal.state === "refused")
      return {
        kind: "failed",
        error: terminal.error,
        refused: terminal.state === "refused",
        elapsedMs,
      };
    return answerOutcome(answer);
  }

  function answerOutcome(answer: ChatMessage | null): HelperState {
    const blocks = answer?.contentBlocks ?? [];
    const text = answerTextOf(answer);
    const typed = blocks.find((block) => block.type === "query")?.query as
      QueryBlockData | undefined;
    const acted = blocks.some(
      (block) =>
        block.type === "approval" ||
        block.type === "link" ||
        block.type === "navigation" ||
        block.policy?.kind === "unreviewed",
    );
    if (acted || deniedThisTurn) return { kind: "wanted_change", answer: text };
    const proposal = typed?.text ?? extractProposal(text, host.language);
    if (proposal) {
      const range =
        typeof typed?.from === "number" && typeof typed?.to === "number"
          ? { from: typed.from, to: typed.to }
          : undefined;
      return {
        kind: "proposal",
        text: proposal,
        ...(typeof typed?.validated === "boolean" && { validated: typed.validated }),
        ...(range && { timeRange: range }),
      };
    }
    const question = questionOf(text);
    if (question) return { kind: "needs_detail", question, answer: text };
    return { kind: "needs_chat", line: firstAnswerLine(text), answer: text };
  }

  // Leaving mid-turn aborts and cancels on the server; the session is dropped with the editor.
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      const id = sid.value;
      if (!id) return;
      const current = store.state.sessions[id];
      if (current && isRunning(current.turn))
        void store.stop(id).finally(() => store.dropSession(id, "cleared"));
      else store.dropSession(id, "cleared");
    });

  return {
    sid: computed(() => sid.value),
    send,
    stop,
    retry,
    state,
    recall,
    reset: () => {
      outcome.value = { kind: "idle" };
    },
  };
}
