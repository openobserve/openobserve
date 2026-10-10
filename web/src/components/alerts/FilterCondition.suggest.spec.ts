// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, defineComponent, provide, reactive } from "vue";
import { createStore } from "vuex";
import FilterCondition from "./FilterCondition.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import { raw } from "@/types/i18n";
import {
  CONDITION_VALUE_SUGGEST_KEY,
  siblingAndPairs,
  type ConditionValuePair,
  type ConditionValueSuggest,
} from "./conditionOperators";

const store = createStore({ state: { isAiChatEnabled: false } });

const row = (id: string, column: string, value: string, operator = "=") => ({
  filterType: "condition",
  column,
  operator,
  value,
  values: [],
  logicalOperator: "AND",
  id,
});

const mountRows = (suggest: ConditionValueSuggest | null) => {
  const tree = reactive({
    filterType: "group",
    logicalOperator: "AND",
    groupId: "root",
    conditions: [row("r1", "service", "payments-api"), row("r2", "host", "node-7")],
  });
  const Host = defineComponent({
    components: { OForm, FilterCondition },
    setup() {
      if (suggest) provide(CONDITION_VALUE_SUGGEST_KEY, suggest);
      return { tree, defaults: { conditions: tree }, fields: [] };
    },
    template: `
      <OForm :default-values="defaults">
        <FilterCondition
          v-for="(c, i) in tree.conditions"
          :key="c.id"
          :condition="c"
          :stream-fields="fields"
          :index="i"
          label="and"
          :depth="0"
          :is-first-in-group="i === 0"
          :name-prefix="'conditions.conditions.' + i"
        />
      </OForm>`,
  });
  return mount(Host, { global: { provide: { store } } });
};

describe("FilterCondition value box", () => {
  it("keeps the plain input when no provider is injected, as alerts and pipelines use it", () => {
    const wrapper = mountRows(null);
    expect(wrapper.findAllComponents(OFormInput)).toHaveLength(2);
    expect(wrapper.findAllComponents(OFormCombobox)).toHaveLength(0);
    expect(wrapper.find('[data-test="alert-conditions-value-input"]').exists()).toBe(true);
  });

  it("renders a combobox fed by the provider, with the other rows as sibling pairs", async () => {
    const calls: Array<{ column: string; prefix: string; pairs: ConditionValuePair[] }> = [];
    const suggest: ConditionValueSuggest = (column, prefix, siblingPairs) => {
      const seen = computed(() => {
        const call = { column: column(), prefix: prefix(), pairs: siblingPairs() };
        calls.push(call);
        return call;
      });
      return {
        options: computed(() => [{ label: raw(`${seen.value.column}-a`), value: "a" }]),
        hint: computed(() =>
          seen.value.prefix === "node-7" ? raw("Not seen in the last hour.") : undefined,
        ),
      };
    };
    const wrapper = mountRows(suggest);
    await flushPromises();

    const boxes = wrapper.findAllComponents(OFormCombobox);
    expect(boxes).toHaveLength(2);
    expect(wrapper.findAllComponents(OFormInput)).toHaveLength(0);
    expect(boxes[1].props("name")).toBe("conditions.conditions.1.value");
    expect(boxes[1].props("items")).toEqual([{ label: "host-a", value: "a" }]);
    expect(boxes[1].props("helpText")).toBe("Not seen in the last hour.");
    expect(boxes[0].props("helpText")).toBeUndefined();
    const hostCall = calls.find((c) => c.column === "host");
    expect(hostCall?.pairs).toEqual([{ key: "service", value: "payments-api" }]);
  });
});

describe("siblingAndPairs", () => {
  it("keeps complete = rows on the And spine and drops the edited row, != rows and Or groups", () => {
    const tree = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        row("r1", "service", "payments-api"),
        row("r2", "host", ""),
        row("r3", "env", "prod", "!="),
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [row("r4", "region", "eu")],
        },
        {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [row("r5", "cluster", "c1")],
        },
      ],
    };
    expect(siblingAndPairs(tree, "r1")).toEqual([{ key: "cluster", value: "c1" }]);
    expect(siblingAndPairs(tree, "r2")).toEqual([
      { key: "service", value: "payments-api" },
      { key: "cluster", value: "c1" },
    ]);
    expect(siblingAndPairs(null, "r1")).toEqual([]);
  });
});
