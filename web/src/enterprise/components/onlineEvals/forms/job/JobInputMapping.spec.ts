// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/languages/en-US.json";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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

function mountMapping(targetScope: EvalTargetScope, scorers: Scorer[] = [scorer]) {
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
      streamFields: [
        { label: "gen_ai_output_messages", value: "gen_ai_output_messages", type: "Utf8" },
        { label: "custom_attribute", value: "custom_attribute", type: "Utf8" },
      ],
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

  it("opens the system-provided values table from the explicit help action", async () => {
    const wrapper = mountMapping("trace");

    expect(
      wrapper.find('[data-test="job-input-mapping-system-variables-learn-more"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="job-input-mapping-system-variables-table"]').exists()).toBe(
      false,
    );

    const systemValuesHelp = wrapper.get(
      '[data-test="job-input-mapping-system-variables-learn-more"]',
    );
    expect(systemValuesHelp.text()).toContain("About system-provided values");
    await systemValuesHelp.trigger("click");

    expect(wrapper.get('[data-test="job-input-mapping-system-variables-drawer"]').text()).toContain(
      "Trace system values",
    );
    const systemVariablesTable = wrapper.find(
      '[data-test="job-input-mapping-system-variables-table"]',
    );
    expect(systemVariablesTable.exists()).toBe(true);
    expect(systemVariablesTable.text()).toContain("Value");
    expect(systemVariablesTable.text()).toContain("Source");
    expect(systemVariablesTable.text()).toContain("Value supplied");
    expect(systemVariablesTable.text()).toContain("Span Selector required");
    expect(wrapper.get('[data-test="job-input-mapping-system-variable-input"]').text()).toBe(
      "input",
    );
    expect(wrapper.get('[data-test="job-input-mapping-system-variable-steps"]').text()).toBe(
      "steps",
    );
    for (const variable of ["input", "output", "statistics", "steps"]) {
      expect(
        wrapper.find(`[data-test="job-input-mapping-select-scorer-1-${variable}"]`).exists(),
      ).toBe(true);
    }
    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-1"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="job-input-mapping-select-scorer-1-custom"]').exists()).toBe(
      true,
    );
  });

  it("keeps every scorer variable editable for session jobs", () => {
    const wrapper = mountMapping("session");

    for (const variable of ["input", "output", "statistics", "spans", "steps", "custom"]) {
      expect(
        wrapper.find(`[data-test="job-input-mapping-select-scorer-1-${variable}"]`).exists(),
      ).toBe(true);
    }
  });

  it("vertically centers the variable label and mapping controls", () => {
    const wrapper = mountMapping("trace");
    const row = wrapper.get('[data-test="job-input-mapping-row-scorer-1-output"]');

    expect(row.classes()).toContain("items-center");
    expect(row.get("code").classes()).not.toContain("mt-0.5");
  });

  it("keeps all scorer variables editable for span jobs", () => {
    const wrapper = mountMapping("span");

    expect(
      wrapper.find('[data-test="job-input-mapping-system-variables-learn-more"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="job-input-mapping-select-scorer-1-statistics"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="job-input-mapping-select-scorer-1-steps"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="job-input-mapping-select-scorer-1-spans"]').exists()).toBe(
      true,
    );
  });

  it("copies the mapping expression from an editable variable", async () => {
    const wrapper = mountMapping("span");

    await wrapper.get('[data-test="job-input-mapping-copy-scorer-1-input"]').trigger("click");

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("{{custom_input}}", {
      successMessage: "Copied to clipboard",
    });
  });

  it("combines system-provided values and span attributes in each mapping dropdown", () => {
    const wrapper = mountMapping("trace");
    const select = wrapper
      .findAllComponents(OSelect)
      .find(
        (component) =>
          component.attributes("data-test") === "job-input-mapping-select-scorer-1-output",
      );

    expect(select).toBeDefined();
    expect(select?.props("searchable")).toBe(true);
    const options = select?.props("options") ?? [];
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "System-provided values · For each trace this job evaluates",
          header: true,
        }),
        expect.objectContaining({ label: "output", value: "{{output}}" }),
        expect.objectContaining({ label: "steps", value: "{{steps}}" }),
        expect.objectContaining({ label: "Span attributes", header: true }),
        expect.objectContaining({
          label: "gen_ai_output_messages",
          value: "{{gen_ai_output_messages}}",
        }),
        expect.objectContaining({
          label: "custom_attribute",
          value: "{{custom_attribute}}",
        }),
      ]),
    );
    expect(
      options
        .filter((option: { header?: boolean }) => !option.header)
        .every((option: { subLabel?: string }) => option.subLabel === undefined),
    ).toBe(true);
    expect(
      options
        .filter((option: { header?: boolean }) => !option.header)
        .every(
          (option: { label: string }) =>
            !option.label.includes("{{") && !option.label.includes("}}"),
        ),
    ).toBe(true);
  });

  it("explains which target supplies the system-provided values", () => {
    for (const [scope, groupLabel] of [
      ["trace", "System-provided values · For each trace this job evaluates"],
      ["session", "System-provided values · For each session this job evaluates"],
    ] as const) {
      const wrapper = mountMapping(scope);
      const select = wrapper
        .findAllComponents(OSelect)
        .find(
          (component) =>
            component.attributes("data-test") === "job-input-mapping-select-scorer-1-output",
        );

      expect(select?.props("options")).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: groupLabel, header: true })]),
      );
    }
  });

  it("emits the selected mapping value", async () => {
    const wrapper = mountMapping("trace", [autoFilledScorer]);
    const select = wrapper
      .findAllComponents(OSelect)
      .find(
        (component) =>
          component.attributes("data-test") === "job-input-mapping-select-scorer-2-output",
      );

    expect(select).toBeDefined();
    select?.vm.$emit("update:modelValue", "{{gen_ai_output_messages}}");
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:inputMappings")?.at(-1)?.[0]).toEqual({
      "scorer-1": {
        input: "{{custom_input}}",
        output: "{{custom_output}}",
        statistics: "{{custom_statistics}}",
        spans: "{{custom_spans}}",
        steps: "{{custom_steps}}",
        custom: "{{custom_field}}",
      },
      "scorer-2": {
        output: "{{gen_ai_output_messages}}",
      },
    });
  });

  it("hides the selector dropdown until a selector exists", async () => {
    const wrapper = mountMapping("trace");

    await wrapper.setProps({
      inputMappings: {
        "scorer-1": {
          input: "{{custom_input}}",
          output: "{{custom_output}}",
          statistics: "{{custom_statistics}}",
          spans: "{{spans}}",
          steps: "{{custom_steps}}",
          custom: "{{custom_field}}",
        },
      },
    });

    expect(wrapper.find('[data-test="span-selector-binding-scorer-1"]').exists()).toBe(false);
    const createButton = wrapper.get('[data-test="span-selector-create-scorer-1"]');
    expect(createButton.text()).toContain("Create for scorer");
    expect(createButton.attributes("title")).toBe("Create a Span Selector for this scorer");

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

    expect(wrapper.find('[data-test="span-selector-binding-scorer-1"]').exists()).toBe(true);
  });

  it("offers a Span Selector only after the spans system value is selected", async () => {
    const wrapper = mountMapping("trace");

    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-1"]').exists()).toBe(
      false,
    );

    const spansSelect = wrapper
      .findAllComponents(OSelect)
      .find(
        (component) =>
          component.attributes("data-test") === "job-input-mapping-select-scorer-1-spans",
      );
    expect(spansSelect).toBeDefined();

    spansSelect?.vm.$emit("update:modelValue", "{{spans}}");
    await wrapper.vm.$nextTick();

    const inputMappings = wrapper.emitted("update:inputMappings")?.at(-1)?.[0];
    expect(inputMappings).toEqual(
      expect.objectContaining({
        "scorer-1": expect.objectContaining({ spans: "{{spans}}" }),
      }),
    );

    await wrapper.setProps({
      inputMappings: {
        "scorer-1": {
          input: "{{custom_input}}",
          output: "{{custom_output}}",
          statistics: "{{custom_statistics}}",
          spans: "{{spans}}",
          steps: "{{custom_steps}}",
          custom: "{{custom_field}}",
        },
      },
    });

    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-1"]').exists()).toBe(
      true,
    );
  });

  it("offers no Span Selector for a trace scorer that has no {{ spans }}", () => {
    const wrapper = mountMapping("trace", [autoFilledScorer]);

    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-2"]').exists()).toBe(
      false,
    );
  });

  it("offers a Span Selector when a custom variable maps to {{ spans }}", async () => {
    const customScorer = {
      ...autoFilledScorer,
      variables: ["evidence"],
      template: "Judge {{ evidence }}.",
    } as Scorer;
    const wrapper = mountMapping("trace", [customScorer]);

    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-2"]').exists()).toBe(
      false,
    );

    await wrapper.setProps({
      inputMappings: {
        "scorer-2": { evidence: "{{ spans }}" },
      },
    });

    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-2"]').exists()).toBe(
      true,
    );
  });

  it("offers no Span Selector outside trace scope", () => {
    const wrapper = mountMapping("span");

    expect(wrapper.find('[data-test="job-input-mapping-span-selector-scorer-1"]').exists()).toBe(
      false,
    );
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

    it("shows every declared variable as an editable mapping row", () => {
      const wrapper = mountMapping("trace", [autoFilledScorer]);

      for (const variable of ["input", "output"]) {
        expect(
          wrapper.find(`[data-test="job-input-mapping-select-scorer-2-${variable}"]`).exists(),
        ).toBe(true);
      }
    });

    // Provenance is carried by the heading ("Prompt variables") rather than a
    // sentence in the hint, so the hint can stay short.
    it("names the variables' origin in the heading, not a long hint", () => {
      const wrapper = mountMapping("trace");

      expect(wrapper.text()).toContain("Prompt variables");
      expect(wrapper.text()).toContain(
        "Map each variable to a system-provided value or span attribute.",
      );
    });

    it("keeps the reference drawer reachable in every case", async () => {
      const wrapper = mountMapping("trace", [autoFilledScorer]);

      await wrapper
        .get('[data-test="job-input-mapping-system-variables-learn-more"]')
        .trigger("click");

      expect(wrapper.find('[data-test="job-input-mapping-system-variables-table"]').exists()).toBe(
        true,
      );
    });
  });

  // Regression: the description interpolates {scope}; calling t() without the
  // param leaves a hole in the explanation.
  it("interpolates the scope into the system-provided description", async () => {
    const wrapper = mountMapping("trace");

    await wrapper
      .get('[data-test="job-input-mapping-system-variables-learn-more"]')
      .trigger("click");

    const drawer = wrapper.get('[data-test="job-input-mapping-system-variables-drawer"]');
    expect(drawer.text()).toContain("separately for each trace this job evaluates");
    expect(drawer.text()).not.toContain("for each  this job evaluates");
  });
});
