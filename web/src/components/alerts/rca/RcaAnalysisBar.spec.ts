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
