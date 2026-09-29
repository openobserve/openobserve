<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div class="flex min-h-0 flex-col gap-4" data-test="prompt-version-diff">
    <section class="flex flex-col gap-2">
      <h4 :class="headingClass">
        {{ t("aiObservability.promptManagement.form.promptText") }}
        <OTag
          :variant="payloadChanged ? 'amber-soft' : 'default-soft'"
          data-test="prompt-diff-payload-status"
          >{{ statusLabel(payloadChanged) }}</OTag
        >
        <span
          v-if="payloadChanged"
          class="ms-auto inline-flex gap-2 font-mono text-xs font-normal"
          data-test="prompt-diff-payload-counts"
        >
          <span class="text-status-success-text">{{ raw(`+${stats.added}`) }}</span>
          <span class="text-status-error-text">{{ raw(`−${stats.removed}`) }}</span>
        </span>
      </h4>
      <DiffViewer
        :original="payloadText(left.payload)"
        :modified="payloadText(right.payload)"
        :mode="mode"
        data-test="prompt-diff-payload"
        @stats="stats = $event"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h4 :class="headingClass">
        {{ t("aiObservability.promptManagement.configuration") }}
        <OTag
          :variant="changedFields ? 'amber-soft' : 'default-soft'"
          data-test="prompt-diff-config-status"
          >{{ statusLabel(Boolean(changedFields)) }}</OTag
        >
        <span v-if="changedFields" class="text-text-secondary ms-auto text-xs font-normal">{{
          t("aiObservability.promptManagement.form.fieldsChanged", {
            changed: changedFields,
            total: configRows.length,
          })
        }}</span>
      </h4>
      <div
        class="rounded-default border-border-default text-compact grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden border"
        data-test="prompt-config-diff"
      >
        <span :class="headerCellClass">{{ t("aiObservability.promptManagement.form.field") }}</span>
        <span :class="headerCellClass">{{
          t("aiObservability.promptManagement.versionNumber", { version: left.version })
        }}</span>
        <span :class="headerCellClass">{{
          t("aiObservability.promptManagement.versionNumber", { version: right.version })
        }}</span>
        <template v-for="row in configRows" :key="row.key">
          <span
            class="border-border-default border-t px-3 py-2"
            :class="row.changed ? 'text-text-heading font-medium' : 'text-text-secondary'"
            >{{ row.label }}</span
          >
          <span
            class="border-border-default border-t px-3 py-2 font-mono text-xs break-all"
            :class="row.changed ? 'bg-status-error-bg text-status-error-text' : ''"
            :data-test="`prompt-config-diff-${row.key}-left`"
            ><span class="block max-h-[5lh] overflow-y-auto">{{ row.left }}</span></span
          >
          <span
            class="border-border-default border-t px-3 py-2 font-mono text-xs break-all"
            :class="row.changed ? 'bg-status-success-bg text-status-success-text' : ''"
            :data-test="`prompt-config-diff-${row.key}-right`"
            ><span class="block max-h-[5lh] overflow-y-auto">{{ row.right }}</span></span
          >
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import DiffViewer, { type DiffStats } from "@/components/AIObservability/DiffViewer.vue";
import type { PromptVersion } from "@/services/llm-prompts.service";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

const { t } = useI18nTyped();

const props = withDefaults(
  defineProps<{
    left: PromptVersion;
    right: PromptVersion;
    mode?: "split" | "unified";
  }>(),
  { mode: "split" },
);

const headingClass =
  "text-compact text-text-heading border-b-text-secondary/12 m-0 flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold";
const headerCellClass = "bg-surface-subtle text-text-secondary px-3 py-2 text-xs font-semibold";

const stats = ref<DiffStats>({ added: 0, removed: 0 });

const payloadText = (payload: unknown) =>
  typeof payload === "string" ? payload : JSON.stringify(payload ?? null, null, 2);

const compact = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);

const payloadChanged = computed(
  () => JSON.stringify(props.left.payload) !== JSON.stringify(props.right.payload),
);

const statusLabel = (changed: boolean) =>
  changed
    ? t("aiObservability.promptManagement.changed")
    : t("aiObservability.promptManagement.form.unchanged");

const fieldKeys: Record<keyof PromptVersion["config"], I18nKey> = {
  model: "aiObservability.promptManagement.model",
  params: "aiObservability.promptManagement.parameters",
  tools: "aiObservability.promptManagement.tools",
  responseFormat: "aiObservability.promptManagement.responseFormat",
};
const configRows = computed(() =>
  (["model", "params", "tools", "responseFormat"] as const).map((field) => {
    const left = compact(props.left.config[field]);
    const right = compact(props.right.config[field]);
    return { key: field, label: t(fieldKeys[field]), left, right, changed: left !== right };
  }),
);
const changedFields = computed(() => configRows.value.filter((row) => row.changed).length);
</script>
