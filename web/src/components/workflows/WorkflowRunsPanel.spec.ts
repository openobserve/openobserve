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

import { vi } from "vitest";

const { mockList, mockToast, mockRetry } = vi.hoisted(() => ({
  mockList: vi.fn().mockResolvedValue({ data: [] }),
  mockToast: vi.fn(),
  mockRetry: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock("@/services/workflows", () => ({
  default: {
    getWorkflowHistory: (...a: any[]) => mockList(...a),
    retryWorkflow: (...a: any[]) => mockRetry(...a),
  },
}));
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
    "footerTitle",
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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRunsPanel from "./WorkflowRunsPanel.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

const globalCfg = {
  plugins: [i18n, store],
  stubs: {
    OTable: OTableStub,
    OTimeCell: stub("OTimeCell", ["value", "unit", "mode", "timezone", "emptyLabel"]),
    OBadge: stub("OBadge", ["variant", "size"]),
    OButton: stub("OButton", ["variant", "size", "iconLeft", "loading"]),
    OTooltip: stub("OTooltip", ["side", "content"]),
    DateTime: DateTimeStub,
    WorkflowExecutionTimeline: stub("WorkflowExecutionTimeline", [
      "history",
      "firingLabel",
      "okLabel",
    ]),
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
    { run_id: "real", event_type: "AlertFired", start_time: 1, end_time: 2, error: null },
    { run_id: "test", event_type: "Test", start_time: 3, end_time: 4, error: null },
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
    expect(await errorText({ ...errRun, error: null })).toBe("");
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
    const w = await rowsFor([run({ error: "" })]);
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

// The panel is a fixed 27.5rem (440px) master-detail column, so the column widths
// are a hard budget, not a preference: every pixel over the container pushes a
// column off-screen where no horizontal scrollbar reaches it.
describe("WorkflowRunsPanel — column layout fits the 27.5rem panel", () => {
  const PANEL_WIDTH = 440;
  const INDEX_COL = 56;

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

  // Defect 2/3: the declared widths summed to 918px in a 440px panel, so Duration,
  // Started and Ended were pushed out of view entirely.
  it("declares a total width that fits the panel", async () => {
    const w = await mountCols();
    const total = colsOf(w).reduce((sum, c) => sum + (c.size ?? 0), INDEX_COL);
    expect(total).toBeLessThanOrEqual(PANEL_WIDTH);
  });

  // Defect 3: a run history is scanned as "when did it run, how long, did it pass".
  it("leads with the columns a run history is scanned by", async () => {
    const w = await mountCols();
    const order = colsOf(w).map((c) => c.id);
    expect(order.slice(0, 3)).toEqual(["start_time", "duration", "status"]);
  });

  // Defect 3: `actions` is pinned right, so declaring it between start_time and
  // end_time made the source order lie about the rendered order.
  it("declares the pinned actions column last", async () => {
    const w = await mountCols();
    const order = colsOf(w).map((c) => c.id);
    expect(order[order.length - 1]).toBe("actions");
    expect(byId(w, "actions").pinned).toBe("right");
  });

  // Defect 2: the Error column flexed to absorb every leftover pixel, so on a
  // history with no failures the widest column carried nothing but em-dashes. The
  // reason now rides on the Failed badge instead of holding a column open.
  it("spends no column width on the error text", async () => {
    const w = await mountCols();
    expect(byId(w, "error")).toBeUndefined();
    expect(colsOf(w).some((c) => c.meta?.flex)).toBe(false);
  });

  // Defect 1: the status cell rendered the Success badge AND the "Test run" badge
  // inside a column capped at 100px, clipping the second badge to a stray "T".
  it("gives the test-run marker its own column instead of crowding status", async () => {
    const w = await mountCols();
    expect(byId(w, "event_type")).toBeTruthy();
  });
});

// Defect 1 (root cause): two badges cannot fit a 100px cell. The status cell must
// render the outcome alone; the test/real distinction is load-bearing and moves to
// its own column rather than being dropped.
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
                <span class="c-type"><slot name="cell-event_type" :row="r" /></span>
              </div>
            </div>`,
          },
          OBadge: { name: "OBadge", props: ["variant", "size"], template: `<b><slot /></b>` },
          // The shared stub drops its slot, which would hide the marker it wraps.
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

  it("renders the test-run marker in its own cell", async () => {
    const w = await mountRows();
    expect(w.find(".c-type").text()).toContain("Test");
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
