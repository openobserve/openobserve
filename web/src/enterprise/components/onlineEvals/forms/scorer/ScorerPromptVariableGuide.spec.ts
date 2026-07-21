// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import ScorerPromptVariableGuide from "./ScorerPromptVariableGuide.vue";

function mountGuide() {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(ScorerPromptVariableGuide, {
    global: { plugins: [i18n] },
  });
}

describe("ScorerPromptVariableGuide", () => {
  it("describes all five View Component variables and their scope behavior", () => {
    const wrapper = mountGuide();

    expect(
      wrapper.find('[data-test="scorer-form-prompt-variable-table"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain(
      "Prompt variable",
    );
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Span");
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Trace");
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Session");
    expect(
      wrapper.find('[data-test="scorer-form-prompt-variable-guide"]').text(),
    ).toContain("Evaluation View variables");
    expect(
      wrapper
        .find('[data-test="scorer-form-prompt-variable-inputOutput"]')
        .text(),
    ).toContain("{{ input }}");
    expect(
      wrapper
        .find('[data-test="scorer-form-prompt-variable-inputOutput"]')
        .text(),
    ).toContain("{{ output }}");
    const tableText = wrapper.find('[data-test="o2-table"]').text();
    expect(tableText).toContain("{{ statistics }}");
    expect(tableText).toContain("Bounded trace metrics");
    expect(tableText).toContain("Bounded session metrics");
    expect(tableText).toContain("{{ steps }}");
    expect(tableText).toContain("time-ordered span trajectory");
    expect(tableText).toContain("conversation turns");
    expect(tableText).toContain("{{ spans }}");
    expect(tableText).toContain("Span Selector required");
  });

  it("explains that array variables do not support indexed template access", () => {
    const indexNote = mountGuide()
      .find('[data-test="scorer-form-prompt-variable-index-note"]')
      .text();

    expect(indexNote).toContain("{{ spans }}");
    expect(indexNote).toContain("{{ steps }}");
    expect(indexNote).toContain("{{ spans[0] }}");
    expect(indexNote).toContain("not supported");
  });
});
