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
export { isAssistantV2 } from "./flags";
export { useAssistantName } from "./useAssistantName";
export { useAssistantClient } from "./useAssistantClient";
export { parseStream, extractFrames } from "./sseParser";
export { toAssistantError, ASSISTANT_ERROR_CODES } from "./assistantErrors";
export { turnStatusText } from "./turnStateMachine";
export { useAssistantStarters } from "./useAssistantStarters";
export {
  registerAssistantFocusTarget,
  registerContainerCloser,
  registerEscapeRung,
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
export { MAX_IMAGES, UNDO_WINDOW_MS, isRunning } from "./assistantStore";
export { readRecall, readHints, markHintSeen } from "./prefs";
export type { TurnStatusText } from "./turnStateMachine";
export type { AssistantContextView } from "./context/useAssistantContext";
export type { ChipState, SeesRow, TimeWindow } from "./context/contextChips";
export type { RecallEntry } from "./prefs";
export type { AssistantScope, AssistantStartersInput, Starter } from "./useAssistantStarters";
export type { AssistantClient, FrameSink, SendResult, TailResult } from "./useAssistantClient";
export type * from "./assistantStore.types";
export type * from "./turnStates";
export type * from "./frames";
export type * from "./context/types";
export type * from "./actions/types";
