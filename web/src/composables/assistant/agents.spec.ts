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

import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import {
  agentIdOf,
  agentMatches,
  agentPolicy,
  agentReason,
  agentRequestOf,
  commitTurnAgent,
  currentAgent,
  defaultAgentFor,
  nextAgent,
  revertHandoff,
  rosterOf,
  rosterOffersChoice,
  suggestionFor,
} from "./agents";
import type { AssistantSession, CapabilityAgent } from "./assistantStore.types";

const ROSTER: CapabilityAgent[] = [
  { id: "o2-ai", pickable: true, available: true },
  { id: "sre", pickable: true, available: true },
  { id: "generate-query", pickable: true, available: false, reason: "role" },
];

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as never;

function session(over: Partial<AssistantSession> = {}): AssistantSession {
  const messages: ChatMessage[] = [
    { role: "user", content: raw("q"), turnId: "t1" },
    { role: "assistant", content: raw("a") },
    { role: "user", content: raw("q2"), turnId: "t2" },
  ];
  return { messages, turnMeta: {}, ...over } as unknown as AssistantSession;
}

describe("agents: the roster", () => {
  it("reads sre-rca as Investigator and the underscored id as Query builder", () => {
    expect(agentIdOf("sre-rca")).toBe("sre");
    expect(agentIdOf("generate_query")).toBe("generate-query");
    expect(agentIdOf("o2-ai-judge")).toBeNull();
    expect(agentIdOf(undefined)).toBeNull();
  });

  it("offers only pickable roster ids in roster order, never the judge or an opencode agent", () => {
    const rows = rosterOf([
      { id: "generate-query", pickable: true, available: true, read_only: true },
      { id: "sre-rca", pickable: true, available: true },
      { id: "o2-ai-judge", pickable: true, available: true },
      { id: "build", pickable: true, available: true },
      { id: "sre", pickable: false, available: true },
      { id: "o2-ai", pickable: true, available: true },
    ]);
    expect(rows?.map((row) => row.id)).toEqual(["o2-ai", "generate-query"]);
    expect(rows?.[1].readOnly).toBe(true);
  });

  it("is no roster when the server sends ids only or nothing, so no picker and no agent field", () => {
    expect(rosterOf(["o2-ai", "sre"])).toBeUndefined();
    expect(rosterOf(undefined)).toBeUndefined();
    expect(rosterOffersChoice(undefined)).toBe(false);
    expect(rosterOffersChoice([ROSTER[0]])).toBe(false);
    expect(rosterOffersChoice(ROSTER)).toBe(true);
  });

  it("keeps a reason and the time of an unreachable check", () => {
    const [row] = rosterOf([
      { id: "sre", pickable: true, available: false, reason: "unreachable", checked_at: 1234 },
    ])!;
    expect(row).toMatchObject({ available: false, reason: "unreachable", checkedAt: 1234 });
  });

  it("calls an agent read-only only on the server's flag, whatever its id", () => {
    expect(agentPolicy(ROSTER[1], t)).toBe("assistant.agent.policy.asks");
    expect(agentPolicy({ ...ROSTER[1], readOnly: true }, t)).toBe(
      "assistant.agent.policy.readOnly",
    );
  });

  it("words a refusal over the roster, and an unreachable row with or without its check", () => {
    expect(agentReason(ROSTER[0], null, t)).toBeNull();
    expect(agentReason(ROSTER[0], "agent_disabled", t)).toBe(
      "assistant.agent.unavailable.disabled",
    );
    expect(agentReason(ROSTER[2], null, t)).toBe("assistant.agent.unavailable.role");
    const down: CapabilityAgent = { ...ROSTER[1], available: false, reason: "unreachable" };
    expect(agentReason(down, null, t)).toBe("assistant.agent.unavailable.unreachableNow");
    expect(agentReason({ ...down, checkedAt: 1_000 }, null, t)).toContain(
      "assistant.agent.unavailable.unreachable ",
    );
  });

  it("matches a name prefix or the id, never a word inside the name", () => {
    expect(agentMatches("sre", "Investigator", "inv")).toBe(true);
    expect(agentMatches("sre", "Investigator", "sre")).toBe(true);
    expect(agentMatches("sre", "Investigator", "Investigator")).toBe(true);
    expect(agentMatches("generate-query", "Query builder", "query")).toBe(true);
    expect(agentMatches("generate-query", "Query builder", "builder")).toBe(false);
    expect(agentMatches("sre", "Investigator", "")).toBe(true);
  });
});

describe("agents: who answers", () => {
  it("falls back from a pick to the last turn's agent to the default", () => {
    expect(currentAgent(null)).toBe("o2-ai");
    expect(currentAgent(session())).toBe("o2-ai");
    const answered = session();
    answered.messages[0].agentId = "sre";
    expect(currentAgent(answered)).toBe("sre");
    expect(currentAgent(session({ agentId: "generate-query" }))).toBe("generate-query");
    expect(nextAgent(session({ agentId: "sre", nextAgentId: "o2-ai" }))).toBe("o2-ai");
  });

  it("sends nothing while the roster offers no choice, so the server keeps routing", () => {
    const picked = session({ agentId: "sre", nextAgentId: "o2-ai" });
    expect(agentRequestOf(picked, undefined)).toEqual({});
    expect(agentRequestOf(picked, [ROSTER[0]])).toEqual({});
  });

  it("names the agent only once something named one, and a pick that differs is a hand-off", () => {
    expect(agentRequestOf(session(), ROSTER)).toEqual({});
    expect(agentRequestOf(session({ agentId: "sre" }), ROSTER)).toEqual({ agent: "sre" });
    expect(agentRequestOf(session({ agentId: "o2-ai", nextAgentId: "sre" }), ROSTER)).toEqual({
      agent: "sre",
      handoffFrom: "o2-ai",
    });
    expect(agentRequestOf(session({ nextAgentId: "sre" }), ROSTER)).toEqual({
      agent: "sre",
      handoffFrom: "o2-ai",
    });
  });
});

describe("agents: committing a turn", () => {
  const handoff = { agent: "sre", handoffFrom: "o2-ai" } as const;

  it("moves the chat only on the echo, and marks the prompt once", () => {
    const s = session({ agentId: "o2-ai", nextAgentId: "sre" });
    expect(commitTurnAgent(s, handoff, "sre-rca", 2, true)).toBe("handed");
    expect(s.agentId).toBe("sre");
    expect(s.nextAgentId).toBeUndefined();
    expect(s.turnMeta.handoffFrom).toBe("o2-ai");
    expect(s.messages[2]).toMatchObject({
      agentId: "sre",
      handoffFrom: "o2-ai",
      handoffWithdrewApproval: true,
    });
  });

  it("keeps the agent and Next on another agent's echo, and reports the failed hand-off", () => {
    const s = session({ agentId: "o2-ai", nextAgentId: "sre" });
    expect(commitTurnAgent(s, handoff, "o2-ai", 2, false)).toBe("mismatch");
    expect(s.agentId).toBe("o2-ai");
    expect(s.nextAgentId).toBe("sre");
    expect(s.messages[2].handoffFrom).toBeUndefined();
    expect(s.messages[2].handoffFailed).toEqual({ from: "o2-ai", to: "sre" });
    expect(s.messages[2].agentId).toBe("o2-ai");
  });

  it("writes no marker for a server that names no agent", () => {
    const s = session({ agentId: "o2-ai", nextAgentId: "sre" });
    expect(commitTurnAgent(s, handoff, undefined, 2, false)).toBe("none");
    expect(s.agentId).toBe("sre");
    expect(s.messages[2].handoffFrom).toBeUndefined();
  });

  it("stamps a chat nobody picked for with whoever answered", () => {
    const s = session();
    expect(commitTurnAgent(s, {}, "sre-rca", 2, false)).toBe("none");
    expect(s.messages[2].agentId).toBe("sre");
    expect(s.agentId).toBeUndefined();
  });

  it("gives the chat back when the target fails before its first byte", () => {
    const s = session({ agentId: "sre" });
    s.turnMeta.handoffFrom = "o2-ai";
    revertHandoff(s, handoff, 2);
    expect(s.agentId).toBe("o2-ai");
    expect(s.nextAgentId).toBe("sre");
    expect(s.turnMeta.handoffFrom).toBeUndefined();
    expect(s.messages[2].handoffFailed).toEqual({ from: "o2-ai", to: "sre" });
  });
});

describe("agents: suggestions and doors", () => {
  it("drops a suggestion it cannot honour", () => {
    const s = session({ agentId: "o2-ai" });
    const raw2 = { agent: "sre", reason: "needs a look" };
    expect(suggestionFor(raw2, s, ROSTER)).toEqual({ agent: "sre", reason: "needs a look" });
    expect(suggestionFor(undefined, s, ROSTER)).toBeNull();
    expect(suggestionFor(raw2, s, undefined)).toBeNull();
    expect(suggestionFor({ ...raw2, agent: "o2-ai" }, s, ROSTER)).toBeNull();
    expect(suggestionFor({ ...raw2, agent: "generate-query" }, s, ROSTER)).toBeNull();
    expect(suggestionFor({ ...raw2, agent: "o2-ai-judge" }, s, ROSTER)).toBeNull();
  });

  it("gives query doors Query builder, investigation doors Investigator, others the server's default", () => {
    const door = (entryVerb: string, objectKind: string, dockHost?: string) =>
      defaultAgentFor({ entryVerb, objectKind, dockHost } as never);
    expect(door("ask", "none", "alert_query")).toBe("generate-query");
    expect(door("ask", "none", "scheduled_query")).toBe("generate-query");
    expect(door("ask", "none", "regex")).toBeNull();
    expect(door("troubleshoot", "query_error")).toBe("generate-query");
    expect(door("troubleshoot", "log_row")).toBe("sre");
    expect(door("explain", "alert_firing")).toBe("sre");
    expect(door("explain", "log_row")).toBeNull();
  });
});
