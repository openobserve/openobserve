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

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

import type {
  AgentId,
  AssistantSession,
  CapabilityAgent,
  DockHostId,
  EntryVerb,
  ObjectKind,
} from "./assistantStore.types";
import { useAssistantName } from "./useAssistantName";

export const DEFAULT_AGENT: AgentId = "o2-ai";

const AGENT_ORDER: readonly AgentId[] = ["o2-ai", "sre", "generate-query"];

const AGENT_NAME_KEYS: Record<AgentId, I18nKey> = {
  "o2-ai": "assistant.agent.o2.name",
  sre: "assistant.agent.investigator.name",
  "generate-query": "assistant.agent.queryBuilder.name",
};

const AGENT_PURPOSE_KEYS: Record<AgentId, I18nKey> = {
  "o2-ai": "assistant.agent.o2.purpose",
  sre: "assistant.agent.investigator.purpose",
  "generate-query": "assistant.agent.queryBuilder.purpose",
};

const AGENT_SUGGEST_KEYS: Record<AgentId, I18nKey> = {
  "o2-ai": "assistant.handoff.suggest.title.o2",
  sre: "assistant.handoff.suggest.title.investigator",
  "generate-query": "assistant.handoff.suggest.title.queryBuilder",
};

// `sre-rca` cannot be chosen but its chats read as Investigator; history spells the query agent with an underscore.
const AGENT_ALIASES: Readonly<Record<string, AgentId>> = {
  "o2-ai": "o2-ai",
  sre: "sre",
  "sre-rca": "sre",
  "generate-query": "generate-query",
  generate_query: "generate-query",
};

const INVESTIGATION_OBJECTS: ReadonlySet<ObjectKind> = new Set([
  "alert_firing",
  "incident",
  "service_edge",
]);

const QUERY_OBJECTS: ReadonlySet<ObjectKind> = new Set(["query", "query_error", "empty_result"]);

const QUERY_DOCKS: ReadonlySet<DockHostId> = new Set(["alert_query", "scheduled_query"]);

/** The wire's agent id as a roster id; any other id never renders as an agent. */
export function agentIdOf(value: unknown): AgentId | null {
  return typeof value === "string" ? (AGENT_ALIASES[value] ?? null) : null;
}

/** `agents[]` of the capabilities read; ids only (today's shape) or none at all is no roster. */
export function rosterOf(value: unknown): CapabilityAgent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((row) => rosterRow(row));
  if (rows.length === 0) return undefined;
  return rows.sort((a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id));
}

function rosterRow(row: unknown): CapabilityAgent[] {
  if (!row || typeof row !== "object") return [];
  const value = row as Record<string, unknown>;
  // `sre-rca` is the engine of incident analysis, never a choice, even if a server lists it.
  const id = value.id === "sre-rca" ? null : agentIdOf(value.id);
  if (!id || value.pickable !== true) return [];
  const reason = reasonOf(value.reason);
  const checkedAt = checkedAtOf(value.checked_at ?? value.checkedAt);
  return [
    {
      id,
      pickable: true,
      available: value.available === true,
      ...(reason && { reason }),
      ...(checkedAt && { checkedAt }),
      ...(value.read_only === true && { readOnly: true }),
    },
  ];
}

function reasonOf(value: unknown): CapabilityAgent["reason"] | null {
  return value === "role" || value === "disabled" || value === "unreachable" ? value : null;
}

function checkedAtOf(value: unknown): number | null {
  const at = typeof value === "string" ? Date.parse(value) : value;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** More than one row is the only case that offers a choice, so it is also what puts `agent` on the wire. */
export function rosterOffersChoice(agents: CapabilityAgent[] | undefined): boolean {
  return (agents?.length ?? 0) > 1;
}

/** The product's own agent carries the product name, whatever the build calls it. */
export function agentName(id: AgentId, t: TranslateFn): I18nText {
  return t(AGENT_NAME_KEYS[id], { product: useAssistantName().product });
}

export function agentPurpose(id: AgentId, t: TranslateFn): I18nText {
  return t(AGENT_PURPOSE_KEYS[id]);
}

/** The clause comes only from the server's flag, never from the agent's id (PO A13). */
export function agentPolicy(agent: CapabilityAgent | undefined, t: TranslateFn): I18nText {
  return t(agent?.readOnly ? "assistant.agent.policy.readOnly" : "assistant.agent.policy.asks");
}

export function agentSuggestTitle(id: AgentId, t: TranslateFn): I18nText {
  return t(AGENT_SUGGEST_KEYS[id], { agent: agentName(id, t) });
}

/** Why a row cannot be chosen; a refusal at send outranks the roster until the next read. */
export function agentReasonKey(
  agent: Pick<CapabilityAgent, "available" | "reason">,
  refusal: string | null,
): I18nKey | null {
  if (refusal === "agent_unreachable") return "assistant.agent.unavailable.unreachable";
  if (refusal === "agent_disabled") return "assistant.agent.unavailable.disabled";
  if (refusal === "agent_not_permitted") return "assistant.agent.unavailable.role";
  if (agent.available) return null;
  if (agent.reason === "unreachable") return "assistant.agent.unavailable.unreachable";
  if (agent.reason === "disabled") return "assistant.agent.unavailable.disabled";
  return "assistant.agent.unavailable.role";
}

/** The reason line of an unavailable row, for the picker and the mention menu. */
export function agentReason(
  agent: CapabilityAgent,
  refusal: string | null,
  t: TranslateFn,
): I18nText | null {
  const key = agentReasonKey(agent, refusal);
  if (!key) return null;
  if (key !== "assistant.agent.unavailable.unreachable") return t(key);
  if (!agent.checkedAt) return t("assistant.agent.unavailable.unreachableNow");
  return t(key, { time: raw(formatOrgTime(agent.checkedAt)) });
}

/** Name prefix or id, so `@inv`, `@sre` and `@query` find their row and the purpose never does. */
export function agentMatches(id: AgentId, name: string, query: string): boolean {
  const typed = query.trim().toLowerCase();
  if (!typed) return true;
  const label = name.toLowerCase();
  return label.startsWith(typed) || id.startsWith(typed);
}

function lastTurnAgent(messages: ChatMessage[]): AgentId | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const agent = messages[i].agentId;
    if (agent) return agent;
  }
  return null;
}

type AgentSession = Pick<AssistantSession, "agentId" | "nextAgentId" | "messages">;

/** The agent that holds the chat now: a pick or hand-off, else whoever answered last. */
export function currentAgent(session: AgentSession | null | undefined): AgentId {
  if (!session) return DEFAULT_AGENT;
  return session.agentId ?? lastTurnAgent(session.messages) ?? DEFAULT_AGENT;
}

/** The agent the next send goes to. */
export function nextAgent(session: AgentSession | null | undefined): AgentId {
  return session?.nextAgentId ?? currentAgent(session);
}

/** The wire fields of a send; a chat nobody picked for keeps the server's routing, incident routing included. */
export function agentRequestOf(
  session: AgentSession,
  agents: CapabilityAgent[] | undefined,
): { agent?: AgentId; handoffFrom?: AgentId } {
  if (!rosterOffersChoice(agents)) return {};
  const current = currentAgent(session);
  const next = session.nextAgentId;
  if (next && next !== current) return { agent: next, handoffFrom: current };
  const named = session.agentId ?? lastTurnAgent(session.messages);
  return named ? { agent: named } : {};
}

export type TurnAgentResult = "none" | "handed" | "mismatch";

/** Commits what `turn_started` echoed: only an echo of the requested agent moves the chat (`00` §4.3). */
export function commitTurnAgent(
  session: AssistantSession,
  requested: { agent?: AgentId; handoffFrom?: AgentId },
  echoed: unknown,
  userIndex: number,
  withdrewApproval: boolean,
): TurnAgentResult {
  const echo = agentIdOf(echoed);
  const user = session.messages[userIndex];
  const prompt = user?.role === "user" ? user : null;
  session.turnMeta.agentId = echo ?? requested.agent ?? null;
  if (prompt && session.turnMeta.agentId) prompt.agentId = session.turnMeta.agentId;
  if (!requested.agent) return "none";
  if (echo && echo !== requested.agent) {
    if (!requested.handoffFrom || !prompt) return "none";
    prompt.handoffFailed = { from: requested.handoffFrom, to: requested.agent };
    return "mismatch";
  }
  session.agentId = requested.agent;
  delete session.nextAgentId;
  // An older server's `turn_started` names no agent, so nothing proves a hand-off and no marker is written.
  if (!echo || !requested.handoffFrom) return "none";
  session.turnMeta.handoffFrom = requested.handoffFrom;
  if (prompt) {
    prompt.handoffFrom = requested.handoffFrom;
    if (withdrewApproval) prompt.handoffWithdrewApproval = true;
  }
  return "handed";
}

/** The target failed before its first byte: the chat stays with the agent it came from, and Next stays set. */
export function revertHandoff(
  session: AssistantSession,
  requested: { agent?: AgentId; handoffFrom?: AgentId },
  userIndex: number,
): void {
  const { agent, handoffFrom } = requested;
  if (!agent || !handoffFrom) return;
  const user = session.messages[userIndex];
  if (user?.role === "user") user.handoffFailed = { from: handoffFrom, to: agent };
  session.agentId = handoffFrom;
  session.nextAgentId = agent;
  delete session.turnMeta.handoffFrom;
}

/** An agent the chat can actually be handed to; anything else leaves no card (MULTI-AGENT-05 AC 8). */
export function suggestionFor(
  raw: { agent: string; reason: string } | undefined,
  session: AgentSession,
  agents: CapabilityAgent[] | undefined,
): { agent: AgentId; reason: string } | null {
  const agent = agentIdOf(raw?.agent);
  if (!raw || !agent || !rosterOffersChoice(agents) || agent === nextAgent(session)) return null;
  return agents?.some((row) => row.id === agent && row.available)
    ? { agent, reason: raw.reason }
    : null;
}

/** The default of `60` §3.1 and D6 §3.1–3.2; `null` leaves the org default to the server. */
export function defaultAgentFor(door: {
  entryVerb: EntryVerb;
  objectKind: ObjectKind;
  dockHost?: DockHostId;
}): AgentId | null {
  if (door.dockHost && QUERY_DOCKS.has(door.dockHost)) return "generate-query";
  if (door.entryVerb === "generate_query" || QUERY_OBJECTS.has(door.objectKind))
    return "generate-query";
  if (door.entryVerb === "troubleshoot" || INVESTIGATION_OBJECTS.has(door.objectKind)) return "sre";
  return null;
}
