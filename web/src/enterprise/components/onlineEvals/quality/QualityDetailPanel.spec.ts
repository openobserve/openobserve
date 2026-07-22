// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { ScoreConfig } from "@/services/online-evals.service";
import QualityDetailPanel from "./QualityDetailPanel.vue";

function mountPanel(scope: "all" | "span" | "trace" | "session" = "all") {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(QualityDetailPanel, {
    props: {
      config: {
        id: "config-1",
        name: "Coherence",
      } as ScoreConfig,
      dataType: "numeric",
      kpis: [],
      hasScores: false,
      isLoading: false,
      numericTrend: [],
      numericDistribution: [],
      numericThreshold: null,
      numericRange: null,
      booleanAgg: null,
      booleanTrend: [],
      booleanTrendSeries: [],
      categoricalRows: [],
      scope,
      scopeCounts: { span: 1200, trace: 50, session: 5 },
      runs: [],
      runsCounts: { all: 0, unhealthy: null },
      runsFilter: "all",
      runsCurrentPage: 1,
      runsPageSize: 10,
      runsTotalCount: 0,
      runsLoading: false,
      runsError: null,
    },
    global: {
      plugins: [i18n],
      stubs: {
        OEmptyState: true,
        OSpinner: true,
        QualityBooleanTrendChart: true,
        QualityRunsTable: true,
      },
    },
  });
}

describe("QualityDetailPanel", () => {
  it("shows all scope counts and emits a diagnostic scope change", async () => {
    const wrapper = mountPanel();

    expect(wrapper.find('[data-test="quality-detail-scope-all"]').text()).toBe(
      "All1.3k",
    );
    expect(wrapper.find('[data-test="quality-detail-scope-span"]').text()).toBe(
      "Span1.2k",
    );
    expect(
      wrapper.find('[data-test="quality-detail-scope-trace"]').text(),
    ).toBe("Trace50");
    expect(
      wrapper.find('[data-test="quality-detail-scope-session"]').text(),
    ).toBe("Session5");

    await wrapper
      .find('[data-test="quality-detail-scope-trace"]')
      .trigger("click");

    expect(wrapper.emitted("update:scope")).toEqual([["trace"]]);
  });

  it("exposes the selected scope through aria-pressed", () => {
    const wrapper = mountPanel("session");

    expect(
      wrapper
        .find('[data-test="quality-detail-scope-session"]')
        .attributes("aria-pressed"),
    ).toBe("true");
    expect(
      wrapper
        .find('[data-test="quality-detail-scope-all"]')
        .attributes("aria-pressed"),
    ).toBe("false");
    expect(wrapper.find("o-empty-state-stub").attributes("title")).toBe(
      "No Session scores in this window",
    );
  });

  it("labels boolean trends according to whether healthy_value is configured", async () => {
    const wrapper = mountPanel();
    const point = { t: 1, passRate: 75, total: 4 };

    await wrapper.setProps({
      dataType: "boolean",
      hasScores: true,
      booleanTrend: [point],
      booleanTrendSeries: [
        { id: "__default__", label: "True rate", points: [point] },
      ],
    });

    expect(wrapper.text()).toContain("True rate over time");
    expect(
      wrapper
        .findComponent({ name: "QualityBooleanTrendChart" })
        .props("legendPassRate"),
    ).toBe("True rate");

    await wrapper.setProps({
      config: {
        id: "config-1",
        name: "Coherence",
        healthy_threshold: { healthy_value: false },
      } as ScoreConfig,
    });

    expect(wrapper.text()).toContain("Healthy rate over time");
    expect(
      wrapper
        .findComponent({ name: "QualityBooleanTrendChart" })
        .props("legendPassRate"),
    ).toBe("Healthy rate");
  });
});
