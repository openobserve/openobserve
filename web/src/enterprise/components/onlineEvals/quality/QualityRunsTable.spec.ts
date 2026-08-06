// @vitest-environment jsdom

import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { ScoreConfig } from "@/services/online-evals.service";
import type { QualityRunRow } from "../composables/useQualityRuns";
import QualityRunsTable from "./QualityRunsTable.vue";

const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
    pagination: { type: String, default: "client" },
    sorting: { type: String, default: "client" },
    totalCount: { type: Number, default: 0 },
  },
  template: `
    <div data-test="stub-scores-table" @click="$emit('row-click', data[0])">
      <span data-test="stub-row-count">{{ data.length }}</span>
      <slot v-if="data.length" name="cell-agentName" :row="data[0]" />
    </div>
  `,
});

function run(id: string, overrides: Partial<QualityRunRow> = {}): QualityRunRow {
  return {
    id,
    taskId: `task-${id}`,
    timestampMs: 1,
    evaluatorTraceId: `trace-${id}`,
    evaluatorSpanId: "",
    evalRunId: `run-${id}`,
    status: "success",
    result: 0.9,
    resultDisplay: "0.90",
    reasoning: "Canonical reasoning",
    health: "healthy",
    isUnhealthy: false,
    targetScope: "span",
    targetId: `target-${id}`,
    targetSpanId: `target-${id}`,
    targetTraceId: "",
    targetSessionId: "",
    targetStream: "default",
    targetStreamType: "traces",
    agentName: "Support agent",
    agentId: "support-agent",
    scorerId: "scorer-1",
    jobId: "job-1",
    latencyMs: null,
    errorKind: "",
    ...overrides,
  };
}

function mountTable(config: ScoreConfig) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });
  return mount(QualityRunsTable, {
    props: {
      config,
      rows: [run("healthy"), run("second")],
      counts: { all: 42, unhealthy: 7 },
      activeFilter: "all",
      currentPage: 2,
      pageSize: 10,
      totalCount: 42,
      isLoading: false,
      error: null,
    },
    global: {
      plugins: [i18n],
      stubs: {
        OTable: OTableStub,
        OIcon: true,
      },
    },
  });
}

describe("QualityRunsTable", () => {
  it("uses server pagination and exposes global unhealthy counts", async () => {
    const wrapper = mountTable({
      id: "config-1",
      name: "Answer relevance",
      data_type: "numeric",
      healthy_threshold: { direction: "gte", value: 0.7 },
    } as ScoreConfig);
    const table = wrapper.findComponent(OTableStub);

    expect(table.props("pagination")).toBe("server");
    expect(table.props("sorting")).toBe("none");
    expect(table.props("totalCount")).toBe(42);
    expect(wrapper.get('[data-test="stub-row-count"]').text()).toBe("2");
    expect(wrapper.get('[data-test="quality-runs-filter-unhealthy"]').text()).toContain("7");

    await wrapper.get('[data-test="quality-runs-filter-unhealthy"]').trigger("click");
    expect(wrapper.emitted("filter-change")).toEqual([["unhealthy"]]);

    const reasoningColumn = (table.props("columns") as any[]).find(
      (column) => column.id === "reasoning",
    );
    expect(reasoningColumn.header).toBe("Reasoning");
  });

  it("opens the evaluator trace when the run row is clicked", async () => {
    const wrapper = mountTable({
      id: "config-1",
      name: "Answer relevance",
      data_type: "numeric",
      healthy_threshold: { direction: "gte", value: 0.7 },
    } as ScoreConfig);

    await wrapper.get('[data-test="stub-row-count"]').trigger("click");
    expect(wrapper.emitted("open-run")?.[0]?.[0]).toMatchObject({
      id: "healthy",
      evaluatorTraceId: "trace-healthy",
    });
  });

  it("renders the agent column from the score row", () => {
    const wrapper = mountTable({
      id: "config-1",
      name: "Answer relevance",
      data_type: "numeric",
      healthy_threshold: { direction: "gte", value: 0.7 },
    } as ScoreConfig);
    const table = wrapper.findComponent(OTableStub);

    const agentColumn = (table.props("columns") as any[]).find(
      (column) => column.id === "agentName",
    );
    expect(agentColumn.header).toBe("Agent");
    expect(wrapper.text()).toContain("Support agent");
  });

  it("disables unhealthy filtering until a threshold is configured", () => {
    const wrapper = mountTable({
      id: "config-1",
      name: "Answer relevance",
      data_type: "numeric",
    } as ScoreConfig);

    expect(
      wrapper.get('[data-test="quality-runs-filter-unhealthy"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.get('[data-test="quality-runs-no-threshold"]').text()).toContain(
      "Set a healthy threshold",
    );
  });
});
