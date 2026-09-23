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
      :show-footer="false"
      :default-columns="false"
      data-test="prompt-config-diff"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { PromptVersion } from "@/services/llm-prompts.service";
import { raw } from "@/types/i18n";

const props = defineProps<{
  left: PromptVersion;
  right: PromptVersion;
}>();

const pretty = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const sides = computed(() => [
  { key: "left", label: `v${props.left.version}`, payload: pretty(props.left.payload) },
  { key: "right", label: `v${props.right.version}`, payload: pretty(props.right.payload) },
]);

const configRows = computed(() =>
  (["model", "params", "tools", "responseFormat"] as const).map((field) => ({
    field,
    left: pretty(props.left.config[field]),
    right: pretty(props.right.config[field]),
    changed: JSON.stringify(props.left.config[field]) !== JSON.stringify(props.right.config[field]),
  })),
);

const columns: OTableColumnDef[] = [
  { id: "field", header: raw("Setting"), accessorKey: "field" },
  { id: "left", header: raw("Earlier"), accessorKey: "left" },
  { id: "right", header: raw("Later"), accessorKey: "right" },
  { id: "changed", header: raw("Changed"), accessorKey: "changed" },
];
</script>
