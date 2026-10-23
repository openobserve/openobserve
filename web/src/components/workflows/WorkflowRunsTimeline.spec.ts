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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import WorkflowRunsTimeline, { type TimelineRun } from "./WorkflowRunsTimeline.vue";

const HOUR_US = 3_600_000_000;
const END = 1_792_600_000_000_000;

const run = (id: string, hoursBeforeEnd: number, over: Partial<TimelineRun> = {}): TimelineRun => ({
  id,
  at: END - hoursBeforeEnd * HOUR_US,
  status: "succeeded",
  matched: true,
  ...over,
});

const mountTimeline = (runs: TimelineRun[], end = END) =>
  mount(WorkflowRunsTimeline, {
    props: { runs, start: end - 24 * HOUR_US, end, timezone: "UTC" },
    global: { plugins: [i18n] },
  });

const leftOf = (w: ReturnType<typeof mountTimeline>, id: string) =>
  parseFloat(
    (w.find(`[data-test="workflow-runs-timeline-bar-${id}"]`).element as HTMLElement).style.left,
  );

describe("WorkflowRunsTimeline", () => {
  afterEach(() => vi.useRealTimers());

  it("places each bar by its run time on an axis pinned to the selected range", () => {
    const w = mountTimeline([run("a", 18), run("b", 12), run("c", 6)]);
    expect(leftOf(w, "a")).toBeCloseTo(25, 5);
    expect(leftOf(w, "b")).toBeCloseTo(50, 5);
    expect(leftOf(w, "c")).toBeCloseTo(75, 5);
  });

  it("keeps bars at the same place whatever the filter matches", () => {
    const all = mountTimeline([run("a", 18), run("b", 6)]);
    const one = mountTimeline([run("a", 18, { matched: false }), run("b", 6)]);
    expect(leftOf(one, "a")).toBe(leftOf(all, "a"));
    expect(leftOf(one, "b")).toBe(leftOf(all, "b"));
  });

  it("dims filtered-out runs instead of dropping them", () => {
    const w = mountTimeline([run("in", 3), run("out", 9, { matched: false })]);
    const dimmed = w.find('[data-test="workflow-runs-timeline-bar-out"]').classes();
    expect(dimmed).toEqual(expect.arrayContaining(["opacity-20", "dark:opacity-30"]));
    expect(w.find('[data-test="workflow-runs-timeline-bar-in"]').classes()).not.toContain(
      "opacity-20",
    );
  });

  it("always renders the three legend slots, zeros included, counting matched runs only", () => {
    const w = mountTimeline([
      run("ok", 2),
      run("bad", 3, { status: "failed", matched: false }),
      run("q", 1, { status: "queued" }),
    ]);
    const count = (k: string) => w.find(`[data-test="workflow-runs-timeline-count-${k}"]`).text();
    expect(count("success")).toBe("1");
    expect(count("failed")).toBe("0");
    expect(count("running")).toBe("1");
    expect(w.find('[data-test="workflow-runs-timeline-count-success"]').classes()).toContain(
      "tabular-nums",
    );
  });

  it("renders the axis and legend with no runs at all", () => {
    const w = mountTimeline([]);
    expect(w.find('[data-test="workflow-runs-timeline-track"]').exists()).toBe(true);
    for (const k of ["success", "failed", "running"])
      expect(w.find(`[data-test="workflow-runs-timeline-count-${k}"]`).text()).toBe("0");
    expect(w.find('[data-test="workflow-runs-timeline-start"]').text()).toBe("Oct 20, 16:26");
    expect(w.find('[data-test="workflow-runs-timeline-end"]').text()).toBe("Oct 21, 16:26");
  });

  it("labels ticks back from the range end, ending in now for a live range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(END / 1000);
    const w = mountTimeline([]);
    const ticks = w.findAll('[data-test="workflow-runs-timeline-ticks"] span').map((s) => s.text());
    expect(ticks).toEqual(["−24h", "−18h", "−12h", "−6h", "now"]);
  });
});
