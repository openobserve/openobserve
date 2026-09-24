<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Label/value rows for a record drawer; every value copies, and pivots when `pivotable`. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export interface KeyValueRow {
  key: string;
  label?: string;
  value: string;
  mono?: boolean;
  /** Field to filter on, when it differs from `key`; null disables pivots for the row. */
  field?: string | null;
}

const props = withDefaults(
  defineProps<{
    rows: KeyValueRow[];
    searchable?: boolean;
    pivotable?: boolean;
    dataTest?: string;
  }>(),
  { searchable: false, pivotable: false, dataTest: "security-key-values" },
);

const emit = defineEmits<{ pivot: [field: string, value: string, op: "=" | "!="] }>();

const { t } = useI18n();
const search = ref("");
const copied = ref<string | null>(null);

const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q
    ? props.rows.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          (r.label ?? "").toLowerCase().includes(q) ||
          r.value.toLowerCase().includes(q),
      )
    : props.rows;
});

function copy(row: KeyValueRow) {
  // navigator.clipboard is undefined on plain-HTTP deployments.
  if (!navigator.clipboard) {
    toast({ variant: "error", message: t("siem.record.copyFailed") });
    return;
  }
  navigator.clipboard.writeText(row.value).then(
    () => {
      copied.value = row.key;
      setTimeout(() => (copied.value = null), 1400);
    },
    () => toast({ variant: "error", message: t("siem.record.copyFailed") }),
  );
}

const pivotField = (row: KeyValueRow) => (row.field === undefined ? row.key : row.field);
</script>

<template>
  <div class="flex flex-col gap-2" :data-test="dataTest">
    <OSearchInput
      v-if="searchable"
      v-model="search"
      :placeholder="t('siem.record.searchFields')"
      size="sm"
      :data-test="`${dataTest}-search`"
    />
    <div class="border-border-default rounded-surface overflow-hidden border">
      <div
        v-for="row in shown"
        :key="row.key"
        :data-test="`${dataTest}-row-${row.key}`"
        class="group border-border-subtle hover:bg-surface-subtle flex items-start gap-3 border-b px-3 py-1.5 last:border-b-0"
      >
        <span
          class="text-text-secondary w-2/5 shrink-0 truncate text-xs"
          :class="{ 'font-mono': !row.label }"
          >{{ row.label ?? row.key }}<OTooltip v-if="!row.label" :content="row.key"
        /></span>
        <span
          class="text-text-heading min-w-0 flex-1 text-xs break-all"
          :class="{ 'font-mono': row.mono ?? !row.label }"
          >{{ row.value }}</span
        >
        <div
          class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        >
          <template v-if="pivotable && pivotField(row)">
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="add-circle-outline"
              :data-test="`${dataTest}-include-${row.key}`"
              @click="emit('pivot', pivotField(row)!, row.value, '=')"
            >
              <OTooltip :content="t('siem.pivot.include')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="block"
              :data-test="`${dataTest}-exclude-${row.key}`"
              @click="emit('pivot', pivotField(row)!, row.value, '!=')"
            >
              <OTooltip :content="t('siem.pivot.exclude')" />
            </OButton>
          </template>
          <OButton
            variant="ghost"
            size="icon-xs"
            :icon-left="copied === row.key ? 'check' : 'content-copy'"
            :data-test="`${dataTest}-copy-${row.key}`"
            @click="copy(row)"
          >
            <OTooltip :content="t('siem.pivot.copy')" />
          </OButton>
        </div>
      </div>
      <OEmptyState
        v-if="!shown.length"
        size="inline"
        icon="search-off"
        :title="t('siem.record.noFields')"
      />
    </div>
  </div>
</template>
