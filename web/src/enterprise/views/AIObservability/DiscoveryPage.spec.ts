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
//
// @vitest-environment jsdom
//
// Discovery is a stateless triage inbox over a SERVER-paginated endpoint, so the
// behaviours worth pinning are the ones where that shows: what gets sent for a
// scope/filter/page change, that paging resets when the listed set changes, and
// that enqueuing goes through one path for a row and for a bulk selection.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSearch = vi.fn();
const mockAddToQueue = vi.fn();
const mockListQueues = vi.fn();
const mockToast = vi.fn();
const mockPush = vi.fn();

vi.mock("@/services/llm-discovery.service", () => ({
  default: {
    search: (...args: any[]) => mockSearch(...args),
    addToQueue: (...args: any[]) => mockAddToQueue(...args),
  },
  DISCOVERY_MAX_PAGE_SIZE: 100,
}));

vi.mock("@/services/llm-queues.service", () => ({
  default: { list: (...args: any[]) => mockListQueues(...args) },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({ state: { selectedOrganization: { identifier: "test-org" } } })),
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/enterprise/composables/useAiDateController", () => ({
  useAiDateController: () => ({
    dateState: { value: {} },
    timeRange: { value: { startTime: 100, endTime: 200 } },
    onDateChange: vi.fn(),
    mountResolve: vi.fn(),
  }),
}));

// Shell + table stubs — reduced to the contract these tests read.
vi.mock("@/enterprise/components/AIObservability/AiPageShell.vue", () => ({
  default: {
    name: "AiPageShell",
    template: `<div class="ai-page-shell"><slot name="subnav" /><slot /></div>`,
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: [
      "data",
      "columns",
      "selectedIds",
      "pagination",
      "currentPage",
      "totalCount",
      "pageSize",
      "tableId",
    ],
    emits: ["update:selectedIds", "update:currentPage", "update:pageSize", "rowClick"],
    template: `<div class="o-table" :data-table-id="tableId" :data-total="totalCount"
      :data-page="currentPage" :data-pagination="pagination"
      :data-columns="(columns || []).map(c => c.id).join(',')">
      <slot name="toolbar" /><slot name="bottom" /></div>`,
  },
}));

vi.mock("@/lib/forms/Select/OSelect.vue", () => ({
  default: {
    name: "OSelect",
    props: ["modelValue", "options"],
    emits: ["update:model-value"],
    template: `<div class="o-select" :data-value="modelValue"
      :data-options="(options || []).map(o => o.value).join(',')" />`,
  },
}));

vi.mock("@/enterprise/components/AIObservability/AddToQueueMenu.vue", () => ({
  default: {
    name: "AddToQueueMenu",
    props: ["scope", "queues", "loading", "busy", "label", "variant", "dataTest"],
    emits: ["select", "open"],
    template: `<button class="add-to-queue-menu" :data-scope="scope" :data-test="dataTest" />`,
  },
}));

import { mount, flushPromises } from "@vue/test-utils";
import DiscoveryPage from "./DiscoveryPage.vue";

function searchResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        scope: "trace",
        targetId: "trace-1",
        traceId: "trace-1",
        sessionId: null,
        refTimestamp: 1_700_000_000_000_000,
        sourceStream: "default",
        quality: "issue",
        issueCount: 1,
        input: "why was my refund declined?",
        operationName: "gen_ai.chat.completions deepseek-v4-pro",
        genAiOperationName: "chat",
        spanKind: "INTERNAL",
        serviceName: "support-api",
        durationUs: 1000,
        userEmail: null,
        traceCount: null,
        agentName: null,
        queues: [],
        inQueue: false,
      },
    ],
    total: 42,
    scopeTotals: { span: 216, trace: 42, session: 11 },
    from: 0,
    size: 20,
    hasMore: true,
    ...overrides,
  };
}

async function mountPage() {
  const wrapper = mount(DiscoveryPage, {
    global: { stubs: { OTabs: true, OTab: true, OEmptyState: true, OTag: true, OTimeCell: true } },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  localStorage.clear();
  mockSearch.mockReset().mockResolvedValue(searchResult());
  mockAddToQueue.mockReset().mockResolvedValue(1);
  mockListQueues.mockReset().mockResolvedValue([]);
  mockToast.mockReset();
  mockPush.mockReset();
});

describe("DiscoveryPage fetching", () => {
  it("loads the triage backlog for traces on mount, unfiltered by queue status", async () => {
    await mountPage();

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith("test-org", {
      scope: "trace",
      startTime: 100,
      endTime: 200,
      from: 0,
      size: 20,
      queueStatus: "all",
    });
  });

  it("offers every queue-status the API accepts, and refetches on change", async () => {
    const wrapper = await mountPage();
    const select = wrapper.find(".o-select");

    expect(select.attributes("data-options")).toBe("not_enqueued,enqueued,pending,reviewed,all");

    await select.trigger("update:model-value");
    (wrapper.vm as any).$.setupState.onQueueStatusChange("reviewed");
    await flushPromises();

    expect(mockSearch).toHaveBeenLastCalledWith(
      "test-org",
      expect.objectContaining({ queueStatus: "reviewed", from: 0 }),
    );
  });

  it("switches columns and table id per scope, and clears paging", async () => {
    const wrapper = await mountPage();
    const table = () => wrapper.find(".o-table");

    expect(table().attributes("data-table-id")).toBe("ai-discovery-trace");
    expect(table().attributes("data-columns")).toBe(
      "refTimestamp,genAiOperationName,serviceName,input,quality,inQueue,actions",
    );

    (wrapper.vm as any).$.setupState.onPageChange(3);
    await flushPromises();
    (wrapper.vm as any).$.setupState.onScopeChange("session");
    await flushPromises();

    expect(table().attributes("data-table-id")).toBe("ai-discovery-session");
    expect(table().attributes("data-columns")).toBe(
      "refTimestamp,session,input,traceCount,durationUs,quality,inQueue,actions",
    );
    expect(mockSearch).toHaveBeenLastCalledWith(
      "test-org",
      expect.objectContaining({ scope: "session", from: 0 }),
    );
  });

  it("fills the span Kind column with the gen-ai operation, not OTel's span_kind", async () => {
    const wrapper = await mountPage();
    (wrapper.vm as any).$.setupState.onScopeChange("span");
    await flushPromises();

    expect(wrapper.find(".o-table").attributes("data-columns")).toBe(
      "refTimestamp,genAiOperationName,span,input,durationUs,quality,inQueue,actions",
    );
  });

  it("badges the gen-ai operation by family and keeps unknown operations neutral", async () => {
    const wrapper = await mountPage();
    const { operationVariant } = (wrapper.vm as any).$.setupState;

    expect(operationVariant("chat")).toBe("blue-soft");
    expect(operationVariant("text_completion")).toBe("blue-soft");
    expect(operationVariant("execute_tool")).toBe("amber-soft");
    expect(operationVariant("invoke_agent")).toBe("purple-soft");
    expect(operationVariant("embeddings")).toBe("teal-soft");
    // An operation the vocabulary has not seen must not borrow a family colour.
    expect(operationVariant("rerank")).toBe("default-soft");
  });

  it("pages server-side without resetting to page one", async () => {
    const wrapper = await mountPage();

    (wrapper.vm as any).$.setupState.onPageChange(3);
    await flushPromises();

    expect(mockSearch).toHaveBeenLastCalledWith(
      "test-org",
      expect.objectContaining({ from: 40, size: 20 }),
    );
    expect(wrapper.find(".o-table").attributes("data-total")).toBe("42");
  });

  it("narrows the loaded page across service, input and quality without refetching", async () => {
    mockSearch.mockResolvedValue(
      searchResult({
        items: [
          ...searchResult().items,
          {
            ...searchResult().items[0],
            targetId: "trace-2",
            input: "order status?",
            serviceName: "orders-api",
            genAiOperationName: "embeddings",
            quality: "multiple",
          },
        ],
      }),
    );
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;
    const rows = () => state.visibleItems;

    expect(rows()).toHaveLength(2);

    state.search = "orders-api";
    await flushPromises();
    expect(rows().map((r: any) => r.targetId)).toEqual(["trace-2"]);

    state.search = "refund";
    await flushPromises();
    expect(rows().map((r: any) => r.targetId)).toEqual(["trace-1"]);

    state.search = "embeddings";
    await flushPromises();
    expect(rows().map((r: any) => r.targetId)).toEqual(["trace-2"]);

    state.search = "multiple";
    await flushPromises();
    expect(rows().map((r: any) => r.targetId)).toEqual(["trace-2"]);

    // Client-side only — /discovery takes no query parameter.
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it("clears the search when the scope changes", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.search = "refund";
    state.onScopeChange("span");
    await flushPromises();

    expect(state.search).toBe("");
  });

  // The scope must be restored BEFORE the first fetch, or the page would load
  // one scope and render another.
  it("restores the last used scope on a revisit, and fetches it", async () => {
    localStorage.setItem("o2_ai_discovery_scope", "span");
    const wrapper = await mountPage();

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith("test-org", expect.objectContaining({ scope: "span" }));
    expect(wrapper.find(".o-table").attributes("data-table-id")).toBe("ai-discovery-span");
  });

  it("falls back to traces when the stored scope is no longer a scope", async () => {
    localStorage.setItem("o2_ai_discovery_scope", "workspace");
    await mountPage();

    expect(mockSearch).toHaveBeenCalledWith(
      "test-org",
      expect.objectContaining({ scope: "trace" }),
    );
  });

  it("persists the scope when the user switches tab", async () => {
    const wrapper = await mountPage();

    (wrapper.vm as any).$.setupState.onScopeChange("session");
    await flushPromises();

    expect(localStorage.getItem("o2_ai_discovery_scope")).toBe("session");
  });

  it("surfaces a load failure as an error toast", async () => {
    mockSearch.mockRejectedValueOnce(new Error("boom"));
    await mountPage();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});

describe("DiscoveryPage add to queue", () => {
  it("enqueues a single row and refetches", async () => {
    const wrapper = await mountPage();
    const row = (wrapper.vm as any).$.setupState.items[0];

    await (wrapper.vm as any).$.setupState.addToQueue({ id: "q1", name: "Safety" }, [row]);
    await flushPromises();

    expect(mockAddToQueue).toHaveBeenCalledWith("test-org", "q1", [row]);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", action: expect.anything() }),
    );
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it("enqueues a multi-row selection through the same path", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;
    const rows = [state.items[0], { ...state.items[0], targetId: "trace-2" }];

    await state.addToQueue({ id: "q1", name: "Safety" }, rows);
    await flushPromises();

    // One call carrying every row — the service fans out the per-item POSTs.
    expect(mockAddToQueue).toHaveBeenCalledTimes(1);
    expect(mockAddToQueue).toHaveBeenCalledWith("test-org", "q1", rows);
  });

  it("loads queues lazily — never on page load", async () => {
    const wrapper = await mountPage();
    expect(mockListQueues).not.toHaveBeenCalled();

    await (wrapper.vm as any).$.setupState.loadQueues();
    expect(mockListQueues).toHaveBeenCalledWith("test-org");
  });

  it("does not refetch (and so does not drop the selection) when enqueuing fails", async () => {
    mockAddToQueue.mockRejectedValueOnce(new Error("nope"));
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    await state.addToQueue({ id: "q1", name: "Safety" }, [state.items[0]]);
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });
});

describe("DiscoveryPage row drill-down", () => {
  it("routes a trace row to the trace detail view", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openTarget(state.items[0]);

    // stream + from/to are REQUIRED: the trace view reads them off the URL and
    // renders "trace not found" without them.
    expect(mockPush).toHaveBeenCalledWith({
      name: "traceDetails",
      query: {
        org_identifier: "test-org",
        stream: "default",
        from: 1_700_000_000_000_000 - 3_600_000_000,
        to: 1_700_000_000_000_000 + 3_600_000_000,
        trace_id: "trace-1",
      },
    });
  });

  it("routes a session row to the session detail view", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openTarget({
      scope: "session",
      targetId: "s1",
      sessionId: "s1",
      traceId: null,
      refTimestamp: 2_000_000_000,
      sourceStream: "sessions",
    });

    expect(mockPush).toHaveBeenCalledWith({
      name: "sessionDetails",
      query: {
        org_identifier: "test-org",
        stream: "sessions",
        from: 2_000_000_000 - 3_600_000_000,
        to: 2_000_000_000 + 3_600_000_000,
        session_id: "s1",
      },
    });
  });

  it("omits the stream when the row has none, so the view falls back", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openTarget({
      scope: "trace",
      targetId: "trace-5",
      traceId: "trace-5",
      sessionId: null,
      refTimestamp: 1_000_000_000,
      sourceStream: null,
    });

    expect(mockPush.mock.calls[0][0].query).not.toHaveProperty("stream");
  });

  it("routes a span row to its parent trace", async () => {
    const wrapper = await mountPage();
    const state = (wrapper.vm as any).$.setupState;

    state.openTarget({
      scope: "span",
      targetId: "span-1",
      traceId: "trace-9",
      sessionId: null,
      refTimestamp: 5_000_000_000,
      sourceStream: "default",
    });

    // A span lands on its parent trace with itself selected.
    expect(mockPush).toHaveBeenCalledWith({
      name: "traceDetails",
      query: {
        org_identifier: "test-org",
        stream: "default",
        from: 5_000_000_000 - 3_600_000_000,
        to: 5_000_000_000 + 3_600_000_000,
        trace_id: "trace-9",
        span_id: "span-1",
      },
    });
  });
});
