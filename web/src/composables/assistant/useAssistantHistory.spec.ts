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
import assistant, { parseChatDetail, type ChatSummaryWire } from "@/services/assistant";
import { gt, raw } from "@/types/i18n";

import { approvalAnnotationKey } from "./actions/appliers/approval";
import type { AssistantCapability } from "./assistantStore.types";
import { LOCAL_CAP, SERVER_CACHE_CAP, type LocalRecord } from "./historyDb";
import { writeAnnotation } from "./prefs";
import { LIVE_SAVE_GRACE_MS } from "./historyDb";
import { POLL_FAST_MS } from "./historyElsewhere";
import { patchCards, serverCardOf, waitingCardOf } from "./historyRecords";
import { approvalOf } from "./reducer";
import { runsList } from "./runs";
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

  it("loads the list again when identity and persistence settle in the tick after the first ask", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [{ session_id: record(1).sessionId!, title: "Listed", created_at: 1, updated_at: 1 }],
    });
    const fake = setup();
    fake.store.setIdentity({ userOrgKey: "k2", org: "default" });
    fake.capability.value = { ...fake.capability.value, persistence: true };
    await flushPromises();
    expect(fake.history.listState.value.status).toBe("ready");
    expect(fake.history.rows.value.map((row) => String(row.title))).toEqual(["Listed"]);
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

  it("lists a chat with only a typed draft apart from the saved rows", async () => {
    const fake = setup({}, [record(1)]);
    await flushPromises();
    const sid = fake.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    expect(fake.history.drafts.value).toEqual([]);
    fake.store.state.sessions[sid].composer.text = "Compare p95\nbefore the deploy";
    expect(fake.history.drafts.value.map((row) => String(row.title))).toEqual(["Compare p95"]);
    expect(fake.history.rows.value.some((row) => row.sid === sid)).toBe(false);
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
  it("stops calling a chat answering once this tab saw the listed turn end", async () => {
    const sid = "0190ffff-0000-7000-8000-0000000a11ed";
    vi.spyOn(assistant, "listChats").mockResolvedValue({
      chats: [
        {
          session_id: sid,
          title: "Listed",
          created_at: 1,
          updated_at: 1,
          active_turn: true,
          active_turn_id: "t1",
          pending_approval: true,
        },
      ],
    });
    const fake = setup({ persistence: true });
    fake.store.adoptSession(sid, {
      title: raw("Listed"),
      titleSource: "generated",
      origin: { entryKind: "deep_link", objectKind: "none", container: "full_view" },
      messages: [{ role: "user", content: raw("q") }],
      record: { serverBacked: true },
    });
    const session = fake.store.state.sessions[sid];
    Object.assign(session.turnMeta, { turnId: "t1", ownedByThisTab: true });
    session.turn = { state: "responding.writing" };
    await flushPromises();
    expect(fake.history.rows.value[0]).toMatchObject({ activeTurn: true });
    session.turn = { state: "done", saved: "server" };
    expect(fake.history.rows.value[0]).toMatchObject({ activeTurn: false, pendingApproval: false });
  });

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

  it("opens a browser-only chat from this browser and keeps its only copy", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const read = vi.spyOn(assistant, "getChat").mockRejectedValue(httpError(404));
    const fake = setup({ persistence: true }, [record(7)]);
    await flushPromises();
    const sid = record(7).sessionId!;
    expect(fake.history.rows.value).toEqual([expect.objectContaining({ sid, local: true })]);
    await expect(fake.store.openSession({ sid })).resolves.toBe(sid);
    await flushPromises();
    expect(read).not.toHaveBeenCalled();
    expect(fake.db.rows.has(7)).toBe(true);
    expect(fake.store.state.sessions[sid].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: "answer 7" })]),
    );
    expect(fake.history.deletedNotice.value).toBeNull();
  });

  it("drops a history read that answers after an org switch", async () => {
    const org = { value: "old-org" };
    const fake = fakeAssistant(
      "available",
      { persistence: true },
      { getOrg: () => ({ identifier: org.value, name: org.value }) },
      80,
      true,
      { org: () => org.value },
    );
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const sid = "0190ffff-c3d4-7e5f-8a9b-000000000001";
    let answer!: (detail: Awaited<ReturnType<typeof assistant.getChat>>) => void;
    vi.spyOn(assistant, "getChat").mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const pending = fake.store.openSession({ sid }).catch(() => null);
    await flushPromises();
    expect(assistant.getChat).toHaveBeenCalledWith("old-org", sid, undefined);
    await fake.store.onOrgSwitch({ userOrgKey: "new-key", org: "new-org" });
    org.value = "new-org";
    fake.store.setIdentity({ userOrgKey: "new-key", org: "new-org" });
    await flushPromises();
    answer({
      session_id: sid,
      title: "Old org chat",
      created_at: 1,
      updated_at: 1,
      turns: [
        {
          turn_id: "turn-old",
          user: { text: "old-org question" },
          frames: [{ type: "message_delta", content: "old-org answer" }, { type: "complete" }],
          status: "completed",
        },
      ],
    } as Awaited<ReturnType<typeof assistant.getChat>>);
    await pending;
    await flushPromises();
    expect(fake.store.state.shell.activeSid).toBeNull();
    expect(fake.store.state.sessions[sid]).toBeUndefined();
    expect([...fake.db.rows.values()].filter((row) => row.userOrgKey === "new-key")).toEqual([]);
    fake.history.dispose();
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

  it("keeps an open chat the server search did not return out of the matches", async () => {
    const list = vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const fake = setup({ persistence: true, historySearch: true });
    await flushPromises();
    chat(fake, "Say only the word pineapple.");
    await vi.waitFor(() => expect(fake.history.rows.value).toHaveLength(1));
    fake.history.setFilter({ q: "checkoutzzzqqq" });
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith(
      "default",
      expect.objectContaining({ q: "checkoutzzzqqq" }),
    );
    expect(fake.history.visible.value).toEqual([]);
    fake.history.setFilter({ q: "pineapple" });
    await flushPromises();
    expect(fake.history.visible.value).toHaveLength(1);
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
    expect(fake.store.state.sessions[sid].turnMeta.ownedByThisTab).toBe(true);
    hints.fire({ type: "turn_heartbeat", sid, turnId: "t9", org: "default" });
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

  it("caps the server chats cached in this browser, oldest unopened first, without re-reading every row (WC-2)", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    vi.spyOn(assistant, "getChat").mockResolvedValue(detail([]) as never);
    const old = Array.from({ length: SERVER_CACHE_CAP + 1 }, (_, i) =>
      record(100 + i, { serverBacked: true }),
    );
    const live = record(99, { serverBacked: true, liveTurnId: "t-live", liveSavedAt: Date.now() });
    const local = record(98);
    const fake = setup({ persistence: true }, [
      record(1, { serverBacked: true }),
      live,
      local,
      ...old,
    ]);
    await flushPromises();
    const list = vi.spyOn(fake.db, "list");
    await fake.history.open({ sid });
    await flushPromises();
    expect(list).not.toHaveBeenCalled();
    const kept = [...fake.db.rows.keys()];
    expect(kept).toEqual(expect.arrayContaining([1, 98, 99]));
    expect(kept).not.toContain(100);
    expect(kept).not.toContain(101);
    expect(kept.filter((id) => fake.db.rows.get(id)?.serverBacked)).toHaveLength(SERVER_CACHE_CAP);
  });

  it("lets a chat saved after a completed turn leave the cache once its grace window is over (S2-1)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      const fake = setup({ persistence: true });
      await flushPromises();
      // The fake's ids share one v7 time prefix, so each chat carries its own row id as a real one would.
      const saveNew = (text: string) => {
        const sid = chat(fake, text);
        fake.store.state.sessions[sid].chatId = Date.now();
        return fake.history.save(sid).then(() => sid);
      };
      const first = await saveNew("oldest");
      const firstId = [...fake.db.rows.values()].find((row) => row.sessionId === first)!.id;
      expect(fake.db.rows.get(firstId)).toMatchObject({ liveTurnId: "t1" });
      fake.store.dropSession(first);
      vi.setSystemTime(Date.now() + LIVE_SAVE_GRACE_MS + 1);
      for (let i = 0; i < SERVER_CACHE_CAP; i++) {
        vi.setSystemTime(Date.now() + 1);
        await saveNew(`newer ${i}`);
      }
      await flushPromises();
      expect(fake.db.rows.has(firstId)).toBe(false);
      expect(fake.db.rows.size).toBe(SERVER_CACHE_CAP);
    } finally {
      vi.useRealTimers();
    }
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

  it("keeps a branched chat's source on reload, so its Branched from header comes back", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    const wire = {
      ...detail([]),
      branched_from: { session_id: "src-1", turn_id: "t2", title: "Checkout failures" },
    };
    vi.spyOn(assistant, "getChat").mockResolvedValue(parseChatDetail(wire));
    const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
    await flushPromises();
    await fake.history.open({ sid });
    expect(fake.store.state.sessions[sid].record.branchedFrom).toEqual({
      sessionId: "src-1",
      turnId: "t2",
      title: "Checkout failures",
    });
  });

  it("shows a branched chat's carried turns as its own, from the seed the read returns", async () => {
    vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
    // The shape `GET /ai/chats/{sid}` returned for a fresh branch: no own turns, the cut in `seed.turns`.
    const carried = (n: number) => ({
      user_message_id: `msg_${n}`,
      created: 1_794_222_602_989 + n,
      user: { text: `question ${n}`, images: [] },
      frames: [{ type: "message_delta", content: `answer ${n}` }, { type: "complete" }],
      error: null,
      turn_id: `src-t${n}`,
      status: "completed",
      error_code: null,
      agent_type: "o2-ai",
    });
    const wire = {
      ...detail([]),
      last_committed_seq: -1,
      branched_from: { session_id: "src-1", turn_id: "src-t2", title: "Checkout failures" },
      active_turn: false,
      pending_approval: false,
      has_more: false,
      seed: { owner_name: "Conv Tester", as_of: 1, turns: [carried(1), carried(2)] },
    };
    vi.spyOn(assistant, "getChat").mockResolvedValue(parseChatDetail(wire));
    const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
    await flushPromises();
    await fake.history.open({ sid });
    const messages = fake.store.state.sessions[sid].messages;
    expect(messages.map((m) => [m.role, String(m.content)])).toEqual([
      ["user", "question 1"],
      ["assistant", "answer 1"],
      ["user", "question 2"],
      ["assistant", "answer 2"],
    ]);
  });

  describe("B-conversation-21: carried turns survive a reload answered not_modified", () => {
    const carried = (n: number) => ({
      user_message_id: `msg_${n}`,
      created: 1_794_231_018_497 + n,
      user: { text: `question ${n}`, images: [] },
      frames: [{ type: "message_delta", content: `answer ${n}` }, { type: "complete" }],
      error: null,
      turn_id: `src-t${n}`,
      status: "completed",
      error_code: null,
      agent_type: "o2-ai",
    });
    const fullRead = (over: Record<string, unknown>) => ({
      ...detail([]),
      last_committed_seq: -1,
      agent_type: "o2-ai",
      active_turn: false,
      pending_approval: false,
      pinned: false,
      state_version: "-1.0.0.0.cbf29ce484222325",
      not_modified: false,
      has_more: false,
      seed: {
        owner_name: "Conv Tester",
        as_of: 1_794_231_438_493_003,
        turns: [carried(1), carried(2)],
      },
      approvals: [],
      ...over,
    });
    // What `GET /ai/chats/{sid}?known_seq=-1&known_version=…` answers once the browser holds the chat.
    const notModified = (over: Record<string, unknown>) => ({
      ...fullRead(over),
      not_modified: true,
      partial_from_seq: null,
      turns: null,
      seed: null,
      approvals: null,
    });

    async function openThenReload(over: Record<string, unknown>) {
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      const getChat = vi
        .spyOn(assistant, "getChat")
        .mockResolvedValue(parseChatDetail(fullRead(over)));
      const first = setup({ persistence: true }, [record(1, { serverBacked: true })]);
      await flushPromises();
      await first.history.open({ sid });
      await flushPromises();
      getChat.mockResolvedValue(parseChatDetail(notModified(over)));
      const reloaded = setup({ persistence: true }, [...first.db.rows.values()]);
      await flushPromises();
      await reloaded.history.open({ sid });
      expect(getChat).toHaveBeenLastCalledWith(
        expect.any(String),
        sid,
        expect.objectContaining({
          seq: over.last_committed_seq ?? -1,
          version: "-1.0.0.0.cbf29ce484222325",
        }),
      );
      return reloaded.store.state.sessions[sid];
    }

    it("keeps a branch's carried turns", async () => {
      const session = await openThenReload({
        branched_from: { session_id: "src-1", turn_id: "src-t2", title: "Checkout failures" },
      });
      expect(session.messages.map((m) => [m.role, String(m.content)])).toEqual([
        ["user", "question 1"],
        ["assistant", "answer 1"],
        ["user", "question 2"],
        ["assistant", "answer 2"],
      ]);
      expect(session.messages.filter((m) => m.role === "user").every((m) => m.carried)).toBe(true);
    });

    it("keeps a share fork's source seed, with its owner and time", async () => {
      const session = await openThenReload({ forked_from_share: "3LsRsoFNinRWZfgpIQxeiimjnHa" });
      expect(session.messages).toHaveLength(0);
      expect(session.record.seed).toMatchObject({
        ownerName: "Conv Tester",
        asOf: 1_794_231_438_493.003,
      });
      expect(session.record.seed?.turns).toHaveLength(2);
    });

    it("B-conversation-26: never probes the share by its id, which the shared read does not accept", async () => {
      const session = await openThenReload({ forked_from_share: "3LsRsoFNinRWZfgpIQxeiimjnHa" });
      expect(session.record.forkedFromShare).toBe("3LsRsoFNinRWZfgpIQxeiimjnHa");
      expect(session.record.seed?.token).toBeUndefined();
    });

    it("B-conversation-27: heads the fork with the source's title, not its own (continued) one", async () => {
      const source = "Run a SQL query listing the 20 most recent rows";
      const session = await openThenReload({
        forked_from_share: "3LsRsoFNinRWZfgpIQxeiimjnHa",
        title: `${source} (continued)`,
        seed: {
          owner_name: "Conv Tester",
          title: source,
          as_of: 1_794_231_438_493_003,
          turns: [carried(1), carried(2)],
        },
      });
      expect(session.record.seed?.title).toBe(source);
    });

    it("keeps a door-seeded chat's turns, which the server sends as its own", async () => {
      const session = await openThenReload({
        seed: null,
        last_committed_seq: 0,
        turns: [carried(1)],
      });
      expect(session.messages.map((m) => String(m.content))).toEqual(["question 1", "answer 1"]);
    });

    it("sends no known_seq from a copy that holds no turns, so the read is never empty", async () => {
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      const getChat = vi
        .spyOn(assistant, "getChat")
        .mockResolvedValue(parseChatDetail(fullRead({ forked_from_share: "tok-1" })));
      const fake = setup({ persistence: true }, [
        record(1, { serverBacked: true, cachedLastSeq: -1 }),
      ]);
      await flushPromises();
      await fake.history.open({ sid });
      expect(getChat).toHaveBeenCalledWith(expect.any(String), sid, undefined);
    });
  });

  describe("B-conversation-23 / B-shell3-6: a reopened chat keeps the window it asked over", () => {
    const DAY = 86_400_000;
    const asked = { from: 1_794_147_097_080, to: 1_794_147_097_080 + DAY };
    const storedTurn = {
      user_message_id: "msg_1",
      created: asked.to,
      user: { text: "Write a SQL query by level", images: [], window: asked },
      frames: [
        {
          type: "message_delta",
          content: "```sql\nSELECT level, COUNT(*) FROM t GROUP BY level\n```",
        },
        { type: "complete" },
      ],
      turn_id: "t-home",
      status: "completed",
    };

    async function reopen(over: Record<string, unknown>) {
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      vi.spyOn(assistant, "getChat").mockResolvedValue(
        parseChatDetail({ ...detail([storedTurn]), ...over }),
      );
      const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
      await flushPromises();
      await fake.history.open({ sid });
      return fake.store.state.sessions[sid];
    }

    it("gives the reopened question its stored window, so its query card keeps the range", async () => {
      const session = await reopen({});
      expect(session.messages.find((m) => m.role === "user")?.sentWindow).toEqual(asked);
      expect(session.composer.timeOverride).toBeNull();
    });

    it("keeps a Home chat's relative window on the composer after a reload", async () => {
      const session = await reopen({ origin: "home" });
      expect(session.composer.timeOverride).toEqual({ ...asked, period: "24h" });
    });

    it("keeps it from this browser's own Home mark when the server names no origin", async () => {
      writeAnnotation(
        KEY,
        sid,
        "turn:t-home:window",
        { window: asked, homeDefaultWindow: true },
        1,
      );
      const session = await reopen({});
      expect(session.composer.timeOverride).toEqual({ ...asked, period: "24h" });
    });

    it("keeps the stored relative period and Home entry in a fresh browser, even on a read without origin", async () => {
      // The live read FX-BE recorded for a Home question (`p3_window.out`).
      const window = { from: 1794148464840, to: 1794234864840, relative: "24h" };
      const turn = {
        ...storedTurn,
        user: { ...storedTurn.user, window, entry_kind: "home_launcher" },
      };
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      vi.spyOn(assistant, "getChat").mockResolvedValue(parseChatDetail(detail([turn])));
      const fake = setup({ persistence: true }, [record(1, { serverBacked: true })]);
      await flushPromises();
      await fake.history.open({ sid });
      const session = fake.store.state.sessions[sid];
      expect(session.messages.find((m) => m.role === "user")?.sentWindow).toEqual({
        from: window.from,
        to: window.to,
        period: "24h",
      });
      expect(session.composer.timeOverride).toEqual({
        from: window.from,
        to: window.to,
        period: "24h",
      });
    });
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
    return { ...fake, hints, approvals };
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
    // The held card is the chat's state, so every list reads it as waiting on the user (B1).
    expect(session.turn).toMatchObject({ state: "awaiting_approval", callId: "apr_1" });
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

  describe("a queued write whose turn ended waiting on its card", () => {
    const id = "apr_7ff4b3fb174562c42aa0";
    // The frames the live o2-ai stream sent for the turn (approval-stream capture), as the stored turn replays them.
    const queuedFrames = (expiresAtMs: number) => [
      {
        type: "confirmation_required",
        tool: "CreateAlert",
        args: { request_body: { name: "payment_errors" } },
        message: 'The assistant wants to create the alert "payment_errors".',
        id,
        kind: "create",
        operation: "CreateAlert",
        destructive: false,
        targets: [{ type: "alert", name: "payment_errors" }],
        expires_at: expiresAtMs,
        editable: false,
        grantable: true,
        user_extends_left: 10,
        background_extends_left: 3,
      },
      {
        type: "tool_call",
        tool: "CreateAlert",
        message: "Executing CreateAlert",
        context: { request_body: { name: "payment_errors" } },
        call_id: "call_2",
      },
      {
        type: "tool_result",
        tool: "CreateAlert",
        success: false,
        error_type: "approval_pending",
        approval_id: id,
        message: "Waiting for your approval. Nothing has changed yet.",
        call_id: "call_2",
      },
      { type: "message_delta", content: "Proposed change: a scheduled alert on payment's errors." },
      { type: "complete", turn_id: "t1" },
    ];
    // `ChatDetailResponse` once the turn completed: no running turn, the card's row still pending (micros).
    const endedWaiting = (expiresAtMs: number, over: Record<string, unknown> = {}) => ({
      ...detailOf(queuedFrames(expiresAtMs), "completed"),
      active_turn: false,
      pending_approval: true,
      approvals: [{ id, status: "pending", expires_at: expiresAtMs * 1000, user_extends_left: 10 }],
      ...over,
    });

    async function reopen(detail: unknown, chats: ChatSummaryWire[] = []) {
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats });
      vi.spyOn(assistant, "getChat").mockResolvedValue(detail as never);
      const fake = open();
      fake.db.rows.set(1, structuredClone(record(1, { serverBacked: true })));
      fake.history.ensureLoaded();
      await flushPromises();
      await fake.history.open({ sid });
      await flushPromises();
      return fake;
    }

    it("rebuilds a pending card from its approval row when the stored turn never kept the frame", async () => {
      // Chat 01a1c00b as `GET /ai/chats/{sid}` returned it: the turn has no card frame, only the row's `card` holds it.
      const expiresAt = Date.now() + 600_000;
      const card = {
        ...queuedFrames(expiresAt)[0],
        before: { name: "payment_errors" },
        sealed: "s1:x",
      };
      const stored = queuedFrames(expiresAt).filter((f) => f.type !== "confirmation_required");
      const wire = {
        ...endedWaiting(expiresAt),
        turns: [{ turn_id: "t1", user: { text: "mute it" }, frames: stored, status: "completed" }],
        pending_approval_id: id,
        approvals: [
          {
            id,
            status: "pending",
            scope: null,
            card,
            resolved: null,
            expires_at: expiresAt * 1000,
          },
        ],
      };
      const fake = await reopen(parseChatDetail(wire));
      const session = fake.store.state.sessions[sid];
      expect(session.pendingApproval).toMatchObject({ id, turnId: "t1", expiresAt });
      expect(cardBlock(fake)).toMatchObject({ id });
      expect(cardBlock(fake)?.noDecision).toBeUndefined();
    });

    it("restores the card as actionable while the server still holds it pending and unexpired", async () => {
      const expiresAt = Date.now() + 600_000;
      const fake = await reopen(endedWaiting(expiresAt));
      const session = fake.store.state.sessions[sid];
      expect(session.pendingApproval).toMatchObject({ id, turnId: "t1", expiresAt });
      expect(cardBlock(fake)).toMatchObject({ id });
      expect(cardBlock(fake)?.recorded).toBeUndefined();
      expect(cardBlock(fake)?.noDecision).toBeUndefined();
    });

    it("keeps an ask_user question answered in this browser answered after a reload", async () => {
      // Chat 01a1af52 as stored: two denied writes; the question is never stored, only this browser's copy and record keep it.
      const turn = "01a1af52-0b3b-73b7-a053-4221c2d37ccb";
      const denied = (id: string, tool: string, type: string, name: string, at: number) => ({
        id,
        status: "denied",
        scope: null,
        card: {
          type: "confirmation_required",
          tool,
          id,
          kind: "create",
          operation: tool,
          destructive: false,
          targets: [{ type, name }],
          grantable: true,
        },
        resolved: {
          type: "confirmation_resolved",
          id,
          approved: false,
          by: "root@example.com",
          at,
          tool,
          operation: "create",
          outcome: "denied",
          detail: "Declined. Nothing was changed.",
        },
        expires_at: (at + 600_000) * 1000,
      });
      const frames = [
        { type: "message_delta", content: "I proposed the destination and the alert." },
        ...["apr_08bef9b0f807ccb8da9d", "apr_1717efb9c59c6c7e496d"].map((id, n) => ({
          type: "confirmation_resolved",
          id,
          approved: false,
          by: "root@example.com",
          at: 1_793_942_809_560 + n * 11_880,
        })),
        { type: "complete" },
      ];
      const detail = {
        ...detailOf(frames, "completed"),
        turns: [
          {
            turn_id: turn,
            user: { text: "Create an alert for payment errors" },
            frames,
            status: "completed",
          },
        ],
        last_committed_seq: 129,
        pending_approval: false,
        approvals: [
          denied(
            "apr_08bef9b0f807ccb8da9d",
            "CreateDestination",
            "destination",
            "payment_errors_webhook",
            1_793_942_809_559,
          ),
          denied(
            "apr_1717efb9c59c6c7e496d",
            "CreateAlert",
            "alert",
            "payment_error_rate",
            1_793_942_821_439,
          ),
        ],
      };
      const question = approvalOf({
        type: "confirmation_required",
        id: "q_1",
        tool: "ask_user",
        kind: "question",
        message: "Where should payment alerts go?",
        options: [{ id: "opt_1", label: "Create a webhook destination for payment alerts" }],
        allow_other: true,
        expires_at: 1_793_943_383_260,
      });
      const outcome = {
        state: "answered" as const,
        at: 1_793_942_790_000,
        decision: {
          approved: false as const,
          reason: "answer" as const,
          answer: "opt_1",
          answerLabel: "Create a webhook destination for payment alerts",
        },
      };
      writeAnnotation(KEY, sid, approvalAnnotationKey("q_1"), { approvalOutcome: outcome }, 1);
      vi.spyOn(assistant, "listChats").mockResolvedValue({ chats: [] });
      vi.spyOn(assistant, "getChat").mockResolvedValue(detail as never);
      const fake = open();
      fake.db.rows.set(
        1,
        record(1, {
          serverBacked: true,
          messages: [
            { role: "user", content: raw("Create an alert for payment errors"), turnId: turn },
            {
              role: "assistant",
              content: raw(""),
              contentBlocks: [{ type: "approval", approval: question }],
            },
          ],
        }),
      );
      fake.history.ensureLoaded();
      await flushPromises();
      await fake.history.open({ sid });
      await flushPromises();
      const session = fake.store.state.sessions[sid];
      expect(session.annotations[approvalAnnotationKey("q_1")]?.approvalOutcome).toEqual(outcome);
    });

    it("restores every write the turn queued, the first shown and the next waiting behind it", async () => {
      const expiresAt = Date.now() + 600_000;
      const first = "apr_6c229cd28e1c3c38595d";
      const [destination] = queuedFrames(expiresAt).map((frame) => ({
        ...frame,
        tool: "CreateDestination",
        operation: "CreateDestination",
        id: first,
        args: { request_body: { name: "default_webhook" } },
        targets: [{ type: "destination", name: "default_webhook" }],
      }));
      const frames = [destination, ...queuedFrames(expiresAt)];
      const fake = await reopen({
        ...detailOf(frames, "completed"),
        active_turn: false,
        pending_approval: true,
        approvals: [first, id].map((card) => ({
          id: card,
          status: "pending",
          expires_at: expiresAt * 1000,
          user_extends_left: 10,
        })),
      });
      const session = fake.store.state.sessions[sid];
      expect(session.pendingApproval).toMatchObject({ id: first, turnId: "t1" });
      expect(session.queuedApprovals?.map((card) => card.id)).toEqual([id]);
    });

    it("leaves In progress once this tab denies the restored card, though the summary still says pending", async () => {
      // The active-chats summary read before the decision: the ended turn, its card still waiting.
      const summary = {
        session_id: sid,
        title: "Create an alert for payment errors",
        created_at: 1,
        updated_at: (Date.now() - 5_000) * 1000,
        last_committed_seq: 36,
        active_turn: false,
        pending_approval: true,
        pending_approval_id: id,
        last_turn_status: "completed",
        seen: true,
      } as ChatSummaryWire;
      const fake = await reopen(endedWaiting(Date.now() + 600_000), [summary]);
      expect(fake.history.rows.value.find((row) => row.sid === sid)?.pendingApproval).toBe(true);
      await fake.approvals!.decide(sid, { approved: false, reason: "deny" }, id);
      await flushPromises();
      const session = fake.store.state.sessions[sid];
      expect(session.pendingApproval).toBeNull();
      expect(fake.history.rows.value.find((row) => row.sid === sid)?.pendingApproval).toBe(false);
      const runs = runsList({
        sessions: [session],
        chats: [summary],
        remote: [],
        cleared: {},
        org: "default",
        userOrgKey: session.userOrgKey,
        clientId: "me",
        now: Date.now(),
      });
      expect(runs.find((row) => row.sid === sid)).toBeUndefined();
    });

    it("keeps the card a record once a later turn moved the chat on", async () => {
      const ended = endedWaiting(Date.now() + 600_000);
      const later = {
        turn_id: "t2",
        user: { text: "never mind" },
        frames: [{ type: "complete" }],
        status: "completed",
      };
      const fake = await reopen({ ...ended, turns: [...ended.turns, later] });
      expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    });

    it("keeps the card a record once the server stops calling it pending", async () => {
      const fake = await reopen(endedWaiting(Date.now() + 600_000, { pending_approval: false }));
      expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    });

    it("keeps the card a record once its row is past its expiry", async () => {
      const fake = await reopen(endedWaiting(Date.now() - 1_000));
      expect(fake.store.state.sessions[sid].pendingApproval).toBeNull();
    });

    it("reads the card as still open on a later check, never as withdrawn", () => {
      const expiresAt = Date.now() + 600_000;
      expect(serverCardOf(endedWaiting(expiresAt) as never, "t1", id)).toMatchObject({
        ending: null,
        expires_at: expiresAt,
      });
    });
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
