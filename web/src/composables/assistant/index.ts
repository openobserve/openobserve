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
export { useAssistantCapability } from "./useAssistantCapability";
export { openAssistant, type OpenAssistantCall } from "./openAssistant";
export { useDeepLinkDoor } from "./useDeepLinkDoor";
export { isAssistantV2 } from "./flags";
export { useAssistantName } from "./useAssistantName";
export { useAssistantClient } from "./useAssistantClient";
export { parseStream, extractFrames } from "./sseParser";
export { toAssistantError, ASSISTANT_ERROR_CODES } from "./assistantErrors";
export { STALL_MS, turnStatusText } from "./turnStateMachine";
export { useAssistantStarters } from "./useAssistantStarters";
export {
  assistantGoToAnswer,
  registerAssistantFocusTarget,
  registerContainerCloser,
  registerEscapeRung,
  runEscapeLadder,
  stopLadderEscape,
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
export { parseAttachmentBlocks } from "./record";
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
  assistantLifecycle,
  registerLifecycleDialogs,
  runLeaveGuards,
  useAssistantLeaveGuard,
  useLifecycleQuestion,
} from "./lifecycle";
export {
  markSignedIn,
  useApprovalElsewhere,
  useOtherAccountSignedIn,
  useSignedOutElsewhere,
  turnLockKey,
  useTurnLock,
} from "./runtimeHandle";
export { queryRunOf } from "./actions/appliers/query";
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
  ProposalLanguage,
  ProposalProvenance,
} from "./useEditorProposal";
export type { AssistantHintChannel } from "./hints";
export type { AssistantLifecycle, LeaveGuard, LifecycleQuestion, OpenQuestion } from "./lifecycle";
export type { InsertOutcome } from "./actions/appliers/editor";
export type { AssistantScope, AssistantStartersInput, Starter } from "./useAssistantStarters";
export type { AssistantClient, FrameSink, SendResult, TailResult } from "./useAssistantClient";
export type * from "./assistantStore.types";
export type * from "./turnStates";
export type * from "./frames";
export type * from "./context/types";
export type * from "./actions/types";
