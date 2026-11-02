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
  <div class="bg-card-glass-solid flex h-auto! flex-col" data-test="traces-sql-result">
    <div
      v-if="offerAddTraceId"
      class="border-border-default text-text-secondary flex items-center gap-2 border-b px-2 py-1 text-xs"
      data-test="traces-sql-no-trace-id"
    >
      <span>{{ t("traces.sqlMode.noTraceIdHint") }}</span>
      <OButton
        variant="outline"
        size="xs"
        data-test="traces-sql-add-trace-id-btn"
        @click="emit('add-trace-id')"
      >
        {{ t("traces.sqlMode.addTraceId") }}
      </OButton>
    </div>
    <OTable
      class="h-auto!"
      :wrap="wrap"
      :columns="columns"
      :data="hits"
      :loading="loading"
      sorting="none"
      :row-height="28"
      virtual-scroll
      :fill-height="false"
      :scroll-el="scrollEl"
      :scroll-margin="0"
      :horizontal-scroll="true"
      :enable-column-resize="true"
      :default-columns="false"
      :show-global-filter="false"
      pagination="none"
      data-test="traces-sql-result-table"
    >
      <template v-if="shape === 'traces'" #cell-trace_id="{ row }">
        <a
          :href="traceHref(row)"
          class="text-accent block truncate text-xs hover:underline"
          data-test="traces-sql-result-trace-link"
          @click="onTraceLinkClick($event, row)"
        >
          {{ row.trace_id }}
          <OTooltip :content="t('traces.sqlMode.openTrace')" side="bottom" />
        </a>
      </template>
      <template #empty><div /></template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { TracesSqlShape } from "@/utils/traces/tracesSql";

withDefaults(
  defineProps<{
    hits: Record<string, any>[];
    columns: OTableColumnDef<Record<string, any>>[];
    shape: TracesSqlShape;
    loading?: boolean;
    wrap?: boolean;
    scrollEl?: HTMLElement | null;
    offerAddTraceId?: boolean;
    traceHref?: (row: Record<string, any>) => string;
  }>(),
  {
    loading: false,
    wrap: false,
    scrollEl: null,
    offerAddTraceId: false,
    traceHref: () => "",
  },
);

const emit = defineEmits<{
  "open-trace": [row: Record<string, any>];
  "add-trace-id": [];
}>();

const { t } = useI18nTyped();

// Modified clicks fall through so the browser opens the trace in its own tab.
const onTraceLinkClick = (event: MouseEvent, row: Record<string, any>) => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  emit("open-trace", row);
};
</script>
