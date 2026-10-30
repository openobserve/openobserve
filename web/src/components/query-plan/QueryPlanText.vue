<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="query-plan-text">
    <div
      class="border-border-default flex shrink-0 items-center gap-3 border-b pe-4 max-md:flex-wrap max-md:ps-4 max-md:pb-2"
    >
      <OTabs v-model="tab" dense class="min-w-0 flex-1 max-md:basis-full">
        <OTab
          name="physical"
          :label="t('search.queryProfile.textPhysical')"
          data-test="query-plan-text-tab-physical"
        />
        <OTab
          name="logical"
          :label="t('search.queryProfile.textLogical')"
          data-test="query-plan-text-tab-logical"
        />
        <OTab
          v-if="analyzePlan !== null"
          name="analyze"
          :label="t('search.queryProfile.textAnalyze', { command: raw('EXPLAIN ANALYZE') })"
          data-test="query-plan-text-tab-analyze"
        />
      </OTabs>
      <OSwitch
        v-model="wrap"
        size="sm"
        :label="t('search.queryProfile.wrapLines')"
        data-test="query-plan-text-wrap"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="content-copy"
        :disabled="!text"
        data-test="query-plan-text-copy"
        @click="copy"
        >{{ t("common.copy") }}</OButton
      >
    </div>

    <div
      class="bg-surface-panel min-h-0 flex-1 overflow-auto py-3"
      data-test="query-plan-text-body"
    >
      <div
        v-if="lines.length"
        class="text-compact font-mono leading-relaxed"
        :class="wrap ? '' : 'w-max min-w-full'"
      >
        <div
          v-for="line in lines"
          :key="line.no"
          class="flex"
          :data-test="`query-plan-text-line-${line.no}`"
        >
          <span class="text-text-secondary w-14 shrink-0 pe-4 text-end select-none">{{
            line.no
          }}</span>
          <span
            class="text-text-body min-w-0 flex-1 pe-4"
            :class="wrap ? 'wrap-anywhere whitespace-pre-wrap' : 'whitespace-pre'"
            ><span
              v-for="g in line.guides"
              :key="g"
              class="border-border-subtle inline-block border-s whitespace-pre"
              >{{ GUIDE }}</span
            >{{ line.pad
            }}<span
              v-if="line.name"
              class="font-semibold"
              :class="CATEGORY_STYLE[line.category].text"
              :data-test="`query-plan-text-op-${line.no}`"
              >{{ line.name }}</span
            >{{ line.rest }}</span
          >
        </div>
      </div>
      <div
        v-else
        class="text-text-secondary px-4 py-6 text-center text-sm"
        data-test="query-plan-text-empty"
      >
        {{ emptyText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { operatorCategory, type OperatorCategory } from "@/utils/queryProfile";
import { CATEGORY_STYLE } from "./profileStyles";

interface PlanLine {
  no: number;
  guides: number;
  pad: string;
  name: string;
  category: OperatorCategory;
  rest: string;
}

const INDENT = 2;
const GUIDE = " ".repeat(INDENT);

const props = defineProps<{
  physicalPlan: string;
  logicalPlan: string;
  analyzePlan: string | null;
}>();

const { t } = useI18nTyped();

const tab = ref<string | number>("physical");
const wrap = ref(true);

const text = computed(() => {
  if (tab.value === "logical") return props.logicalPlan;
  if (tab.value === "analyze") return props.analyzePlan ?? "";
  return props.physicalPlan;
});

const lines = computed<PlanLine[]>(() =>
  text.value.trim() ? text.value.replace(/\s+$/, "").split("\n").map(toLine) : [],
);

const emptyText = computed<I18nText>(() => {
  if (tab.value === "logical") return t("search.noLogicalPlan");
  if (tab.value === "analyze") return t("search.noAnalyzePlanFound");
  return t("search.noPhysicalPlan");
});

watch(
  () => props.analyzePlan,
  (plan) => {
    if (plan === null && tab.value === "analyze") tab.value = "physical";
  },
);

function toLine(line: string, i: number): PlanLine {
  const indent = line.match(/^ */)?.[0].length ?? 0;
  const body = line.slice(indent);
  const name = body.match(/^([A-Za-z_]\w*)(?=:|$)/)?.[1] ?? "";
  return {
    no: i + 1,
    guides: Math.floor(indent / INDENT),
    pad: " ".repeat(indent % INDENT),
    name,
    category: operatorCategory(name),
    rest: body.slice(name.length),
  };
}

function copy() {
  copyToClipboard(text.value, t);
}
</script>
