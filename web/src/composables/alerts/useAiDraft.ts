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

import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { ZodType } from "zod";
import store from "@/stores";
import useAiChat from "@/composables/useAiChat";
import { extractFrames, extractTailFrames } from "@/components/O2AIChat.framing";
import {
  buildNavigationRoute,
  generateNavigationFromToolResult,
  type NavigationRoute,
} from "@/components/O2AIChat.navigation";
import {
  followUpMessage,
  readDraftEvent,
  schemaIssues,
  type AiDraftEvent,
  type AiDraftIssue,
  type AiDraftKind,
} from "@/components/ai-draft/aiDraftEvents";
import { accessDeniedMessage, accessReason, viewDenial } from "@/composables/useAccessStore";
import {
  isPaidOverageConsentError,
  usePaidOverageConsent,
} from "@/composables/usePaidOverageConsent";
import { aiCreditsNotice } from "@/utils/aiCredits";
import { UNAUTHORIZED_MESSAGE_KEY, isAuthError } from "@/utils/authErrors";
import { getUUIDv7 } from "@/utils/zincutils";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/**
 * idle → drafting → ready (a proposal waits for Create) → approving → created.
 * `reply`: the turn ended in words, not a proposal; `saved`: the agent created it without asking.
 */
export type AiDraftPhase =
  "idle" | "drafting" | "reply" | "ready" | "approving" | "created" | "failed" | "saved";

export type AiDraftFailureKind =
  "unavailable" | "quota" | "stream" | "noProposal" | "invalid" | "expired" | "notCreated";

export interface AiDraftFailure {
  kind: AiDraftFailureKind;
  /** The server's or the check's own words, when it gave any. */
  detail: I18nText | null;
}

export interface AiDraftResult<T> {
  draft: T;
  /** The proposal exactly as the agent will run it on approval. */
  args: Record<string, unknown>;
}

/** What a form hands the drafting loop: the tool whose call it approves, its schema and a server check. */
export interface AiDraftHost<T> {
  kind: AiDraftKind;
  /** The agent tool that carries the proposal, e.g. `CreateAlert`. */
  tool: string;
  schema: ZodType<T>;
  /** Host facts for the model beyond the page's own context provider. */
  context?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Server-side checks (a dry run); an empty list means the proposal is good. */
  check?: (draft: T, signal: AbortSignal) => Promise<AiDraftIssue[]>;
}

export interface AiDraft<T> {
  phase: Ref<AiDraftPhase>;
  statusLines: Ref<I18nText[]>;
  /** The assistant's own words in this turn: what it understood and guessed, or its question. */
  text: Ref<string>;
  result: ShallowRef<AiDraftResult<T> | null>;
  issues: Ref<AiDraftIssue[]>;
  failure: Ref<AiDraftFailure | null>;
  /** Where the created resource opens. */
  createdRoute: Ref<NavigationRoute | null>;
  sessionId: Ref<string | null>;
  prompt: Ref<string>;
  start: (prompt: string) => Promise<void>;
  /** Answers the assistant's question with the next message of the same session. */
  reply: (value: string) => Promise<void>;
  /** Approves the waiting proposal; resolves once the agent reports it created. */
  approve: () => Promise<void>;
  /** Declines the waiting proposal and stops reading the turn. */
  decline: () => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Deferred {
  resolve: () => void;
  reject: (error: Error) => void;
}

/** What one turn left behind once its stream ended. */
interface TurnState {
  text: string;
  finalText: string | null;
  streamError: I18nText | null;
  /** Issues of a proposal this loop declined; they go back once as the next message. */
  declinedIssues: AiDraftIssue[] | null;
  created: { route: NavigationRoute | null } | null;
  /** Where the agent's "View" link after a create points. */
  navigation: NavigationRoute | null;
  toolFailure: string | null;
}

type Request =
  | { ok: true; body: ReadableStream<Uint8Array> }
  | { ok: false; failure: AiDraftFailure }
  | { ok: false; cancelled: true };

// The RCA agent claims a turn whose context carries an incident, and the pane must never route there.
const CONTEXT_KEYS_DROPPED = ["incident_id", "agent_type"];
// How long the agent holds a proposal for the user's answer before it gives up.
const CONFIRM_TIMEOUT_SECS = 600;

/** Drafts a `T` over the chat stream: the agent proposes its create call, the user approves or declines it here. */
export function useAiDraft<T>(host: AiDraftHost<T>): AiDraft<T> {
  const { t } = useI18nTyped();
  const { fetchAiChat, cancelAiChat, confirmAiTool, getStructuredContext } = useAiChat();
  const { promptForConsent } = usePaidOverageConsent();

  const phase = ref<AiDraftPhase>("idle");
  const statusLines = ref<I18nText[]>([]);
  const text = ref("");
  const result = shallowRef<AiDraftResult<T> | null>(null);
  const issues = ref<AiDraftIssue[]>([]);
  const failure = ref<AiDraftFailure | null>(null);
  const createdRoute = ref<NavigationRoute | null>(null);
  const sessionId = ref<string | null>(null);
  const prompt = ref("");

  let messages: ChatMessage[] = [];
  // Proposals this loop declined since the user last wrote; the second one is not sent back.
  let rejected = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  let approval: Deferred | null = null;
  let approved = false;
  // The agent is paused on a proposal nobody has answered yet.
  let awaitingAnswer = false;

  const org = (): string => store.state.selectedOrganization?.identifier ?? "";
  const failWith = (kind: AiDraftFailureKind, detail: I18nText | null = null) => {
    failure.value = { kind, detail };
    phase.value = "failed";
  };

  const addStatus = (line: string) => {
    const next = raw(line);
    if (statusLines.value[statusLines.value.length - 1] !== next) {
      statusLines.value = [...statusLines.value, next];
    }
  };

  const buildContext = async (): Promise<Record<string, unknown>> => {
    const page = ((await getStructuredContext()) ?? {}) as Record<string, unknown>;
    const extras = (await host.context?.()) ?? {};
    const context: Record<string, unknown> = { ...page, ...extras };
    for (const key of CONTEXT_KEYS_DROPPED) delete context[key];
    // Opt-in: without it the agent creates as it does from the header chat.
    return { ...context, confirm_before_create: true, confirm_timeout_secs: CONFIRM_TIMEOUT_SECS };
  };

  const refusal = async (response: Response): Promise<AiDraftFailure | { consent: any }> => {
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      // The body may not be JSON.
    }
    if (isPaidOverageConsentError(response.status, body)) return { consent: body.consent };
    if (response.status === 402) return { kind: "quota", detail: aiCreditsNotice(body, t) };
    if (response.status === 429) {
      return { kind: "stream", detail: t("aiAssistant.turnLimitReached") };
    }
    if (response.status === 403) {
      const group = accessDeniedMessage([viewDenial("ai", "update")], t).groups[0];
      return { kind: "unavailable", detail: accessReason(group, t) };
    }
    const detail = raw(typeof body?.message === "string" ? body.message : "") || null;
    if ([401, 404, 501, 503].includes(response.status)) return { kind: "unavailable", detail };
    return {
      kind: "stream",
      detail: detail ?? t("aiAssistant.aiChat.serverErrorStatus", { status: response.status }),
    };
  };

  const request = async (signal: AbortSignal): Promise<Request> => {
    const context = await buildContext();
    const call = () =>
      fetchAiChat(messages, "", org(), signal, context, sessionId.value ?? undefined);
    let response: any = await call();
    for (let consentAsked = false; ; consentAsked = true) {
      if (!response) return { ok: false, failure: { kind: "stream", detail: null } };
      if (response.cancelled) return { ok: false, cancelled: true };
      if (response.ok) break;
      const refused = await refusal(response);
      if (!("consent" in refused)) return { ok: false, failure: refused };
      if (consentAsked) return { ok: false, failure: { kind: "quota", detail: null } };
      const accepted = await promptForConsent(org(), "ai_credits", refused.consent, signal);
      if (signal.aborted) return { ok: false, cancelled: true };
      if (!accepted) {
        return { ok: false, failure: { kind: "quota", detail: t("paidUsage.declinedNotice") } };
      }
      response = await call();
    }
    return response.body
      ? { ok: true, body: response.body }
      : { ok: false, failure: { kind: "stream", detail: null } };
  };

  /** A proposal of the host's tool: shown for approval when it passes, declined with its issues when not. */
  const onProposal = async (
    args: Record<string, unknown>,
    turn: TurnState,
    signal: AbortSignal,
  ) => {
    const parsed = host.schema.safeParse(args);
    let found: AiDraftIssue[] = parsed.success ? [] : schemaIssues(parsed.error);
    if (parsed.success) {
      result.value = { draft: parsed.data, args };
      if (host.check) {
        addStatus(t("aiDraft.checking"));
        try {
          found = await host.check(parsed.data, signal);
        } catch (error) {
          found = [{ message: String((error as Error)?.message ?? error) }];
        }
      }
    }
    if (signal.aborted) return;
    if (found.length === 0) {
      turn.declinedIssues = null;
      awaitingAnswer = true;
      phase.value = "ready";
      return;
    }
    rejected += 1;
    turn.declinedIssues = found;
    await confirmAiTool(org(), sessionId.value ?? "", false);
  };

  const onEvent = async (event: AiDraftEvent, turn: TurnState, signal: AbortSignal) => {
    if (event.kind === "status") addStatus(event.text);
    else if (event.kind === "text") {
      turn.text += event.text;
      text.value = turn.text;
    } else if (event.kind === "final") turn.finalText = event.text;
    else if (event.kind === "error") {
      turn.streamError = isAuthError(event.text, event.errorType)
        ? t(UNAUTHORIZED_MESSAGE_KEY)
        : raw(event.text);
    } else if (event.kind === "confirm") {
      // The pane approves only its own tool; anything else the agent wants to run is declined.
      if (event.tool === host.tool) await onProposal(event.args, turn, signal);
      else await confirmAiTool(org(), sessionId.value ?? "", false);
    } else if (event.kind === "navigation") {
      turn.navigation = buildNavigationRoute(event.action, org());
    } else if (event.kind === "toolResult" && event.tool === host.tool) {
      if (!event.success) turn.toolFailure = event.message;
      else {
        const action = generateNavigationFromToolResult(
          event.tool,
          event.data.call_args,
          event.data,
          t,
        );
        turn.created = { route: action ? buildNavigationRoute(action, org()) : null };
      }
    }
  };

  const readTurn = async (body: ReadableStream<Uint8Array>, signal: AbortSignal) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const turn: TurnState = {
      text: "",
      finalText: null,
      streamError: null,
      declinedIssues: null,
      created: null,
      navigation: null,
      toolFailure: null,
    };
    const apply = async (frames: string[]) => {
      for (const frame of frames) {
        let data: unknown;
        try {
          data = JSON.parse(frame);
        } catch {
          continue;
        }
        await onEvent(readDraftEvent(data), turn, signal);
      }
    };
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = extractFrames(buffer);
        buffer = rest;
        await apply(events);
      }
      await apply(extractTailFrames(buffer));
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") turn.streamError = turn.streamError ?? raw("");
    }
    return turn;
  };

  const settleApproval = (error: Error | null) => {
    if (error) approval?.reject(error);
    else approval?.resolve();
    approval = null;
  };

  /** Decides what the pane shows once a turn's stream has ended. */
  const finishTurn = async (turn: TurnState) => {
    const said = (turn.finalText ?? turn.text).trim();
    text.value = said;
    if (turn.created) {
      createdRoute.value = turn.created.route ?? turn.navigation;
      phase.value = approved ? "created" : "saved";
      settleApproval(null);
      return;
    }
    if (approved) {
      failWith("notCreated", turn.toolFailure ? raw(turn.toolFailure) : turn.streamError || null);
      settleApproval(new Error("not created"));
      return;
    }
    if (turn.streamError !== null) return failWith("stream", turn.streamError || null);
    // A proposal left unanswered until the agent stopped waiting can no longer be approved.
    if (phase.value === "ready") {
      awaitingAnswer = false;
      return failWith("expired");
    }
    if (turn.declinedIssues) {
      if (rejected >= 2) {
        issues.value = turn.declinedIssues;
        return failWith("invalid");
      }
      messages = [
        ...messages,
        { role: "assistant", content: said },
        { role: "user", content: followUpMessage(host.tool, turn.declinedIssues) },
      ];
      return send();
    }
    if (!said) return failWith("noProposal");
    messages = [...messages, { role: "assistant", content: said }];
    phase.value = "reply";
  };

  async function send(): Promise<void> {
    generation += 1;
    const mine = generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    phase.value = "drafting";
    statusLines.value = [];
    text.value = "";
    failure.value = null;
    issues.value = [];
    result.value = null;
    approved = false;
    awaitingAnswer = false;

    const response = await request(signal);
    if (mine !== generation) return;
    if (!response.ok) {
      if ("cancelled" in response) phase.value = "idle";
      else failWith(response.failure.kind, response.failure.detail);
      return;
    }
    const turn = await readTurn(response.body, signal);
    if (mine !== generation) return;
    await finishTurn(turn);
  }

  const clear = () => {
    statusLines.value = [];
    text.value = "";
    result.value = null;
    issues.value = [];
    failure.value = null;
    createdRoute.value = null;
  };

  const start = async (value: string) => {
    if (!value.trim()) return;
    clear();
    prompt.value = value.trim();
    sessionId.value = getUUIDv7();
    messages = [{ role: "user", content: prompt.value }];
    rejected = 0;
    await send();
  };

  const reply = async (value: string) => {
    if (phase.value !== "reply" || !value.trim()) return;
    messages = [...messages, { role: "user", content: value.trim() }];
    rejected = 0;
    await send();
  };

  const stopReading = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };

  const approve = async () => {
    if (phase.value !== "ready" || !sessionId.value) return;
    const done = new Promise<void>((resolve, reject) => {
      approval = { resolve, reject };
    });
    approved = true;
    awaitingAnswer = false;
    phase.value = "approving";
    if (!(await confirmAiTool(org(), sessionId.value, true))) {
      approved = false;
      stopReading();
      failWith("expired");
      settleApproval(new Error("approval not delivered"));
    }
    return done;
  };

  const decline = async () => {
    if (awaitingAnswer && sessionId.value) {
      awaitingAnswer = false;
      await confirmAiTool(org(), sessionId.value, false);
    }
    stopReading();
  };

  const cancel = () => {
    const running = phase.value === "drafting" || phase.value === "ready";
    const id = sessionId.value;
    if (awaitingAnswer && id) void confirmAiTool(org(), id, false);
    awaitingAnswer = false;
    stopReading();
    // The server keeps a turn running after the browser stops reading, so it is told too.
    if (running && id) void cancelAiChat(org(), id).catch(() => undefined);
    if (running || phase.value === "reply") phase.value = "idle";
  };

  const reset = () => {
    cancel();
    settleApproval(new Error("reset"));
    clear();
    messages = [];
    sessionId.value = null;
    phase.value = "idle";
  };

  const retry = () => start(prompt.value);

  return {
    phase,
    statusLines,
    text,
    result,
    issues,
    failure,
    createdRoute,
    sessionId,
    prompt,
    start,
    reply,
    approve,
    decline,
    retry,
    cancel,
    reset,
  };
}
