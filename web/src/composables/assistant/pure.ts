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

import type { AssistantErrorAction, AssistantSession, Sid } from "./assistantStore.types";

export { isAssistantV2 } from "./flags";
export { useAssistantName } from "./useAssistantName";
export { foldTurns, mergeIncremental, messagesFromTurns, parseAttachmentBlocks } from "./record";
export { ERROR_LEDGER } from "./assistantErrors";
export {
  elapsedMs,
  errorTitle,
  outcomeError,
  outcomeRecordOf,
  stepLabelOf,
  turnStatusText,
  STALL_MS,
} from "./turnStateMachine";
export { isTerminal } from "./turnStates";
export type { TurnStatusText } from "./turnStateMachine";
export type { AttachmentBlock } from "./record";
export type * from "./assistantStore.types";
export type * from "./turnStates";
export type * from "./frames";
export type * from "./context/types";
export type * from "./actions/types";

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
