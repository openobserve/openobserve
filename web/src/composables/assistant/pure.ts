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

import type { ComputedRef, InjectionKey } from "vue";

import type { ChatMessage, TurnOutcomeRecord } from "@/ts/interfaces/chat";
import type { I18nText } from "@/types/i18n";

import type { QueryRun } from "./actions/appliers/query";
import type { ActionResult, AssistantAction } from "./actions/types";
import type {
  AssistantCapability,
  AssistantErrorAction,
  AssistantHostAdapter,
  AssistantSession,
  Sid,
} from "./assistantStore.types";

export { isAssistantV2 } from "./flags";
export { HELPER_PREFIXES, HELPER_REQUEST_STARTS, type HelperLanguage } from "./helperPrefixes";
export { INLINE_HOST_IDS, isDockHostId } from "./hostIds";
export { openTabWithoutOpener } from "./openTab";
export { answerTextOf, lastAnswerOf, markdownMessage } from "./answers";
export { useAssistantName } from "./useAssistantName";
export {
  foldTurns,
  hidesAttachments,
  mergeIncremental,
  messagesFromTurns,
  minuteLabel,
  parseAttachmentBlocks,
  prepareTurns,
  projectRecord,
} from "./record";
export type { ProjectRecordOptions, RecordAudience, StoredTurn } from "./record";
export { ERROR_LEDGER } from "./assistantErrors";
export {
  elapsedMs,
  errorTitle,
  outcomeError,
  outcomeRecordOf,
  stepLabel,
  stepLabelOf,
  turnStatusText,
  STALL_MS,
} from "./turnStateMachine";
export { isTerminal } from "./turnStates";
export { diffCounts, diffLines, type DiffLine } from "./lineDiff";
export {
  assistantObjectNameKey,
  isDockOpen,
  focusDockComposer,
  queueDockStage,
  useAssistantDockToggle,
  useDockedEditor,
  type AssistantDockHost,
  type DockedEditor,
  type DockedEditorConfig,
  type QueryEditorAssistant,
} from "./hostAdapter";
export {
  scheduleResizeSignal,
  useAssistantPanelWidth,
  useSidebarFloating,
  type AssistantPanelWidth,
} from "./useAssistantPanelWidth";
export { useAssistantLeaveGuard, type LeaveGuard } from "./lifecycleQuestions";
export {
  markSignedIn,
  runtimeHandle,
  useAssistantGate,
  useOtherAccountSignedIn,
  useSignedOutElsewhere,
  turnLockKey,
  useTurnLock,
} from "./runtimeHandle";
export type { InsertOutcome } from "./actions/appliers/editor";
export { PROPOSAL_LANGUAGE_NAMES, proposalFor, useEditorProposal } from "./useEditorProposal";
export { validateProposal, type ProposalValidation } from "./queryValidation";
export type {
  AiLabelState,
  EditorProposal,
  PendingProposal,
  ProposalChecks,
  ProposalChoice,
  ProposalHost,
  ProposalProvenance,
} from "./useEditorProposal";
export {
  MAX_HIT_ROWS,
  chipOpenQuery,
  claimNumbers,
  fenceQuery,
  footerOf,
  manualRouteOf,
  promptRange,
  queryCount,
  stateOf,
  stepsOf,
  toolLinksOf,
  turnAnnotationKey,
  windowsOf,
} from "./evidence";
export {
  MARKDOWN_LINK_ROUTES,
  rebuildMarkdownTarget,
  buildNavigationRoute,
  type LinkKind,
  type LinkTarget,
} from "./navigationRoutes";
export type {
  FenceQuery,
  FindingsData,
  FooterData,
  LinkBlockData,
  QueryBlockData,
  StepFacts,
  StepKind,
  StepResult,
} from "./evidence";
export type { QueryRun } from "./actions/appliers/query";
export { canAlwaysAllow } from "./actions/appliers/approval";
export {
  approvalClock,
  approvalEntity,
  approvalHeading,
  approvalOutcomeOf,
  approvalTargetHref,
  entityKeyOf,
} from "./useAssistantApprovals";
export type {
  ApprovalBlockData,
  ConsentNoteData,
  PolicyBlockData,
  ResolvedBlockData,
} from "./reducer";
export type { TurnStatusText } from "./turnStateMachine";
export type { AttachmentBlock } from "./record";
export type * from "./assistantStore.types";
export type * from "./turnStates";
export type * from "./frames";
export type * from "./context/types";
export type * from "./actions/types";

/** The live half of an answer's evidence: dispatch, session state and run results; a shared page provides none. */
export const assistantEvidenceHostKey: InjectionKey<AssistantEvidenceHost> =
  /* @__PURE__ */ Symbol("assistantEvidenceHost");

/** Lets a readonly transcript read messages without importing the runtime store. */
export const assistantSessionSourceKey: InjectionKey<(sid: Sid) => ComputedRef<ChatMessage[]>> =
  /* @__PURE__ */ Symbol("assistantSessionSource");

/** The live half of a transcript: the session's turn, view state and actions, provided by the shell. */
export const assistantTranscriptHostKey: InjectionKey<AssistantTranscriptHost> =
  /* @__PURE__ */ Symbol("assistantTranscriptHost");

/** What a live transcript reads of its session and asks of the store; a shared page provides none (constraint 29). */
export interface AssistantTranscriptHost {
  session(sid: Sid): AssistantSession | null;
  setFollow(sid: Sid, follow: boolean): void;
  setScroll(sid: Sid, top: number | "bottom"): void;
  selectVersion(sid: Sid, turnId: string, n: number): void;
  /** Runs the one action of an outcome block (`30` §4.1). */
  outcomeAction(
    sid: Sid,
    action: AssistantErrorAction | "continue",
    outcome: TurnOutcomeRecord,
  ): void;
  isAdmin(): boolean;
  /** Server persistence: Retry save can apply (`80` §1.3). */
  persistence(): boolean;
  online(): boolean;
  /** The last turn still has the snapshot a Retry resends (HT-03 AC 5). */
  canRetry(sid: Sid): boolean;
  /** After a turn action whose control unmounts (`95` §3, HT-04 AC 10). */
  focusComposer(): void;
}

/** What evidence blocks ask of the live store; every action still goes through `dispatch`. */
export interface AssistantEvidenceHost {
  dispatch(sid: Sid, action: AssistantAction): Promise<ActionResult>;
  session(sid: Sid): AssistantSession | null;
  capability(): AssistantCapability;
  queryRun(sid: Sid, blockId: string): QueryRun | null;
  /** Docked or with unsaved changes: Open in new tab is the primary. */
  prefersNewTab(): boolean;
  currentOrg(): string | null;
  /** The persisted "Opened · {time}" of a link card. */
  markOpened(sid: Sid, blockId: string): void;
  toggleStep(sid: Sid, callId: string): void;
  /** Speaks through the composer's status region, the one the container owns. */
  announce(sid: Sid, text: I18nText): void;
  /** The editor a docked container sits beside, whose Insert previews a diff there. */
  host?(): AssistantHostAdapter | null;
}

/** What an answer's evidence knows of its turn; the transcript builds it. */
export interface AssistantTurnView {
  sid: Sid | null;
  /** The raw turn id: store keys, annotations and Re-run use it. */
  turnId: string;
  /** The session's org; a query block carries it. */
  org: string;
  prompt: ChatMessage | null;
  /** The page's window when the prompt was sent, kept with the session's annotations. */
  askedWindow?: { from: number; to: number } | null;
  /** False on a readonly page with no explorer behind it: evidence offers no Open. */
  openable?: boolean;
  outcome: "live" | "done" | "done_not_saved" | "stopped" | "failed";
  isLast: boolean;
  /** When a live turn started, for the trail's running duration. */
  startedAt: number | null;
  /** A share made with tool data hidden: the trail shows a count, nothing expands. */
  hiddenByOwner?: boolean;
}
