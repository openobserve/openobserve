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
    global: {
      plugins: [i18n],
      stubs: {
        ODrawer: {
          props: ["open", "title"],
          template: '<aside v-if="open"><h2>{{ title }}</h2><slot /></aside>',
        },
      },
    },
  });
}

describe("ScorerPromptVariableGuide", () => {
  it("lists the variable names without opening anything", () => {
    const wrapper = mountGuide();

    for (const variable of ["input", "output", "statistics", "spans", "steps"]) {
      expect(
        wrapper.find(`[data-test="scorer-form-prompt-variable-chip-${variable}"]`).exists(),
      ).toBe(true);
    }
    // The per-scope matrix is reference material — it lives behind Learn more.
    expect(wrapper.find('[data-test="scorer-form-prompt-variable-detail"]').exists()).toBe(false);
  });

  it("describes all five prompt variables and their scope behavior", async () => {
    const wrapper = mountGuide();
    await wrapper.get('[data-test="scorer-form-prompt-variable-learn-more"]').trigger("click");

    expect(wrapper.find('[data-test="scorer-form-prompt-variable-table"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Prompt variable");
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Span");
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Trace");
    expect(wrapper.find('[data-test="o2-table"]').text()).toContain("Session");
    expect(wrapper.find('[data-test="scorer-form-prompt-variable-guide"]').text()).toContain(
      "Available Prompt Variables",
    );
    expect(wrapper.find('[data-test="scorer-form-prompt-variable-inputOutput"]').text()).toContain(
      "{{ input }}",
    );
    expect(wrapper.find('[data-test="scorer-form-prompt-variable-inputOutput"]').text()).toContain(
      "{{ output }}",
    );
    const tableText = wrapper.find('[data-test="o2-table"]').text();
    expect(tableText).toContain("{{ statistics }}");
    expect(tableText).toContain("Trace metrics:");
    expect(tableText).toContain("Session metrics:");
    expect(tableText).toContain("{{ steps }}");
    expect(tableText).toContain("Spans in time order");
    expect(tableText).toContain("conversation turns");
    expect(tableText).toContain("{{ spans }}");
    expect(tableText).toContain("Span Selector required");

    // Design-doc vocabulary must not reach the user.
    const guideText = wrapper.find('[data-test="scorer-form-prompt-variable-guide"]').text();
    for (const jargon of ["View Component", "bounded", "The design defines"]) {
      expect(guideText).not.toContain(jargon);
    }
  });

  it("explains that array variables do not support indexed template access", async () => {
    const wrapper = mountGuide();
    await wrapper.get('[data-test="scorer-form-prompt-variable-learn-more"]').trigger("click");
    const indexNote = wrapper.find('[data-test="scorer-form-prompt-variable-index-note"]').text();

    expect(indexNote).toContain("{{ spans }}");
    expect(indexNote).toContain("{{ steps }}");
    expect(indexNote).toContain("{{ spans[0] }}");
    expect(indexNote).toContain("not supported");
  });
});
