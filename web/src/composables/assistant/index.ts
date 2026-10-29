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

export {
  createAssistantStore,
  useAssistantPlacement,
  useAssistantSession,
  useAssistantStore,
} from "./assistantStore";
export { assistantStore } from "./runtime";
export { openTabWithoutOpener } from "./openTab";
export { useAssistantCapability } from "./useAssistantCapability";
export {
  useAssistantCredits,
  useCreditNotice,
  type CreditRefusalContext,
} from "./useAssistantCredits";
export { openAssistant, type OpenAssistantCall } from "./openAssistant";
export { useDeepLinkDoor } from "./useDeepLinkDoor";
export { isAssistantV2 } from "./flags";
export { useAssistantName } from "./useAssistantName";
export { useAssistantClient } from "./useAssistantClient";
export { parseStream, extractFrames } from "./sseParser";
export { toAssistantError, ASSISTANT_ERROR_CODES } from "./assistantErrors";
export { STALL_MS, turnStatusText } from "./turnStateMachine";
export { useAssistantStarters } from "./useAssistantStarters";
export { groupOf, originOf, useAssistantHistory } from "./useAssistantHistory";
export type {
  AssistantHistory,
  DeletedNotice,
  HistoryAnnouncement,
  HistoryListState,
  HistoryPending,
  ImportView,
} from "./useAssistantHistory";
export type { ElsewhereView } from "./historyElsewhere";
export { LOCAL_CAP } from "./historyDb";
export { useChatExport } from "./useChatExport";
export {
  assistantFocusCard,
  assistantGoToAnswer,
  historyTargetAbove,
  registerAssistantFocusTarget,
  registerContainerCloser,
  registerEscapeRung,
  registerHistoryTarget,
  runEscapeLadder,
  runHistoryTarget,
  stopLadderEscape,
  useAssistantOpenChord,
  useAssistantShortcuts,
} from "./shortcuts";
export { refreshPageContext, useAssistantContext } from "./context/useAssistantContext";
export {
  INTERNAL_FIELDS,
  MAX_ATTACHED_BYTES,
  MAX_ATTACHED_ROWS,
  byteSize,
  chipSecondaryOf,
  chipStateOf,
  contextChipFor,
  periodMs,
  shortLabelFor,
  timeChipOf,
  timeRangeShortText,
  timeRangeText,
  truncateChip,
} from "./context/contextChips";
export {
  legacyAutoSend,
  legacyPayloadToChips,
  legacyRelayArgs,
} from "./context/legacyPayloadToChips";
export { serialize } from "./context/serialize";
export {
  hidesAttachments,
  minuteLabel,
  parseAttachmentBlocks,
  prepareTurns,
  projectRecord,
} from "./record";
export type { ProjectRecordOptions, RecordAudience, StoredTurn } from "./record";
export {
  MAIN_MIN_REM,
  MAX_IMAGES,
  NAV_RAIL_REM,
  SIDEBAR_MIN_REM,
  UNDO_WINDOW_MS,
  isRunning,
} from "./assistantStore";
export { sidebarWidthFor } from "./sidebarWidth";
export { readRecall, readHints, readSidebar, markHintSeen, migrateHome, writeHome } from "./prefs";
export { assistantDashboardDraft, clearDashboardDraft } from "./actions/appliers/drafts";
export {
  assistantObjectNameKey,
  focusDockComposer,
  hostRegistry,
  isDockOpen,
  queueDockStage,
  reportDockWidth,
  useAssistantDockHost,
  useAssistantDockToggle,
  useDockedEditor,
} from "./hostAdapter";
export {
  scheduleResizeSignal,
  useAssistantPanelWidth,
  useSidebarFloating,
} from "./useAssistantPanelWidth";
export {
  PROPOSAL_LANGUAGE_NAMES,
  proposalFor,
  useEditorProposal,
  withProvenance,
  withoutProvenance,
} from "./useEditorProposal";
export { createHintChannel } from "./hints";
export {
  askLeaveGuard,
  assistantLifecycle,
  registerLifecycleDialogs,
  runLeaveGuards,
  useAssistantLeaveGuard,
  useLifecycleQuestion,
} from "./lifecycle";
export {
  markSignedIn,
  useOtherAccountSignedIn,
  useSignedOutElsewhere,
  stopElsewhere,
  turnLockKey,
  useTurnLock,
} from "./runtimeHandle";
export { queryRunOf } from "./actions/appliers/query";
export {
  DELETE_TTL_MS,
  PERMISSION_TTL_MS,
  approvalClock,
  approvalEntity,
  approvalHeading,
  approvalOutcomeOf,
  approvalTargetHref,
  entityKeyOf,
  assistantApprovals,
  useAssistantApprovals,
} from "./useAssistantApprovals";
export { assistantConsent, consentCardFor, isMeteredCredit, orgDisplayName } from "./consent";
export type { ConsentCardBinding } from "./consent";
export {
  assistantKeydownAt,
  noteAssistantKeydown,
  useAssistantIdleFocus,
} from "./useAssistantIdleFocus";
export type { TurnStatusText } from "./turnStateMachine";
export type { AssistantContextView } from "./context/useAssistantContext";
export type { ChipState, SeesRow, TimeWindow } from "./context/contextChips";
export type { RecallEntry } from "./prefs";
export type { DashboardDraft } from "./actions/registry";
export type {
  AssistantDockHost,
  AssistantDockHostOptions,
  DockedEditor,
  DockedEditorConfig,
} from "./hostAdapter";
export type { AssistantPanelWidth } from "./useAssistantPanelWidth";
export type {
  AiLabelState,
  EditorBinding,
  EditorProposal,
  PendingProposal,
  ProposalChecks,
  ProposalChoice,
  ProposalHost,
  ProposalLanguage,
  ProposalProvenance,
} from "./useEditorProposal";
export type { AssistantHintChannel } from "./hints";
export type { ApprovalsRuntime } from "./useAssistantApprovals";
export type {
  AssistantConsentCardProps,
  ConsentCardState,
  ConsentRuntime,
  ConsentView,
} from "./consent";
export type { AssistantIdleFocus } from "./useAssistantIdleFocus";
export type {
  ApprovalBlockData,
  ConsentNoteData,
  PolicyBlockData,
  ResolvedBlockData,
} from "./reducer";
export type { AssistantLifecycle, LeaveGuard, LifecycleQuestion, OpenQuestion } from "./lifecycle";
export type { InsertOutcome } from "./actions/appliers/editor";
export type { AssistantScope, AssistantStartersInput, Starter } from "./useAssistantStarters";
export type { AssistantClient, FrameSink, SendResult, TailResult } from "./useAssistantClient";
export type * from "./assistantStore.types";
export type * from "./turnStates";
export type * from "./frames";
export type * from "./context/types";
export type * from "./actions/types";
