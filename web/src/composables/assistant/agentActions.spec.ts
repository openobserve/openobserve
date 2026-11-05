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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { trackAssistant } from "@/services/assistantAnalytics";
import { raw } from "@/types/i18n";

import { createAgentActions, type AgentActionsCore } from "./agentActions";
import type { AgentId, AssistantSession } from "./assistantStore.types";

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

function setup(over: Partial<AssistantSession> = {}, writable = true) {
  const session = { sid: "s1", messages: [], turnMeta: {}, ...over } as unknown as AssistantSession;
  const withdraw = vi.fn().mockResolvedValue(undefined);
  const capability = { agents: [{ id: "sre" }] as unknown[] };
  const persistDraft = vi.fn();
  const core = {
    state: { capability },
    deps: { approvals: { withdraw } },
    session: (sid?: string | null) => (sid === "s1" ? session : undefined),
    writable: () => writable,
    persistDraft,
  } as unknown as AgentActionsCore;
  const resend = vi.fn().mockResolvedValue({ state: "done", saved: "server" });
  return {
    session,
    withdraw,
    capability,
    persistDraft,
    resend,
    actions: createAgentActions(core, () => resend),
  };
}

const withTurns = { messages: [{ role: "user", content: raw("q") }] } as never;

beforeEach(() => vi.mocked(trackAssistant).mockClear());

describe("agentActions", () => {
  it("sets the agent of a new chat and writes no Next", () => {
    const h = setup({ nextAgentId: "sre" as AgentId });
    h.actions.pickAgent("s1", "generate-query", "picker");
    expect(h.session.agentId).toBe("generate-query");
    expect(h.session.nextAgentId).toBeUndefined();
    expect(h.persistDraft).toHaveBeenCalled();
    expect(trackAssistant).toHaveBeenCalledWith("ai_agent_picked", {
      via: "picker",
      agent: "generate-query",
    });
  });

  it("only stages Next on a chat with turns, and the current agent clears it", () => {
    const h = setup({ ...(withTurns as object), agentId: "o2-ai" });
    h.actions.pickAgent("s1", "sre", "mention");
    expect(h.session.agentId).toBe("o2-ai");
    expect(h.session.nextAgentId).toBe("sre");
    h.actions.pickAgent("s1", "o2-ai", "picker");
    expect(h.session.nextAgentId).toBeUndefined();
  });

  it("counts no pick for a door and touches nothing on a read-only chat", () => {
    const door = setup();
    door.actions.pickAgent("s1", "sre", "door");
    expect(trackAssistant).not.toHaveBeenCalled();
    const locked = setup({}, false);
    locked.actions.pickAgent("s1", "sre", "picker");
    expect(locked.session.agentId).toBeUndefined();
  });

  it("accepts a suggestion: picks, withdraws a card first, sends the prompt, leaves the draft alone", async () => {
    const h = setup({
      ...(withTurns as object),
      agentId: "o2-ai",
      pendingApproval: { id: "c1" } as never,
    });
    h.session.turnMeta.handoffSuggestion = { agent: "sre", reason: "r" };
    await h.actions.acceptHandoff("s1", "Continue");
    expect(h.session.nextAgentId).toBe("sre");
    expect(h.withdraw).toHaveBeenCalledWith("s1", "withdrawn");
    expect(h.session.turnMeta.withdrewApproval).toBe(true);
    expect(h.resend).toHaveBeenCalledWith(
      "s1",
      { text: "Continue", chips: [], images: [], mentions: [], timeOverride: null },
      "continue",
    );
  });

  it("refuses an accept with nothing to accept", async () => {
    const h = setup();
    expect((await h.actions.acceptHandoff("s1", "x")).state).toBe("refused");
    expect(h.resend).not.toHaveBeenCalled();
  });

  it("collapses on Not now and keeps the agent", () => {
    const h = setup({ agentId: "o2-ai" });
    h.session.turnMeta.handoffSuggestion = { agent: "sre", reason: "r" };
    h.actions.dismissHandoff("s1");
    expect(h.session.turnMeta.handoffSuggestion.collapsed).toBe(true);
    expect(h.session.agentId).toBe("o2-ai");
  });

  it("marks a refused agent until the capability is re-read, never the fallback", () => {
    const h = setup();
    h.actions.noteAgentRefused("sre", "agent_not_permitted");
    h.actions.noteAgentRefused("o2-ai", "agent_unreachable");
    expect(h.actions.agentRefusal("sre")).toBe("agent_not_permitted");
    expect(h.actions.agentRefusal("o2-ai")).toBeNull();
    h.capability.agents = [{ id: "sre" }];
    expect(h.actions.agentRefusal("sre")).toBeNull();
  });
});
