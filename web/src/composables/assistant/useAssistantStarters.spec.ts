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
import { assistantSettingsKeys } from "@/services/assistant_settings.querykeys";
import { streamKeys } from "@/services/stream.querykeys";
import { raw } from "@/types/i18n";

import { createAssistantStore, inertAssistantDeps } from "./assistantStore";
import { wireContextOf } from "./context/serialize";
import { refreshPageContext, resetAssistantContextForTests } from "./context/useAssistantContext";
import { starterPayload } from "./starterPayload";
import type { AssistantCapability, AssistantHostAdapter } from "./assistantStore.types";
import type { PageContext } from "./context/types";
import { useAssistantStarters } from "./useAssistantStarters";

const { runtime, getActiveContext, settingsGet } = vi.hoisted(() => ({
  runtime: { current: null as any },
  getActiveContext: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock("@/services/assistant_settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/assistant_settings")>();
  return { ...actual, default: { ...actual.default, get: settingsGet } };
});

// Every scope a test opens is stopped after it, so a later test's settings read is its own.
const scopes: { stop(): void }[] = [];

vi.mock("./runtime", () => ({ getAssistantRuntime: () => runtime.current }));
vi.mock("@/composables/contextProviders/registry", () => ({
  contextRegistry: { getActiveContext, version: { value: 0 } },
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
  scopes.push(effects);
  const page$ = ref(page);
  const result = effects.run(() => useAssistantStarters({ page: () => page$.value, host }))!;
  return { ...result, store, effects, page$, capability };
}

// Names the test marks internal stand in for the server's is_internal flag.
const INTERNAL = new Set(["_o2_internal", "_agent_signals", "_o2_spans", "_rumdata"]);
const seedStreams = (type: string, names: string[]) =>
  queryClient.setQueryData(
    streamKeys.nameList("default", type),
    names.map((name) => (INTERNAL.has(name) ? { name, is_internal: true } : { name })),
  );

const labels = (starters: { value: { label: string }[] }) => starters.value.map((s) => s.label);

// What `homeContextOf` puts in the page context for an Overview with an incident and an uncovered service.
const HOME_CONTEXT = (coverage: "none" | "covered" | "unknown" = "none"): PageContext => ({
  currentPage: "home",
  routeName: "home",
  page: "home_overview",
  overviewIncidents: [
    { id: "inc-7", title: "Checkout errors", severity: "P1", status: "open", alert_count: 3 },
  ],
  overviewServices: [
    {
      service: "checkout-api",
      error_rate: 6.1,
      requests: 1200,
      p99_ms: 2900,
      p99_ratio: 2.7,
      baseline_error_rate: 0.4,
      baseline_hours: 24,
      signal: "errors",
      alert_coverage: coverage,
    },
  ],
});

const seedTier = (tier: "read" | "propose" | "act_with_approval" | null) =>
  queryClient.setQueryData(
    assistantSettingsKeys.org("default"),
    tier === null ? null : ({ permission_tier: tier } as never),
  );

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  resetAssistantContextForTests();
  queryClient.clear();
  getActiveContext.mockReset();
  settingsGet.mockReset();
});

describe("useAssistantStarters", () => {
  it("follows the stream the composer's tray reads after the page changes it", async () => {
    seedStreams("logs", ["default", "app_logs"]);
    const { starters } = setup("logs");
    await flushPromises();
    getActiveContext.mockResolvedValue({ ...LOGS_CONTEXT, selectedStreams: ["app_logs"] });
    refreshPageContext();
    await flushPromises();
    expect(labels(starters)[0]).toBe("Why did errors spike in `app_logs` in the last 15 min?");
  });

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
    expect(dashboard.starters.value.some((starter) => starter.home)).toBe(false);
    dashboard.page$.value = "home";
    await flushPromises();
    expect(labels(dashboard.starters)).toEqual([
      "What needs attention right now?",
      "What can you do here?",
    ]);
    expect(dashboard.starters.value.every((starter) => starter.home === true)).toBe(true);
  });

  it("offers learn and org health off the page table, never the removed alerts starter", async () => {
    const { starters } = setup("assistant", { currentPage: "assistant" });
    await flushPromises();
    expect(labels(starters)).toEqual(["What can you do here?", "What needs attention right now?"]);
  });

  it("grounds Home on streams the org has, skips internal ones and stages the hour it names", async () => {
    seedStreams("logs", ["_o2_internal", "_agent_signals", "k8s"]);
    seedStreams("traces", ["_o2_spans", "checkout"]);
    const { starters } = setup("home", null);
    await flushPromises();
    expect(labels(starters)).toEqual([
      "What needs attention right now?",
      "Summarise errors in `k8s`",
      "Which services had the slowest spans in the last hour?",
    ]);
    expect(starters.value[1].period).toBe("1h");
    expect(starters.value[1].chips[0].ref).toMatchObject({ stream: "k8s", streamType: "logs" });
    expect(starters.value[2].chips[0].ref).toMatchObject({
      stream: "checkout",
      streamType: "traces",
    });
    expect(labels(starters).join(" ")).not.toContain("_o2_");
    expect(labels(starters).join(" ")).not.toContain("_agent_signals");
  });

  it("names and counts a user's own underscore stream, skipping only what the server marks internal (X3)", async () => {
    seedStreams("logs", ["_o2_internal", "_agent_signals", "_myapp"]);
    const { starters } = setup("home", null);
    await flushPromises();
    expect(labels(starters)).toContain("Summarise errors in `_myapp`");
  });

  it("names a user-sourced stream even though the server marks it internal", async () => {
    seedStreams("logs", ["_o2_internal", "_rumdata"]);
    const { starters } = setup("home", null);
    await flushPromises();
    expect(labels(starters)).toContain("Summarise errors in `_rumdata`");
    expect(labels(starters).join(" ")).not.toContain("_o2_internal");
  });

  it("stages Home starter streams so they reach the tray and the request from the full view", async () => {
    seedStreams("logs", ["k8s"]);
    seedStreams("traces", ["checkout"]);
    const { starters, store } = setup("home", null);
    await flushPromises();
    const sid = store.createSession({
      origin: { entryKind: "home_launcher", objectKind: "none", container: "full_view" },
    });
    const wire = (index: number) => {
      store.state.sessions[sid].composer.chips = [];
      store.stage(sid, { ...starterPayload(starters.value[index], "default"), mode: "replace" });
      const composer = store.state.sessions[sid].composer;
      expect(composer.chips.some((chip) => chip.provenance === "page")).toBe(false);
      expect(composer.timeOverride).not.toBeNull();
      return wireContextOf(null, composer, { org: "default" });
    };
    expect(wire(1)).toMatchObject({ selectedStreams: ["k8s"], streamType: "logs" });
    expect(wire(2)).toMatchObject({ selectedStreams: ["checkout"], streamType: "traces" });
  });

  it("keeps a Logs starter's stream a page copy that never re-adds the page's own field", async () => {
    seedStreams("logs", ["default"]);
    const { starters } = setup("logs");
    await flushPromises();
    const stream = starters.value[0].chips.find((chip) => chip.kind === "stream");
    expect(stream?.provenance).toBe("page");
  });

  it("never offers a Continue starter on Home, where Your chats lists them", async () => {
    const { starters, store } = setup("home", null);
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.state.sessions[sid].messages.push({ role: "user", content: raw("q") });
    store.setActive(null);
    await flushPromises();
    expect(starters.value.some((s) => s.kind === "recent")).toBe(false);
  });

  it("names the org by its display name, not its identifier", async () => {
    setup("home", null);
    runtime.current.context = shallowRef({
      getOrg: () => ({ identifier: "a1b2c3", name: "Acme" }),
    });
    const acmeScope = effectScope();
    scopes.push(acmeScope);
    const acme = acmeScope.run(() => useAssistantStarters({ page: "home" }))!;
    await flushPromises();
    expect(labels(acme.starters)[0]).toBe("What needs attention right now?");
    expect(acme.scope.value).toMatchObject({ org: "a1b2c3", orgName: "Acme" });
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

  it("leads Home with starters that name the Overview's top rows at the write tier", async () => {
    seedStreams("logs", ["k8s"]);
    seedTier("act_with_approval");
    const { starters } = setup("home", HOME_CONTEXT());
    await flushPromises();
    expect(labels(starters)).toEqual([
      "What caused Checkout errors?",
      "Why is checkout-api failing?",
      "Which alert should cover checkout-api errors?",
    ]);
    expect(starters.value[1].prompt).toBe("Why is checkout-api failing?");
    expect(starters.value.every((starter) => starter.home === true)).toBe(true);
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it.each([
    ["read tier", "read" as const, "yes" as const, "none" as const],
    ["propose tier", "propose" as const, "yes" as const, "none" as const],
    ["settings null (older server)", null, "yes" as const, "none" as const],
    ["admin who can write, in a read-tier org", "read" as const, "yes" as const, "none" as const],
    [
      "write tier, but no write permission",
      "act_with_approval" as const,
      "no" as const,
      "none" as const,
    ],
    ["coverage unknown", "act_with_approval" as const, "yes" as const, "unknown" as const],
    ["coverage covered", "act_with_approval" as const, "yes" as const, "covered" as const],
  ])("offers no alert starter for %s", async (_name, tier, canWrite, coverage) => {
    seedTier(tier);
    const { starters, capability } = setup("home", HOME_CONTEXT(coverage));
    capability.value = { ...capability.value, canWrite };
    await flushPromises();
    expect(labels(starters)[0]).toBe("What caused Checkout errors?");
    expect(labels(starters).join(" ")).not.toContain("Which alert should cover");
  });

  it("offers no alert starter while the tier is still loading", async () => {
    settingsGet.mockReturnValue(new Promise(() => {}));
    const { starters } = setup("home", HOME_CONTEXT());
    await flushPromises();
    expect(settingsGet).toHaveBeenCalledWith("default");
    expect(labels(starters).join(" ")).not.toContain("Which alert should cover");
  });

  it("never asks for the tier on Home when every service is covered", async () => {
    setup("home", HOME_CONTEXT("covered"));
    await flushPromises();
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it("never asks for the tier off Home, whatever the page context holds", async () => {
    setup("logs", {
      ...LOGS_CONTEXT,
      overviewServices: HOME_CONTEXT().overviewServices,
    });
    await flushPromises();
    expect(settingsGet).not.toHaveBeenCalled();
  });

  it("asks why a slow service is slow, and never about a normal one", async () => {
    const latency = HOME_CONTEXT("covered");
    latency.overviewServices = [
      { ...latency.overviewServices![0], service: "search", signal: "normal" },
      { ...latency.overviewServices![0], service: "payments", signal: "latency" },
    ];
    const { starters } = setup("home", latency);
    await flushPromises();
    expect(labels(starters).slice(0, 2)).toEqual([
      "What caused Checkout errors?",
      "Why is payments slow?",
    ]);
    expect(labels(starters).join(" ")).not.toContain("search");
  });

  it("skips a resolved incident", async () => {
    seedStreams("logs", ["k8s"]);
    const { starters } = setup("home", {
      ...HOME_CONTEXT("covered"),
      overviewIncidents: [
        { id: "i1", title: "Old outage", severity: "P2", status: "resolved", alert_count: 1 },
      ],
    });
    await flushPromises();
    expect(labels(starters)[0]).toBe("Why is checkout-api failing?");
    expect(labels(starters).join(" ")).not.toContain("Old outage");
  });

  it("gives the new-tenant layout the three ingestion questions", async () => {
    seedStreams("logs", ["k8s"]);
    const fresh = setup("home", { currentPage: "home", routeName: "home", homeNoData: true });
    await flushPromises();
    expect(labels(fresh.starters)).toEqual([
      "How do I send my first logs?",
      "How do I send traces?",
      "How do I send metrics?",
    ]);
    expect(fresh.starters.value.map((starter) => starter.kind)).toEqual([
      "ingest",
      "ingest",
      "ingest",
    ]);
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
