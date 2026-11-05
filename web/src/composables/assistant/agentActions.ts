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

import { shallowReactive, toRaw } from "vue";

import { trackAssistant } from "@/services/assistantAnalytics";

import { DEFAULT_AGENT, currentAgent } from "./agents";
import type {
  AgentId,
  AgentPickVia,
  AssistantErrorCode,
  AssistantSession,
  AssistantState,
  AssistantStoreApi,
  AssistantStoreDeps,
  ComposerSnapshot,
  Sid,
  TurnInput,
} from "./assistantStore.types";
import type { TurnTerminal } from "./turnStates";

/** What the agent actions read of the store; the store passes its core and its `resend`. */
export interface AgentActionsCore {
  state: AssistantState;
  deps: AssistantStoreDeps;
  session(sid: Sid | null | undefined): AssistantSession | undefined;
  writable(session: AssistantSession): boolean;
  persistDraft(session: AssistantSession): void;
}

type Resend = (sid: Sid, snapshot: ComposerSnapshot, input: TurnInput) => Promise<TurnTerminal>;

type AgentActions = Pick<
  AssistantStoreApi,
  "pickAgent" | "acceptHandoff" | "dismissHandoff" | "noteAgentRefused" | "agentRefusal"
>;

/** `resend` is a getter: the store's turn slice does not exist yet when these are made. */
export function createAgentActions(core: AgentActionsCore, resend: () => Resend): AgentActions {
  const refusals = shallowReactive(
    new Map<AgentId, { code: AssistantErrorCode; roster: unknown }>(),
  );
  const rosterNow = () => toRaw(core.state.capability.agents);
  const refused = (): TurnTerminal => ({
    state: "refused",
    error: { code: "unknown", phase: "pre_admission", retryable: false, action: "none" },
  });
  const pickAgent = (sid: Sid, agent: AgentId, via: AgentPickVia) => {
    const session = core.session(sid);
    if (!session || !core.writable(session)) return;
    if (session.messages.length === 0) {
      session.agentId = agent;
      delete session.nextAgentId;
    } else if (agent === currentAgent(session)) delete session.nextAgentId;
    else session.nextAgentId = agent;
    core.persistDraft(session);
    if (via !== "door") trackAssistant("ai_agent_picked", { via, agent });
  };
  return {
    pickAgent,
    async acceptHandoff(sid, prompt) {
      const session = core.session(sid);
      const suggestion = session?.turnMeta.handoffSuggestion;
      if (!session || !suggestion) return refused();
      pickAgent(sid, suggestion.agent, "suggestion");
      if (session.pendingApproval) {
        session.turnMeta.withdrewApproval = true;
        void core.deps.approvals.withdraw(sid, "withdrawn");
      }
      trackAssistant("ai_handoff", { step: "accepted" });
      return resend()(
        sid,
        { text: prompt, chips: [], images: [], mentions: [], timeOverride: null },
        "continue",
      );
    },
    dismissHandoff(sid) {
      const suggestion = core.session(sid)?.turnMeta.handoffSuggestion;
      if (!suggestion) return;
      suggestion.collapsed = true;
      trackAssistant("ai_handoff", { step: "dismissed" });
    },
    noteAgentRefused(agent, code) {
      // The fallback agent stays offered: marking it would leave the refusal with no way forward.
      if (agent !== DEFAULT_AGENT) refusals.set(agent, { code, roster: rosterNow() });
    },
    agentRefusal(agent) {
      const refusal = refusals.get(agent);
      return refusal && refusal.roster === rosterNow() ? refusal.code : null;
    },
  };
}
