// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { EvalTargetScope, Scorer } from "@/services/online-evals.service";
import JobInputMapping from "./JobInputMapping.vue";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

const scorer = {
  id: "scorer-1",
  entity_id: "scorer-1",
  name: "Trajectory quality",
  version: 1,
  template:
    "Review {{ input }}, {{ output }}, {{ statistics }}, {{ spans }}, {{ steps }}, and {{ custom }}.",
  variables: ["input", "output", "statistics", "spans", "steps", "custom"],
} as Scorer;

function mountMapping(targetScope: EvalTargetScope) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(JobInputMapping, {
    props: {
      targetScope,
      selectedScorers: [scorer],
      inputMappings: {
        "scorer-1": {
          input: "{{custom_input}}",
          output: "{{custom_output}}",
          statistics: "{{custom_statistics}}",
          spans: "{{custom_spans}}",
          steps: "{{custom_steps}}",
          custom: "{{custom_field}}",
        },
      },
    },
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

describe("JobInputMapping", () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockClear();
  });

  it("opens the system-provided variables table from Learn more", async () => {
    const wrapper = mountMapping("trace");

    expect(
      wrapper.find('[data-test="job-input-mapping-system-variables"]').exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-test="job-input-mapping-system-variables-table"]')
        .exists(),
    ).toBe(false);

    const learnMore = wrapper.get(
      '[data-test="job-input-mapping-system-variables-learn-more"]',
    );
    expect(learnMore.text()).toContain("Learn more");
    await learnMore.trigger("click");

    expect(
      wrapper
        .get('[data-test="job-input-mapping-system-variables-drawer"]')
        .text(),
    ).toContain("System-provided variables for Trace evaluation");
    const systemVariablesTable = wrapper.find(
      '[data-test="job-input-mapping-system-variables-table"]',
    );
    expect(systemVariablesTable.exists()).toBe(true);
    expect(systemVariablesTable.text()).toContain("Prompt variable");
    expect(systemVariablesTable.text()).toContain("Source");
    expect(systemVariablesTable.text()).toContain("Value supplied");
    expect(systemVariablesTable.text()).toContain("Span Selector required");
    for (const variable of ["input", "output", "statistics", "steps"]) {
      expect(
        wrapper
          .find(
            `[data-test="job-input-mapping-system-provided-scorer-1-${variable}"]`,
          )
          .text(),
      ).toContain("System provided");
    }
    expect(
      wrapper
        .find('[data-test="job-input-mapping-system-provided-scorer-1-spans"]')
        .text(),
    ).toContain("Span Selector required");
    expect(
      wrapper
        .find('[data-test="job-input-mapping-input-scorer-1-custom"]')
        .exists(),
    ).toBe(true);
  });

  it("only marks statistics and steps as system provided for session jobs", () => {
    const wrapper = mountMapping("session");

    for (const variable of ["statistics", "steps"]) {
      expect(
        wrapper
          .find(
            `[data-test="job-input-mapping-system-provided-scorer-1-${variable}"]`,
          )
          .text(),
      ).toContain("System provided");
    }
    for (const variable of ["input", "output", "spans", "custom"]) {
      expect(
        wrapper
          .find(`[data-test="job-input-mapping-input-scorer-1-${variable}"]`)
          .exists(),
      ).toBe(true);
    }
  });

  it("keeps all scorer variables editable for span jobs", () => {
    const wrapper = mountMapping("span");

    expect(
      wrapper.find('[data-test="job-input-mapping-system-variables"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .find('[data-test="job-input-mapping-input-scorer-1-statistics"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-test="job-input-mapping-input-scorer-1-steps"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-test="job-input-mapping-input-scorer-1-spans"]')
        .exists(),
    ).toBe(true);
  });

  it("copies the mapping expression from an editable variable", async () => {
    const wrapper = mountMapping("span");

    await wrapper
      .get('[data-test="job-input-mapping-copy-scorer-1-input"]')
      .trigger("click");

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("{{custom_input}}", {
      successMessage: "Copied to clipboard",
    });
  });

  it("hides the selector dropdown until a selector exists", async () => {
    const wrapper = mountMapping("trace");

    expect(
      wrapper.find('[data-test="span-selector-binding-scorer-1"]').exists(),
    ).toBe(false);
    const createButton = wrapper.get(
      '[data-test="span-selector-create-scorer-1"]',
    );
    expect(createButton.text()).toContain("Create for scorer");
    expect(createButton.attributes("title")).toBe(
      "Create a Span Selector for this scorer",
    );

    await wrapper.setProps({
      spanSelectors: [
        {
          id: "selector-1",
          name: "Tool spans",
          filterCondition: { type: "all" },
          fieldMode: "default",
          fields: [],
          maximumSpans: 5,
        },
      ],
    });

    expect(
      wrapper.find('[data-test="span-selector-binding-scorer-1"]').exists(),
    ).toBe(true);
  });
});
