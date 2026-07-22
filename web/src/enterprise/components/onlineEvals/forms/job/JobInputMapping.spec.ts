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

// A scorer whose every variable is supplied by the system on trace scope, so
// there is genuinely nothing for the user to map.
const autoFilledScorer = {
  id: "scorer-2",
  entity_id: "scorer-2",
  name: "Faithfulness",
  version: 2,
  template: "Judge {{ input }} against {{ output }}.",
  variables: ["input", "output"],
} as Scorer;

function mountMapping(
  targetScope: EvalTargetScope,
  scorers: Scorer[] = [scorer],
) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(JobInputMapping, {
    props: {
      targetScope,
      selectedScorers: scorers,
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
      wrapper.find('[data-test="job-input-mapping-system-variables-learn-more"]').exists(),
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
    ).toContain("Trace Variables");
    const systemVariablesTable = wrapper.find(
      '[data-test="job-input-mapping-system-variables-table"]',
    );
    expect(systemVariablesTable.exists()).toBe(true);
    expect(systemVariablesTable.text()).toContain("Prompt variable");
    expect(systemVariablesTable.text()).toContain("Source");
    expect(systemVariablesTable.text()).toContain("Value supplied");
    expect(systemVariablesTable.text()).toContain("Span Selector required");
    for (const variable of ["input", "output", "statistics", "steps"]) {
      // Auto-filled rows are identified by the row itself, not by badge copy:
      // they render a source description and no mapping input.
      const row = wrapper.find(
        `[data-test="job-input-mapping-system-provided-scorer-1-${variable}"]`,
      );
      expect(row.exists()).toBe(true);
      expect(row.text().length).toBeGreaterThan(0);
      expect(
        wrapper
          .find(`[data-test="job-input-mapping-input-scorer-1-${variable}"]`)
          .exists(),
      ).toBe(false);
    }
    // The Span Selector is bound once per scorer (card level), not inside the
    // {{ spans }} row — the backend requires one for EVERY trace scorer.
    expect(
      wrapper
        .find('[data-test="job-input-mapping-span-selector-scorer-1"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-test="job-input-mapping-input-scorer-1-custom"]')
        .exists(),
    ).toBe(true);
  });

  it("only marks statistics and steps as system provided for session jobs", () => {
    const wrapper = mountMapping("session");

    for (const variable of ["statistics", "steps"]) {
      // Auto-filled rows are identified by the row itself, not by badge copy:
      // they render a source description and no mapping input.
      const row = wrapper.find(
        `[data-test="job-input-mapping-system-provided-scorer-1-${variable}"]`,
      );
      expect(row.exists()).toBe(true);
      expect(row.text().length).toBeGreaterThan(0);
      expect(
        wrapper
          .find(`[data-test="job-input-mapping-input-scorer-1-${variable}"]`)
          .exists(),
      ).toBe(false);
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
      wrapper.find('[data-test="job-input-mapping-system-variables-learn-more"]').exists(),
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

  // Regression: the Span Selector control used to render only inside the
  // {{ spans }} variable row, but the backend's validate_for_activation()
  // demands a binding for EVERY trace scorer. A scorer without {{ spans }} was
  // therefore blocked from activation with no control to satisfy it.
  it("offers a Span Selector for a trace scorer that has no {{ spans }}", () => {
    const wrapper = mountMapping("trace", [autoFilledScorer]);

    // autoFilledScorer declares only input/output — no spans variable.
    expect(
      wrapper
        .find('[data-test="job-input-mapping-system-provided-scorer-2-spans"]')
        .exists(),
    ).toBe(false);
    // ...yet it must still be bindable, because activation requires it.
    const row = wrapper.find(
      '[data-test="job-input-mapping-span-selector-scorer-2"]',
    );
    expect(row.exists()).toBe(true);
    // And it must say what a selector is for — "required" alone reads arbitrary.
    expect(row.text()).toContain("Pick the ones this scorer should look at");
  });

  it("offers no Span Selector outside trace scope", () => {
    const wrapper = mountMapping("span");

    expect(
      wrapper
        .find('[data-test="job-input-mapping-span-selector-scorer-1"]')
        .exists(),
    ).toBe(false);
  });

  // The section keeps ONE shape regardless of what the scorer declares — only
  // individual rows differ. An earlier version collapsed the whole block when
  // nothing needed mapping, which made the layout jump as scorers changed.
  describe("keeps a single consistent layout", () => {
    it("renders a scorer card whether or not anything needs mapping", () => {
      const allAuto = mountMapping("trace", [autoFilledScorer]);
      const needsWork = mountMapping("trace");

      expect(allAuto.findAll("article")).toHaveLength(1);
      expect(needsWork.findAll("article")).toHaveLength(1);
    });

    it("shows every declared variable as a row, auto-filled ones included", () => {
      const wrapper = mountMapping("trace", [autoFilledScorer]);

      for (const variable of ["input", "output"]) {
        expect(
          wrapper
            .find(
              `[data-test="job-input-mapping-system-provided-scorer-2-${variable}"]`,
            )
            .exists(),
        ).toBe(true);
      }
      // Auto rows explain their source instead of repeating a badge.
      expect(wrapper.text()).toContain("Input from the trace's root span");
    });

    // Provenance is carried by the heading ("Prompt variables") rather than a
    // sentence in the hint, so the hint can stay short.
    it("names the variables' origin in the heading, not a long hint", () => {
      const wrapper = mountMapping("trace");

      expect(wrapper.text()).toContain("Prompt variables");
      expect(wrapper.text()).toContain(
        "Trace values fill in automatically. Map anything else to a span field.",
      );
    });

    it("keeps the reference drawer reachable in every case", async () => {
      const wrapper = mountMapping("trace", [autoFilledScorer]);

      await wrapper
        .get('[data-test="job-input-mapping-system-variables-learn-more"]')
        .trigger("click");

      expect(
        wrapper
          .find('[data-test="job-input-mapping-system-variables-table"]')
          .exists(),
      ).toBe(true);
    });
  });

  // Regression: the description interpolates {scope}; calling t() without the
  // param rendered "from the  itself" with a hole in the sentence.
  it("interpolates the scope into the system-provided description", async () => {
    const wrapper = mountMapping("trace");

    await wrapper
      .get('[data-test="job-input-mapping-system-variables-learn-more"]')
      .trigger("click");

    const drawer = wrapper.get(
      '[data-test="job-input-mapping-system-variables-drawer"]',
    );
    expect(drawer.text()).toContain("from the trace itself");
    expect(drawer.text()).not.toContain("from the  itself");
  });
});
