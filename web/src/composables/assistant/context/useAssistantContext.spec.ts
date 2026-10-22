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
import { effectScope, type EffectScope } from "vue";

import { contextRegistry } from "@/composables/contextProviders/registry";
import { raw } from "@/types/i18n";

import { PAGE_CONTEXTS } from "../__fixtures__/pageContexts";
import {
  createAssistantStore,
  inertAssistantDeps,
  type AssistantStoreInternal,
} from "../assistantStore";
import type { AssistantCapability } from "../assistantStore.types";
import { resetPrefsForTests } from "../prefs";
import { chipStateOf } from "./contextChips";
import { sentWindows } from "./serialize";
import type { PageContext } from "./types";
import {
  PAGE_POLL_MS,
  refreshPageContext,
  resetAssistantContextForTests,
  useAssistantContext,
} from "./useAssistantContext";

const capability = { gate: "available", persistence: true } as AssistantCapability;

let scope: EffectScope;
let store: AssistantStoreInternal;
let sid: string;

function mountContext(read?: () => Promise<PageContext | null>) {
  return scope.run(() => useAssistantContext(sid, { store, ...(read && { read }) }))!;
}

beforeEach(() => {
  sessionStorage.clear();
  resetPrefsForTests();
  let n = 0;
  store = createAssistantStore(
    inertAssistantDeps({
      getOrg: () => ({ identifier: "acme-prod", name: "acme-prod" }),
      uuid: () => `0190a1b2-c3d4-7e5f-8a9b-${String(++n).padStart(12, "0")}`,
    }),
    { viewportRem: () => 80 },
  );
  store.setIdentity({ userOrgKey: "k1", org: "acme-prod" });
  store.syncCapability({
    ...capability,
    edition: "ee",
    configured: true,
    health: "ok",
    canChat: "yes",
  } as AssistantCapability);
  sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
  });
  scope = effectScope();
});

afterEach(() => {
  scope.stop();
  resetAssistantContextForTests();
  contextRegistry.cleanup();
  vi.useRealTimers();
});

describe("useAssistantContext", () => {
  it("puts the time chip first, then the page chips in table order (CT-01 AC 1)", async () => {
    const view = mountContext(async () => PAGE_CONTEXTS.logs);
    await flushPromises();
    expect(view.chips.value.map((chip) => chip.label)).toEqual([
      "Time · last 15 min",
      "Stream · default",
      "SQL · default",
    ]);
    expect(view.timeChip.value.kind).toBe("time");
  });

  it("follows the page until the user overrides the time, then keeps custom (CT-01 AC 4–5)", async () => {
    vi.useFakeTimers();
    let page: PageContext = PAGE_CONTEXTS.logs;
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    const view = mountContext(async () => page);
    await flushPromises();
    page = {
      ...PAGE_CONTEXTS.logs,
      timeRange: { ...PAGE_CONTEXTS.logs.timeRange, relativeTimePeriod: "1h" },
    };
    await vi.advanceTimersByTimeAsync(PAGE_POLL_MS);
    expect(view.timeChip.value.label).toBe("Time · last 1 h");
    store.setTimeOverride(sid, { from: 0, to: 86_400_000, period: "24h" });
    page = { ...page, timeRange: { ...page.timeRange, relativeTimePeriod: "7d" } };
    await vi.advanceTimersByTimeAsync(PAGE_POLL_MS);
    expect(view.timeChip.value).toMatchObject({ label: "Time · last 24 h", secondary: "custom" });
  });

  it("turns a removed page chip into a ghost for this chat only (CT-01 AC 7)", async () => {
    const view = mountContext(async () => PAGE_CONTEXTS.logs);
    await flushPromises();
    store.setDraft(sid, { removedPageKeys: ["selectedStreams"] });
    expect(view.chips.value.map((chip) => chip.kind)).toEqual(["time", "query"]);
    expect(view.removed.value.map((chip) => chip.label)).toEqual(["Stream · default"]);
    store.addBackChip(sid, "selectedStreams");
    expect(view.removed.value).toEqual([]);
  });

  it("keeps the parent's chips once a nested editor pops its provider (constraint 39)", async () => {
    contextRegistry.register("pipeline", { getContext: () => PAGE_CONTEXTS.pipelines });
    contextRegistry.setActive("pipeline");
    const view = mountContext();
    await flushPromises();
    expect(view.chips.value.map((chip) => chip.label)).toContain("Pipeline · ingest-k8s");
    contextRegistry.push("query_node", { getContext: () => ({ ...PAGE_CONTEXTS.logs }) });
    await flushPromises();
    expect(view.chips.value.map((chip) => chip.label)).toContain("SQL · default");
    contextRegistry.pop("query_node");
    await flushPromises();
    expect(view.chips.value.map((chip) => chip.label)).toContain("Pipeline · ingest-k8s");
  });

  it("shows the window the running turn was sent with until it ends (CT-01 AC 13)", async () => {
    const view = mountContext(async () => PAGE_CONTEXTS.logs);
    await flushPromises();
    sentWindows.set(sid, { from: 0, to: 600_000, period: "10m", source: "page" });
    store.state.sessions[sid].turn = { state: "connecting" } as never;
    expect(view.timeChip.value.label).toBe("Time · last 10 min");
    store.state.sessions[sid].turn = { state: "done", saved: "server" };
    expect(view.timeChip.value.label).toBe("Time · last 15 min");
  });

  it("summarises the scope for the placeholder, and says when there is none (CT-01 AC 10)", async () => {
    const view = mountContext(async () => PAGE_CONTEXTS.logs);
    await flushPromises();
    expect(view.summary.value).toBe("default · last 15 min");
    expect(view.noScope.value).toBe(false);
    store.setDraft(sid, { removedPageKeys: ["selectedStreams"] });
    expect(view.noScope.value).toBe(true);
  });

  it("shows a door's chip for the page's own incident once, in place of the page's copy", async () => {
    const view = mountContext(async () => ({
      ...PAGE_CONTEXTS.logs,
      incident_id: "inc-1",
      incident_title: "Checkout latency",
    }));
    await flushPromises();
    const incidents = () => view.chips.value.filter((chip) => chip.kind === "incident");
    expect(incidents()).toHaveLength(1);
    store.addChip(sid, {
      id: "door:incident:1",
      kind: "incident",
      label: raw("Incident · Checkout latency"),
      ref: { type: "incident", id: "inc-1", org: "default" },
      sizeBytes: 0,
      provenance: "door",
      sent: "serialized",
    });
    expect(incidents().map((chip) => chip.id)).toEqual(["door:incident:1"]);
  });

  it("reads the page's incident as sent once chat turns carry its id, and as not read before", async () => {
    const view = mountContext(async () => ({
      ...PAGE_CONTEXTS.logs,
      incident_id: "inc-1",
      incident_title: "Checkout latency",
    }));
    await flushPromises();
    const chip = () => view.chips.value.find((c) => c.kind === "incident")!;
    const row = () => view.sees.value.find((r) => r.id === "incident_id")!;
    expect(chipStateOf(chip())).toBe("not_read");
    expect(row().group).toBe("not_read");
    store.syncCapability({ ...store.state.capability, rcaChatMode: true });
    await flushPromises();
    expect(chipStateOf(chip())).toBe("sent");
    expect(row().group).toBe("sent");
    store.setDraft(sid, { removedPageKeys: ["incident_id"] });
    expect(view.chips.value.some((c) => c.kind === "incident")).toBe(false);
  });

  it("adds an attachments row and the shared disclosure", async () => {
    const view = mountContext(async () => PAGE_CONTEXTS.logs);
    await flushPromises();
    store.addChip(sid, {
      id: "r1",
      kind: "log_row",
      label: raw("Log row"),
      data: { a: 1 },
      sizeBytes: 7,
      provenance: "door",
      sent: "serialized",
    });
    expect(view.sees.value.find((row) => row.id === "attachments")?.value).toBe(
      "1 attachment · 7 B",
    );
    expect(view.disclosure.value).toBe(
      "Attached data is sent to the assistant and saved with this chat.",
    );
    store.state.sessions[sid].share = {
      id: "s",
      visibility: "org",
      mode: "snapshot",
      expiresAt: null,
      outOfDate: false,
      count: 1,
    };
    expect(view.disclosure.value).toContain("included in any share");
  });

  it("does not poll the provider while every container is hidden, and re-reads on demand (CT-01 AC 15)", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => PAGE_CONTEXTS.logs);
    mountContext(read);
    await flushPromises();
    const first = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PAGE_POLL_MS * 3);
    expect(read.mock.calls.length).toBe(first);
    refreshPageContext();
    expect(read.mock.calls.length).toBe(first + 1);
  });

  it("keeps following the page after the first subscriber unmounts (S1)", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => PAGE_CONTEXTS.logs);
    const first = effectScope();
    first.run(() => useAssistantContext(sid, { store, read }));
    mountContext(read);
    await flushPromises();
    first.stop();
    const before = read.mock.calls.length;
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await vi.advanceTimersByTimeAsync(PAGE_POLL_MS * 2);
    expect(read.mock.calls.length).toBeGreaterThan(before + 1);
    store.close("close");
    await flushPromises();
    const closed = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PAGE_POLL_MS * 3);
    expect(read.mock.calls.length).toBe(closed);
  });

  it("shows nothing of another user+org's chat (F8)", async () => {
    const view = mountContext(async () => PAGE_CONTEXTS.logs);
    await flushPromises();
    store.addChip(sid, {
      id: "r1",
      kind: "log_row",
      label: raw("Log row"),
      data: { a: 1 },
      sizeBytes: 7,
      provenance: "door",
      sent: "serialized",
    });
    expect(view.chips.value.some((chip) => chip.id === "r1")).toBe(true);
    store.setIdentity({ userOrgKey: "k2", org: "other" });
    await flushPromises();
    expect(view.chips.value.some((chip) => chip.id === "r1")).toBe(false);
  });
});
