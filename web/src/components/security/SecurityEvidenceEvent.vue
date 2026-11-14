<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- One evidence row: its key fields for its source on one line, the whole raw row on expand. -->
<script setup lang="ts">
import { computed } from "vue";
import { securityTime } from "@/utils/security/time";
import { raw, useI18nTyped } from "@/types/i18n";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import SecurityKeyValues, { type KeyValueRow } from "@/components/security/SecurityKeyValues.vue";
import type { NormalizedEvent } from "@/utils/security/ocsf";
import { evidenceFallbackFields, evidenceKeyFields } from "@/utils/security/firings";

const props = defineProps<{
  event: NormalizedEvent;
  /** The column a value-count rule counted, shown as its own field. */
  valueField?: string | null;
  dataTest?: string;
}>();

const { t } = useI18nTyped();

const fields = computed(() => {
  const keyed = evidenceKeyFields(props.event, props.valueField ?? null).map((f) => ({
    id: f.key,
    label: f.key === "counted" ? raw(f.column ?? "") : t(`siem.alerts.evidenceField.${f.key}`),
    value: f.value,
  }));
  if (keyed.length) return keyed;
  return evidenceFallbackFields(props.event.raw).map((f) => ({
    id: f.column,
    label: raw(f.column),
    value: f.value,
  }));
});

const rawRows = computed<KeyValueRow[]>(() =>
  Object.entries(props.event.raw)
    .filter(([key]) => key !== "zo_rn")
    .map(([key, value]) => ({
      key,
      value:
        value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""),
      mono: true,
    }))
    .filter((row) => row.value !== ""),
);
</script>

<template>
  <OCollapsible :data-test="dataTest ?? 'security-evidence-event'" trigger-class="!px-3 !py-2">
    <template #trigger>
      <div class="flex min-w-0 flex-1 items-start gap-3 text-start">
        <OTag variant="primary-soft" size="xs" class="shrink-0">{{
          event.className || t("siem.drawer.eyebrow")
        }}</OTag>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
            data-test="security-evidence-event-fields"
          >
            <span v-for="f in fields" :key="f.id" class="inline-flex min-w-0 items-baseline gap-1">
              <span class="text-text-secondary shrink-0">{{ f.label }}</span>
              <OTruncatedText class="text-text-heading max-w-60 font-mono">{{
                f.value
              }}</OTruncatedText>
            </span>
            <span v-if="!fields.length" class="text-text-secondary">—</span>
          </div>
          <span class="text-text-secondary text-2xs font-mono">{{
            securityTime(event.time ?? 0)
          }}</span>
        </div>
      </div>
    </template>
    <div class="px-3 pb-2" data-test="security-evidence-event-raw">
      <SecurityKeyValues :rows="rawRows" data-test="security-evidence-event-raw-fields" />
    </div>
  </OCollapsible>
</template>
