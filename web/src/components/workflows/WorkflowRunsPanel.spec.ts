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

// WorkflowRunsPanel — the persistent runs list of the master-detail Runs view.
// Contract tested: a row click emits `select-run` with that run's id, and the
// currently-loaded run (`selectedRunId`) is highlighted via rowClass. The heavy
// children (OTable, DateTime, timeline) are stubbed; the run-click wiring and the
// highlight function are what matter.

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { mockList, mockToast, mockRetry, mockGetHttp, mockAlerts } = vi.hoisted(() => ({
  mockAlerts: vi.fn().mockResolvedValue({ data: { list: [] } }),
  mockList: vi.fn().mockResolvedValue({ data: [] }),
  mockToast: vi.fn(),
  mockRetry: vi.fn().mockResolvedValue({ data: {} }),
  mockGetHttp: vi.fn().mockResolvedValue({ configured: false }),
}));

vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getWorkflowHistory: (...a: any[]) => mockList(...a),
      retryWorkflow: (...a: any[]) => mockRetry(...a),
      getHttpTrigger: (...a: any[]) => mockGetHttp(...a),
    },
  });
});
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listByFolderId: (...a: any[]) => mockAlerts(...a) },
  });
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

// OTable stub: exposes the data/columns/rowClass it received and re-emits
// row-click, so the run-click wiring can be driven without the real grid.
const OTableStub = {
  name: "OTable",
  props: [
    "data",
    "columns",
    "rowKey",
    "rowClass",
    "pageSize",
    "pageSizeOptions",
    "loading",
    "showGlobalFilter",
    "defaultColumns",
    "showIndex",
    "enableColumnResize",
    "sortBy",
    "sortOrder",
    "width",
  ],
  emits: ["row-click"],
  // Renders the #empty slot when there are no rows, like the real OTable —
  // without this the empty/error branch is never mounted and assertions on it
  // silently pass against nothing.
  template: `<div class="o-table" @click="$emit('row-click', { run_id: 'r-clicked' })">
    <slot name="empty" v-if="!data || data.length === 0" />
    <div v-for="r in data" :key="r.run_id" class="o-row">
      <slot name="cell-actions" :row="r" />
    </div>
  </div>`,
};
const stub = (name: string, props: string[] = []) => ({
  name,
  props,
  template: `<div class="${name}" />`,
});

// The real DateTime picker emits `on:date-change` on mount with the initial range —
// the panel's FIRST fetch rides on that emit (NOT an immediate watch, which would
// double-fetch). Mirror it so the mount-fetch fires in tests.
const DateTimeStub = {
  name: "DateTime",
  emits: ["on:date-change"],
  template: `<div class="DateTime" />`,
  mounted() {
    (this as any).$emit("on:date-change", {
      startTime: 1000,
      endTime: 2000,
      relativeTimePeriod: "15m",
    });
  },
};

import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRunsPanel from "./WorkflowRunsPanel.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

const globalCfg = {
  plugins: [i18n, store],
  stubs: {
    OTable: OTableStub,
    OTimeCell: stub("OTimeCell", ["value", "unit", "mode", "timezone", "emptyLabel", "format"]),
    OBadge: stub("OBadge", ["variant", "size"]),
    OTag: {
      name: "OTag",
      props: ["type", "value", "size", "label", "variant", "icon"],
      template: `<b class="o-tag">{{ label || value }}</b>`,
    },
    OButton: stub("OButton", ["variant", "size", "iconLeft", "loading"]),
    OTooltip: stub("OTooltip", ["side", "content"]),
    DateTime: DateTimeStub,
    WorkflowRunsTimeline: stub("WorkflowRunsTimeline", ["runs", "start", "end", "timezone"]),
    NoData: stub("NoData"),
    OEmptyState: stub("OEmptyState", ["preset", "filtered"]),
  },
};

const mountPanel = (props: Record<string, any> = {}) =>
  mount(WorkflowRunsPanel, {
    props: { orgId: "default", workflowId: "wf-1", ...props },
    global: globalCfg,
  });

describe("WorkflowRunsPanel", () => {
  // The runs list is SHARED state now, so a leaked wrapper from a prior test would
  // keep reacting to it and skew fetch counts — auto-unmount after each test.
  enableAutoUnmount(afterEach);
  beforeEach(() => {
    mockList.mockClear();
    mockToast.mockClear();
    // Reset the shared list so a prior test's fetch doesn't leak into the next
    // (each mount re-fetches and repopulates it).
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
  });

  it("renders the runs table", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findComponent(OTableStub as any).exists()).toBe(true);
  });

  it("fetches history EXACTLY ONCE on mount (no immediate-watch double-fetch)", async () => {
    mockList.mockResolvedValue({ data: [] });
    mountPanel();
    await flushPromises();
    // Only the DateTime picker's on-mount emit fetches — not a second immediate watch.
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("emits select-run with the clicked run's id", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.findComponent(OTableStub as any).trigger("click");

    expect(wrapper.emitted("select-run")?.[0]).toEqual(["r-clicked"]);
  });

  it("highlights the selected run row via rowClass", async () => {
    const wrapper = mountPanel({ selectedRunId: "run-2" });
    await flushPromises();
    const rowClass = wrapper.findComponent(OTableStub as any).props("rowClass") as (
      row: any,
    ) => string;

    expect(rowClass({ run_id: "run-2" })).toBe("bg-select-item-hover-bg!");
    expect(rowClass({ run_id: "run-9" })).toBe("");
  });

  it("shows the workflow name as a sub-label when provided", async () => {
    const wrapper = mountPanel({ workflowName: "my flow" });
    await flushPromises();
    expect(wrapper.text()).toContain("my flow");
  });

  describe("fetchHistory error handling", () => {
    it("stays silent on a 403 (no toast) and empties the list", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 403 } });
      const w = mountPanel();
      await flushPromises();
      expect(mockToast).not.toHaveBeenCalled();
      expect(w.findComponent(OTableStub as any).props("data")).toEqual([]);
    });

    it("toasts an error on a non-403 failure and empties the list", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 500 } });
      const w = mountPanel();
      await flushPromises();
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast.mock.calls[0][0]).toMatchObject({ variant: "error" });
      expect(w.findComponent(OTableStub as any).props("data")).toEqual([]);
    });

    it("does not fetch when workflowId is missing", async () => {
      mockList.mockClear();
      mountPanel({ workflowId: "" });
      await flushPromises();
      expect(mockList).not.toHaveBeenCalled();
    });
  });

  // ── duration formatting (i18n) ─────────────────────────────────────────────
  // The h/m/s suffixes used to be concatenated in JS. They now go through t(),
  // so a locale can relabel/reorder them; these pin the rendered output.
  describe("formatDuration", () => {
    const fmt = (w: any, us: number) => (w.vm as any).formatDuration(us);

    it("renders each magnitude via i18n", async () => {
      const w = mountPanel();
      await flushPromises();
      expect(fmt(w, 0)).toBe("0s");
      expect(fmt(w, -5)).toBe("0s");
      expect(fmt(w, 45 * 1_000_000)).toBe("45s");
      expect(fmt(w, (5 * 60 + 30) * 1_000_000)).toBe("5m 30s");
      expect(fmt(w, (2 * 3600 + 5 * 60) * 1_000_000)).toBe("2h 5m");
    });

    it("does not leak a raw i18n key when a locale lookup is used", async () => {
      const w = mountPanel();
      await flushPromises();
      expect(fmt(w, 90 * 1_000_000)).not.toContain("workflow.history");
    });
  });

  // ── error state vs empty state ─────────────────────────────────────────────
  // A failed fetch used to fall through to <NoData />, so "request failed" and
  // "never run" were indistinguishable and there was no retry affordance.
  describe("load error is distinct from empty", () => {
    const emptyState = (w: any) => w.findComponent({ name: "OEmptyState" });

    it("shows the retryable error state when the fetch fails", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 500 } });
      const w = mountPanel();
      await flushPromises();
      expect(emptyState(w).exists()).toBe(true);
      expect(emptyState(w).props("preset")).toBe("load-error");
      expect(w.findComponent({ name: "NoData" }).exists()).toBe(false);
    });

    it("shows the plain empty state when the fetch succeeds with no runs", async () => {
      mockList.mockResolvedValueOnce({ data: [] });
      const w = mountPanel();
      await flushPromises();
      expect(w.findComponent({ name: "NoData" }).exists()).toBe(true);
      expect(emptyState(w).exists()).toBe(false);
    });

    it("treats 403 as empty, not an error — retrying cannot help", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 403 } });
      const w = mountPanel();
      await flushPromises();
      expect(emptyState(w).exists()).toBe(false);
      expect(w.findComponent({ name: "NoData" }).exists()).toBe(true);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("clears the error once a later fetch succeeds", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 500 } });
      const w = mountPanel();
      await flushPromises();
      expect(emptyState(w).exists()).toBe(true);

      mockList.mockResolvedValueOnce({ data: [] });
      await w.find('[data-test="workflow-runs-refresh"]').trigger("click");
      await flushPromises();
      expect(emptyState(w).exists()).toBe(false);
    });
  });
});

// Run history exists for incident forensics, but an author tuning a branch can
// fire dozens of dry runs a day — at 50/day a real fired-alert run is 1 row in 51.
// So test runs are hidden by DEFAULT and revealed on demand.
describe("test runs are filtered out of run history by default", () => {
  const rowsOf = (w: any) => w.findComponent({ name: "OTable" }).props("data");
  const toggle = (w: any) => w.find('[data-test="workflow-runs-show-test"]');

  const mixed = [
    {
      run_id: "real",
      event_type: "AlertFired",
      start_time: 1,
      end_time: 2,
      error: null,
      status: "succeeded",
    },
    {
      run_id: "test",
      event_type: "Test",
      start_time: 3,
      end_time: 4,
      error: null,
      status: "succeeded",
    },
  ];

  beforeEach(() => {
    mockList.mockClear();
    mockList.mockResolvedValue({ data: mixed });
    // The hide-by-default this block asserts is the PUBLISHED default; pin it so
    // the block does not silently depend on module state left by another test.
    workflowObj.currentSelectedWorkflow = {
      ...(workflowObj.currentSelectedWorkflow || {}),
      isDraft: false,
    } as any;
  });

  it("hides test runs so a real run is not buried", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(rowsOf(w).map((r: any) => r.run_id)).toEqual(["real"]);
  });

  it("shows them when the author asks", async () => {
    const w = mountPanel();
    await flushPromises();
    await toggle(w).trigger("click");
    await flushPromises();
    expect(
      rowsOf(w)
        .map((r: any) => r.run_id)
        .sort(),
    ).toEqual(["real", "test"]);
  });

  // Hiding rows silently would make the list look empty on a workflow that has
  // only ever been tested — the toggle must appear so the author knows there is
  // something withheld. (The OButton stub drops slot text, so the count itself is
  // asserted via the rows it filters rather than the rendered label.)
  it("offers the toggle whenever test runs are being withheld", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(toggle(w).exists()).toBe(true);
    expect(rowsOf(w).length).toBe(1);
    expect(workflowObj.runsHistory.list.length).toBe(2);
  });

  // Nothing to reveal — no toggle.
  it("omits the toggle when there are no test runs", async () => {
    mockList.mockResolvedValue({ data: [mixed[0]] });
    const w = mountPanel();
    await flushPromises();
    expect(toggle(w).exists()).toBe(false);
  });
});

// A run-level failure names the offending nodes by raw uuid ("errors in nodes:
// <uuid>"), which is meaningless to the author. The same humanising the editor
// already applies to save/test failures must reach the status tooltip that now
// carries the reason.
describe("run error text names nodes readably", () => {
  const errRun = {
    run_id: "r-err",
    event_type: "AlertFired",
    start_time: 1,
    end_time: 2,
    error: "errors in nodes: 2d127ed5-b02a-48ab-8839-10f9d58de3f6",
    status: "failed",
  };

  // The reason renders in the status cell's tooltip, so drive that cell and read
  // the tooltip's resolved content.
  const errorText = async (row: any) => {
    mockList.mockResolvedValue({ data: [row] });
    const w = mount(WorkflowRunsPanel, {
      props: { orgId: "default", workflowId: "wf-1" },
      global: {
        ...globalCfg,
        stubs: {
          ...globalCfg.stubs,
          OTable: {
            ...OTableStub,
            template: `<div class="o-table">
              <div v-for="r in data" :key="r.run_id" class="o-row">
                <slot name="cell-status" :row="r" />
              </div>
            </div>`,
          },
          OBadge: { name: "OBadge", props: ["variant", "size"], template: `<b><slot /></b>` },
        },
      },
    });
    await flushPromises();
    const tip = w.findComponent({ name: "OTooltip" });
    return tip.exists() ? String(tip.props("content")) : "";
  };

  beforeEach(() => {
    mockList.mockResolvedValue({ data: [errRun] });
    workflowObj.currentSelectedWorkflow = {
      ...(workflowObj.currentSelectedWorkflow || {}),
      nodes: [
        {
          id: "2d127ed5-b02a-48ab-8839-10f9d58de3f6",
          data: { node_type: "destination" },
          meta: { label: "Page On-Call" },
        },
      ],
    } as any;
  });

  it("replaces a node uuid with the step's authored name", async () => {
    expect(await errorText(errRun)).toBe("errors in nodes: Page On-Call");
  });

  // No error, no tooltip — a successful run must not carry an empty explanation.
  it("renders no reason tooltip on a run that did not fail", async () => {
    expect(await errorText({ ...errRun, error: null, status: "succeeded" })).toBe("");
  });
});

// ── Retry a failed run ───────────────────────────────────────────────────────
// The run list is where an operator scanning for failures actually is, so the
// retry affordance lives on the row. It must never be offered on a run the
// backend would refuse: Test and Retry runs carry no stored input.
describe("WorkflowRunsPanel — retry row action", () => {
  const run = (over: Record<string, any> = {}) => ({
    run_id: "r-1",
    start_time: 1000,
    end_time: 2000,
    error: "errors in nodes: abc",
    event_type: "AlertFired",
    status: "failed",
    ...over,
  });

  beforeEach(() => {
    mockList.mockClear();
    mockToast.mockClear();
    mockRetry.mockClear();
    mockRetry.mockResolvedValue({ data: {} });
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
  });

  const rowsFor = async (list: any[]) => {
    mockList.mockResolvedValue({ data: list });
    const w = mountPanel();
    await flushPromises();
    return w;
  };

  it("offers retry on a failed run from a real trigger", async () => {
    const w = await rowsFor([run()]);
    expect(w.find('[data-test="workflow-run-retry-r-1"]').exists()).toBe(true);
  });

  it("does NOT offer retry on a TEST run — it has no persisted input to replay", async () => {
    const w = await rowsFor([run({ event_type: "Test" })]);
    expect(w.find('[data-test="workflow-run-retry-r-1"]').exists()).toBe(false);
  });

  it("does NOT offer retry on a RETRY run — a retry stores no input either", async () => {
    const w = await rowsFor([run({ event_type: "Retry" })]);
    expect(w.find('[data-test="workflow-run-retry-r-1"]').exists()).toBe(false);
  });

  it("does NOT offer retry on a successful run", async () => {
    const w = await rowsFor([run({ error: "", status: "succeeded" })]);
    expect(w.find('[data-test="workflow-run-retry-r-1"]').exists()).toBe(false);
  });

  it("asks for confirmation before replaying — a retry dispatches destinations for real", async () => {
    const w = await rowsFor([run()]);
    await w.find('[data-test="workflow-run-retry-r-1"]').trigger("click");
    expect(mockRetry).not.toHaveBeenCalled();
    expect(w.findComponent({ name: "ConfirmDialog" }).props("modelValue")).toBe(true);
  });

  it("posts the retry once confirmed", async () => {
    const w = await rowsFor([run()]);
    await w.find('[data-test="workflow-run-retry-r-1"]').trigger("click");
    w.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
    expect(mockRetry).toHaveBeenCalledWith({
      org_identifier: "default",
      id: "wf-1",
      run_id: "r-1",
      from_node: undefined,
    });
  });

  it("refreshes the history after a retry — the retry is a NEW run", async () => {
    const w = await rowsFor([run()]);
    const before = mockList.mock.calls.length;
    await w.find('[data-test="workflow-run-retry-r-1"]').trigger("click");
    w.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
    expect(mockList.mock.calls.length).toBeGreaterThan(before);
  });

  it("surfaces the backend refusal instead of silently doing nothing", async () => {
    mockRetry.mockRejectedValue({
      response: { status: 400, data: { message: "Errored run info not found" } },
    });
    const w = await rowsFor([run()]);
    await w.find('[data-test="workflow-run-retry-r-1"]').trigger("click");
    w.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("does not emit select-run when the retry button is clicked", async () => {
    const w = await rowsFor([run()]);
    await w.find('[data-test="workflow-run-retry-r-1"]').trigger("click");
    expect(w.emitted("select-run")).toBeFalsy();
  });
});

// While a workflow is a DRAFT its test runs ARE the history — hiding them shows an
// empty panel on a workflow the author has been actively testing. Once published,
// real fired-alert runs are what matter and rehearsals bury them.
describe("WorkflowRunsPanel — test-run visibility defaults by draft state", () => {
  const testRun = (id: string) => ({
    run_id: id,
    start_time: 1000,
    end_time: 2000,
    error: "",
    event_type: "Test",
  });
  const realRun = (id: string) => ({
    run_id: id,
    start_time: 1000,
    end_time: 2000,
    error: "",
    event_type: "AlertFired",
  });

  beforeEach(() => {
    mockList.mockClear();
    mockToast.mockClear();
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
    workflowObj.currentSelectedWorkflow = {
      ...workflowObj.currentSelectedWorkflow,
      id: "wf-1",
      isDraft: false,
    };
  });

  const ids = (w: any) =>
    (w.findComponent(OTableStub as any).props("data") as any[]).map((r) => r.run_id);
  const toggle = (w: any) => w.find('[data-test="workflow-runs-show-test"]');

  // The shared OButton stub swallows its default slot, so the toggle's label —
  // which carries the withheld count — would never render to assert on.
  const LabelledButtonStub = {
    name: "OButton",
    props: ["variant", "size", "iconLeft", "loading"],
    template: `<button><slot /></button>`,
  };

  const mountWith = async (list: any[], draft: boolean) => {
    workflowObj.currentSelectedWorkflow.isDraft = draft;
    mockList.mockResolvedValue({ data: list });
    const w = mount(WorkflowRunsPanel, {
      props: { orgId: "default", workflowId: "wf-1" },
      global: { ...globalCfg, stubs: { ...globalCfg.stubs, OButton: LabelledButtonStub } },
    });
    await flushPromises();
    return w;
  };

  it("shows test runs by default on a DRAFT — they are the only history that exists", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], true);
    expect(ids(w)).toEqual(["t-1", "r-1"]);
  });

  it("hides test runs by default on a PUBLISHED workflow", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], false);
    expect(ids(w)).toEqual(["r-1"]);
  });

  it("derives the default from a draft state that hydrates AFTER mount (deep link)", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], false);
    expect(ids(w)).toEqual(["r-1"]);
    workflowObj.currentSelectedWorkflow.isDraft = true;
    await flushPromises();
    expect(ids(w)).toEqual(["t-1", "r-1"]);
  });

  it("keeps an explicit HIDE on a draft across a refetch", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], true);
    await toggle(w).trigger("click");
    expect(ids(w)).toEqual(["r-1"]);

    await (w.vm as any).fetchHistory();
    await flushPromises();

    expect(ids(w)).toEqual(["r-1"]);
  });

  it("keeps an explicit SHOW on a published workflow across a refetch", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], false);
    await toggle(w).trigger("click");
    expect(ids(w)).toEqual(["t-1", "r-1"]);

    await (w.vm as any).fetchHistory();
    await flushPromises();

    expect(ids(w)).toEqual(["t-1", "r-1"]);
  });

  // Publishing mid-session must not yank rows out from under the author.
  it("leaves an explicit choice alone when the workflow is published while open", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], true);
    await toggle(w).trigger("click");
    expect(ids(w)).toEqual(["r-1"]);

    workflowObj.currentSelectedWorkflow.isDraft = false;
    await flushPromises();

    expect(ids(w)).toEqual(["r-1"]);
  });

  it("re-derives to hidden on publish when the author never chose", async () => {
    const w = await mountWith([testRun("t-1"), realRun("r-1")], true);
    expect(ids(w)).toEqual(["t-1", "r-1"]);

    workflowObj.currentSelectedWorkflow.isDraft = false;
    await flushPromises();

    expect(ids(w)).toEqual(["r-1"]);
  });

  it("does not render the toggle when there are no test runs to withhold", async () => {
    const w = await mountWith([realRun("r-1")], false);
    expect(toggle(w).exists()).toBe(false);
  });

  it("does not render the toggle on a draft with no test runs", async () => {
    const w = await mountWith([realRun("r-1")], true);
    expect(toggle(w).exists()).toBe(false);
  });

  it("counts test runs for the label regardless of which default is active", async () => {
    const published = await mountWith([testRun("t-1"), testRun("t-2"), realRun("r-1")], false);
    expect(published.text()).toContain("Show 2 test run(s)");

    const draft = await mountWith([testRun("t-1"), testRun("t-2"), realRun("r-1")], true);
    expect(draft.text()).toContain("Hide test runs");
  });
});

describe("WorkflowRunsPanel — one fixed column set", () => {
  const colsOf = (w: any) => w.findComponent(OTableStub as any).props("columns") as any[];
  const byId = (w: any, id: string) => colsOf(w).find((c) => c.id === id);

  const mountCols = async () => {
    mockList.mockResolvedValue({ data: [] });
    const w = mountPanel();
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    mockList.mockClear();
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
  });

  it("declares Started, Status, Run, Trigger, Source details, Duration and Actions at their sizes", async () => {
    const w = await mountCols();
    expect(colsOf(w).map((c) => [c.id, c.size])).toEqual([
      ["start_time", 112],
      ["status", 92],
      ["run_id", 88],
      ["trigger", 124],
      ["details", 210],
      ["duration", 84],
      ["actions", 68],
    ]);
  });

  it("pins actions last and budgets two icon slots", async () => {
    const w = await mountCols();
    expect(byId(w, "actions").pinned).toBe("right");
    expect(byId(w, "actions").meta.actionCount).toBe(2);
  });

  it("spends no column width on the error text and shows no index column", async () => {
    const w = await mountCols();
    expect(byId(w, "error")).toBeUndefined();
    expect(w.findComponent(OTableStub as any).props("showIndex")).toBeFalsy();
  });

  it("lets Source details absorb what the pinned actions floor leaves", async () => {
    const w = await mountCols();
    expect(byId(w, "details").meta).toMatchObject({ autoWidth: true, fillRemaining: true });
    for (const c of colsOf(w).filter((c) => !["details", "actions"].includes(c.id)))
      expect(c.maxSize).toBe(c.size);
  });
});

describe("WorkflowRunsPanel — test-run marker is legible", () => {
  const testRun = {
    run_id: "t-1",
    start_time: 1000,
    end_time: 2000,
    error: null,
    event_type: "Test",
  };

  beforeEach(() => {
    mockList.mockClear();
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
    workflowObj.currentSelectedWorkflow = {
      ...workflowObj.currentSelectedWorkflow,
      id: "wf-1",
      isDraft: true,
    };
  });

  const mountRows = async () => {
    mockList.mockResolvedValue({ data: [testRun] });
    const w = mount(WorkflowRunsPanel, {
      props: { orgId: "default", workflowId: "wf-1" },
      global: {
        ...globalCfg,
        stubs: {
          ...globalCfg.stubs,
          OTable: {
            ...OTableStub,
            template: `<div class="o-table">
              <div v-for="r in data" :key="r.run_id" class="o-row">
                <span class="c-status"><slot name="cell-status" :row="r" /></span>
                <span class="c-trigger"><slot name="cell-trigger" :row="r" /></span>
              </div>
            </div>`,
          },
          OTooltip: {
            name: "OTooltip",
            props: ["side", "content", "maxWidth"],
            template: `<i><slot /></i>`,
          },
        },
      },
    });
    await flushPromises();
    return w;
  };

  it("renders only the outcome badge in the status cell", async () => {
    const w = await mountRows();
    expect(w.find(".c-status").text()).not.toContain("Test run");
  });

  it("names the test run in its Trigger badge", async () => {
    const w = await mountRows();
    expect(w.find(".c-trigger").text()).toContain("Test run");
    expect(w.find('[data-test="workflow-run-test-marker"]').exists()).toBe(true);
  });
});

// Dropping the Error column must not drop the failure REASON — it moves onto the
// Failed badge's tooltip (as in the run switcher), with node uuids still resolved.
describe("WorkflowRunsPanel — a failure still explains itself", () => {
  const failed = {
    run_id: "f-1",
    start_time: 1000,
    end_time: 2000,
    error: "boom in node abc",
    event_type: "AlertFired",
    status: "failed",
  };

  beforeEach(() => {
    mockList.mockClear();
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
    workflowObj.currentSelectedWorkflow = {
      ...workflowObj.currentSelectedWorkflow,
      id: "wf-1",
      isDraft: false,
    };
  });

  it("carries the error message on the status cell's tooltip", async () => {
    mockList.mockResolvedValue({ data: [failed] });
    const w = mount(WorkflowRunsPanel, {
      props: { orgId: "default", workflowId: "wf-1" },
      global: {
        ...globalCfg,
        stubs: {
          ...globalCfg.stubs,
          OTable: {
            ...OTableStub,
            template: `<div class="o-table">
              <div v-for="r in data" :key="r.run_id" class="o-row">
                <slot name="cell-status" :row="r" />
              </div>
            </div>`,
          },
          OBadge: { name: "OBadge", props: ["variant", "size"], template: `<b><slot /></b>` },
        },
      },
    });
    await flushPromises();

    const tip = w.findComponent({ name: "OTooltip" });
    expect(tip.exists()).toBe(true);
    expect(String(tip.props("content"))).toContain("boom in node");
  });
});

// ── Stored statuses and HTTP request runs (AC-WEB-06, AC-UI-10) ────────────────
describe("WorkflowRunsPanel — stored statuses and HTTP request runs", () => {
  const COLUMN_IDS = [
    "start_time",
    "status",
    "run_id",
    "trigger",
    "details",
    "duration",
    "actions",
  ];
  const facts = (over: Record<string, any> = {}) => ({
    credential_prefix: "o2wh_4fK9…oI4k",
    caller_ip: "203.0.113.24",
    idempotency_key: "deploy-d-4821",
    content_type: "application/json",
    body_bytes: 68,
    status: "failed",
    error: null,
    ...over,
  });
  const row = (over: Record<string, any>) => ({
    start_time: 1000,
    end_time: 2000,
    _timestamp: 1000,
    error: null,
    status: "succeeded",
    event_type: "AlertFired",
    ...over,
  });
  const httpRows = [
    row({
      run_id: "0193f2e8-aaaa",
      event_type: "Webhook",
      status: "queued",
      http_request: facts({ status: "queued", idempotency_key: "deploy-d-4825" }),
    }),
    row({
      run_id: "0193f25e-bbbb",
      event_type: "Webhook",
      status: "expired",
      http_request: facts({ status: "expired", idempotency_key: null, caller_ip: "198.51.100.7" }),
    }),
    row({
      run_id: "0193f1f9-cccc",
      event_type: "Webhook",
      status: "failed",
      error: "worker_lost",
      http_request: facts({ error: "worker_lost", idempotency_key: "deploy-d-4818" }),
    }),
    row({
      run_id: "0193f2c4-dddd",
      event_type: "Webhook",
      status: "failed",
      error: "FunctionNode JS error",
      http_request: facts({ error: "node_errored" }),
    }),
    row({ run_id: "alert-1", event_type: "AlertFired" }),
    row({ run_id: "retry-1", event_type: "Retry" }),
  ];

  // Renders every declared column's cell slot so each cell is assertable.
  const CellTable = {
    ...OTableStub,
    template: `<div class="o-table">
      <slot name="empty" v-if="!data || data.length === 0" />
      <div v-for="r in data" :key="r.run_id" class="o-row" :data-run="r.run_id">
        <span v-for="c in columns" :key="c.id" :class="'c-' + c.id">
          <slot :name="'cell-' + c.id" :row="r" :value="c.accessorFn ? c.accessorFn(r) : r[c.accessorKey]" />
        </span>
      </div>
    </div>`,
  };
  const ToggleGroupStub = {
    name: "OToggleGroup",
    props: ["modelValue", "type", "mobileDropdown"],
    emits: ["update:modelValue"],
    template: `<div class="o-toggle" v-bind="$attrs"><slot /></div>`,
  };
  const ToggleItemStub = {
    name: "OToggleGroupItem",
    props: ["value", "size", "iconLeft"],
    template: `<span class="o-toggle-item" v-bind="$attrs"><slot /></span>`,
  };
  const SearchStub = {
    name: "OSearchInput",
    props: ["modelValue", "placeholder", "size", "clearable"],
    emits: ["update:modelValue"],
    template: `<input class="o-search" v-bind="$attrs" />`,
  };
  const EmptyStub = {
    name: "OEmptyState",
    props: ["preset", "title", "description", "actionLabel", "icon", "size", "filtered"],
    emits: ["action"],
    template: `<div class="o-empty" v-bind="$attrs">{{ title }}</div>`,
  };

  const mounted: any[] = [];
  const mountHttp = async (list: any[] = httpRows) => {
    mockList.mockResolvedValue({ data: list });
    const w = mount(WorkflowRunsPanel, {
      props: { orgId: "default", workflowId: "wf-http" },
      global: {
        ...globalCfg,
        stubs: {
          ...globalCfg.stubs,
          OTable: CellTable,
          OToggleGroup: ToggleGroupStub,
          OToggleGroupItem: ToggleItemStub,
          OSearchInput: SearchStub,
          OEmptyState: EmptyStub,
          OTooltip: {
            name: "OTooltip",
            props: ["side", "content", "maxWidth"],
            template: `<i><slot /></i>`,
          },
        },
      },
    });
    mounted.push(w);
    await flushPromises();
    return w;
  };
  const colIds = (w: any) =>
    (w.findComponent(CellTable as any).props("columns") as any[]).map((c) => c.id);
  const rowIds = (w: any) =>
    (w.findComponent(CellTable as any).props("data") as any[]).map((r) => r.run_id);
  const setFilter = async (w: any, value: string) => {
    w.findComponent(ToggleGroupStub as any).vm.$emit("update:modelValue", value);
    await flushPromises();
  };
  const filter = (w: any) => w.find('[data-test="workflow-runs-trigger-filter"]');
  const timeline = (w: any) => w.findComponent({ name: "WorkflowRunsTimeline" });

  beforeEach(() => {
    mockList.mockClear();
    mockRetry.mockClear();
    mockGetHttp.mockReset();
    mockGetHttp.mockResolvedValue({ configured: false });
    mockAlerts.mockReset();
    mockAlerts.mockResolvedValue({ data: { list: [] } });
    (store.state as any).zoConfig.workflow_hooks_enabled = true;
    workflowObj.runsHistory = {
      list: [],
      fetchedAt: 0,
      params: { start: 0, end: 0 },
      loading: false,
    };
    workflowObj.currentSelectedWorkflow = {
      ...workflowObj.currentSelectedWorkflow,
      id: "wf-http",
      isDraft: false,
      http_endpoint_enabled: false,
      nodes: [
        {
          id: "trig",
          data: { node_type: "workflow_trigger", trigger_kind: "alert_fired" },
        },
      ],
    };
  });

  afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    delete (store.state as any).zoConfig.workflow_hooks_enabled;
  });

  it("status comes from the stored status field", async () => {
    const w = await mountHttp([row({ run_id: "s-1", status: "succeeded", error: "warning text" })]);
    expect(w.find('[data-run="s-1"] .c-status .o-tag').text()).toBe("succeeded");
  });

  it("an errored row stored as succeeded renders Failed (server-normalised fixture)", async () => {
    const w = await mountHttp([row({ run_id: "s-2", status: "failed", error: "boom" })]);
    const tag = w.find('[data-run="s-2"] .c-status').findComponent({ name: "OTag" });
    expect(tag.props("type")).toBe("hookRunStatus");
    expect(tag.props("value")).toBe("failed");
  });

  it("feeds the timeline from the stored status", async () => {
    const w = await mountHttp([
      row({ run_id: "t-1", status: "failed", error: null }),
      row({ run_id: "t-2", status: "succeeded", error: "x" }),
      row({ run_id: "t-3", status: "queued", error: null }),
      row({ run_id: "t-5", status: "expired", error: null }),
    ]);
    const runs = timeline(w).props("runs") as { id: string; status: string }[];
    expect(runs.map((r) => [r.id, r.status])).toEqual([
      ["t-1", "failed"],
      ["t-2", "succeeded"],
      ["t-3", "queued"],
      ["t-5", "expired"],
    ]);
  });

  it("pins the timeline to the picked range and keeps it when a filter matches nothing", async () => {
    mockGetHttp.mockResolvedValue({ configured: true, enabled: true });
    const w = await mountHttp([
      row({ run_id: "h-1", event_type: "Webhook", http_request: facts() }),
    ]);
    expect(timeline(w).props("start")).toBe(1000);
    expect(timeline(w).props("end")).toBe(2000);
    await setFilter(w, "alert_fired");
    expect(rowIds(w)).toEqual([]);
    expect(timeline(w).exists()).toBe(true);
    expect(timeline(w).props("runs")).toEqual([
      expect.objectContaining({ id: "h-1", matched: false }),
    ]);
  });

  it("marks only the filtered rows as matched on the timeline", async () => {
    const w = await mountHttp();
    await setFilter(w, "http_request");
    const runs = timeline(w).props("runs") as { id: string; matched: boolean }[];
    expect(runs.filter((r) => r.matched).map((r) => r.id)).toEqual(rowIds(w));
    expect(runs.find((r) => r.id === "alert-1")?.matched).toBe(false);
  });

  it("hides the trigger filter on a workflow that never had an endpoint, same columns", async () => {
    const w = await mountHttp([row({ run_id: "alert-1" })]);
    expect(filter(w).exists()).toBe(false);
    expect(w.find('[data-test="workflow-runs-search"]').exists()).toBe(false);
    expect(colIds(w)).toEqual(COLUMN_IDS);
  });

  it("hides the trigger filter while hooks are off on the server", async () => {
    delete (store.state as any).zoConfig.workflow_hooks_enabled;
    const w = await mountHttp();
    expect(filter(w).exists()).toBe(false);
    expect(mockGetHttp.mock.calls.filter((c) => c[0]?.id === "wf-http")).toHaveLength(0);
  });

  it("shows All triggers / the kind / HTTP request once the workflow had HTTP runs", async () => {
    const w = await mountHttp();
    expect(filter(w).exists()).toBe(true);
    for (const id of ["all", "alert_fired", "http_request"])
      expect(w.find(`[data-test="workflow-runs-trigger-filter-${id}"]`).exists()).toBe(true);
    expect(w.find('[data-test="workflow-runs-trigger-filter-alert_fired"]').text()).toBe(
      "Alert fired",
    );
  });

  it("shows the trigger filter for an endpoint that exists but has no runs in range", async () => {
    mockGetHttp.mockResolvedValue({ configured: true, enabled: false });
    const w = await mountHttp([row({ run_id: "alert-1" })]);
    expect(mockGetHttp.mock.calls.some((c) => c[0]?.id === "wf-http")).toBe(true);
    expect(filter(w).exists()).toBe(true);
  });

  it("names each run's trigger in words under All triggers", async () => {
    const w = await mountHttp();
    expect(w.find('[data-run="0193f2c4-dddd"] .c-trigger').text()).toBe("HTTP request");
    expect(w.find('[data-run="alert-1"] .c-trigger').text()).toBe("Alert fired");
    expect(w.find('[data-run="retry-1"] .c-trigger').text()).toBe("Retry run");
  });

  it("keeps the identical column set under every filter", async () => {
    const w = await mountHttp();
    const sets: unknown[] = [];
    for (const f of ["all", "alert_fired", "http_request"]) {
      await setFilter(w, f);
      sets.push(
        (w.findComponent(CellTable as any).props("columns") as any[]).map((c) => [
          c.id,
          c.size,
          c.maxSize,
        ]),
      );
    }
    expect(colIds(w)).toEqual(COLUMN_IDS);
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
    expect(w.emitted("update:triggerFilter")?.at(-1)).toEqual(["http_request"]);
    expect(rowIds(w)).not.toContain("alert-1");
    expect(rowIds(w)).not.toContain("retry-1");
  });

  it("keeps the same table instance across filters", async () => {
    const w = await mountHttp();
    const before = w.findComponent(CellTable as any).vm;
    await setFilter(w, "http_request");
    expect(w.findComponent(CellTable as any).vm).toBe(before);
  });

  it("gives every filter option the same fixed width and no icon", async () => {
    const w = await mountHttp();
    const items = w.findAllComponents(ToggleItemStub as any);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.classes()).toEqual(expect.arrayContaining(["w-28", "shrink-0"]));
      expect(item.props("iconLeft")).toBeUndefined();
    }
  });

  it("dates Started like the mockups and shows the received time for a queued HTTP run", async () => {
    const w = await mountHttp([
      row({ run_id: "alert-1", start_time: 5000 }),
      row({
        run_id: "q-1",
        event_type: "Webhook",
        status: "queued",
        start_time: 0,
        _timestamp: 7000,
        http_request: facts({ status: "queued" }),
      }),
    ]);
    const started = (id: string) =>
      w.find(`[data-run="${id}"] .c-start_time`).findComponent({ name: "OTimeCell" });
    expect(started("alert-1").props("format")).toBe("MMM d, HH:mm");
    expect(started("alert-1").props("value")).toBe(5000);
    expect(started("q-1").props("value")).toBe(7000);
  });

  it("a reason line wraps under its chip instead of cutting off", async () => {
    const w = await mountHttp();
    expect(w.find('[data-test="workflow-run-reason-0193f25e-bbbb"]').classes()).toContain(
      "whitespace-normal",
    );
  });

  it("a run that never started or has not finished shows no duration", async () => {
    const w = await mountHttp();
    for (const id of ["0193f2e8-aaaa", "0193f25e-bbbb"])
      expect(w.find(`[data-run="${id}"] .c-duration`).text()).toBe("—");
    expect(w.find('[data-run="alert-1"] .c-duration').text()).not.toBe("—");
  });

  it("a kind filter keeps that kind's runs only", async () => {
    const w = await mountHttp();
    await setFilter(w, "alert_fired");
    expect(rowIds(w)).toEqual(["alert-1"]);
  });

  it("source details: token prefix over IP and key, the alert name, the retried run, the user", async () => {
    mockAlerts.mockResolvedValue({
      data: { list: [{ alert_id: "al-1", name: "checkout_5xx_rate" }] },
    });
    const w = await mountHttp([
      ...httpRows,
      row({ run_id: "alert-2", source_id: "al-1" }),
      row({ run_id: "alert-3", source_id: "al-gone" }),
      row({ run_id: "retry-2", event_type: "Retry", source_id: "3L5y2KdQ-original" }),
      row({ run_id: "manual-1", event_type: "Manual", source_id: "root@example.com" }),
    ]);
    const details = (id: string) => w.find(`[data-test="workflow-run-details-${id}"]`).text();
    expect(details("0193f25e-bbbb")).toContain("o2wh_4fK9…oI4k");
    expect(details("0193f25e-bbbb")).toContain("198.51.100.7 · no idempotency key");
    expect(details("0193f2c4-dddd")).toContain("203.0.113.24 · key deploy-d-4821");
    expect(details("alert-2")).toBe("checkout_5xx_rate");
    expect(details("alert-3")).toBe("al-gone");
    expect(details("retry-2")).toBe("Retry of 3L5y2KdQ");
    expect(details("manual-1")).toBe("root@example.com");
    expect(w.find('[data-run="0193f2c4-dddd"] .c-run_id').text()).toContain("0193f2c4");
    expect(w.find('[data-run="0193f2c4-dddd"] .c-run_id').text()).not.toContain("dddd");
  });

  it("expired rows show never ran, worker-lost rows say they are not re-run", async () => {
    const w = await mountHttp();
    expect(w.find('[data-test="workflow-run-reason-0193f25e-bbbb"]').text()).toBe(
      "never ran · queued over 1 h",
    );
    expect(w.find('[data-test="workflow-run-reason-0193f1f9-cccc"]').text()).toBe(
      "worker lost · not re-run",
    );
    expect(w.find('[data-test="workflow-run-reason-0193f2c4-dddd"]').exists()).toBe(false);
  });

  it("every row has an open icon and keeps the retry slot reserved when it cannot retry", async () => {
    const w = await mountHttp();
    for (const id of rowIds(w)) {
      const actions = w.find(`[data-run="${id}"] .c-actions`);
      expect(actions.find(`[data-test="workflow-run-open-${id}"]`).exists()).toBe(true);
      const slots =
        actions.findAll(`[data-test="workflow-run-retry-${id}"]`).length +
        actions.findAll('[data-test="workflow-run-retry-slot"]').length;
      expect(slots).toBe(1);
    }
    await w.find('[data-test="workflow-run-open-alert-1"]').trigger("click");
    expect(w.emitted("select-run")?.at(-1)).toEqual(["alert-1"]);
  });

  it("retry is hidden for never-executed runs", async () => {
    const w = await mountHttp();
    expect(w.find('[data-test="workflow-run-retry-0193f25e-bbbb"]').exists()).toBe(false);
    expect(w.find('[data-test="workflow-run-retry-0193f1f9-cccc"]').exists()).toBe(false);
    expect(w.find('[data-test="workflow-run-retry-0193f2e8-aaaa"]').exists()).toBe(false);
    expect(w.find('[data-test="workflow-run-retry-0193f2c4-dddd"]').exists()).toBe(true);
  });

  it("search shows under every filter and matches a run id prefix, key, token prefix or alert", async () => {
    mockAlerts.mockResolvedValue({
      data: { list: [{ alert_id: "al-1", name: "checkout_5xx_rate" }] },
    });
    const w = await mountHttp([...httpRows, row({ run_id: "alert-2", source_id: "al-1" })]);
    const search = w.findComponent(SearchStub as any);
    expect(search.attributes("data-test")).toBe("workflow-runs-search");
    expect(search.props("placeholder")).toBe("Search run ID, idempotency key or alert");
    search.vm.$emit("update:modelValue", "5XX");
    await flushPromises();
    expect(rowIds(w)).toEqual(["alert-2"]);
    search.vm.$emit("update:modelValue", "4fK9");
    await flushPromises();
    expect(rowIds(w)).toHaveLength(4);
    await setFilter(w, "http_request");
    expect(w.findComponent(SearchStub as any).exists()).toBe(true);
    search.vm.$emit("update:modelValue", "DEPLOY-D-4825");
    await flushPromises();
    expect(rowIds(w)).toEqual(["0193f2e8-aaaa"]);
    search.vm.$emit("update:modelValue", "0193f2c4");
    await flushPromises();
    expect(rowIds(w)).toEqual(["0193f2c4-dddd"]);
  });

  it("prioritizes search empty and clears search without resetting the trigger filter", async () => {
    const w = await mountHttp(httpRows);
    await setFilter(w, "http_request");
    w.findComponent(SearchStub).vm.$emit("update:modelValue", "no-such-run");
    await flushPromises();
    const empty = w.findComponent(EmptyStub);
    expect(empty.attributes("data-test")).toBe("workflow-runs-search-empty");
    empty.vm.$emit("action");
    await flushPromises();
    expect(w.findComponent(SearchStub).props("modelValue")).toBe("");
    expect(rowIds(w).length).toBeGreaterThan(0);
    expect(w.emitted("update:triggerFilter")?.at(-1)).toEqual(["http_request"]);
  });

  it("an empty HTTP filter says so and offers all triggers back", async () => {
    mockGetHttp.mockResolvedValue({ configured: true, enabled: true });
    const w = await mountHttp([row({ run_id: "alert-1" })]);
    await setFilter(w, "http_request");
    const empty = w.findComponent(EmptyStub as any);
    expect(empty.attributes("data-test")).toBe("workflow-runs-http-empty");
    expect(empty.props("title")).toBe("No HTTP requests in this time range");
    expect(empty.props("actionLabel")).toBe("Show all triggers");
    empty.vm.$emit("action");
    await flushPromises();
    expect(w.emitted("update:triggerFilter")?.at(-1)).toEqual(["all"]);
    expect(rowIds(w)).toEqual(["alert-1"]);
  });

  it("an empty alert filter names it, says the rest are dimmed and offers all triggers", async () => {
    const w = await mountHttp(httpRows.filter((r) => r.event_type === "Webhook"));
    await setFilter(w, "alert_fired");
    const empty = w.findComponent(EmptyStub as any);
    expect(empty.attributes("data-test")).toBe("workflow-runs-filter-empty");
    expect(empty.props("title")).toBe("No alert-fired runs in this time range");
    expect(empty.props("description")).toBe("The other runs are still on the timeline, dimmed.");
    expect(empty.props("actionLabel")).toBe("Show all triggers");
  });
});
