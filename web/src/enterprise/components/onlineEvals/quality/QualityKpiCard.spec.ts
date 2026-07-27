// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { KpiCard } from "../composables/useQualityData";
import QualityKpiCard from "./QualityKpiCard.vue";

function mountCard(kpi: KpiCard) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(QualityKpiCard, {
    props: { kpi, delta: null },
    global: {
      plugins: [i18n],
      stubs: { KpiSparkline: true },
    },
  });
}

describe("QualityKpiCard", () => {
  it("shows a compact target-scope breakdown for score results", () => {
    const wrapper = mountCard({
      id: "scoreResults",
      value: 1255,
      prevValue: 1000,
      sparkline: [],
      healthyDirection: "neutral",
      format: "count",
      scopeCounts: { span: 1200, trace: 50, session: 5 },
    });

    expect(wrapper.text()).toContain("Score Results");
    expect(wrapper.find('[data-test="quality-kpi-scope-span"]').text()).toBe("Span1.2k");
    expect(wrapper.find('[data-test="quality-kpi-scope-trace"]').text()).toBe("Trace50");
    expect(wrapper.find('[data-test="quality-kpi-scope-session"]').text()).toBe("Session5");
  });

  it("uses operational scorer copy without a scope breakdown", () => {
    const wrapper = mountCard({
      id: "scorerSuccess",
      value: 98.4,
      prevValue: 97,
      sparkline: [],
      healthyDirection: "up",
      format: "percent",
    });

    expect(wrapper.text()).toContain("Scorer Success");
    expect(wrapper.find('[data-test="quality-kpi-scope-breakdown"]').exists()).toBe(false);
  });
});
