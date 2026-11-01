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

import { vi } from "vitest";
import { reactive } from "vue";

import {
  assistantEvidenceHostKey,
  type AssistantEvidenceHost,
  type AssistantTurnView,
  type QueryRun,
} from "@/composables/assistant/pure";
import type { ChatMessage } from "@/ts/interfaces/chat";

import { fakeAssistant } from "./fakeAssistant";

/** A live evidence host over a real store: dispatch is a spy, runs are set by the spec. */
export function fakeEvidence(
  over: { messages?: ChatMessage[]; creditMode?: "free" | "exhausted" | "pay_as_you_go" } = {},
) {
  // Annotations persist per user and org, so a fresh host starts without a previous spec's.
  localStorage.clear();
  const { store, capability } = fakeAssistant("available", {
    ...(over.creditMode && { creditMode: over.creditMode }),
  });
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
    ...(over.messages && { messages: over.messages }),
  });
  const runs = reactive(new Map<string, QueryRun>());
  const host = {
    dispatch: vi.fn(async () => ({ ok: true }) as const),
    session: (id: string) => store.state.sessions[id] ?? null,
    capability: () => capability.value,
    queryRun: (_sid: string, blockId: string) => runs.get(blockId) ?? null,
    prefersNewTab: vi.fn(() => false),
    currentOrg: vi.fn(() => "default"),
    markOpened: vi.fn((id: string, blockId: string) =>
      store.annotate(id, blockId, { linkOutcome: { openedAt: 1_760_000_000_000 } }),
    ),
    toggleStep: vi.fn((id: string, callId: string) => store.toggleStep(id, callId)),
    announce: vi.fn(),
  } satisfies AssistantEvidenceHost;
  const provide = { [assistantEvidenceHostKey as symbol]: host };
  const turn = (patch: Partial<AssistantTurnView> = {}): AssistantTurnView => ({
    sid,
    turnId: "t1",
    org: "default",
    prompt: null,
    outcome: "done",
    isLast: true,
    startedAt: null,
    ...patch,
  });
  return { store, capability, sid, host, runs, provide, turn };
}
