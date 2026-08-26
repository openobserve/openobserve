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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ExperimentComparison } from "@/services/llm-experiments.service";
import ExperimentComparisonPanel from "./ExperimentComparisonPanel.vue";

const comparison: ExperimentComparison = {
  baselineId: "baseline",
  candidateId: "candidate",
  datasetId: "dataset",
  threshold: 0.05,
  assignmentRule: "Any regression wins; one-sided evidence is neutral.",
  counts: {
    baselineRows: 4,
    candidateRows: 4,
    commonRows: 3,
    regressed: 1,
    improved: 1,
    unchanged: 1,
    inconclusive: 0,
    new: 1,
    missing: 1,
  },
  dimensions: [
    {
      name: "quality",
      kind: "score",
      scoreConfigId: "score-quality",
      scoreConfigName: "quality",
      scoreConfigVersion: "1",
      baseline: 0.8,
      candidate: 0.7,
      delta: -0.1,
      orientedDelta: -0.1,
      gating: true,
      normalized: true,
      baselineSampleCount: 3,
      candidateSampleCount: 2,
      comparableRowCount: 2,
      baselineOnlyRowCount: 1,
      candidateOnlyRowCount: 0,
      assignment: "regressed",
    },
    // Latency rises, which is WORSE — the raw delta is positive but the oriented
    // one is negative. Guards the tint from following the wrong number.
    {
      name: "latency_ms",
      kind: "latency",
      scoreConfigId: null,
      scoreConfigName: null,
      scoreConfigVersion: null,
      baseline: 3,
      candidate: 34,
      delta: 31,
      orientedDelta: -31,
      gating: true,
      normalized: false,
      baselineSampleCount: 1,
      candidateSampleCount: 1,
      comparableRowCount: 1,
      baselineOnlyRowCount: 0,
      candidateOnlyRowCount: 0,
      assignment: "regressed",
    },
  ],
  rows: [
    {
      logicalId: "case-1",
      baselineRowId: "old-row",
      candidateRowId: "new-row",
      bucket: "regressed",
      dimensions: [],
    },
    {
      logicalId: "case-2",
      baselineRowId: null,
      candidateRowId: "fresh-row",
      bucket: "new",
      dimensions: [],
    },
  ],
};

const stubs = {
  global: {
    stubs: {
      KpiCardRow: { template: "<div><slot /></div>" },
      KpiCard: {
        props: ["label", "icon"],
        template:
          '<div v-bind="$attrs" :data-icon="icon">{{ label }}<slot name="value" /><slot name="footer" /></div>',
      },
      OIcon: true,
      OButton: { template: "<button @click=\"$emit('click')\"><slot /></button>" },
      OTag: {
        props: ["label", "variant"],
        template: '<span v-bind="$attrs" :data-variant="variant">{{ label }}</span>',
      },
      OSelect: {
        props: ["modelValue", "options"],
        emits: ["update:modelValue"],
        template: `<select v-bind="$attrs" @change="$emit('update:modelValue', Number($event.target.value))">
            <option v-for="o in options" :key="o.value" :value="o.value" :selected="o.value === modelValue">{{ o.label }}</option>
          </select>`,
      },
      OStatStrip: {
        props: ["items", "selectedKey"],
        emits: ["select"],
        template: `<div data-test="stat-strip" :data-selected="selectedKey ?? ''" :data-order="items.map((i) => i.key).join(',')">
            <button v-for="i in items" :key="i.key" :data-test="i.dataTest" :data-icon="i.icon" :data-bar="i.max ?? ''" @click="$emit('select', i.key)">{{ i.value }}</button>
          </div>`,
      },
      OTable: {
        props: ["data"],
        emits: ["row-click"],
        template: `<div><slot name="subheader" />
            <div v-for="row in data" :key="row.logicalId" data-test="row" @click="$emit('row-click', row, $event)">
              <slot name="cell-bucket" :row="row" />
            </div></div>`,
      },
    },
  },
};

function mountPanel(override: Partial<ExperimentComparison> = {}) {
  return mount(ExperimentComparisonPanel, {
    props: { comparison: { ...comparison, ...override } },
    ...stubs,
  });
}

describe("ExperimentComparisonPanel", () => {
  it("shows honest bucket counts and per-tile coverage", () => {
    const wrapper = mountPanel();

    // 3 common + 1 new + 1 missing — rows in EITHER run, not just the joined ones.
    expect(wrapper.get('[data-test="ai-experiment-count-total"]').text()).toBe("5");
    expect(wrapper.get('[data-test="ai-experiment-count-regressed"]').text()).toBe("1");
  });

  it("keeps each tile to a single caption line", () => {
    const wrapper = mountPanel();
    const latency = wrapper.get('[data-test="ai-experiment-tile-latency"]');

    // Three stacked caption lines is what made these tiles tall; the reference
    // cards carry exactly one.
    expect(latency.text()).toContain("Mean per row, over trials");
    expect(latency.text()).not.toContain("comparable rows");
  });

  it("always renders a cost tile, even when the run recorded no cost", () => {
    const wrapper = mountPanel();

    // The fixture has no cost dimension — the backend only emits one when the
    // executions carried a cost, so the gap has to be visible, not absent.
    expect(wrapper.get('[data-test="ai-experiment-tile-cost"]').text()).toContain("—");
    expect(wrapper.get('[data-test="ai-experiment-tile-latency"]').text()).toContain("34");
  });

  it("orders tiles quality-first with cost last, and never shows a gating tile", () => {
    const wrapper = mountPanel();

    const order = wrapper
      .findAll('[data-test^="ai-experiment-tile-"]')
      .map((w) => w.attributes("data-test"))
      .filter((name) => !/-(delta|warning|unit)$/.test(name ?? ""));

    expect(order).toEqual([
      "ai-experiment-tile-score-dimensions-regressed",
      "ai-experiment-tile-weakest-score-dimension",
      "ai-experiment-tile-latency",
      "ai-experiment-tile-cost",
    ]);
  });

  it("labels a score dimension from comparison metadata and never exposes its raw ID", () => {
    const scored = {
      dimensions: [
        {
          ...comparison.dimensions[0],
          name: "749570578629158502 · v1",
          scoreConfigId: "749570578629158502",
          scoreConfigName: "answer_quality",
          scoreConfigVersion: "1",
        },
      ],
    };

    const named = mountPanel(scored);
    expect(named.get('[data-test="ai-experiment-tile-weakest-score-dimension"]').text()).toContain(
      "answer_quality · v1",
    );

    const unresolved = mountPanel({
      dimensions: [{ ...scored.dimensions[0], scoreConfigName: null }],
    });
    const unresolvedTile = unresolved.get(
      '[data-test="ai-experiment-tile-weakest-score-dimension"]',
    );
    expect(unresolvedTile.text()).toContain("Unknown score dimension");
    expect(unresolvedTile.text()).not.toContain("749570578629158502");
  });

  it("carries the detail page's icons and value formatting", () => {
    const wrapper = mountPanel();

    // Same glyphs the Experiment detail cards use for the same two concepts.
    expect(wrapper.get('[data-test="ai-experiment-tile-latency"]').attributes("data-icon")).toBe(
      "speed",
    );
    expect(wrapper.get('[data-test="ai-experiment-tile-cost"]').attributes("data-icon")).toBe(
      "payments",
    );
    expect(
      wrapper
        .get('[data-test="ai-experiment-tile-score-dimensions-regressed"]')
        .attributes("data-icon"),
    ).toBe("error-outline");

    // Assert the unit SPAN, not the tile text — the label is "Latency (ms)", so
    // a text match would pass with no unit rendered at all.
    expect(wrapper.get('[data-test="ai-experiment-tile-latency-unit"]').text()).toBe("ms");
    expect(wrapper.find('[data-test="ai-experiment-tile-cost-unit"]').exists()).toBe(false);
  });

  it("renders cost as currency on both sides and on the delta", () => {
    const wrapper = mountPanel({
      dimensions: [
        {
          ...comparison.dimensions[1],
          kind: "cost",
          name: "cost",
          baseline: 0.031,
          candidate: 0.006,
          delta: -0.025,
          orientedDelta: 0.025,
        },
      ],
    });
    const cost = wrapper.get('[data-test="ai-experiment-tile-cost"]');

    expect(cost.text()).toContain("$0.031");
    expect(cost.text()).toContain("$0.006");
    expect(wrapper.get('[data-test="ai-experiment-tile-cost-delta"]').text()).toBe("-$0.025");
  });

  it("says what the latency number measures", () => {
    const wrapper = mountPanel();
    const latency = wrapper.get('[data-test="ai-experiment-tile-latency"]');

    // A mean of per-row means over trials, in ms — not a p50.
    expect(latency.text()).toContain("Latency (ms)");
    expect(latency.text()).toContain("Mean per row, over trials");
  });

  it("summarises every score dimension in a fixed number of tiles", () => {
    const wrapper = mountPanel({
      dimensions: [
        ...comparison.dimensions,
        {
          ...comparison.dimensions[0],
          name: "grounded",
          scoreConfigId: "score-grounded",
          scoreConfigName: "grounded",
          assignment: "regressed",
          orientedDelta: -0.4,
        },
        {
          ...comparison.dimensions[0],
          name: "tone",
          scoreConfigId: "score-tone",
          scoreConfigName: "tone",
          assignment: "regressed",
          orientedDelta: -0.2,
        },
      ],
    });

    // Three dimensions regressed — one tile regardless of how many there are.
    expect(
      wrapper.get('[data-test="ai-experiment-tile-score-dimensions-regressed"]').text(),
    ).toContain("3");
    expect(
      wrapper.get('[data-test="ai-experiment-tile-score-dimensions-regressed"]').text(),
    ).toContain("of 3 aggregate score dimensions");

    // The weakest is the most negative ORIENTED delta, not the most negative raw one.
    const weakest = wrapper.get('[data-test="ai-experiment-tile-weakest-score-dimension"]');
    expect(weakest.text()).toContain("grounded");
    expect(weakest.text()).toContain("-0.4");
  });

  it("warns about one-sided coverage on a tile that has it", () => {
    const wrapper = mountPanel({
      dimensions: [
        { ...comparison.dimensions[1], baselineOnlyRowCount: 1, candidateOnlyRowCount: 0 },
      ],
    });

    expect(wrapper.get('[data-test="ai-experiment-tile-latency-warning"]').text()).toContain(
      "1 baseline-only",
    );
  });

  it("tints a delta by its oriented direction, not its sign", () => {
    const wrapper = mountPanel();

    // Latency rose by 31 — a POSITIVE number but a worse result.
    const latency = wrapper.get('[data-test="ai-experiment-tile-latency-delta"]');
    expect(latency.text()).toBe("+31");
    expect(latency.attributes("data-variant")).toBe("error-soft");
  });

  it("gathers every no-verdict bucket behind one tile", async () => {
    const wrapper = mountPanel();

    // 0 inconclusive + 1 new + 1 missing.
    expect(wrapper.get('[data-test="ai-experiment-count-uncompared"]').text()).toBe("2");
    await wrapper.get('[data-test="ai-experiment-count-uncompared"]').trigger("click");

    // Only the `new` row is loaded; the `missing` one is counted, not listed.
    const rows = wrapper.findAll('[data-test="row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("New");
  });

  it("orders outcomes first with Total last, each carrying an icon", () => {
    const wrapper = mountPanel();
    const strip = wrapper.get('[data-test="stat-strip"]');

    expect(strip.attributes("data-order")).toBe("regressed,improved,unchanged,uncompared,total");
    expect(wrapper.get('[data-test="ai-experiment-count-regressed"]').attributes("data-icon")).toBe(
      "trending-down",
    );
    expect(wrapper.get('[data-test="ai-experiment-count-improved"]').attributes("data-icon")).toBe(
      "trending-up",
    );
    // Total summarises rather than filters: no share bar, and it never rings.
    expect(wrapper.get('[data-test="ai-experiment-count-total"]').attributes("data-bar")).toBe("");
  });

  it("clears the filter from Total without selecting it", async () => {
    const wrapper = mountPanel();
    const strip = () => wrapper.get('[data-test="stat-strip"]');
    expect(strip().attributes("data-selected")).toBe("");

    await wrapper.get('[data-test="ai-experiment-count-regressed"]').trigger("click");
    expect(strip().attributes("data-selected")).toBe("regressed");
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(1);

    await wrapper.get('[data-test="ai-experiment-count-total"]').trigger("click");
    expect(strip().attributes("data-selected")).toBe("");
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(2);
  });

  it("filters rows to the picked bucket and back", async () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(2);

    await wrapper.get('[data-test="ai-experiment-count-regressed"]').trigger("click");
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(1);

    // Re-picking the active tile clears the filter rather than trapping the user.
    await wrapper.get('[data-test="ai-experiment-count-regressed"]').trigger("click");
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(2);
  });

  it("offers fixed threshold steps and asks the page to reload on a change", async () => {
    const wrapper = mountPanel();
    const select = wrapper.get('[data-test="ai-experiment-comparison-threshold"]');

    expect(select.findAll("option").map((o) => o.text())).toEqual(["0.02", "0.05", "0.10", "0.15"]);

    await select.setValue("0.15");
    expect(wrapper.emitted("apply-threshold")?.[0]).toEqual([0.15]);
  });

  it("keeps an off-ladder server threshold selectable", () => {
    const wrapper = mountPanel({ threshold: 0.5 });

    expect(
      wrapper
        .get('[data-test="ai-experiment-comparison-threshold"]')
        .findAll("option")
        .map((o) => o.text()),
    ).toEqual(["0.02", "0.05", "0.10", "0.15", "0.50"]);
  });

  it("opens the row from a click anywhere on it, with no action button", async () => {
    const wrapper = mountPanel();
    expect(wrapper.find('[data-test="ai-experiment-comparison-inspect"]').exists()).toBe(false);

    await wrapper.findAll('[data-test="row"]')[0].trigger("click");

    // The second argument is the FILTERED order, so the drawer pages through
    // what the user is actually looking at.
    expect(wrapper.emitted("inspect")?.[0]).toEqual([comparison.rows[0], comparison.rows]);
  });
});
