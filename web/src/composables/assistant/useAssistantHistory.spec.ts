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

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeAssistant,
  hintBus,
  memoryHistoryDb,
} from "@/components/ai-assistant/__tests__/fakeAssistant";
import assistant from "@/services/assistant";
import { gt, raw } from "@/types/i18n";

import { approvalAnnotationKey } from "./actions/appliers/approval";
import type { AssistantCapability } from "./assistantStore.types";
import { LOCAL_CAP, type LocalRecord } from "./historyDb";
import { LIVE_SAVE_GRACE_MS } from "./historyDb";
import { POLL_FAST_MS } from "./historyElsewhere";
import { patchCards, waitingCardOf } from "./historyRecords";
import { approvalOf } from "./reducer";
import { createApprovalsRuntime, type ApprovalsRuntime } from "./useAssistantApprovals";
import { HELPER_REQUEST_STARTS, IMPORT_BATCH, groupOf, isHelperChat } from "./useAssistantHistory";

const KEY = "k1";

function record(id: number, over: Partial<LocalRecord> = {}): LocalRecord {
  return {
    id,
    timestamp: new Date(id).toISOString(),
    title: `Chat ${id}`,
    messages: [
      { role: "user", content: raw(`question ${id}`) },
      { role: "assistant", content: raw(`answer ${id}`) },
    ],
    sessionId: `0190ffff-c3d4-7e5f-8a9b-${String(id).padStart(12, "0")}`,
    userOrgKey: KEY,
    ...over,
  };
}

function setup(over: Partial<AssistantCapability> = {}, seed: LocalRecord[] = []) {
  const fake = fakeAssistant("available", { persistence: false, ...over }, {}, 80, true);
  for (const row of seed) fake.db.rows.set(row.id, structuredClone(row));
  fake.history.ensureLoaded();
  return fake;
}

function chat(fake: ReturnType<typeof setup>, text = "why 5xx?") {
  const sid = fake.store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  const session = fake.store.state.sessions[sid];
  session.messages.push(
    { role: "user", content: raw(text), turnId: "t1", sentAt: 1_000 },
    { role: "assistant", content: raw("Because the gateway timed out."), turnId: "t1" },
  );
  session.turnMeta.turnId = "t1";
  session.turn = { state: "done", saved: "local" };
  return sid;
}

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data: {} },
  });
}

function withBus(over: Partial<AssistantCapability> = {}, seed: LocalRecord[] = []) {
  const hints = hintBus();
  const fake = fakeAssistant("available", { persistence: false, ...over }, {}, 80, true, {
    hints: hints as never,
  });
  for (const row of seed) fake.db.rows.set(row.id, structuredClone(row));
  fake.history.ensureLoaded();
  return { ...fake, hints };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAssistantHistory in local-only mode", () => {
  it("saves a chat with its turns beside the legacy messages and lists it", async () => {
    const fake = setup();
    await flushPromises();
    const sid = chat(fake);
    expect(await fake.history.save(sid)).toBe("local");
    const stored = [...fake.db.rows.values()][0];
    expect(stored.messages).toHaveLength(2);
    expect(stored.turns?.[0]).toMatchObject({ turn_id: "t1", status: "completed" });
    expect(stored.rev).toBe(1);
    expect(stored.userOrgKey).toBe(KEY);
    expect(fake.history.rows.value.map((row) => row.sid)).toEqual([sid]);
  });

  it("keeps an incident chat's origin through a save and a reopen", async () => {
    const fake = setup();
    await flushPromises();
    const sid = chat(fake);
    const session = fake.store.state.sessions[sid];
    session.origin = { entryKind: "object_verb", objectKind: "incident", container: "rca" };
    await fake.history.save(sid);
    const stored = [...fake.db.rows.values()][0];
    expect(stored).toMatchObject({ origin: "incident" });
    expect(fake.history.rows.value[0].origin).toBe("incident");
    const reopened = setup({}, [record(7, { origin: "incident" })]);
    await flushPromises();
    const id = record(7).sessionId!;
    expect(await reopened.history.open({ sid: id })).toBe(id);
    expect(reopened.store.state.sessions[id]).toMatchObject({
      origin: { objectKind: "incident" },
    });
  });

  it("reads as loading, not empty, until the browser store answers", async () => {
    const fake = setup({}, [record(1)]);
    fake.history.ensureLoaded();
    expect(fake.history.listState.value.status).toBe("loading");
    await flushPromises();
    expect(fake.history.listState.value.status).toBe("ready");
  });

  it("never lists another user+org's rows or v1 rows without a key, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = setup({}, [
      record(1),
      record(2, { userOrgKey: "someone-else" }),
      record(3, { userOrgKey: undefined }),
    ]);
    await flushPromises();
    expect(fake.history.rows.value.map((row) => String(row.title))).toEqual(["Chat 1"]);
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(fake.history.open({ sid: record(2).sessionId! })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("filters helper chats by agent type, ephemerality and the helper prefixes", async () => {
    const fake = setup({}, [
      record(1),
      record(2, { agentType: "generate_query" }),
      record(3, { ephemeral: true }),
      record(4, { title: `${HELPER_REQUEST_STARTS[0]}top errors` }),
    ]);
    await flushPromises();
    expect(fake.history.rows.value.map((row) => String(row.title))).toEqual(["Chat 1"]);
    expect(isHelperChat({ firstPrompt: "Generate VRL function for nginx" })).toBe(true);
  });

  it("shows under Shared the chats the user's links point at", async () => {
    const fake = setup({}, [record(1), record(2)]);
    await flushPromises();
    fake.history.setFilter({ kind: "shared" });
    expect(fake.history.visible.value).toEqual([]);
    fake.history.noteShared([record(2).sessionId!]);
    expect(fake.history.visible.value.map((row) => String(row.title))).toEqual(["Chat 2"]);
  });

  it("searches the loaded rows by title and first prompt on the client", async () => {
    const fake = setup({}, [record(1, { title: "Payments p95" }), record(2, { title: "VRL" })]);
    await flushPromises();
    fake.history.setFilter({ q: "payments" });
    expect(fake.history.visible.value.map((row) => String(row.title))).toEqual(["Payments p95"]);
    fake.history.setFilter({ q: "question 2" });
    expect(fake.history.visible.value.map((row) => String(row.title))).toEqual(["VRL"]);
    expect(fake.history.searchPartial.value).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(`o2.assistant.historyFilter:${KEY}`) ?? "{}").q).toBe(
      "question 2",
    );
  });

  it("prunes the oldest unpinned chat on save and Undo puts it back", async () => {
    const seed = Array.from({ length: LOCAL_CAP }, (_, i) => record(i + 1, { pinned: i === 0 }));
    const fake = setup({}, seed);
    await flushPromises();
    const sid = chat(fake);
    expect(await fake.history.save(sid)).toBe("local");
    expect(fake.db.rows.has(1)).toBe(true);
    expect(fake.db.rows.has(2)).toBe(false);
    const toast = fake.toast.mock.calls.at(-1)![0];
    expect(String(toast.message)).toBe("Removed the oldest chat to make room: “Chat 2”");
    expect(toast.timeout).toBe(10_000);
    toast.action.handler();
    await flushPromises();
    expect(fake.db.rows.has(2)).toBe(true);
  });

  it("keeps a new chat in memory as not saved when every chat is pinned", async () => {
    const seed = Array.from({ length: LOCAL_CAP }, (_, i) => record(i + 1, { pinned: true }));
    const fake = setup({}, seed);
    await flushPromises();
    const sid = chat(fake);
    expect(await fake.history.save(sid)).toBe("not_saved");
    expect(fake.history.notSaved(sid)).toBe(true);
    expect(fake.db.rows.size).toBe(LOCAL_CAP);
    expect(String(fake.toast.mock.calls[0][0].message)).toBe(
      "All 100 chats are pinned. Unpin or delete one to save new chats.",
    );
  });

  it("reopens a saved chat after its session is gone, with its title and transcript", async () => {
    const fake = setup({}, [record(5, { title: "Payments p95", titleSource: "renamed" })]);
    await flushPromises();
    const sid = record(5).sessionId!;
    expect(await fake.history.open({ sid })).toBe(sid);
    const session = fake.store.state.sessions[sid];
    expect(String(session.title)).toBe("Payments p95");
    expect(session.titleSource).toBe("renamed");
    expect(session.messages.map((m) => String(m.content))).toEqual(["question 5", "answer 5"]);
  });

  it("follows the tab holding a browser chat's turn lock and re-reads the chat once it lets go", async () => {
    const sid = record(5).sessionId!;
    let holding = true;
    let release = () => undefined as void;
    const freed = new Promise<void>((resolve) => (release = resolve));
    const locks = {
      query: vi.fn(async () => ({
        held: holding ? [{ name: `o2-assistant-turn:${sid}` }] : [],
        pending: [],
      })),
      request: vi.fn(async (_name: string, _options: unknown, callback: () => unknown) => {
        await freed;
        return callback();
      }),
    };
    const fake = fakeAssistant("available", { persistence: false }, {}, 80, true, {
      locks: locks as never,
    });
    fake.db.rows.set(5, structuredClone(record(5)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    await flushPromises();
    const session = fake.store.state.sessions[sid];
    expect(session.turnMeta.ownedByThisTab).toBe(false);
    expect(fake.history.elsewhere(sid)).not.toBeNull();
    expect(locks.request).toHaveBeenCalledWith(
      `o2-assistant-turn:${sid}`,
      { mode: "shared" },
      expect.any(Function),
    );
    fake.db.rows
      .get(5)!
      .messages.push(
        { role: "user", content: raw("second question") },
        { role: "assistant", content: raw("second answer") },
      );
    holding = false;
    release();
    await flushPromises();
    expect(session.turnMeta.ownedByThisTab).toBe(true);
    expect(fake.history.elsewhere(sid)).toBeNull();
    expect(fake.store.state.sessions[sid].messages.map((m) => String(m.content))).toContain(
      "second answer",
    );
  });

  it("renames, pins and deletes in this browser and announces each once", async () => {
    const fake = setup({}, [record(1)]);
    await flushPromises();
    const sid = record(1).sessionId!;
    expect(await fake.history.rename(sid, "  Renamed chat  ")).toEqual({ ok: true });
    expect(fake.db.rows.get(1)?.title).toBe("Renamed chat");
    expect(fake.db.rows.get(1)?.titleSource).toBe("renamed");
    expect(String(fake.history.announcement.value?.text)).toBe("Renamed");
    await fake.history.pin(sid, true);
    expect(fake.db.rows.get(1)?.pinned).toBe(true);
    expect(fake.history.rows.value[0].pinned).toBe(true);
    await fake.history.remove(sid);
    expect(fake.db.rows.size).toBe(0);
    expect(String(fake.history.announcement.value?.text)).toBe("Chat deleted");
  });

  it("clears only this user+org's rows", async () => {
    const fake = setup({}, [record(1), record(2), record(3, { userOrgKey: "other" })]);
    await flushPromises();
    await fake.history.clearAll();
    expect([...fake.db.rows.keys()]).toEqual([3]);
    expect(String(fake.history.announcement.value?.text)).toBe("Deleted 2 chats");
  });

  it("keeps the sign-out preference per user", () => {
    const fake = setup();
    expect(fake.history.clearOnSignOut()).toBe(false);
    fake.history.setClearOnSignOut(true);
    expect(fake.history.clearOnSignOut()).toBe(true);
  });
});

describe("useAssistantHistory in server mode", () => {
  it("drops the chat, purges the cache and announces when the server says it is gone", async () => {
    const listed = "0190ffff-0000-7000-8000-00000000dead";
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [{ session_id: listed, title: "Listed", created_at: 1, updated_at: 1 }],
    });
    vi.spyOn(assistant, "getChat").mockRejectedValue(httpError(404));
    const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
    await flushPromises();
    const sid = record(1).sessionId!;
    fake.store.adoptSession(sid, {
      chatId: 1,
      title: raw("Chat 1"),
      titleSource: "generated",
      origin: { entryKind: "deep_link", objectKind: "none", container: "full_view" },
      messages: [{ role: "user", content: raw("q") }],
      record: { serverBacked: true },
    });
    fake.store.setActive(sid);
    await expect(fake.history.open({ sid })).rejects.toMatchObject({ code: "deleted_elsewhere" });
    expect(fake.db.rows.size).toBe(0);
    expect(fake.store.state.sessions[sid]).toBeUndefined();
    expect(fake.history.deletedNotice.value).toEqual({ sid, via: "server" });
    expect(String(fake.history.announcement.value?.text)).toBe("This chat was deleted elsewhere");
    await expect(fake.history.open({ sid: listed })).rejects.toMatchObject({
      code: "deleted_elsewhere",
    });
    expect(fake.history.deletedNotice.value).toEqual({ sid: listed, via: "server", opening: true });
  });

  it("reads a chat it never saw saved as not found, so a reloaded draft is not called deleted", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockRejectedValue(httpError(404));
    const fake = setup({ persistence: true });
    await flushPromises();
    const sid = "0190ffff-0000-7000-8000-0000000d1af7";
    await expect(fake.history.open({ sid })).rejects.toMatchObject({ code: "not_found" });
    expect(fake.history.deletedNotice.value).toBeNull();
  });

  it("keeps the cached transcript and marks history unavailable when the read fails", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockRejectedValue(httpError(503));
    const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
    await flushPromises();
    const sid = record(1).sessionId!;
    expect(await fake.history.open({ sid })).toBe(sid);
    const session = fake.store.state.sessions[sid];
    expect(session.record.historyUnavailable).toBe(true);
    expect(session.messages).toHaveLength(2);
  });

  it("lists server rows and the browser-only rows under their own group", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        {
          session_id: "0190a1b2-c3d4-7e5f-8a9b-00000000aaaa",
          title: "From the server",
          created_at: 1_000_000,
          updated_at: 2_000_000,
          last_committed_seq: 4,
        },
      ],
      next_cursor: "c2",
    });
    const fake = setup({ persistence: true }, [record(7)]);
    await flushPromises();
    await vi.waitFor(() => expect(fake.history.rows.value).toHaveLength(2));
    const browser = fake.history.rows.value.find((row) => row.local)!;
    expect(String(browser.title)).toBe("Chat 7");
    expect(groupOf(browser, Date.now(), () => 0, true)).toBe("browser");
    expect(fake.history.hasMore.value).toBe(true);
    fake.history.setFilter({ q: "server" });
    expect(fake.history.searchPartial.value).toBe(true);
  });

  it("moves browser chats in batches of ten and deletes a local row only once the server confirms it", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const seed = Array.from({ length: IMPORT_BATCH + 2 }, (_, i) => record(i + 1));
    const imported = vi
      .spyOn(assistant, "importBrowserChats")
      .mockImplementation(async (_org, items) => ({
        imported: items
          .filter((item) => !item.title.endsWith(" 3"))
          .map((item) => ({ client_id: item.client_id, session_id: `s-${item.client_id}` })),
        skipped: [],
        failed: items
          .filter((item) => item.title.endsWith(" 3"))
          .map((item) => ({ client_id: item.client_id, code: "invalid" })),
      }));
    const fake = setup({ persistence: true, historyImport: true }, seed);
    await flushPromises();
    expect(fake.history.importView.value).toMatchObject({ state: "offer", count: 12 });
    await fake.history.runImport();
    expect(imported).toHaveBeenCalledTimes(2);
    expect(imported.mock.calls[0][1]).toHaveLength(IMPORT_BATCH);
    const ids = imported.mock.calls.flatMap((call) => call[1].map((item) => item.client_id));
    expect(new Set(ids).size).toBe(12);
    expect([...fake.db.rows.keys()]).toEqual([3]);
    expect(fake.history.importView.value).toMatchObject({
      state: "partial",
      failed: [{ title: "Chat 3" }],
    });
  });

  it("offers Download instead of a move when the server does not advertise import", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const fake = setup({ persistence: true }, [record(1)]);
    await flushPromises();
    expect(fake.history.importView.value).toMatchObject({ state: "unavailable", count: 1 });
    fake.history.dismissImport("never");
    expect(fake.history.importView.value).toBeNull();
  });
});

describe("useAssistantHistory across tabs", () => {
  it("drops a chat another tab deleted, says so, and never writes the row back", async () => {
    const fake = withBus({}, [record(1)]);
    await flushPromises();
    const sid = record(1).sessionId!;
    await fake.history.open({ sid });
    fake.store.setActive(sid);
    fake.db.rows.delete(1);
    fake.hints.fire({ type: "history_changed", sid, op: "delete" });
    await flushPromises();
    expect(fake.store.state.sessions[sid]).toBeUndefined();
    expect(fake.history.deletedNotice.value).toEqual({ sid, via: "tab" });
    expect(await fake.history.save(sid)).toBe("local");
    expect(fake.db.rows.size).toBe(0);
    expect(fake.history.rows.value).toHaveLength(0);
  });

  it("drops every chat of this user+org when another tab clears all", async () => {
    const fake = withBus({}, [record(1), record(2)]);
    await flushPromises();
    await fake.history.open({ sid: record(1).sessionId! });
    await fake.history.open({ sid: record(2).sessionId! });
    fake.db.rows.clear();
    fake.hints.fire({ type: "history_changed", sid: "*", op: "clear" });
    await flushPromises();
    expect(Object.keys(fake.store.state.sessions)).toHaveLength(0);
  });

  it("keeps a pin another tab set when this tab saves the same chat", async () => {
    const fake = withBus({}, [record(1)]);
    await flushPromises();
    const sid = record(1).sessionId!;
    await fake.history.open({ sid });
    fake.db.rows.get(1)!.pinned = true;
    expect(await fake.history.save(sid)).toBe("local");
    expect(fake.db.rows.get(1)?.pinned).toBe(true);
    fake.hints.fire({ type: "history_changed", sid, op: "pin" });
    await flushPromises();
    expect(fake.store.state.sessions[sid].record.pinned).toBe(true);
    expect(fake.history.rows.value[0].pinned).toBe(true);
  });

  it("hands Send back when the tab a hint named never holds the turn lock", async () => {
    const sid = record(1).sessionId!;
    const locks = {
      query: vi.fn(async () => ({ held: [], pending: [] })),
      request: vi.fn(async () => undefined),
    };
    const hints = hintBus();
    const fake = fakeAssistant("available", { persistence: false }, {}, 80, true, {
      hints: hints as never,
      locks: locks as never,
    });
    fake.db.rows.set(1, structuredClone(record(1)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    hints.fire({ type: "turn_started", sid, turnId: "t9", org: "default" });
    expect(fake.store.state.sessions[sid].turnMeta.ownedByThisTab).toBe(false);
    await vi.waitFor(
      () => expect(fake.store.state.sessions[sid].turnMeta.ownedByThisTab).toBe(true),
      { timeout: 3_000 },
    );
    expect(locks.query.mock.calls.length).toBeGreaterThan(1);
    expect(fake.history.elsewhere(sid)).toBeNull();
  });
});

describe("useAssistantHistory mutations in server mode", () => {
  function served(over: Partial<AssistantCapability> = {}) {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        {
          session_id: record(1).sessionId!,
          title: "Server chat",
          created_at: 1_000_000,
          updated_at: 2_000_000,
        },
      ],
      next_cursor: "more",
    });
    return setup({ persistence: true, historyPins: true, ...over }, [
      record(1, { serverBacked: true }),
    ]);
  }

  it("restores the title, the pin and the row when the server refuses each change", async () => {
    vi.spyOn(assistant, "renameChat").mockRejectedValue(httpError(500));
    vi.spyOn(assistant, "pinChat").mockRejectedValue(httpError(500));
    vi.spyOn(assistant, "deleteChat").mockRejectedValue(httpError(500));
    const fake = served();
    await vi.waitFor(() => expect(fake.history.rows.value).toHaveLength(1));
    const sid = record(1).sessionId!;
    expect((await fake.history.rename(sid, "Nope")).ok).toBe(false);
    expect(String(fake.history.rows.value[0].title)).toBe("Server chat");
    expect((await fake.history.pin(sid, true)).ok).toBe(false);
    expect(fake.history.rows.value[0].pinned).toBe(false);
    expect((await fake.history.remove(sid)).ok).toBe(false);
    expect(fake.history.rows.value.map((row) => row.sid)).toEqual([sid]);
    expect(fake.toast).toHaveBeenCalledTimes(3);
  });

  it("counts a delete the server already lost as done, and stops the answer only after it", async () => {
    const order: string[] = [];
    vi.spyOn(assistant, "deleteChat").mockImplementation(async () => {
      order.push("delete");
      throw httpError(404);
    });
    const fake = served();
    await vi.waitFor(() => expect(fake.history.rows.value).toHaveLength(1));
    const sid = record(1).sessionId!;
    await fake.history.open({ sid }).catch(() => undefined);
    const session = fake.store.state.sessions[sid];
    if (session) session.turn = { state: "responding.thinking" };
    vi.spyOn(fake.store, "stop").mockImplementation(async () => void order.push("stop"));
    expect(await fake.history.remove(sid)).toEqual({ ok: true });
    expect(order[0]).toBe("delete");
    expect(fake.history.rows.value).toHaveLength(0);
  });

  it("says all your chats when more pages exist, and the count once the list is whole", async () => {
    vi.spyOn(assistant, "deleteAllChats").mockResolvedValue(undefined as never);
    const fake = served();
    await vi.waitFor(() => expect(fake.history.rows.value).toHaveLength(1));
    expect(fake.history.total.value).toBeNull();
    await fake.history.clearAll();
    expect(String(fake.history.announcement.value?.text)).toBe("Deleted all your chats");
  });
});

describe("useAssistantHistory import resume", () => {
  it("drops a row the server already had, and keeps the server id when the local delete fails", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "importBrowserChats").mockImplementation(async (_org, items) => ({
      imported: [{ client_id: items[1].client_id, session_id: "s-new" }],
      skipped: [items[0].client_id],
      failed: [],
    }));
    const fake = setup({ persistence: true, historyImport: true }, [record(1), record(2)]);
    await flushPromises();
    const remove = vi.spyOn(fake.db, "remove").mockRejectedValueOnce(new Error("blocked"));
    await fake.history.runImport();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(fake.db.rows.get(2)?.importedAs).toBe("s-new");
    expect(fake.db.rows.get(1)?.importedAs).toBe(record(1).sessionId);
    expect(fake.history.importView.value).toBeNull();
  });

  it("stops on a server failure with a retryable error, never a zero-chat failure line", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "importBrowserChats").mockRejectedValue(httpError(413));
    const fake = setup({ persistence: true, historyImport: true }, [record(1)]);
    await flushPromises();
    await fake.history.runImport();
    expect(fake.history.importView.value).toMatchObject({ state: "error", failed: [] });
    expect(fake.db.rows.has(1)).toBe(true);
  });
});

describe("useAssistantHistory reload", () => {
  const sid = record(1).sessionId!;
  const detail = (turns: unknown[]) => ({
    session_id: sid,
    title: "Chat 1",
    created_at: 1,
    updated_at: 1,
    last_committed_seq: 3,
    turns,
  });

  it("keeps this browser's live save inside the grace window and the server's after it", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(detail([]) as never);
    const cached = record(1, { serverBacked: true, liveTurnId: "t-live", liveSavedAt: Date.now() });
    const fake = setup({ persistence: true }, [cached]);
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].messages).toHaveLength(2);
    fake.store.dropSession(sid, "deleted");
    fake.db.rows.set(1, { ...cached, liveSavedAt: Date.now() - LIVE_SAVE_GRACE_MS - 1 });
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].messages).toHaveLength(0);
  });

  it("rebuilds the chat from the browser copy when the server says nothing changed after a reload", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const getChat = vi
      .spyOn(assistant, "getChat")
      .mockResolvedValue({ ...detail([]), turns: undefined, not_modified: true } as never);
    const turn = {
      turn_id: "t1",
      user: { text: "kept question" },
      frames: [{ type: "message_delta", content: "kept answer" }, { type: "complete" }],
      status: "completed" as const,
    };
    const cached = record(1, { serverBacked: true, cachedLastSeq: 3, turns: [turn] });
    const fake = setup({ persistence: true }, [cached]);
    await flushPromises();
    await fake.history.open({ sid });
    expect(getChat).toHaveBeenCalledWith(
      expect.any(String),
      sid,
      expect.objectContaining({ seq: 3 }),
    );
    const text = fake.store.state.sessions[sid].messages.map((m) => String(m.content)).join(" ");
    expect(text).toContain("kept question");
    expect(text).toContain("kept answer");
  });

  it("keeps model names on the owner's own reload, as the live answer showed them", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(
      detail([
        {
          turn_id: "t1",
          user: { text: "which model?" },
          frames: [
            { type: "message_delta", content: "Calling gpt-4o-mini now." },
            { type: "complete" },
          ],
          status: "completed",
        },
      ]) as never,
    );
    const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
    await flushPromises();
    await fake.history.open({ sid });
    const text = fake.store.state.sessions[sid].messages.map((m) => String(m.content)).join(" ");
    expect(text).toContain("gpt-4o-mini");
  });

  it("puts a recovered card before the result of the call it gated, not the turn's first result", () => {
    const card = { type: "confirmation_required", id: "apr", call_id: "c2", tool: "o2_delete" };
    const decided = { type: "confirmation_resolved", id: "apr", approved: true };
    const server = [
      { type: "tool_call", call_id: "c1", tool: "SearchAlerts" },
      { type: "tool_result", call_id: "c1", tool: "SearchAlerts" },
      { type: "message_delta", content: "Deleting needs approval." },
      { type: "tool_result", call_id: "c2", tool: "o2_delete" },
      { type: "complete" },
    ];
    const cached = [
      {
        turn_id: "t1",
        frames: [server[0], server[1], server[2], card, decided, server[3], server[4]],
        status: "completed" as const,
        user: null,
      },
    ];
    const [patched] = patchCards(
      [{ turn_id: "t1", frames: server, status: "completed", user: null }],
      cached,
    );
    expect(patched.frames.map((f: any) => f.type)).toEqual([
      "tool_call",
      "tool_result",
      "message_delta",
      "confirmation_required",
      "confirmation_resolved",
      "tool_result",
      "complete",
    ]);
  });
});

describe("useAssistantHistory reload of a chat waiting on an approval", () => {
  const sid = record(1).sessionId!;
  const expires = () => Date.now() + 120_000;
  const cardFrame = (expiresAt = expires()) => ({
    type: "confirmation_required",
    call_id: "apr_1",
    tool: "CreateDowntime",
    message: "Create the downtime cart-5xx-spike-30m-mute?",
    args: { name: "cart-5xx-spike-30m-mute" },
    expires_at: expiresAt / 1000,
  });
  // Exactly the fields `ChatDetailResponse` (src/api/management/src/request/ai/chats.rs) sends today.
  const detailOf = (frames: unknown[], status: "running" | "completed") => ({
    session_id: sid,
    title: "Mute cart alerts",
    created_at: 1,
    updated_at: 1,
    last_committed_seq: 3,
    state_version: "v3",
    not_modified: false,
    active_turn: status === "running",
    has_more: false,
    turns: [{ turn_id: "t1", user: { text: "mute it" }, frames, status }],
  });
  const running = (frames: unknown[]) => detailOf(frames, "running");
  // The browser copy the live stream saved: the prompt and the answer that holds the card.
  const cachedWith = (frame: ReturnType<typeof cardFrame>) =>
    record(1, {
      serverBacked: true,
      messages: [
        { role: "user", content: raw("mute it"), turnId: "t1" },
        {
          role: "assistant",
          content: raw(""),
          contentBlocks: [{ type: "approval", approval: approvalOf(frame) }],
        },
      ],
    });

  function open(locks: unknown = null, hints = hintBus()) {
    let approvals: ApprovalsRuntime | null = null;
    const fake = fakeAssistant("available", { persistence: true }, {}, 80, true, {
      approvals: () => approvals,
      locks: locks as never,
      hints: hints as never,
    });
    approvals = createApprovalsRuntime({
      state: () => fake.store.state,
      annotate: (s, key, patch) => fake.store.annotate(s, key, patch),
      resend: vi.fn(async () => undefined),
      engine: () => ({}),
      dispatch: vi.fn(async () => ({ ok: true }) as never),
      extend: vi.fn(),
      extendable: () => false,
      hints: { on: () => () => undefined },
      now: () => Date.now(),
      lastKeydownAt: () => Number.NEGATIVE_INFINITY,
      t: gt,
    });
    return { ...fake, hints };
  }

  const cardBlock = (fake: ReturnType<typeof open>) =>
    fake.store.state.sessions[sid].messages
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.type === "approval")?.approval;

  it("replays a stored card the turn still waits on as the live card, with its own expiry", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(
      running([{ type: "message_delta", content: "Muting needs your OK." }, frame]) as never,
    );
    const fake = open();
    fake.db.rows.set(1, structuredClone(record(1, { serverBacked: true })));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    const session = fake.store.state.sessions[sid];
    expect(session.pendingApproval).toMatchObject({
      id: "apr_1",
      turnId: "t1",
      expiresAt: frame.expires_at * 1000,
    });
    expect(session.turnMeta.ownedByThisTab).toBe(false);
    expect(cardBlock(fake)).toMatchObject({ id: "apr_1" });
    expect(cardBlock(fake)?.noDecision).toBeUndefined();
  });

  it("restores the card from this browser's copy when the server's history leaves it out", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(running([]) as never);
    const fake = open();
    fake.db.rows.set(1, structuredClone(cachedWith(frame)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval?.id).toBe("apr_1");
    expect(cardBlock(fake)).toMatchObject({ id: "apr_1", question: frame.message });
  });

  it("never offers an expired card: it stays a record", async () => {
    const frame = cardFrame(Date.now() - 1_000);
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(running([frame]) as never);
    const fake = open();
    fake.db.rows.set(1, structuredClone(record(1, { serverBacked: true })));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(cardBlock(fake)?.noDecision).toBe(true);
  });

  it("renders a card its turn already resolved as the result, never as a live card", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(
      running([frame, { type: "confirmation_resolved", id: "apr_1", approved: true }]) as never,
    );
    const fake = open();
    fake.db.rows.set(1, structuredClone(record(1, { serverBacked: true })));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    const blocks = fake.store.state.sessions[sid].messages.flatMap((m) => m.contentBlocks ?? []);
    expect(blocks.find((b) => b.type === "approval_result")?.resolved).toMatchObject({
      id: "apr_1",
      approved: true,
    });
  });

  it("never offers a card whose gated call already has its result", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(
      running([{ type: "tool_result", call_id: "apr_1", tool: "CreateDowntime" }]) as never,
    );
    const fake = open();
    fake.db.rows.set(1, structuredClone(cachedWith(frame)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(cardBlock(fake)).toMatchObject({ id: "apr_1", recorded: { status: "approved" } });
  });

  it("reopens a finished chat with the card only this browser saw and the outcome its turn shows", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(
      detailOf(
        [{ type: "tool_result", call_id: "apr_1", tool: "CreateDowntime" }, { type: "complete" }],
        "completed",
      ) as never,
    );
    const fake = open();
    fake.db.rows.set(1, structuredClone(cachedWith(frame)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(cardBlock(fake)).toMatchObject({
      id: "apr_1",
      question: frame.message,
      recorded: { status: "approved" },
    });
  });

  it("never reads a failed call as a denial: the card stays answered with no known decision", async () => {
    const frame = cardFrame();
    const failed = {
      type: "tool_result",
      call_id: "apr_1",
      tool: "CreateDowntime",
      success: false,
    };
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const getChat = vi.spyOn(assistant, "getChat").mockResolvedValue(running([]) as never);
    const fake = open();
    fake.db.rows.set(1, structuredClone(cachedWith(frame)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval?.id).toBe("apr_1");
    getChat.mockResolvedValue(detailOf([failed, { type: "complete" }], "completed") as never);
    fake.hints.fire({ type: "turn_ended", sid, turnId: "t1", org: "default" });
    await flushPromises();
    const session = fake.store.state.sessions[sid];
    expect(session.pendingApproval).toBeNull();
    expect(session.annotations[approvalAnnotationKey("apr_1")]).toBeUndefined();
    expect(cardBlock(fake)?.recorded).toBeUndefined();
    expect(cardBlock(fake)?.noDecision).toBeUndefined();
    fake.store.dropSession(sid, "deleted");
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(cardBlock(fake)).toMatchObject({ id: "apr_1", question: frame.message });
    expect(cardBlock(fake)?.recorded).toBeUndefined();
  });

  it("follows a server's approval rows when it sends them", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue({
      ...running([frame]),
      pending_approval: false,
      approvals: [{ id: "apr_1", status: "approved", at: Date.now() }],
    } as never);
    const fake = open();
    fake.db.rows.set(1, structuredClone(record(1, { serverBacked: true })));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(cardBlock(fake)?.recorded?.status).toBe("approved");
  });

  it("leaves the card to the tab that still streams the turn", async () => {
    const locks = {
      query: vi.fn(async () => ({ held: [{ name: `o2-assistant-turn:${sid}` }], pending: [] })),
      request: vi.fn(async () => undefined),
    };
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(running([cardFrame()]) as never);
    const fake = open(locks);
    fake.db.rows.set(1, structuredClone(record(1, { serverBacked: true })));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    await flushPromises();
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(locks.request).not.toHaveBeenCalledWith(
      `o2-assistant-card:${sid}`,
      expect.anything(),
      expect.anything(),
    );
    expect(fake.store.state.sessions[sid].turnMeta.ownedByThisTab).toBe(false);
  });

  it("keeps a card only this browser saw, with its outcome, when the turn ends without this tab", async () => {
    const frame = cardFrame();
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const getChat = vi.spyOn(assistant, "getChat").mockResolvedValue(running([]) as never);
    const fake = open();
    fake.db.rows.set(1, structuredClone(cachedWith(frame)));
    fake.history.ensureLoaded();
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval?.id).toBe("apr_1");
    getChat.mockResolvedValue(
      detailOf(
        [
          { type: "tool_result", call_id: "apr_1", tool: "CreateDowntime" },
          { type: "message_delta", content: "Muted." },
          { type: "complete" },
        ],
        "completed",
      ) as never,
    );
    fake.hints.fire({ type: "turn_ended", sid, turnId: "t1", org: "default" });
    await flushPromises();
    const session = fake.store.state.sessions[sid];
    expect(session.pendingApproval).toBeNull();
    expect(session.annotations[approvalAnnotationKey("apr_1")]?.approvalOutcome?.state).toBe(
      "approved_elsewhere",
    );
    expect(cardBlock(fake)).toMatchObject({ id: "apr_1", question: frame.message });
    fake.store.dropSession(sid, "deleted");
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    expect(cardBlock(fake)).toMatchObject({ id: "apr_1", question: frame.message });
  });

  it("keeps the restored card in the answer each poll re-reads, and lets it go when the server ends it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const frame = cardFrame();
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      const getChat = vi.spyOn(assistant, "getChat").mockResolvedValue(running([]) as never);
      const fake = open();
      fake.db.rows.set(1, structuredClone(cachedWith(frame)));
      fake.history.ensureLoaded();
      await flushPromises();
      await fake.history.open({ sid });
      await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
      expect(getChat).toHaveBeenCalledTimes(2);
      expect(fake.store.state.sessions[sid].pendingApproval?.id).toBe("apr_1");
      expect(cardBlock(fake)).toMatchObject({ id: "apr_1", question: frame.message });
      getChat.mockResolvedValue({
        ...running([]),
        approvals: [{ id: "apr_1", status: "expired", at: Date.now() }],
      } as never);
      await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
      const session = fake.store.state.sessions[sid];
      expect(session.pendingApproval).toBeNull();
      expect(session.annotations[approvalAnnotationKey("apr_1")]?.approvalOutcome?.state).toBe(
        "expired",
      );
      expect(cardBlock(fake)).toMatchObject({ id: "apr_1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a card this browser already answered", () => {
    const frame = cardFrame();
    const messages = cachedWith(frame).messages;
    const detail = running([]);
    expect(waitingCardOf(detail, "t1", messages, undefined, {}, Date.now())?.card.id).toBe("apr_1");
    const answered = {
      [approvalAnnotationKey("apr_1")]: { approvalOutcome: { state: "declined" as const, at: 1 } },
    };
    expect(waitingCardOf(detail, "t1", messages, undefined, answered, Date.now())).toBeNull();
    expect(
      waitingCardOf({ ...detail, active_turn: false }, "t1", messages, undefined, {}, Date.now()),
    ).toBeNull();
  });
});

describe("groupOf", () => {
  it("buckets by calendar day, pinned first", () => {
    const row = { pinned: false, updatedAt: 0, local: false };
    expect(groupOf({ ...row, pinned: true }, 0, () => 9, true)).toBe("pinned");
    expect(groupOf(row, 0, () => 0, true)).toBe("today");
    expect(groupOf(row, 0, () => 1, true)).toBe("yesterday");
    expect(groupOf(row, 0, () => 6, true)).toBe("week");
    expect(groupOf(row, 0, () => 7, true)).toBe("older");
  });
});

describe("memoryHistoryDb", () => {
  it("refuses a merge over another user's row or a row with no owner", async () => {
    const db = memoryHistoryDb([
      record(1, { userOrgKey: "other" }),
      record(2, { userOrgKey: undefined }),
    ]);
    expect(await db.merge(record(1), "w")).toBeNull();
    expect(await db.merge(record(2), "w")).toBeNull();
  });

  it("removes only the rows the caller's user+org owns", async () => {
    const db = memoryHistoryDb([record(1), record(2, { userOrgKey: "other" })]);
    await db.remove([1, 2], KEY);
    expect([...db.rows.keys()]).toEqual([2]);
  });
});
