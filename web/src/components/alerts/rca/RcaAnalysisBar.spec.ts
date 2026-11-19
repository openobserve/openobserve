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

import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import RcaAnalysisBar from "./RcaAnalysisBar.vue";
import { RCA_T0, rcaRunItem, sec } from "@/test/unit/fixtures/rcaThread";

// ODropdown renders its menu only when open; the stubs render every item so the
// menu contents can be asserted and selected directly.
const stubs = {
  OPopover: {
    props: ["open"],
    template:
      "<div data-test='popover-stub' :data-open='open'><slot name='trigger' /><slot v-if='open' /></div>",
  },
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownGroup: {
    props: ["label"],
    template: "<div data-test='rca-history-group'><span>{{ label }}</span><slot /></div>",
  },
  ODropdownItem: {
    props: {
      disabled: { type: Boolean, default: false },
      description: { type: String, default: "" },
    },
    emits: ["select"],
    template:
      "<div role='menuitem' :data-disabled='disabled' @click=\"!disabled && $emit('select')\"><slot /><small>{{ description }}</small></div>",
  },
};

// Newest first: a live re-run, a failed run with no record, a cancelled run with a
// partial record, and the first completed run.
const RUNS = [
  rcaRunItem({
    run_id: "run-4",
    trigger: "reanalyze",
    started_by: "j.okafor@acme.io",
    state: "running",
    started_at: RCA_T0 + sec(3600),
    ended_at: null,
  }),
  rcaRunItem({
    run_id: "run-3",
    trigger: "manual",
    started_by: "a.rao@acme.io",
    state: "failed",
    started_at: RCA_T0 + sec(1800),
    has_record: false,
  }),
  rcaRunItem({
    run_id: "run-2",
    trigger: "oncall_page",
    state: "cancelled",
    started_at: RCA_T0 + sec(900),
    has_record: true,
  }),
  rcaRunItem({ run_id: "run-1", trigger: "auto_new_incident", state: "completed" }),
];

const mountBar = (props: Record<string, unknown> = {}) =>
  mount(RcaAnalysisBar, {
    props: {
      runs: RUNS,
      latestRunId: "run-4",
      selectedRunId: "run-4",
      live: true,
      subtitle: "Re-analyze by j.okafor · started 7s ago",
      hasReport: true,
      hasThread: true,
      ...props,
    },
    global: { plugins: [i18n], stubs },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

describe("RcaAnalysisBar (contract E5)", () => {
  describe("report variant", () => {
    it("shows Copy report and Download as Markdown as buttons, and no analysis actions", async () => {
      const wrapper = mountBar({ variant: "report", live: false, selectedRunId: "run-4" });

      for (const id of ["rca-reanalyze-btn", "rca-ask-btn", "rca-more-btn", "rca-cancel-btn"]) {
        expect(byTest(wrapper, id).exists()).toBe(false);
      }
      await byTest(wrapper, "rca-report-copy-btn").trigger("click");
      await byTest(wrapper, "rca-report-download-btn").trigger("click");
      expect(wrapper.emitted("copy-report")).toHaveLength(1);
      expect(wrapper.emitted("download-report")).toHaveLength(1);
    });

    it("previews the copied Markdown in a popover that floats over the page", async () => {
      const wrapper = mountBar({
        variant: "report",
        live: false,
        copyPreview: "# Title · incident analysis\nLink: x",
      });

      const preview = byTest(wrapper, "rca-copy-preview");
      expect(preview.text()).toContain("Copied to clipboard");
      expect(preview.text()).toContain(
        "Preview of the copied Markdown · Download as Markdown saves the same text",
      );
      expect(byTest(wrapper, "rca-copy-preview-text").text()).toBe(
        "# Title · incident analysis\nLink: x",
      );
      await byTest(wrapper, "rca-copy-preview-close").trigger("click");
      expect(wrapper.emitted("close-preview")).toHaveLength(1);
      expect(
        byTest(mountBar({ variant: "report", live: false }), "rca-copy-preview").exists(),
      ).toBe(false);
    });

    it("hides the report buttons while the shown run is live", () => {
      const wrapper = mountBar({ variant: "report" });

      expect(byTest(wrapper, "rca-report-copy-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-run-selector").exists()).toBe(true);
    });
  });

  describe("run selector", () => {
    it("lists the history runs, newest first, with their trigger labels", () => {
      const wrapper = mountBar();

      const items = wrapper.findAll('[data-test^="rca-history-item-"]');
      expect(items.map((item) => item.find("span").text())).toEqual([
        "Run 4 · live",
        "Run 3 · Oct 9, 09:23 UTC",
        "Run 2 · Oct 9, 09:08 UTC",
        "Run 1 · Oct 9, 08:53 UTC",
      ]);
      expect(items.map((item) => item.find("small").text())).toEqual([
        "Re-analyze by j.okafor",
        "Analysis by a.rao · Failed",
        "On-call page · Cancelled",
        "Auto on incident open",
      ]);
      expect(byTest(wrapper, "rca-history-group").text()).toContain("Report history");
      expect(byTest(wrapper, "rca-run-selector-label").text()).toBe("Run 4 · live");
    });

    it("runs with something to show are selectable: completed, recorded, and the latest", async () => {
      const wrapper = mountBar();
      const items = wrapper.findAll('[data-test^="rca-history-item-"]');

      expect(items.map((item) => item.attributes("data-disabled"))).toEqual([
        "false",
        "true",
        "false",
        "false",
      ]);

      for (const item of items) await item.trigger("click");
      // The latest run selects null (follow the latest); the cancelled run reopens its
      // partial record; the failed run with no record emits nothing.
      expect(wrapper.emitted("select-run")).toEqual([[null], ["run-2"], ["run-1"]]);
    });

    it("labels a picked earlier run as the selection", () => {
      const wrapper = mountBar({ selectedRunId: "run-1", live: false });

      expect(byTest(wrapper, "rca-run-selector-label").text()).toBe("Run 1 · Oct 9, 08:53 UTC");
    });
  });

  it("shows the subtitle", () => {
    const wrapper = mountBar();

    expect(byTest(wrapper, "rca-analysis-subtitle").text()).toBe(
      "Re-analyze by j.okafor · started 7s ago",
    );
  });

  it("while live offers Cancel run instead of Re-analyze", async () => {
    const wrapper = mountBar();

    expect(byTest(wrapper, "rca-reanalyze-btn").exists()).toBe(false);
    expect(byTest(wrapper, "rca-cancel-btn").text()).toBe("Cancel run");
    await byTest(wrapper, "rca-cancel-btn").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("when not live, Re-analyze is one button that emits reanalyze (the dialog picks the mode)", async () => {
    const wrapper = mountBar({ live: false, latestRunId: "run-1", selectedRunId: "run-1" });

    expect(byTest(wrapper, "rca-cancel-btn").exists()).toBe(false);
    expect(byTest(wrapper, "rca-reanalyze-btn").text()).toBe("Re-analyze");
    expect(byTest(wrapper, "rca-reanalyze-fresh").exists()).toBe(false);
    await byTest(wrapper, "rca-reanalyze-btn").trigger("click");
    expect(wrapper.emitted("reanalyze")).toEqual([[]]);
  });

  describe("J5: Ask about this analysis", () => {
    it("not live with canAsk: shown before Re-analyze and emits ask", async () => {
      const wrapper = mountBar({ live: false, canAsk: true });
      const ask = byTest(wrapper, "rca-ask-btn");

      expect(ask.text()).toBe("Ask about this analysis");
      const html = wrapper.html();
      expect(html.indexOf('data-test="rca-ask-btn"')).toBeLessThan(
        html.indexOf('data-test="rca-reanalyze-btn"'),
      );
      await ask.trigger("click");
      expect(wrapper.emitted("ask")).toHaveLength(1);
    });

    it("hidden on a live run even with canAsk", () => {
      const wrapper = mountBar({ live: true, canAsk: true });

      expect(byTest(wrapper, "rca-ask-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-cancel-btn").exists()).toBe(true);
    });

    it("hidden without canAsk; Re-analyze stays", () => {
      const wrapper = mountBar({ live: false });

      expect(byTest(wrapper, "rca-ask-btn").exists()).toBe(false);
      expect(byTest(wrapper, "rca-reanalyze-btn").exists()).toBe(true);
    });
  });

  it("J9: Re-analyze is disabled while a resume is in flight", () => {
    const wrapper = mountBar({ live: false, resuming: true });

    expect(byTest(wrapper, "rca-reanalyze-btn").attributes("disabled")).toBeDefined();
  });

  describe("⋯ menu", () => {
    it("has Copy report, Download as Markdown and Copy thread, and emits each", async () => {
      const wrapper = mountBar();

      const ids = ["rca-copy-btn", "rca-download-btn", "rca-copy-thread-btn"];
      expect(ids.map((id) => byTest(wrapper, id).text())).toEqual([
        "Copy report",
        "Download as Markdown",
        "Copy thread",
      ]);
      for (const id of ids) await byTest(wrapper, id).trigger("click");
      expect(wrapper.emitted("copy-report")).toHaveLength(1);
      expect(wrapper.emitted("download-report")).toHaveLength(1);
      expect(wrapper.emitted("copy-thread")).toHaveLength(1);
    });

    it("disables the report items without a report and Copy thread without a thread", () => {
      const wrapper = mountBar({ hasReport: false, hasThread: false });

      for (const id of ["rca-copy-btn", "rca-download-btn", "rca-copy-thread-btn"]) {
        expect(byTest(wrapper, id).attributes("data-disabled")).toBe("true");
      }
    });
  });
});

describe("RcaAnalysisBar: U8 region and P16 skipped-run notes", () => {
  // Renders the item's side slots and its attributes, so tags and notes can be read.
  const richStubs = {
    ...stubs,
    ODropdownItem: {
      props: {
        disabled: { type: Boolean, default: false },
        description: { type: String, default: "" },
      },
      emits: ["select"],
      template:
        "<div role='menuitem' :data-disabled='disabled' @click=\"!disabled && $emit('select')\"><slot name='icon-left' /><b><slot /></b><small>{{ description }}</small><slot name='icon-right' /></div>",
    },
  };

  // Run 4 is newer than run 3, the run both skipped pages point at.
  const REGION_RUNS = [
    rcaRunItem({
      run_id: "r4",
      run_number: 4,
      trigger: "reanalyze",
      started_by: "priya@acme.io",
      started_at: RCA_T0 + sec(3000),
      serving_region: "us-east-1",
    }),
    rcaRunItem({
      run_id: "r3",
      run_number: 3,
      trigger: "oncall_page",
      started_at: RCA_T0 + sec(1000),
      serving_region: "us-east-1",
    }),
    rcaRunItem({ run_id: "r1", run_number: 1, started_at: RCA_T0, report_format: "v1" }),
  ];
  const SKIPPED = [
    {
      at_us: RCA_T0 + sec(1500),
      reason: "in_flight" as const,
      covering_run_id: "r3",
      covering_run_number: 3,
    },
    {
      at_us: RCA_T0 + sec(2000),
      reason: "cooling_down" as const,
      covering_run_id: "r3",
      covering_run_number: 3,
      retry_after_us: RCA_T0 + sec(2800),
      cooldown_us: sec(1800),
    },
  ];

  const mountRegionBar = (props: Record<string, unknown> = {}) =>
    mount(RcaAnalysisBar, {
      props: {
        runs: REGION_RUNS,
        latestRunId: "r4",
        selectedRunId: "r4",
        live: false,
        subtitle: "Re-analyze by priya",
        hasReport: true,
        hasThread: true,
        skippedPages: SKIPPED,
        ...props,
      },
      global: { plugins: [i18n], stubs: richStubs },
    });

  it("tags every history row with its own region, and a legacy run as unknown", () => {
    const wrapper = mountRegionBar();
    const tag = (idx: number) => byTest(wrapper, `rca-history-item-${idx}-region`);

    expect(tag(0).text()).toBe("Analyzed in us-east-1");
    expect(tag(0).attributes("data-region-state")).toBe("known");
    expect(tag(1).text()).toBe("Analyzed in us-east-1");
    expect(tag(2).text()).toBe("analysis region unknown");
    expect(tag(2).attributes("data-region-state")).toBe("unknown");
  });

  it("reads Analyzing in on the live run's row", () => {
    const wrapper = mountRegionBar({ live: true });

    expect(byTest(wrapper, "rca-history-item-0-region").text()).toBe("Analyzing in us-east-1");
  });

  it("claims no unknown region while the run list failed, but keeps the known ones", () => {
    const wrapper = mountRegionBar({ listStatus: "error" });

    expect(byTest(wrapper, "rca-history-item-0-region").text()).toBe("Analyzed in us-east-1");
    expect(byTest(wrapper, "rca-history-item-2-region").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("analysis region unknown");
  });

  it("numbers runs by their stable run_number, not their position", () => {
    const wrapper = mountRegionBar();

    expect(byTest(wrapper, "rca-history-item-2").find("b").text()).toBe("Run 1 · Oct 9, 08:53 UTC");
  });

  it("places the skipped pages in time order between the runs they fell between", () => {
    const wrapper = mountRegionBar();
    const order = byTest(wrapper, "rca-history-group")
      .findAll('[role="menuitem"]')
      .map((item) => item.attributes("data-test"));

    expect(order).toEqual([
      "rca-history-item-0",
      "rca-history-skipped-1",
      "rca-history-skipped-0",
      "rca-history-item-1",
      "rca-history-item-2",
    ]);
  });

  it("words both refusal reasons with the covering run's number and the cooldown", () => {
    const wrapper = mountRegionBar();
    const inFlight = byTest(wrapper, "rca-history-skipped-0");
    const cooling = byTest(wrapper, "rca-history-skipped-1");

    expect(inFlight.find("b").text()).toBe("On-call page at 09:18 UTC: no new run");
    expect(inFlight.find("small").text()).toBe("Run 3 was already running");
    expect(cooling.find("small").text()).toBe("Run 3 ran within the 30m cooldown");
    expect(byTest(wrapper, "rca-history-skipped-1-link").text()).toBe("Open run 3");
    expect(inFlight.attributes("data-covering-run-id")).toBe("r3");
  });

  it("opens the exact covering run, never the latest, while a newer run exists", async () => {
    const wrapper = mountRegionBar();

    await byTest(wrapper, "rca-history-skipped-0").trigger("click");
    await byTest(wrapper, "rca-history-skipped-1-link").trigger("click");

    expect(wrapper.emitted("select-run")).toEqual([["r3"], ["r3"]]);
  });

  it("keeps a note whose covering run is gone, disabled and not selectable", async () => {
    const wrapper = mountRegionBar({ goneRunIds: ["r3"] });
    const note = byTest(wrapper, "rca-history-skipped-0");

    expect(note.attributes("data-disabled")).toBe("true");
    expect(note.find("small").text()).toBe("Run 3 was already running · run no longer kept");
    expect(byTest(wrapper, "rca-history-skipped-0-link").attributes("aria-disabled")).toBe("true");
    await note.trigger("click");
    expect(wrapper.emitted("select-run")).toBeUndefined();
  });
});
