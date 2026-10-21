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
import { computed, effectScope, ref, shallowRef } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import { raw } from "@/types/i18n";

import { createAssistantStore, inertAssistantDeps } from "./assistantStore";
import type { AssistantCapability, AssistantHostAdapter } from "./assistantStore.types";
import type { PageContext } from "./context/types";
import { useAssistantStarters } from "./useAssistantStarters";

const { runtime, getActiveContext } = vi.hoisted(() => ({
  runtime: { current: null as any },
  getActiveContext: vi.fn(),
}));

vi.mock("./runtime", () => ({ getAssistantRuntime: () => runtime.current }));
vi.mock("@/composables/contextProviders/registry", () => ({
  contextRegistry: { getActiveContext },
}));

const LOGS_CONTEXT: PageContext = {
  currentPage: "logs",
  selectedStreams: ["default"],
  timeRange: { relativeTimePeriod: "15m", startTime: 1_000_000, endTime: 2_000_000 } as never,
};

function setup(
  page: string,
  context: PageContext | null = LOGS_CONTEXT,
  host?: AssistantHostAdapter,
) {
  getActiveContext.mockResolvedValue(context);
  const store = createAssistantStore(
    inertAssistantDeps({ getOrg: () => ({ identifier: "default", name: "default" }) }),
    { viewportRem: () => 80 },
  );
  store.setIdentity({ userOrgKey: "k1", org: "default" });
  const capability = ref({ gate: "available", canWrite: "yes" } as AssistantCapability);
  store.syncCapability({ ...capability.value, gate: "available" } as AssistantCapability);
  runtime.current = {
    store,
    context: shallowRef({ getOrg: () => ({ identifier: "default", name: "default" }) }),
    capability: { capability: computed(() => capability.value) },
    // The history list is this tab's sessions here; the service itself is specced on its own.
    history: {
      rows: computed(() =>
        store.state.recent
          .map((sid) => store.state.sessions[sid])
          .filter((session) => session?.messages.length)
          .map((session) => ({ sid: session.sid, chatId: session.chatId, title: session.title })),
      ),
    },
  };
  const effects = effectScope();
  const page$ = ref(page);
  const result = effects.run(() => useAssistantStarters({ page: () => page$.value, host }))!;
  return { ...result, store, effects, page$, capability };
}

const seedStreams = (type: string, names: string[]) =>
  queryClient.setQueryData(
    streamKeys.nameList("default", type),
    names.map((name) => ({ name })),
  );

const labels = (starters: { value: { label: string }[] }) => starters.value.map((s) => s.label);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  queryClient.clear();
  getActiveContext.mockReset();
});

describe("useAssistantStarters", () => {
  it("grounds the Logs starters in the selected stream and range, then learn", async () => {
    seedStreams("logs", ["default", "k8s"]);
    const { starters, loading } = setup("logs");
    expect(loading.value).toBe(true);
    await flushPromises();
    expect(loading.value).toBe(false);
    expect(labels(starters)).toEqual([
      "Why did errors spike in `default` in the last 15 min?",
      "Summarise what's in `default` right now",
      "What can you do here?",
    ]);
    expect(starters.value[0].prompt).toBe(starters.value[0].label);
    expect(starters.value[0].chips.map((c) => c.kind)).toEqual(["time", "stream"]);
    expect(starters.value.map((s) => s.dataTest)).toEqual([
      "assistant-starter-0",
      "assistant-starter-1",
      "assistant-starter-2",
    ]);
  });

  it("offers to continue the last chat of this user and org instead of learn", async () => {
    seedStreams("logs", ["default"]);
    const { starters, store } = setup("logs");
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.setTitle(sid, raw("PromQL for p95"), "renamed");
    store.state.sessions[sid].messages.push({ role: "user", content: raw("q") });
    store.setActive(null);
    await flushPromises();
    const recent = starters.value[2];
    expect(recent.kind).toBe("recent");
    expect(recent.label).toBe('Continue "PromQL for p95"');
    expect(recent.chatId).toBe(store.state.sessions[sid].chatId);
    expect(recent.sid).toBe(sid);
  });

  it("gives a fresh org the ingestion set and nothing about alerts or dashboards", async () => {
    seedStreams("logs", []);
    seedStreams("metrics", []);
    const { starters, scope } = setup("alertList");
    await flushPromises();
    expect(labels(starters)).toEqual([
      "Show me how to send logs from my app",
      "Set up ingestion for Kubernetes",
      "What can you do once data arrives?",
    ]);
    expect(starters.value.every((s) => s.kind === "ingest")).toBe(true);
    expect(labels(starters).join(" ")).not.toMatch(/alert|dashboard|incident/i);
    expect(scope.value.streamCount).toBe(0);
  });

  it("degrades to the generic forms when no list is cached or a list failed", async () => {
    await queryClient
      .fetchQuery({
        queryKey: streamKeys.nameList("default", "logs"),
        queryFn: () => Promise.reject(new Error("network")),
        retry: false,
      })
      .catch(() => undefined);
    const { starters } = setup("alertList", { currentPage: "alerts" });
    await flushPromises();
    expect(labels(starters)).toEqual([
      "Which alerts fired most in the last 24 h?",
      "Draft an alert for errors",
      "What can you do here?",
    ]);
  });

  it("follows the page table for dashboards, metrics and home", async () => {
    seedStreams("metrics", ["http_latency"]);
    const dashboard = setup("viewDashboard", {
      currentPage: "dashboards",
      dashboardName: "Checkout",
      timeRange: { relativeTimePeriod: "1h" } as never,
    });
    await flushPromises();
    expect(labels(dashboard.starters).slice(0, 2)).toEqual([
      'What changed on "Checkout" in the last 1 h?',
      "Explain the panel with the biggest change",
    ]);
    expect(dashboard.scope.value.pageObject).toEqual({ kind: "dashboard", name: "Checkout" });
    dashboard.page$.value = "metrics";
    await flushPromises();
    expect(labels(dashboard.starters)[0]).toBe("Write PromQL for p95 latency of `http_latency`");
    dashboard.page$.value = "home";
    await flushPromises();
    expect(labels(dashboard.starters).slice(0, 2)).toEqual([
      "What needs attention in `default` right now?",
      "Which alerts fired since yesterday?",
    ]);
  });

  it("always offers three distinct starters off the page table", async () => {
    const { starters } = setup("assistant", { currentPage: "assistant" });
    await flushPromises();
    expect(labels(starters)).toEqual([
      "What can you do here?",
      "Which alerts fired since yesterday?",
      "What needs attention in `default` right now?",
    ]);
  });

  it("uses the editor starters for a docked host", async () => {
    const host = { id: "function", objectKind: "function" } as AssistantHostAdapter;
    const { starters } = setup("pipelineEditor", null, host);
    await flushPromises();
    expect(labels(starters).slice(0, 2)).toEqual([
      "Write VRL to parse JSON from the `message` field",
      "Explain what this function does",
    ]);
    expect(starters.value[0].kind).toBe("object");
  });

  it("describes the scope from the cache and the capability", async () => {
    seedStreams("logs", ["a", "b"]);
    seedStreams("traces", ["t"]);
    const { scope, capability } = setup("logs");
    await flushPromises();
    expect(scope.value).toMatchObject({
      org: "default",
      streamCount: 3,
      timeRange: "last 15 min",
      canWrite: "yes",
    });
    capability.value = { ...capability.value, canWrite: "no" };
    expect(scope.value.canWrite).toBe("no");
  });

  it("never asks the server for anything", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    const fetchQuery = vi.spyOn(queryClient, "fetchQuery");
    const { starters } = setup("logs");
    await flushPromises();
    expect(starters.value).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchQuery).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    fetchQuery.mockRestore();
  });

  it("keeps the model's prompt in English when the UI is not", async () => {
    const i18n = (await import("@/locales")).default;
    const previous = i18n.global.locale as unknown as { value: string };
    const before = previous.value;
    previous.value = "de";
    try {
      seedStreams("logs", ["default"]);
      const { starters } = setup("logs", {
        currentPage: "logs",
        selectedStreams: ["default"],
        timeRange: { relativeTimePeriod: "3d" } as never,
      });
      await flushPromises();
      expect(starters.value[0].prompt).toBe(
        "Why did errors spike in `default` in the last 3 days?",
      );
      expect(starters.value[0].label).toContain("3 Tage");
    } finally {
      previous.value = before;
    }
  });
});
