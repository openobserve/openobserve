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
      v-on="rowListeners"
    >
      <template v-if="shape === 'traces'" #cell-trace_id="{ row }">
        <span class="flex min-w-0 items-center gap-1">
          <a
            :href="traceHref(row)"
            class="text-accent truncate text-xs hover:underline"
            :aria-busy="isOpening(row) ? 'true' : undefined"
            data-test="traces-sql-result-trace-link"
            @click="onTraceLinkClick($event, row)"
            @mouseenter="locateOnHover(row)"
            @mouseleave="cancelHover"
            @focus="emit('locate-trace', row)"
          >
            {{ row.trace_id }}
            <OTooltip :content="t('traces.sqlMode.openTrace')" side="bottom" />
          </a>
          <OSpinner
            v-if="isOpening(row)"
            size="xs"
            class="shrink-0"
            :aria-label="t('traces.sqlMode.openingTrace')"
            data-test="traces-sql-result-opening"
          />
        </span>
      </template>
      <template #empty><div /></template>
    </OTable>
    <div
      v-if="capNote"
      class="border-border-default text-text-secondary border-t px-2 py-1 text-xs"
      data-test="traces-sql-result-cap"
    >
      {{ capNote }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { TracesSqlShape } from "@/utils/traces/tracesSql";

const props = withDefaults(
  defineProps<{
    hits: Record<string, any>[];
    columns: OTableColumnDef<Record<string, any>>[];
    shape: TracesSqlShape;
    loading?: boolean;
    wrap?: boolean;
    scrollEl?: HTMLElement | null;
    offerAddTraceId?: boolean;
    traceHref?: (row: Record<string, any>) => string;
    /** Says the rows stop at the query's LIMIT, so the list is not taken as complete. */
    capNote?: string;
    /** The trace row whose lookup is still running after a click. */
    openingTraceId?: string;
  }>(),
  {
    loading: false,
    wrap: false,
    scrollEl: null,
    offerAddTraceId: false,
    traceHref: () => "",
    capNote: "",
    openingTraceId: "",
  },
);

const emit = defineEmits<{
  "open-trace": [row: Record<string, any>];
  "add-trace-id": [];
  "locate-trace": [row: Record<string, any>];
}>();

const { t } = useI18nTyped();

// Rows without a trace get no listener, so OTable keeps their cursor plain.
const rowListeners = computed(() =>
  props.shape === "traces"
    ? { rowClick: (row: Record<string, any>) => emit("open-trace", row) }
    : {},
);

// Each lookup is a server scan, so a pointer sweeping down the column asks only for the link it rests on.
const HOVER_LOCATE_DELAY_MS = 200;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
const cancelHover = () => clearTimeout(hoverTimer);
const locateOnHover = (row: Record<string, any>) => {
  cancelHover();
  hoverTimer = setTimeout(() => emit("locate-trace", row), HOVER_LOCATE_DELAY_MS);
};
onBeforeUnmount(cancelHover);

const isOpening = (row: Record<string, any>) =>
  props.openingTraceId !== "" && String(row.trace_id) === props.openingTraceId;

// Modified clicks fall through so the browser opens the trace in its own tab; no click reaches the row as well.
const onTraceLinkClick = (event: MouseEvent, row: Record<string, any>) => {
  event.stopPropagation();
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  emit("open-trace", row);
};
</script>
