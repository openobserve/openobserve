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

import { getCurrentScope, nextTick, onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";

import useBreakpoint from "@/composables/useBreakpoint";
import { toast } from "@/lib/feedback/Toast/useToast";
import { trackAssistant } from "@/services/assistantAnalytics";
import { gt, type I18nKey, type I18nText } from "@/types/i18n";

import type { AssistantHostAdapter, ProposalHostId } from "./assistantStore.types";
import { focusDockComposer, isDockOpen } from "./hostAdapter";
import { runtimeHandle } from "./runtimeHandle";

/** A proposal longer than this is cut, so model output can never grow an editor without bound. */
export const MAX_PROPOSAL_CHARS = 100_000;

/** The provenance line quotes at most this much of the prompt. */
export const PROVENANCE_PROMPT_CHARS = 120;

const COMMENT_PREFIX: Partial<Record<ProposalLanguage, string>> = {
  sql: "-- ",
  promql: "# ",
  vrl: "# ",
  js: "// ",
};

/** The language as the diff, its announcement and its name say it; never model text. */
export const PROPOSAL_LANGUAGE_NAMES: Record<AssistantHostAdapter["language"], string> = {
  sql: "SQL",
  promql: "PromQL",
  vrl: "VRL",
  regex: "Regex",
  json: "JSON",
  js: "JavaScript",
};

// Controllers of the mounted editors, so the Insert applier finds the one its action names.
const controllers = new Map<ProposalHostId, EditorProposal>();

export type ProposalLanguage = AssistantHostAdapter["language"];

/** The editor a proposal lands in: a docked host's adapter or an inline helper host. */
export type ProposalHost = Pick<
  AssistantHostAdapter,
  "language" | "getBuffer" | "focusEditor" | "run"
> & {
  id: ProposalHostId;
};

/** What the client check found, shown in the diff's bar; Accept waits while `checking`. */
export interface ProposalChecks {
  state: "checking" | "ok" | "error" | "skipped";
  unknownCount?: number;
  /** Marked in the proposed side of the diff. */
  unknownFields?: string[];
  /** Accept and run stays focusable but inert with this reason. */
  runBlocked?: I18nText;
  /** The line under Accept and run: the range it scans. */
  runNote?: I18nText;
}

export interface ProposalProvenance {
  prompt: string;
  stream?: string;
  range?: { from: number; to: number };
}

export type ProposalDecision = "accepted" | "rejected" | "discarded" | "no_change";

/** How the user decided, for `ai_nl_decided`; `accept_run` is Accept and run. */
export type ProposalChoice = "accept" | "accept_run" | "reject" | "discarded";

export interface ProposalHandle {
  accept(): void;
  acceptAndRun(): void;
  reject(): void;
  /** Settles once: Accept, Reject, an edit in the editor, or nothing to change. */
  decision: Promise<ProposalDecision>;
}

/** The proposal the host's editor area shows as a diff until a decision. */
export interface PendingProposal extends Omit<ProposalHandle, "decision"> {
  id: number;
  /** The editor the proposal belongs to; the diff names its object. */
  hostId: ProposalHostId;
  before: string;
  after: string;
  language: ProposalLanguage;
  provenance: ProposalProvenance;
  canRun: boolean;
  checks?: ProposalChecks;
}

/** Editor-session state of accepted text; never persisted on the object. */
export interface AiLabelState {
  status: "written" | "edited";
  assistantText: string;
  /** The text before the first Accept of this editor session. */
  originalText: string;
  provenance: ProposalProvenance;
  /** The editor language (the alert dialog's tab) the text was accepted into; another tab drops the label. */
  language: ProposalLanguage;
  acceptedAt: number;
  /** What the host kept back while landing the text (the JSON editor's protected fields). */
  note: I18nKey | null;
}

/** How the proposal lands in the host's editor; `write` is one undo step. */
export interface EditorBinding {
  write(text: string): { text?: string; note?: I18nKey } | void;
  /** The editor area the diff covers; scrolled into view on a phone. */
  area?(): HTMLElement | null;
  language?(): ProposalLanguage;
  now?(): number;
}

export interface ProposeOptions {
  mode: "replace" | "append";
  provenance: ProposalProvenance;
  canRun: boolean;
  checks?: ProposalChecks;
  /** Called once with the user's choice; an edit in the editor is `discarded`. */
  onDecided?(choice: ProposalChoice): void;
}

export interface EditorProposal {
  propose(text: string, opts: ProposeOptions): Promise<ProposalHandle>;
  pending: ShallowRef<PendingProposal | null>;
  label: ShallowRef<AiLabelState | null>;
  revert(target: "assistant" | "original"): void;
  /** The host saved, reset or closed: an open proposal is discarded and the label goes; the editor is untouched. */
  clear(): void;
  /** Drops an open proposal without touching the editor. */
  discard(): void;
  /** Shows the client check of the open proposal `id` in its diff. */
  annotate(id: number, checks: ProposalChecks): void;
}

/** Lets a spec start with no mounted editor; never called by app code. */
export function resetEditorProposalsForTests(): void {
  controllers.clear();
}

/** An org switch or a sign-out leaves no proposal of the old org reviewable. */
export function discardProposals(): void {
  for (const controller of controllers.values()) controller.discard();
}

/** The proposal controller of a mounted editor, for the Insert applier. */
export function proposalFor(hostId: ProposalHostId): EditorProposal | null {
  return controllers.get(hostId) ?? null;
}

/** The accepted text with its provenance line first; JSON and regex carry none. */
export function withProvenance(
  text: string,
  language: ProposalLanguage,
  provenance: ProposalProvenance,
): string {
  const body = text.slice(0, MAX_PROPOSAL_CHARS);
  const prefix = COMMENT_PREFIX[language];
  const prompt = provenance.prompt.replace(/\s+/g, " ").trim().slice(0, PROVENANCE_PROMPT_CHARS);
  if (!prefix || !prompt) return body;
  return `${prefix}${prompt}\n${body}`;
}

/** The text without a leading provenance line, so a second Insert of the same query reads as no change. */
export function withoutProvenance(text: string, language: ProposalLanguage): string {
  const prefix = COMMENT_PREFIX[language];
  if (!prefix || !text.startsWith(prefix)) return text;
  const end = text.indexOf("\n");
  return end === -1 ? "" : text.slice(end + 1);
}

/** Owns one editor's proposal: the text before it, one undo step on Accept, and the label after it. */
export function useEditorProposal(host: ProposalHost, editor: EditorBinding): EditorProposal {
  const hostId = host.id;
  const { lgUp } = useBreakpoint();
  const pending = shallowRef<PendingProposal | null>(null);
  const label = shallowRef<AiLabelState | null>(null);
  let original: string | null = null;
  let seq = 0;
  let settle: ((decision: ProposalDecision) => void) | null = null;
  let choose: ((choice: ProposalChoice) => void) | null = null;
  const now = () => editor.now?.() ?? Date.now();
  const languageNow = () => editor.language?.() ?? host.language;

  const decide = (decision: ProposalDecision, choice?: ProposalChoice) => {
    pending.value = null;
    const done = settle;
    const chosen = choose;
    settle = null;
    choose = null;
    if (decision !== "no_change")
      chosen?.(choice ?? (decision === "accepted" ? "accept" : "discarded"));
    done?.(decision);
  };

  // Below `lg` the docked chat is a sheet over the editor: it peeks for the diff and comes back after.
  const asSheet = () => !lgUp.value && isDockOpen(hostId);
  const returnFocus = () => {
    if (asSheet()) runtimeHandle().value?.store.setSheetSnap("half");
    void nextTick(() => {
      if (!focusDockComposer(hostId)) host.focusEditor();
    });
  };
  // Revert unmounts the label's own button, so focus goes to the editor and the change is said out loud.
  const restored = (key: I18nKey) => {
    void nextTick(() => host.focusEditor());
    const store = runtimeHandle().value?.store;
    const sid = store?.state.shell.activeSid;
    if (store && sid && isDockOpen(hostId)) store.announce(sid, key);
    else toast({ variant: "default", message: gt(key) });
  };

  const accept = (proposal: PendingProposal, ran = false) => {
    if (pending.value?.id !== proposal.id) return;
    const landed = editor.write(proposal.after) ?? {};
    original ??= proposal.before;
    label.value = {
      status: "written",
      assistantText: landed.text ?? proposal.after,
      originalText: original,
      provenance: proposal.provenance,
      language: proposal.language,
      acceptedAt: now(),
      note: landed.note ?? null,
    };
    decide("accepted", ran ? "accept_run" : "accept");
    returnFocus();
  };

  const reject = (proposal: PendingProposal) => {
    if (pending.value?.id !== proposal.id) return;
    decide("rejected", "reject");
    returnFocus();
  };

  const controller: EditorProposal = {
    pending,
    label,
    async propose(text, opts) {
      if (pending.value) decide("discarded");
      const language = languageNow();
      const before = host.getBuffer();
      const body = text.slice(0, MAX_PROPOSAL_CHARS);
      const same = (a: string, b: string) => a.trim() === b.trim();
      if (same(body, before) || same(body, withoutProvenance(before, language)))
        return settled("no_change");
      const proposed = withProvenance(body, language, opts.provenance);
      const joiner = before === "" || before.endsWith("\n") ? "" : "\n";
      seq += 1;
      const proposal: PendingProposal = {
        id: seq,
        hostId,
        before,
        after: opts.mode === "append" ? `${before}${joiner}${proposed}` : proposed,
        language,
        provenance: opts.provenance,
        canRun: opts.canRun && !!host.run,
        ...(opts.checks && { checks: opts.checks }),
        accept: () => accept(proposal),
        acceptAndRun: () => {
          if (pending.value?.id !== proposal.id) return;
          accept(proposal, true);
          host.run?.();
        },
        reject: () => reject(proposal),
      };
      const decision = new Promise<ProposalDecision>((resolve) => (settle = resolve));
      choose = opts.onDecided ?? null;
      pending.value = proposal;
      if (asSheet()) runtimeHandle().value?.store.setSheetSnap("peek");
      await nextTick();
      if (asSheet()) editor.area?.()?.scrollIntoView({ block: "nearest" });
      return {
        accept: proposal.accept,
        acceptAndRun: proposal.acceptAndRun,
        reject: proposal.reject,
        decision,
      };
    },
    revert(target) {
      const current = label.value;
      if (!current) return;
      const validated = "skipped" as const;
      trackAssistant("ai_nl_decided", { decision: "revert", validated });
      if (current.language !== languageNow()) {
        label.value = null;
        return;
      }
      if (target === "assistant" && current.status === "edited") {
        editor.write(current.assistantText);
        label.value = { ...current, status: "written" };
        restored("assistant.label.restoredAssistant");
        return;
      }
      editor.write(current.originalText);
      label.value = null;
      original = null;
      restored("assistant.label.restoredOriginal");
    },
    clear() {
      if (pending.value) decide("discarded");
      label.value = null;
      original = null;
    },
    discard() {
      if (pending.value) decide("discarded");
    },
    annotate(id, checks) {
      const current = pending.value;
      if (current?.id === id) pending.value = { ...current, checks };
    },
  };

  // Typing in the editor while the diff is open is a Reject; after Accept it turns the label to "edited".
  watch(
    () => host.getBuffer(),
    (buffer) => {
      const proposal = pending.value;
      if (proposal && buffer !== proposal.before) {
        decide("discarded");
        return;
      }
      const current = label.value;
      if (!current) return;
      const status = buffer === current.assistantText ? "written" : "edited";
      if (status !== current.status) label.value = { ...current, status };
    },
  );

  // The alert dialog's SQL and PromQL tabs share one editor: a tab switch drops what belonged to the other tab.
  watch(languageNow, (language) => {
    if (pending.value && pending.value.language !== language) decide("discarded");
    if (label.value && label.value.language !== language) controller.clear();
  });

  controllers.set(hostId, controller);
  if (getCurrentScope())
    onScopeDispose(() => {
      if (controllers.get(hostId) === controller) controllers.delete(hostId);
      if (pending.value) decide("discarded");
    });
  return controller;
}

function settled(decision: ProposalDecision): ProposalHandle {
  const none = () => undefined;
  return { accept: none, acceptAndRun: none, reject: none, decision: Promise.resolve(decision) };
}
