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
import type {
  ExperimentComparison,
  ExperimentComparisonAssignment,
  ExperimentComparisonDimension,
} from "@/services/llm-experiments.service";
import ExperimentComparisonPanel from "./ExperimentComparisonPanel.vue";

function rowDimension(
  name: string,
  kind: "score" | "latency",
  assignment: ExperimentComparisonAssignment,
  gating = true,
): ExperimentComparisonDimension {
  return {
    name,
    kind,
    dataType: kind === "score" ? "numeric" : null,
    scoreConfigId: kind === "score" ? `score-${name}` : null,
    scoreConfigName: kind === "score" ? name : null,
    scoreConfigVersion: kind === "score" ? "1" : null,
    baseline: 0.8,
    candidate: 0.7,
    delta: -0.1,
    orientedDelta: kind === "latency" ? 0.1 : -0.1,
    gating,
    normalized: kind === "score",
    baselineSampleCount: 1,
    candidateSampleCount: 1,
    baselineLabel: null,
    candidateLabel: null,
    baselineDispersion: null,
    candidateDispersion: null,
    withinNoise: false,
    assignment,
  };
}

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
      input: { question: "What changed?", context: ["release", "api"] },
      baselineRowId: "old-row",
      candidateRowId: "new-row",
      bucket: "regressed",
      dimensions: [
        rowDimension("quality", "score", "regressed"),
        // The same row IMPROVED on latency while regressing overall.
        rowDimension("latency_ms", "latency", "improved"),
      ],
    },
    {
      logicalId: "case-2",
      input: "A newly added row",
      baselineRowId: null,
      candidateRowId: "fresh-row",
      bucket: "new",
      // Candidate-only: no baseline to have moved from, so it counts toward
      // no direction at all.
      dimensions: [rowDimension("quality", "score", "candidate_only")],
    },
  ],
};

const stubs = {
  global: {
    stubs: {
      OIcon: true,
      OButton: { template: "<button @click=\"$emit('click')\"><slot /></button>" },
      OTooltip: {
        props: ["content"],
        template: '<span data-test="tooltip" :data-content="content" />',
      },
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
        props: ["data", "columns"],
        emits: ["row-click"],
        template: `<div><slot name="subheader" />
            <template v-for="col in columns" :key="col.id">
              <component :is="col.header" v-if="typeof col.header === 'function'" />
            </template>
            <div v-for="row in data" :key="row.logicalId" data-test="row" @click="$emit('row-click', row, $event)">
              <slot name="cell-input" :row="row" />
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
  it("shows honest bucket counts", () => {
    const wrapper = mountPanel();

    // 3 common + 1 new + 1 missing — rows in EITHER run, not just the joined ones.
    expect(wrapper.get('[data-test="ai-experiment-count-total"]').text()).toBe("5");
    expect(wrapper.get('[data-test="ai-experiment-count-regressed"]').text()).toBe("1");
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

  it("counts how each row moved on the scorer, in its own column header", () => {
    const wrapper = mountPanel();
    const header = wrapper.get(
      '[data-test="ai-experiment-dim-header-score:quality:score-quality:1"]',
    );
    const count = (direction: string) =>
      header
        .get(`[data-test="ai-experiment-dim-${direction}-score:quality:score-quality:1"]`)
        .text();

    // One row regressed. The candidate-only row has no baseline to have moved
    // from, so it is counted toward nothing rather than as unchanged.
    expect(count("regressed")).toBe("1");
    expect(count("unchanged")).toBe("0");
    expect(count("improved")).toBe("0");
  });

  it("counts a dimension by its own assignment, not the row's bucket", () => {
    const wrapper = mountPanel();
    const header = wrapper.get('[data-test="ai-experiment-dim-header-latency:latency_ms::"]');

    // That row is bucketed `regressed` overall while its latency IMPROVED.
    // Reading the bucket instead of the per-dimension assignment would report
    // this column backwards.
    expect(header.get('[data-test="ai-experiment-dim-improved-latency:latency_ms::"]').text()).toBe(
      "1",
    );
    expect(
      header.get('[data-test="ai-experiment-dim-regressed-latency:latency_ms::"]').text(),
    ).toBe("0");
  });

  it("says why a scorer with no comparison policy reports no counts", () => {
    const descriptive = {
      ...comparison,
      dimensions: [
        { ...comparison.dimensions[0], name: "tone", scoreConfigName: "tone", gating: false },
      ],
      rows: [
        {
          ...comparison.rows[0],
          dimensions: [rowDimension("tone", "score", "descriptive", false)],
        },
      ],
    } as ExperimentComparison;
    const wrapper = mountPanel(descriptive);
    const header = wrapper.get('[data-test="ai-experiment-dim-header-score:tone:score-quality:1"]');

    // Rendering nothing here reads as a bug. The server never judges a
    // non-gating dimension, so the absence is a fact about the scorer's setup.
    expect(header.text()).toContain("Not counted");

    // The label states the fact; the reason and the fix have to be reachable,
    // or the column just looks broken.
    const hint = header.get('[data-test="tooltip"]').attributes("data-content");
    expect(hint).toContain("no comparison policy");
    expect(hint).toContain("cannot affect the outcome");
    expect(hint).toContain("direction and a threshold");
    expect(
      header.find('[data-test="ai-experiment-dim-regressed-score:tone:score-quality:1"]').exists(),
    ).toBe(false);
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

  it("shows the dataset input instead of the logical row ID", () => {
    const wrapper = mountPanel();
    const rows = wrapper.findAll('[data-test="row"]');

    expect(rows[0].text()).toContain('{"question":"What changed?","context":["release","api"]}');
    expect(rows[0].text()).not.toContain("case-1");
    expect(rows[1].text()).toContain("A newly added row");
  });
});
