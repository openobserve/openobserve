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

// WorkflowHistoryDrawer — the Executions (past runs) drawer: datetime range +
// refresh in the header, an OTable of runs, and an `open-run` emit when a run is
// picked (the PARENT then calls loadWorkflowRun — that mapping is covered in
// plugins/workflows/useWorkflowCanvas.spec.ts and is deliberately not retested
// here).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

const mockGetHistory = vi.fn();
vi.mock("@/services/workflows", () => ({
  default: { getWorkflowHistory: (...a: any[]) => mockGetHistory(...a) },
}));

import WorkflowHistoryDrawer from "./WorkflowHistoryDrawer.vue";

// ── stubs ────────────────────────────────────────────────────────────────────
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "seamless",
    "persistent",
    "portalTarget",
    "title",
    "subTitle",
  ],
  emits: ["update:open"],
  template: `
    <div class="o-drawer" :data-title="title" :data-subtitle="subTitle">
      <div class="drawer-header-right"><slot name="header-right" /></div>
      <button class="drawer-dismiss" @click="$emit('update:open', false)">x</button>
      <slot />
    </div>`,
};

// Renders the row cell slots so the component's cell templates (duration,
// status, error, times) are actually exercised.
const OTableStub = {
  name: "OTable",
  props: [
    "data",
    "columns",
    "rowKey",
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
  template: `
    <div class="o-table" :data-loading="String(!!loading)" :data-rows="data.length">
      <div
        v-for="row in data"
        :key="row.run_id"
        class="o-row"
        :data-test="'row-' + row.run_id"
        @click="$emit('row-click', row)"
      >
        <span class="c-start"><slot name="cell-start_time" :row="row" :value="row.start_time" /></span>
        <span class="c-end"><slot name="cell-end_time" :row="row" :value="row.end_time" /></span>
        <span class="c-duration"><slot name="cell-duration" :row="row" /></span>
        <span class="c-status"><slot name="cell-status" :row="row" /></span>
        <span class="c-error"><slot name="cell-error" :row="row" :value="row.error" /></span>
      </div>
      <div v-if="!data.length" class="o-empty"><slot name="empty" /></div>
    </div>`,
};

const DateTimeStub = {
  name: "DateTime",
  props: [
    "autoApply",
    "defaultType",
    "defaultAbsoluteTime",
    "defaultRelativeTime",
  ],
  emits: ["on:date-change"],
  template: `<div class="date-time" :data-type="defaultType" :data-relative="defaultRelativeTime" />`,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading", "iconLeft"],
  template: `<button :disabled="disabled" :data-loading="String(!!loading)"><slot /></button>`,
};

const globalConfig = {
  plugins: [i18n, store],
  stubs: {
    ODrawer: ODrawerStub,
    OTable: OTableStub,
    DateTime: DateTimeStub,
    OButton: OButtonStub,
    OTooltip: { name: "OTooltip", props: ["side", "content"], template: "<i />" },
    OBadge: {
      name: "OBadge",
      props: ["variant", "size"],
      template: `<span class="o-badge" :data-variant="variant"><slot /></span>`,
    },
    OTimeCell: {
      name: "OTimeCell",
      props: ["value", "unit", "mode", "timezone", "emptyLabel"],
      template: `<span class="o-time" :data-value="String(value)" :data-tz="timezone" />`,
    },
    WorkflowExecutionTimeline: {
      name: "WorkflowExecutionTimeline",
      props: ["history", "firingLabel", "okLabel"],
      template: `<div class="wf-timeline" :data-len="history.length" />`,
    },
    NoData: { name: "NoData", template: `<div class="no-data" />` },
  },
};

const S = 1_000_000; // one second in microseconds
const RUNS = [
  {
    run_id: "r1",
    start_time: 1_700_000_000_000_000,
    end_time: 1_700_000_000_000_000 + 45 * S,
    error: null,
  },
  {
    run_id: "r2",
    start_time: 1_700_000_100_000_000,
    end_time: 1_700_000_100_000_000 + 90 * S,
    error: "destination unreachable",
  },
];

const defaultProps = {
  open: true,
  orgId: "default",
  workflowId: "wf1",
  workflowName: "My Workflow",
};

const mountDrawer = async (props: Record<string, any> = {}) => {
  const wrapper = mount(WorkflowHistoryDrawer, {
    global: globalConfig,
    props: { ...defaultProps, ...props },
  });
  await flushPromises();
  return wrapper;
};

const table = (w: any) => w.findComponent(OTableStub as any);

describe("WorkflowHistoryDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHistory.mockResolvedValue({ data: RUNS });
  });

  describe("fetching", () => {
    it("fetches the last 24h of runs as soon as it opens", async () => {
      await mountDrawer();
      expect(mockGetHistory).toHaveBeenCalledTimes(1);
      const args = mockGetHistory.mock.calls[0][0];
      expect(args.org_identifier).toBe("default");
      expect(args.id).toBe("wf1");
      // microsecond range, 24h wide
      expect(args.end_time - args.start_time).toBe(24 * 60 * 60 * 1000 * 1000);
    });

    it("does not fetch while it is closed, and fetches when it opens", async () => {
      const wrapper = await mountDrawer({ open: false });
      expect(mockGetHistory).not.toHaveBeenCalled();

      await wrapper.setProps({ open: true });
      await flushPromises();
      expect(mockGetHistory).toHaveBeenCalledTimes(1);
    });

    it("skips the call when there is no workflow id yet", async () => {
      await mountDrawer({ workflowId: "" });
      expect(mockGetHistory).not.toHaveBeenCalled();
    });

    it("re-fetches from the refresh button", async () => {
      const wrapper = await mountDrawer();
      await wrapper
        .find('[data-test="workflow-history-refresh"]')
        .trigger("click");
      await flushPromises();
      expect(mockGetHistory).toHaveBeenCalledTimes(2);
    });

    it("toggles the loading flag on the table while in flight", async () => {
      let resolve!: (v: any) => void;
      mockGetHistory.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const wrapper = mount(WorkflowHistoryDrawer, {
        global: globalConfig,
        props: defaultProps,
      });
      await nextTick();
      expect(table(wrapper).props("loading")).toBe(true);

      resolve({ data: RUNS });
      await flushPromises();
      expect(table(wrapper).props("loading")).toBe(false);
    });
  });

  describe("error + empty states", () => {
    it("toasts and empties the table when the history call fails", async () => {
      mockGetHistory.mockRejectedValue({ response: { status: 500 } });
      const wrapper = await mountDrawer();
      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: i18n.global.t("workflow.history.loadError"),
      });
      expect(table(wrapper).props("data")).toEqual([]);
    });

    it("stays silent on a 403 (no permission) but still empties the table", async () => {
      mockGetHistory.mockRejectedValue({ response: { status: 403 } });
      const wrapper = await mountDrawer();
      expect(mockToast).not.toHaveBeenCalled();
      expect(table(wrapper).props("data")).toEqual([]);
    });

    it("treats a non-array response as no runs", async () => {
      mockGetHistory.mockResolvedValue({ data: { list: [] } });
      const wrapper = await mountDrawer();
      expect(table(wrapper).props("data")).toEqual([]);
    });

    it("renders the NoData empty slot and hides the timeline when there are no runs", async () => {
      mockGetHistory.mockResolvedValue({ data: [] });
      const wrapper = await mountDrawer();
      expect(wrapper.find(".no-data").exists()).toBe(true);
      expect(wrapper.find(".wf-timeline").exists()).toBe(false);
    });
  });

  describe("rendering runs", () => {
    it("lists every run and feeds the timeline one entry per run", async () => {
      const wrapper = await mountDrawer();
      expect(wrapper.findAll(".o-row")).toHaveLength(2);
      const timeline = wrapper.findComponent({ name: "WorkflowExecutionTimeline" });
      expect(timeline.props("history")).toEqual([
        { status: "success", timestamp: RUNS[0].start_time },
        { status: "error", timestamp: RUNS[1].start_time },
      ]);
      expect(timeline.props("firingLabel")).toBe(
        i18n.global.t("workflow.history.failed"),
      );
      expect(timeline.props("okLabel")).toBe(
        i18n.global.t("workflow.history.success"),
      );
    });

    it("renders start/end times as microsecond time cells in the store timezone", async () => {
      const wrapper = await mountDrawer();
      const cells = wrapper.findAll(".o-time");
      expect(cells[0].attributes("data-value")).toBe(String(RUNS[0].start_time));
      expect(cells[1].attributes("data-value")).toBe(String(RUNS[0].end_time));
      expect(cells[0].attributes("data-tz")).toBe("UTC");
    });

    it("badges a clean run as Success and an errored run as Failed", async () => {
      const wrapper = await mountDrawer();
      const badges = wrapper.findAll(".o-badge");
      expect(badges[0].text()).toBe(i18n.global.t("workflow.history.success"));
      expect(badges[0].attributes("data-variant")).toBe("success-outline");
      expect(badges[1].text()).toBe(i18n.global.t("workflow.history.failed"));
      expect(badges[1].attributes("data-variant")).toBe("error-outline");
    });

    it("shows the error text, and a dash when a run has none", async () => {
      const wrapper = await mountDrawer();
      const errs = wrapper.findAll(".c-error");
      expect(errs[0].text()).toBe("—");
      expect(errs[1].text()).toBe("destination unreachable");
    });

    it("formats the duration in s / m+s / h+m and guards a non-positive span", async () => {
      mockGetHistory.mockResolvedValue({
        data: [
          { run_id: "a", start_time: 0, end_time: 45 * S, error: null },
          { run_id: "b", start_time: 0, end_time: 90 * S, error: null },
          { run_id: "c", start_time: 0, end_time: 3 * 3600 * S + 120 * S, error: null },
          { run_id: "d", start_time: 100, end_time: 100, error: null },
          { run_id: "e", start_time: 100, end_time: 50, error: null },
        ],
      });
      const wrapper = await mountDrawer();
      const d = wrapper.findAll(".c-duration").map((n: any) => n.text());
      expect(d).toEqual(["45s", "1m 30s", "3h 2m", "0s", "0s"]);
    });

    it("declares the columns the table renders (incl. computed duration/status)", async () => {
      const wrapper = await mountDrawer();
      const cols = table(wrapper).props("columns") as any[];
      expect(cols.map((c) => c.id)).toEqual([
        "start_time",
        "end_time",
        "duration",
        "status",
        "error",
      ]);
      expect(cols[0].header).toBe(i18n.global.t("workflow.history.started"));
      // accessorFns drive sorting for the two derived columns
      expect(cols[2].accessorFn(RUNS[0])).toBe(45 * S);
      expect(cols[3].accessorFn(RUNS[0])).toBe("success");
      expect(cols[3].accessorFn(RUNS[1])).toBe("failed");
    });

    it("titles the drawer and subtitles it with the workflow name", async () => {
      const wrapper = await mountDrawer();
      const drawer = wrapper.find(".o-drawer");
      expect(drawer.attributes("data-title")).toBe(
        i18n.global.t("workflow.history.title"),
      );
      expect(drawer.attributes("data-subtitle")).toBe("My Workflow");
    });

    it("passes the side-by-side (seamless) props through to the drawer", async () => {
      const wrapper = await mountDrawer({
        seamless: true,
        width: 40,
        portalTarget: "#canvas",
      });
      const drawer = wrapper.findComponent(ODrawerStub as any);
      expect(drawer.props("seamless")).toBe(true);
      expect(drawer.props("persistent")).toBe(true);
      expect(drawer.props("width")).toBe(40);
      expect(drawer.props("portalTarget")).toBe("#canvas");
    });

    it("defaults the drawer width to 65 when no width is given", async () => {
      const wrapper = await mountDrawer();
      expect(wrapper.findComponent(ODrawerStub as any).props("width")).toBe(65);
    });
  });

  describe("selecting a run", () => {
    it("emits open-run with the run id when a row is clicked", async () => {
      const wrapper = await mountDrawer();
      await wrapper.find('[data-test="row-r2"]').trigger("click");
      expect(wrapper.emitted("open-run")).toEqual([["r2"]]);
    });

    it("ignores a row with no run_id", async () => {
      const wrapper = await mountDrawer();
      table(wrapper).vm.$emit("row-click", { start_time: 1 });
      table(wrapper).vm.$emit("row-click", null);
      await nextTick();
      expect(wrapper.emitted("open-run")).toBeUndefined();
    });
  });

  describe("date range", () => {
    it("re-fetches with the new range and keeps relative mode", async () => {
      const wrapper = await mountDrawer();
      const dt = wrapper.findComponent(DateTimeStub as any);
      expect(dt.props("defaultType")).toBe("relative");
      expect(dt.props("defaultRelativeTime")).toBe("24h");

      dt.vm.$emit("on:date-change", {
        startTime: 111,
        endTime: 222,
        relativeTimePeriod: "6h",
      });
      await flushPromises();

      expect(mockGetHistory).toHaveBeenCalledTimes(2);
      expect(mockGetHistory.mock.calls[1][0]).toMatchObject({
        start_time: 111,
        end_time: 222,
      });
      await nextTick();
      expect(dt.props("defaultType")).toBe("relative");
      expect(dt.props("defaultRelativeTime")).toBe("6h");
    });

    it("switches to absolute mode when the picker sends no relative period", async () => {
      const wrapper = await mountDrawer();
      const dt = wrapper.findComponent(DateTimeStub as any);

      dt.vm.$emit("on:date-change", { startTime: 500, endTime: 900 });
      await flushPromises();

      expect(mockGetHistory.mock.calls[1][0]).toMatchObject({
        start_time: 500,
        end_time: 900,
      });
      expect(dt.props("defaultType")).toBe("absolute");
      expect(dt.props("defaultAbsoluteTime")).toEqual({
        startTime: 500,
        endTime: 900,
      });
    });
  });

  it("emits close when the drawer dismisses itself", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find(".drawer-dismiss").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
