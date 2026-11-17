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

// The agent page with the real first-event watch: the services are faked, the watch is not.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

import { queryClient } from "@/composables/query/queryClient";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import store from "@/test/unit/helpers/store";

import type { AgentFocus } from "./agentSetupFile";
import OnboardingAgentSetup from "./OnboardingAgentSetup.vue";

interface FakeRow {
  name: string;
  stats?: { doc_num?: number; doc_time_min?: number; doc_time_max?: number };
}
const rows: Record<string, FakeRow[]> = { logs: [], metrics: [], traces: [] };
// The test event's fields; a cluster's logs add the collector's k8s_namespace_name.
let logFields = ["_timestamp", "level", "message"];
vi.mock("@/services/stream", () => ({
  default: {
    nameList: async (_o: string, type: string, _s: boolean, offset = -1, limit = -1, kw = "") => {
      const all = (rows[type] ?? []).filter((r) => !kw || r.name.includes(kw));
      const list = offset === -1 ? all : all.slice(offset, offset + limit);
      return { data: { list: list.map((r) => ({ stream_type: type, ...r })), total: all.length } };
    },
    schema: async () => ({ data: { schema: logFields.map((name) => ({ name })) } }),
  },
}));

const countHits = vi.fn((): Record<string, unknown>[] => [{ zo_count: 0, zo_min: 0 }]);
const serverNowS = () => Math.floor(Date.now() / 1000);
vi.mock("@/services/search", () => ({
  default: {
    search: async (req: { query: { query: { sql: string } } }) => {
      const sql = req.query.query.sql;
      if (sql.includes("zo_now"))
        return { data: { hits: [{ zo_count: 0, zo_now: serverNowS() }] } };
      if (sql.startsWith("SELECT COUNT")) return { data: { hits: countHits() } };
      return { data: { hits: [{ _timestamp: Date.now() * 1000, message: "test" }] } };
    },
  },
}));
vi.mock("@/services/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/ingestion")>()),
  default: { recentRejections: async () => ({ data: { tracked: true, list: [] } }) },
}));
vi.mock("@/composables/useOrgCredential", () => ({
  useOrgCredential: vi.fn(() => ({ ready: { value: true } })),
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const empty = { render: () => null };
const NOW = Date.UTC(2026, 9, 23, 5, 0, 0);

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/onboarding/:path*", name: "onboarding", component: empty },
      { path: "/iam/mcpServer", name: "mcpServer", component: empty },
    ],
  });
  await router.push("/onboarding/agent");
  const wrapper = mount(OnboardingAgentSetup, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  // The watch's first poll.
  await vi.advanceTimersByTimeAsync(1);
  return wrapper;
}

type Page = Awaited<ReturnType<typeof mountPage>>;
const click = (w: Page, id: string) => w.find(`[data-test="${id}"]`).trigger("click");
const copyTokenAndPrompt = async (w: Page) => {
  await click(w, "ingestion-onboarding-agent-token-code-block-copy-btn");
  await click(w, "onboarding-agent-setup-copy");
  await vi.advanceTimersByTimeAsync(1);
};
const chooseFocus = async (w: Page, focus: AgentFocus) => {
  w.findComponent(OSelect).vm.$emit("update:modelValue", focus);
  await vi.advanceTimersByTimeAsync(1);
};
const arrived = (w: Page) => w.find('[data-test="onboarding-first-data"]').exists();
const fresh = () => ({
  doc_num: 1,
  doc_time_min: Date.now() * 1000,
  doc_time_max: Date.now() * 1000,
});

describe("OnboardingAgentSetup, with the real watch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    rows.logs = [];
    rows.metrics = [];
    rows.traces = [];
    logFields = ["_timestamp", "level", "message"];
    store.state.organizationData.organizationPasscode = "passcode";
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    store.state.organizationData.organizationPasscode = "";
    queryClient.clear();
    countHits.mockReset();
    countHits.mockReturnValue([{ zo_count: 0, zo_min: 0 }]);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("turns green for the cluster's own logs, not for the test event (Kubernetes)", async () => {
    const w = await mountPage();
    await copyTokenAndPrompt(w);
    await vi.advanceTimersByTimeAsync(10_000);
    countHits.mockReturnValue([{ zo_count: 1, zo_min: Date.now() * 1000 }]);
    rows.logs.push({ name: "default", stats: fresh() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(arrived(w)).toBe(false);
    logFields = [...logFields, "k8s_namespace_name"];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(arrived(w)).toBe(true);
    expect(w.find('[data-test="onboarding-first-data"]').text()).toContain("Your data is arriving");
  });

  it("turns green for the test event in logs stream default, not for traces (Logs only)", async () => {
    const w = await mountPage();
    await chooseFocus(w, "logs");
    await copyTokenAndPrompt(w);
    await vi.advanceTimersByTimeAsync(10_000);
    rows.traces.push({ name: "default", stats: fresh() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(arrived(w)).toBe(false);
    rows.logs.push({ name: "default", stats: fresh() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(arrived(w)).toBe(true);
  });

  it("keeps the baseline on Troubleshoot, so data that already landed still counts", async () => {
    const w = await mountPage();
    await chooseFocus(w, "logs");
    await copyTokenAndPrompt(w);
    await vi.advanceTimersByTimeAsync(10_000);
    rows.logs.push({ name: "default", stats: fresh() });
    await click(w, "first-event-status-troubleshoot-btn");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(arrived(w)).toBe(true);
  });

  it("counts the test event in an existing default stream once a copy starts the watch", async () => {
    rows.logs = [{ name: "default", stats: { doc_num: 50, doc_time_min: 1, doc_time_max: 2 } }];
    const w = await mountPage();
    await chooseFocus(w, "logs");
    expect(w.find('[data-test="first-event-status"]').attributes("data-state")).toBe("idle");
    await copyTokenAndPrompt(w);
    await vi.advanceTimersByTimeAsync(10_000);
    countHits.mockReturnValue([{ zo_count: 1, zo_min: Date.now() * 1000 }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(arrived(w)).toBe(true);
  });
});
