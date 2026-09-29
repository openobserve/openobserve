// @vitest-environment jsdom

import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { ScoreConfigRow } from "../composables/useQualityScoreConfigs";
import QualityScoreConfigsTable from "./QualityScoreConfigsTable.vue";

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "evaluations", query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },
  },
  template: `
    <div>
      <div v-for="row in data" :key="row.configId">
        <slot name="cell-status" :row="row" />
      </div>
    </div>
  `,
});

const OTagStub = defineComponent({
  name: "OTag",
  props: { label: { type: String, default: "" } },
  template: `<span>{{ label }}</span>`,
});

function row(
  overrides: Partial<ScoreConfigRow> & Pick<ScoreConfigRow, "configId" | "name" | "status">,
): ScoreConfigRow {
  return {
    config: { id: overrides.configId, name: overrides.name } as any,
    description: "",
    dataType: "numeric",
    totalScores: 10,
    scopeCounts: { span: 10, trace: 0, session: 0 },
    qualityValue: 0.8,
    qualityFormat: "number",
    qualityLabel: "Average",
    hasThreshold: true,
    thresholdLabel: "≥ 0.70",
    unhealthyCount: 0,
    unhealthyPercent: 0,
    lastUpdatedMs: null,
    statusPriority: 1,
    trendSparkline: [],
    ...overrides,
  };
}

describe("QualityScoreConfigsTable", () => {
  it("shows explicit health labels and threshold context", () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      messages: { en },
    });
    const wrapper = mount(QualityScoreConfigsTable, {
      props: {
        isLoading: false,
        rows: [
          row({
            configId: "unhealthy",
            name: "Unhealthy scorer",
            status: "unhealthy",
            unhealthyCount: 2,
            unhealthyPercent: 20,
            statusPriority: 0,
          }),
          row({
            configId: "healthy",
            name: "Healthy scorer",
            status: "healthy",
          }),
          row({
            configId: "no-threshold",
            name: "Unclassified scorer",
            status: "noThreshold",
            hasThreshold: false,
            thresholdLabel: "",
            unhealthyCount: null,
            unhealthyPercent: null,
            statusPriority: 2,
          }),
          row({
            configId: "no-data",
            name: "Empty scorer",
            status: "noData",
            totalScores: 0,
            unhealthyCount: null,
            unhealthyPercent: null,
            statusPriority: 3,
          }),
        ],
      },
      global: {
        plugins: [i18n],
        stubs: {
          OTable: OTableStub,
          OTag: OTagStub,
          OInput: true,
          OIcon: true,
          OEmptyState: true,
          OSpinner: true,
        },
      },
    });

    expect(wrapper.text()).toContain("Needs attention");
    expect(wrapper.text()).toContain("20.0% below · Healthy if ≥ 0.70");
    expect(wrapper.text()).toContain("Healthy");
    expect(wrapper.text()).toContain("Threshold not set");
    expect(wrapper.text()).toContain("Set a healthy threshold");
    expect(wrapper.text()).toContain("No score data");
    expect(wrapper.text()).toContain("No scores in this window");
  });

  describe("column widths", () => {
    const mountColumns = () => {
      const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });
      const wrapper = mount(QualityScoreConfigsTable, {
        props: { isLoading: false, rows: [] },
        global: {
          plugins: [i18n],
          stubs: { OTable: OTableStub, OInput: true, OIcon: true, OEmptyState: true },
        },
      });
      return wrapper.findComponent(OTableStub).props("columns") as any[];
    };

    it("gives every resizable column a minimum width", () => {
      const missing = mountColumns()
        .filter((column) => !column.minSize)
        .map((column) => column.id);

      expect(missing).toEqual([]);
    });

    it("keeps the Type column wide enough for the Categorical badge", () => {
      const type = mountColumns().find((column) => column.id === "type");

      expect(type.minSize).toBeGreaterThanOrEqual(104);
    });

    it("opens Total Scores wide enough that its header is not truncated", () => {
      const totalScores = mountColumns().find((column) => column.id === "totalScores");

      expect(totalScores.minSize).toBeGreaterThanOrEqual(112);
      expect(totalScores.size).toBeGreaterThanOrEqual(totalScores.minSize);
    });
  });
});
