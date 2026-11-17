<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { formatEventCount } from "@/utils/formatters";

const props = defineProps<{
  field: string;
  values: { value: string; count: number }[];
  loading: boolean;
  /** In SQL mode the values cover the whole stream, not the typed query. */
  wholeStream: boolean;
}>();
const emit = defineEmits<{ add: [field: string, value: string, op: string] }>();
const { t } = useI18nTyped();

const total = computed(() => props.values.reduce((sum, v) => sum + v.count, 0));
</script>

<template>
  <div class="flex flex-col gap-1 px-2" :data-test="`security-events-field-values-${field}`">
    <span v-if="wholeStream" class="text-text-secondary text-2xs px-1">
      {{ t("siem.events.topValuesWholeStream") }}
    </span>
    <div v-if="loading" class="flex justify-center py-2">
      <OSpinner size="sm" />
    </div>
    <span v-else-if="!values.length" class="text-text-secondary px-1 py-1 text-xs">
      {{ t("siem.events.noValues") }}
    </span>
    <template v-else>
      <div
        v-for="v in values"
        :key="v.value"
        class="group rounded-default hover:bg-surface-subtle flex flex-col gap-0.5 px-1 py-0.5"
      >
        <div class="flex items-center gap-1">
          <span class="text-text-heading min-w-0 flex-1 truncate font-mono text-xs"
            >{{ v.value }}<OTooltip :content="raw(v.value)"
          /></span>
          <span class="text-text-secondary text-2xs tabular-nums">{{
            formatEventCount(v.count)
          }}</span>
          <div
            class="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <OButton
              :data-test="`security-events-value-include-${v.value}`"
              variant="ghost"
              size="icon-xs"
              icon-left="add-circle-outline"
              @click.stop="emit('add', field, v.value, '=')"
            >
              <OTooltip :content="t('siem.pivot.include')" />
            </OButton>
            <OButton
              :data-test="`security-events-value-exclude-${v.value}`"
              variant="ghost"
              size="icon-xs"
              icon-left="block"
              @click.stop="emit('add', field, v.value, '!=')"
            >
              <OTooltip :content="t('siem.pivot.exclude')" />
            </OButton>
          </div>
        </div>
        <OProgressBar :value="total ? v.count / total : 0" size="xs" />
      </div>
    </template>
  </div>
</template>
