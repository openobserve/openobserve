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
  <span v-if="!events.total" class="text-text-muted text-xs" data-test="span-events-cell-empty">{{
    raw("–")
  }}</span>
  <span v-else class="inline-flex min-w-0">
    <OBadge
      size="xs"
      shape="rounded"
      :variant="events.hasException ? 'error-outline' : 'default-outline'"
      icon="event-note"
      data-test="span-events-cell"
    >
      {{ countLabel }}
    </OBadge>
    <OTooltip side="left" max-width="23.75rem">
      <template #content>
        <div class="flex w-87.5 flex-col gap-1 py-1 text-xs" data-test="span-events-cell-hover">
          <div class="text-text-heading flex items-center gap-1.5 font-semibold">
            <OTruncatedText :tooltip="false">
              {{ t("traces.results.eventsHoverTitle", { operation: operationName }) }}
            </OTruncatedText>
            <span class="text-text-secondary ms-auto shrink-0 font-normal">
              {{ t("traces.results.eventsHoverOrder", { count: events.total }) }}
            </span>
          </div>
          <div
            v-for="item in events.items"
            :key="item.key"
            class="flex min-w-0 items-center gap-2"
            data-test="span-events-cell-hover-row"
          >
            <OBadge
              size="xs"
              shape="rounded"
              :variant="item.kind === 'exception' ? 'error-outline' : 'default-outline'"
              class="shrink-0"
            >
              {{
                item.kind === "exception"
                  ? t("traces.results.eventKindException")
                  : t("traces.results.eventKindLog")
              }}
            </OBadge>
            <span class="text-text-secondary shrink-0 font-mono">
              {{ t("traces.results.eventOffset", { offset: formatTimeWithSuffix(item.offsetUs) }) }}
            </span>
            <OTruncatedText
              :tooltip="false"
              :class="item.kind === 'exception' ? 'text-text-body' : 'text-text-secondary'"
            >
              {{ item.text }}
            </OTruncatedText>
          </div>
          <div
            v-if="events.moreCount"
            class="text-text-secondary"
            data-test="span-events-cell-hover-more"
          >
            {{ t("traces.results.moreEvents", { count: events.moreCount }) }}
          </div>
        </div>
      </template>
    </OTooltip>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import { spanResultCellsFor } from "./spanResultCells";

const props = defineProps<{
  row: Record<string, unknown>;
  timestampField?: string;
}>();

const { t } = useI18nTyped();

const events = computed(() => spanResultCellsFor(props.row, props.timestampField).events);

const operationName = computed(() => raw(String(props.row.operation_name ?? "")));

const countLabel = computed(() => {
  const { exceptions, logs } = events.value;
  const exceptionText = t("traces.results.eventExceptions", { count: exceptions }, exceptions);
  const logText = t("traces.results.eventLogs", { count: logs }, logs);
  if (exceptions && logs) {
    return t("traces.results.eventCounts", { exceptions: exceptionText, logs: logText });
  }
  return exceptions ? exceptionText : logText;
});
</script>
