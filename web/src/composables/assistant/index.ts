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
export { registerContainerCloser, useAssistantShortcuts } from "./shortcuts";
export type { TurnStatusText } from "./turnStateMachine";
export type { AssistantScope, AssistantStartersInput, Starter } from "./useAssistantStarters";
export type { AssistantClient, FrameSink, SendResult, TailResult } from "./useAssistantClient";
export type * from "./assistantStore.types";
export type * from "./turnStates";
export type * from "./frames";
export type * from "./context/types";
export type * from "./actions/types";
