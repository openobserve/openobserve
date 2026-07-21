// @vitest-environment jsdom

import { shallowMount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import { createEmptyJobFilterGroup } from "../../utils/jobFilter";
import JobFilterBuilder from "./JobFilterBuilder.vue";

function mountBuilder(purpose?: "filter" | "endSignal") {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return shallowMount(JobFilterBuilder, {
    props: {
      targetScope: "trace",
      group: createEmptyJobFilterGroup(),
      ...(purpose ? { purpose } : {}),
    },
    global: {
      plugins: [i18n],
    },
  });
}

describe("JobFilterBuilder", () => {
  it("keeps the eligibility filter copy by default", () => {
    const wrapper = mountBuilder();
    expect(
      wrapper.get('[data-test="job-condition-builder-title"]').text(),
    ).toBe("Filter condition");
    expect(
      wrapper.get('[data-test="job-condition-builder-hint"]').text(),
    ).toContain("A trace becomes eligible");
  });

  it("shows End Signal copy when used by completion settings", () => {
    const wrapper = mountBuilder("endSignal");
    expect(
      wrapper.get('[data-test="job-condition-builder-title"]').text(),
    ).toBe("End signal (optional)");
    expect(
      wrapper.get('[data-test="job-condition-builder-hint"]').text(),
    ).toContain("closes the trace immediately");
  });
});
