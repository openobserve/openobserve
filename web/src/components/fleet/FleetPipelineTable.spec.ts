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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import FleetPipelineTable, { type PipelineRow } from "./FleetPipelineTable.vue";

const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  id: "prod/logs",
  fleet: "prod",
  fleetName: "prod",
  fleetMeta: raw("v3 · 24 collectors"),
  name: "logs",
  signal: "logs",
  receivers: "filelog",
  exporters: "otlphttp/o2, kafka/bus",
  inRate: 1200,
  outRate: 2400,
  failedRatio: 0.18,
  queueRatio: 0.9,
  severity: "error",
  ...over,
});

let wrapper: VueWrapper;

async function mountTable(rows: PipelineRow[], selectedId: string | null = null) {
  wrapper = mount(FleetPipelineTable, {
    props: { rows, selectedId },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  await flushPromises();
}

const cell = (id: string) => wrapper.find(`[data-test="fleet-pipeline-table-${id}"]`);

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

describe("FleetPipelineTable", () => {
  it("shows the issue dot first, then fleet and its version and collectors", async () => {
    await mountTable([row()]);
    const dot = cell("prod/logs-dot");
    expect(dot.classes()).toContain("bg-status-error-text");
    const text = wrapper.find("tbody").text();
    expect(text.indexOf("prod")).toBeLessThan(text.indexOf("v3 · 24 collectors"));
  });

  it("gives every column its header", async () => {
    await mountTable([row()]);
    const headers = wrapper.findAll("th").map((h) => h.text());
    for (const label of [
      "Fleet",
      "Pipeline",
      "Receivers",
      "Signal",
      "Exporters",
      "In",
      "Out",
      "Failed",
      "Queue",
    ]) {
      expect(headers.some((h) => h.includes(label))).toBe(true);
    }
  });

  it("shows rates per second in the signal's unit and ratios as percent", async () => {
    await mountTable([row()]);
    const text = wrapper.find("tbody").text();
    expect(text).toContain("1.2K records/s");
    expect(text).toContain("2.4K records/s");
    expect(cell("prod/logs-failed").text()).toBe("18%");
    expect(cell("prod/logs-failed").classes()).toContain("text-status-error-text");
  });

  it("tones a queue at 80 % or more as a warning and leaves a lower one calm", async () => {
    await mountTable([row(), row({ id: "prod/metrics", queueRatio: 0.5, failedRatio: 0 })]);
    expect(cell("prod/logs-queue").classes()).toContain("text-status-warning-text");
    expect(cell("prod/metrics-queue").classes()).not.toContain("text-status-warning-text");
    expect(cell("prod/metrics-failed").classes()).toContain("text-text-muted");
  });

  it("shows a dash, muted, for a rate or ratio without telemetry", async () => {
    await mountTable([row({ inRate: null, failedRatio: null, queueRatio: null })]);
    expect(cell("prod/logs-failed").text()).toBe("—");
    expect(cell("prod/logs-queue").classes()).toContain("text-text-muted");
  });

  it("emits the clicked row and tints the selected one", async () => {
    await mountTable([row(), row({ id: "prod/metrics", name: "metrics" })], "prod/metrics");
    const trs = wrapper.findAll("tbody tr");
    expect(trs[1].classes()).toContain("bg-surface-tint-accent");
    expect(trs[0].classes()).not.toContain("bg-surface-tint-accent");
    await trs[0].trigger("click");
    expect(wrapper.emitted("select")?.[0][0]).toMatchObject({ id: "prod/logs" });
  });
});
