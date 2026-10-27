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
  <div class="flex h-full min-h-0 w-full flex-col" data-test="dashboard-logs-panel">
    <OVirtualScroll
      class="min-h-0 flex-1"
      height="100%"
      :items="rows"
      :estimate-size="28"
      dynamic-row-height
    >
      <template #default="{ item }">
        <OCollapsible
          class="border-border-subtle border-b"
          :model-value="expanded.has(item.key)"
          :data-test="`dashboard-logs-panel-row-${item.key}`"
          @update:model-value="(open: boolean) => setExpanded(item.key, open)"
        >
          <template #trigger="{ open }">
            <div
              class="flex w-full min-w-0 items-start gap-2 px-2 py-1 text-start text-xs"
              :data-test-open="String(open)"
            >
              <OIcon
                :name="open ? 'expand-more' : 'chevron-right'"
                size="xs"
                class="text-text-secondary mt-0.5 shrink-0"
              />
              <span
                v-if="showTime"
                class="text-text-secondary shrink-0 font-mono whitespace-nowrap"
                data-test="dashboard-logs-panel-time"
                >{{ item.timeText || emDash }}</span
              >
              <OTag
                class="shrink-0"
                type="logLevel"
                size="xs"
                :value="item.level"
                data-test="dashboard-logs-panel-level"
              />
              <OTruncatedText
                v-if="!wrap"
                class="min-w-0 flex-1 font-mono"
                :tooltip="false"
                data-test="dashboard-logs-panel-message"
              >
                <LogsHighLighting :data="item.message" :show-braces="false" />
              </OTruncatedText>
              <span
                v-else
                class="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap"
                data-test="dashboard-logs-panel-message"
              >
                <LogsHighLighting :data="item.message" :show-braces="false" />
              </span>
            </div>
          </template>
          <div class="px-2 pb-2" data-test="dashboard-logs-panel-detail">
            <OCodeBlock
              lang="json"
              wrap
              :max-lines="24"
              :code="logRowJson(item.source, prettify)"
              data-test="dashboard-logs-panel-json"
            />
          </div>
        </OCollapsible>
      </template>
    </OVirtualScroll>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OVirtualScroll from "@/lib/core/VirtualScroll/OVirtualScroll.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import { raw } from "@/types/i18n";
import { logRowJson, type LogsPanelRow } from "@/utils/dashboard/convertLogsPanelData";

const props = defineProps<{
  data: { rows?: LogsPanelRow[] } | null | undefined;
  config?: Record<string, any> | null;
}>();

const emDash = raw("—");
const rows = computed<LogsPanelRow[]>(() => props.data?.rows ?? []);
const showTime = computed(() => props.config?.logs_show_time !== false);
const wrap = computed(() => props.config?.logs_wrap === true);
const prettify = computed(() => props.config?.logs_prettify_json !== false);

const expanded = ref(new Set<string>());
const setExpanded = (key: string, open: boolean) => {
  const next = new Set(expanded.value);
  if (open) next.add(key);
  else next.delete(key);
  expanded.value = next;
};
// Keys are row positions, so an open row would point at a different line after a reload.
watch(rows, () => {
  if (expanded.value.size) expanded.value = new Set();
});
</script>
