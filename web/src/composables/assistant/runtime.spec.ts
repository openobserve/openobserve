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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import assistantService from "@/services/assistant";
import { computeUserOrgKey } from "@/utils/userOrgKey";

import { queryRunOf, runQueryApplier } from "./actions/appliers/query";
import * as storeModule from "./assistantStore";
import { assistantStore, openAssistant, useAssistantCapability } from "./index";
import { openTabWithoutOpener } from "./openTab";
import { pushRecall, readRecall } from "./prefs";
import { getAssistantRuntime, resetAssistantRuntimeForTests } from "./runtime";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

vi.mock("@/services/assistant", () => ({
  default: {
    capabilities: vi.fn().mockResolvedValue(null),
    probeChatAccess: vi.fn().mockResolvedValue("no"),
    testCapabilities: vi.fn(),
  },
}));

const createStore = vi.spyOn(storeModule, "createAssistantStore");

const CONFIG = {
  aiEnabled: true,
  rbacEnabled: true,
  persistence: true,
  publicLinks: false,
  publicMaxExpiryDays: 30,
  rcaEnabled: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetAssistantRuntimeForTests();
  queryClient.clear();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

const context = (role: string, org = ref("org1")) => ({
  getOrg: () => ({ identifier: org.value, name: org.value }),
  getUser: () => ({ email: "dev@example.com", role }),
  getConfig: () => CONFIG,
  isOrgAdmin: () => undefined,
  router: {
    currentRoute: ref({ name: "logs", meta: {} }),
    push: vi.fn().mockResolvedValue(undefined),
  } as never,
});

describe("assistant runtime", () => {
  it("constructs nothing on import and builds once on first access", () => {
    expect(createStore).not.toHaveBeenCalled();
    expect(assistantStore.state.ready).toBe(false);
    expect(assistantStore.state.capability.gate).toBe("loading");
    void assistantStore.headerLight;
    expect(createStore).toHaveBeenCalledTimes(1);
  });

  it("resolves the gate from the wired getters and lets a door open", async () => {
    assistantStore.init(context("admin"));
    await flushPromises();
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    expect(useAssistantCapability().value).toMatchObject({
      gate: "available",
      canChat: "yes",
      source: "heuristic",
    });
    expect(assistantService.capabilities).toHaveBeenCalledWith("org1");
    expect(assistantService.probeChatAccess).not.toHaveBeenCalled();
    const result = await openAssistant({
      entryKind: "header_button",
      entryVerb: "ask",
      objectKind: "none",
      intent: "open",
    });
    expect(result).toMatchObject({ ok: true, container: "sidebar" });
    expect(assistantStore.state.shell.placement.kind).toBe("sidebar");
  });

  it("probes a viewer once after B-06 answers absent and locks on a 403", async () => {
    assistantStore.init(context("viewer"));
    await vi.waitFor(() => expect(assistantService.probeChatAccess).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(assistantStore.state.capability.gate).toBe("no_permission"));
    expect(assistantStore.state.capability.source).toBe("probe");
  });

  it("recomputes on an org switch with a new user+org key", async () => {
    const org = ref("org1");
    assistantStore.init(context("editor", org));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const first = assistantStore.state.userOrgKey;
    getAssistantRuntime().capability.noteForbidden();
    expect(assistantStore.state.capability.gate).toBe("no_permission");
    org.value = "org2";
    await vi.waitFor(() => expect(assistantStore.state.userOrgKey).not.toBe(first));
    await vi.waitFor(() => expect(assistantStore.state.capability.gate).toBe("available"));
  });

  it("stamps the telemetry envelope from the runtime", async () => {
    assistantStore.init(context("sre-oncall"));
    await vi.waitFor(() => expect(assistantStore.state.capability.gate).toBe("no_permission"));
    expect(assistantStore.state.ready).toBe(false);
    const getters = assistantStore.telemetryContext("abc123");
    expect(getters.getGate()).toBe(assistantStore.state.capability.gate);
    expect(getters.getRole()).toBe("custom");
    expect(getters.getOrg()).toBe("org1");
    expect(getters.getEdition()).toBe("ee");
    expect(getters.getRoute()).toBe("logs");
    expect(getters.getContainer()).toBe("home");
    expect(getters.uiVersion).toBe("abc123");
  });

  it("writes a debounced draft at once when the page is left", async () => {
    assistantStore.init(context("admin"));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const sid = assistantStore.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    assistantStore.setDraft(sid, { text: "half typed" });
    const key = `o2.assistant.draft:${assistantStore.state.userOrgKey}:${sid}`;
    expect(sessionStorage.getItem(key)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem(key)).toContain("half typed");
  });

  it("opens a tab the page cannot script back, and counts it as opened", () => {
    const opened = { opener: window as unknown };
    // window.open returns null whenever `noopener` is asked for, even though the tab opens.
    const open = vi.fn((_url: string, _target: string, features?: string) =>
      features?.includes("noopener") ? null : opened,
    );
    vi.stubGlobal("open", open);
    expect(openTabWithoutOpener("/web/logs")).toBe(true);
    expect(open).toHaveBeenCalledWith("/web/logs", "_blank");
    expect(opened.opener).toBeNull();
    open.mockReturnValueOnce(null);
    expect(openTabWithoutOpener("/web/logs")).toBe(false);
  });

  it("forgets a session's Run rows when the store drops the session", async () => {
    assistantStore.init(context("admin"));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const sid = assistantStore.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    const { store } = getAssistantRuntime();
    const env = {
      store: () => store,
      now: () => 1,
      search: async () => ({ hits: [{ a: 1 }], total: 1 }),
    };
    const query = { language: "sql" as const, text: "SELECT 1", org: "org1" };
    await runQueryApplier(sid, { kind: "run_query", query, blockId: "b1" }, env as never);
    expect(queryRunOf(sid, "b1")?.status).toBe("done");
    assistantStore.dropSession(sid);
    await flushPromises();
    expect(queryRunOf(sid, "b1")).toBeNull();
  });

  it("aborts a Run of the org the user just left", async () => {
    const org = ref("org1");
    assistantStore.init(context("admin", org));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const sid = assistantStore.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    const { store } = getAssistantRuntime();
    let aborted = false;
    const env = {
      store: () => store,
      now: () => 1,
      search: ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }),
        ),
    };
    const query = { language: "sql" as const, text: "SELECT 1", org: "org1" };
    const pending = runQueryApplier(sid, { kind: "run_query", query, blockId: "b1" }, env as never);
    org.value = "org2";
    await flushPromises();
    await pending;
    expect(aborted).toBe(true);
    expect(queryRunOf(sid, "b1")).toBeNull();
  });

  it("drops the recall of every org of the user on sign-out", async () => {
    assistantStore.init({ ...context("admin"), getOrganizations: () => ["org1", "org2"] });
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const other = await computeUserOrgKey("dev@example.com", "org2");
    pushRecall(other, { text: "token=abc", chips: [], at: 1 });
    await assistantStore.onSignOut();
    expect(readRecall(other)).toEqual([]);
  });

  it("sends a turn end to end through the registered engine (WP-03 §5.9)", async () => {
    const frame = (name: string) =>
      JSON.parse(readFileSync(join(__dirname, "__fixtures__", "frames", `${name}.json`), "utf8"))
        .frame;
    const frames = ["status", "title", "tool_call", "tool_result", "message_delta", "complete"].map(
      frame,
    );
    // The harness stream-shim's wire format: one `data:` line per frame, replayed from the fixtures.
    const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
    assistantStore.init(context("admin"));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const sid = assistantStore.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      thread: "new",
    });
    assistantStore.setDraft(sid, { text: "why?" });
    await expect(assistantStore.send(sid)).resolves.toEqual({ state: "done", saved: "server" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/org1\/ai\/chat_stream$/);
    expect(init.headers["x-o2-assistant-session-id"]).toBe(sid);
    expect(JSON.parse(init.body).messages).toEqual([{ role: "user", content: "why?" }]);
    const session = assistantStore.state.sessions[sid];
    expect(session.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(session.turnMeta.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(session.turnMeta.usage).toMatchObject({ tokensIn: 18342, tokensOut: 612 });
  });
});
