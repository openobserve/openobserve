<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <dl
    class="[&_dd]:text-text-heading [&_dt]:text-text-secondary [&_dd]:text-compact m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 [&_dd]:m-0 [&_dt]:text-xs [&_dt]:font-semibold"
    :data-test="dataTest"
  >
    <template v-for="row in rows" :key="row.key">
      <dt>{{ row.label }}</dt>
      <dd
        class="flex min-w-0 flex-wrap items-center gap-1.5 break-all"
        :data-test="`${dataTest}-${row.key}`"
      >
        <template v-if="row.left !== row.right">
          <span class="text-text-secondary">{{ row.left }}</span>
          <OIcon name="arrow-forward" size="xs" class="text-text-secondary" />
          <span class="text-text-heading font-medium">{{ row.right }}</span>
          <OTag variant="amber-soft">{{ t("aiObservability.promptManagement.changed") }}</OTag>
        </template>
        <template v-else>{{ row.left }}</template>
      </dd>
    </template>
  </dl>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{
  rows: { key: string; label: I18nText; left: string; right: string }[];
  dataTest: string;
}>();

const { t } = useI18nTyped();
</script>
