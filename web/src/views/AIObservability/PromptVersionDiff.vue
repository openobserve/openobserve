<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div class="flex min-h-0 flex-col gap-4" data-test="prompt-version-diff">
    <div class="grid min-h-0 grid-cols-2 gap-3 max-md:grid-cols-1">
      <section v-for="side in sides" :key="side.label" class="flex min-w-0 flex-col gap-2">
        <header class="text-text-heading text-xs font-semibold">{{ side.label }}</header>
        <pre
          class="bg-surface-base border-border-default rounded-default max-h-80 overflow-auto border p-3 font-mono text-xs whitespace-pre-wrap"
          :data-test="`prompt-diff-${side.key}`"
          >{{ side.payload }}</pre>
      </section>
    </div>

    <OTable
      :data="configRows"
      :columns="columns"
      row-key="field"
      :show-global-filter="false"
      pagination="none"
      :fill-height="false"
      :default-columns="false"
      data-test="prompt-config-diff"
    >
      <template #cell-changed="{ row }">
        <OTag v-if="row.changed" variant="amber-soft">{{
          t("aiObservability.promptManagement.changed")
        }}</OTag>
        <span v-else class="text-text-secondary">{{ raw("—") }}</span>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { PromptVersion } from "@/services/llm-prompts.service";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

const { t } = useI18nTyped();

const props = defineProps<{
  left: PromptVersion;
  right: PromptVersion;
}>();

const pretty = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);

const sides = computed(() => [
  { key: "left", label: `v${props.left.version}`, payload: pretty(props.left.payload) },
  { key: "right", label: `v${props.right.version}`, payload: pretty(props.right.payload) },
]);

const fieldKeys: Record<keyof PromptVersion["config"], I18nKey> = {
  model: "aiObservability.promptManagement.model",
  params: "aiObservability.promptManagement.parameters",
  tools: "aiObservability.promptManagement.tools",
  responseFormat: "aiObservability.promptManagement.responseFormat",
};
const configRows = computed(() =>
  (["model", "params", "tools", "responseFormat"] as const).map((field) => ({
    field: t(fieldKeys[field]),
    left: pretty(props.left.config[field]),
    right: pretty(props.right.config[field]),
    changed: JSON.stringify(props.left.config[field]) !== JSON.stringify(props.right.config[field]),
  })),
);

const columns = computed<OTableColumnDef[]>(() => [
  { id: "field", header: t("aiObservability.promptManagement.setting"), accessorKey: "field" },
  { id: "left", header: raw(`v${props.left.version}`), accessorKey: "left" },
  { id: "right", header: raw(`v${props.right.version}`), accessorKey: "right" },
  { id: "changed", header: t("aiObservability.promptManagement.changed"), accessorKey: "changed" },
]);
</script>
