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

import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";

import type { InlineHostAdapter } from "@/composables/assistant/pure";

import { RECALL_LIMIT, useInlineHelperSession, type HelperStore } from "./useInlineHelperSession";

type Terminal = Awaited<ReturnType<HelperStore["send"]>>;

const host: InlineHostAdapter = {
  id: "logs",
  language: "sql",
  getBuffer: () => "",
  previewInsert: vi.fn(),
  focusEditor: vi.fn(),
};

function fakeStore() {
  const state = reactive({ sessions: {} as Record<string, any> });
  let finish: ((terminal: Terminal) => void) | null = null;
  const store = {
    state,
    createSession: vi.fn((init: any) => {
      const sid = `h${Object.keys(state.sessions).length + 1}`;
      state.sessions[sid] = {
        sid,
        origin: init.origin,
        ephemeral: init.ephemeral,
        turn: { state: "idle" },
        turnMeta: { turnId: null, ownedByThisTab: true, startedAt: null },
        messages: [],
        pendingApproval: null,
      };
      return sid;
    }),
    stage: vi.fn(),
    setDraft: vi.fn(),
    send: vi.fn((sid: string) => {
      state.sessions[sid].turn = { state: "responding.writing" };
      return new Promise<Terminal>((resolve) => {
        finish = (terminal) => {
          state.sessions[sid].turn = terminal;
          resolve(terminal);
        };
      });
    }),
    retry: vi.fn(),
    stop: vi.fn(async (sid: string) => {
      finish?.({ state: "stopped", steps: 0, partial: false });
      void sid;
    }),
    dropSession: vi.fn((sid: string) => {
      delete state.sessions[sid];
    }),
    decideApproval: vi.fn(),
  };
  const answer = (
    sid: string,
    blocks: any[],
    terminal: Terminal = { state: "done", saved: "not_saved" },
  ) => {
    state.sessions[sid].messages.push(
      { role: "user", content: "q" },
      { role: "assistant", content: "", contentBlocks: blocks },
    );
    finish?.(terminal);
  };
  return { store: store as unknown as HelperStore & typeof store, answer };
}

function setup() {
  const fake = fakeStore();
  const scope = effectScope();
  const session = scope.run(() => useInlineHelperSession(host, { store: fake.store }))!;
  return { ...fake, scope, session };
}

describe("useInlineHelperSession", () => {
  it("runs one ephemeral nl_bar session and sends the generate request as generate_query", async () => {
    const { store, answer, session } = setup();
    const sent = session.send("errors per service", { current: "" });
    await nextTick();
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        origin: { entryKind: "editor_button", objectKind: "query", container: "nl_bar" },
      }),
    );
    expect(store.stage).toHaveBeenCalledWith("h1", {
      text: "Generate SQL query : errors per service",
      mode: "replace",
    });
    expect(store.send).toHaveBeenCalledWith("h1", { mode: "generate_query", ephemeral: true });
    expect(session.state.value.kind).toBe("running");
    answer("h1", [{ type: "text", text: "```sql\nSELECT 1\n```" }]);
    await sent;
    expect(session.state.value).toEqual({ kind: "proposal", text: "SELECT 1" });
  });

  it("prefers the typed query block, its validated flag and its range", async () => {
    const { answer, session } = setup();
    const sent = session.send("x");
    await nextTick();
    answer("h1", [
      { type: "text", text: "```sql\nSELECT 2\n```" },
      { type: "query", query: { text: "SELECT 1", validated: true, from: 1, to: 2 } },
    ]);
    await sent;
    expect(session.state.value).toEqual({
      kind: "proposal",
      text: "SELECT 1",
      validated: true,
      timeRange: { from: 1, to: 2 },
    });
  });

  it("reads an answer with no query as a question or as needing the chat", async () => {
    const { answer, session } = setup();
    let sent = session.send("x");
    await nextTick();
    answer("h1", [{ type: "text", text: "Which stream should I use?" }]);
    await sent;
    expect(session.state.value).toMatchObject({ kind: "needs_detail" });
    sent = session.send("y");
    await nextTick();
    answer("h1", [{ type: "text", text: "Here is how alerts work." }]);
    await sent;
    expect(session.state.value).toMatchObject({
      kind: "needs_chat",
      line: "Here is how alerts work.",
    });
  });

  it("answers an approval on its own session with deny and reports the wanted change", async () => {
    const { store, answer, session } = setup();
    const sent = session.send("delete the stream");
    await nextTick();
    store.state.sessions.h1.pendingApproval = { id: "a1" };
    await nextTick();
    expect(store.decideApproval).toHaveBeenCalledWith(
      "h1",
      { approved: false, reason: "deny" },
      "a1",
    );
    answer("h1", [{ type: "text", text: "```sql\nSELECT 1\n```" }]);
    await sent;
    expect(session.state.value.kind).toBe("wanted_change");
  });

  it("maps stop, a declined consent and a failure to their own states", async () => {
    const { store, answer, session } = setup();
    let sent = session.send("x");
    await nextTick();
    await session.stop();
    await sent;
    expect(store.stop).toHaveBeenCalledWith("h1");
    expect(session.state.value.kind).toBe("stopped");
    sent = session.send("y");
    await nextTick();
    answer("h1", [], {
      state: "refused",
      error: { code: "consent_declined", phase: "pre_admission", retryable: false, action: "none" },
    } as Terminal);
    await sent;
    expect(session.state.value.kind).toBe("not_sent");
  });

  it("stops a running turn and drops the session when the editor goes", async () => {
    const { store, scope, session } = setup();
    void session.send("x");
    await nextTick();
    scope.stop();
    expect(store.stop).toHaveBeenCalledWith("h1");
    await Promise.resolve();
    await Promise.resolve();
    expect(store.dropSession).toHaveBeenCalledWith("h1", "cleared");
  });

  it("sends the chips and window it shows and suppresses the page's own query keys", async () => {
    const { store, answer, session } = setup();
    const chip = { kind: "stream", id: "s1", label: "k8s_logs" } as never;
    const sent = session.send("errors", {
      current: "SELECT 1",
      chips: [chip],
      window: { from: 1, to: 2, period: "15m" },
    });
    await nextTick();
    expect(store.setDraft).toHaveBeenCalledWith("h1", {
      chips: [],
      timeOverride: { from: 1, to: 2, period: "15m" },
      removedPageKeys: ["selectedStreams", "currentSQLQuery", "currentVRLQuery", "currentQuery"],
    });
    expect(store.stage).toHaveBeenCalledWith("h1", expect.objectContaining({ chips: [chip] }));
    answer("h1", [{ type: "text", text: "```sql\nSELECT 2\n```" }]);
    await sent;
  });

  it("recalls the last prompts of this instance only, newest first, capped", async () => {
    const { answer, session } = setup();
    for (let i = 0; i < RECALL_LIMIT + 2; i += 1) {
      const sent = session.send(`p${i}`);
      await nextTick();
      answer("h1", [{ type: "text", text: "ok." }]);
      await sent;
    }
    expect(session.recall("older")).toBe(`p${RECALL_LIMIT + 1}`);
    expect(session.recall("older")).toBe(`p${RECALL_LIMIT}`);
    expect(session.recall("newer")).toBe(`p${RECALL_LIMIT + 1}`);
    expect(session.recall("newer")).toBeNull();
    for (let i = 0; i < RECALL_LIMIT + 5; i += 1) session.recall("older");
    expect(session.recall("older")).toBe("p2");
    expect(setup().session.recall("older")).toBeNull();
  });
});
