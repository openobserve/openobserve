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
  <ODrawer
    :open="open"
    size="md"
    :title="t('autoobserve2.historyDrawer.title')"
    data-test="autoobserve2-history-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-4">
      <OToggleGroup
        :model-value="filter"
        mobile-dropdown
        :aria-label="t('autoobserve.activityLive.historyFilter')"
        data-test="autoobserve2-history-filter"
        @update:model-value="(v) => v && emit('update:filter', v as HistoryFilter)"
      >
        <OToggleGroupItem
          v-for="f in HISTORY_FILTERS"
          :key="f"
          :value="f"
          size="xs"
          :data-test="`autoobserve2-history-filter-${f}`"
        >
          {{ t(HISTORY_FILTER_LABEL[f]) }}
        </OToggleGroupItem>
      </OToggleGroup>
      <LiveHistory
        :filter="filter"
        @see-issues="emit('see-issues')"
        @open-issue="(id) => emit('open-issue', id)"
        @see-change="(id) => emit('see-change', id)"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import LiveHistory from "../live/LiveHistory.vue";
import type { LiveHistoryKind } from "../live/historyFeed";

export type HistoryFilter = "all" | LiveHistoryKind;

const HISTORY_FILTERS: HistoryFilter[] = ["all", "incident", "change", "decision"];

const HISTORY_FILTER_LABEL: Record<HistoryFilter, I18nKey> = {
  all: "autoobserve2.activityPage.filters.all",
  incident: "autoobserve.activityLive.history.incident",
  change: "autoobserve.activityLive.history.change",
  decision: "autoobserve.activityLive.history.decision",
};

withDefaults(defineProps<{ open: boolean; filter?: HistoryFilter }>(), { filter: "all" });

const emit = defineEmits<{
  "update:open": [open: boolean];
  "update:filter": [filter: HistoryFilter];
  "see-issues": [];
  "open-issue": [id: string];
  "see-change": [decisionId: string];
}>();

const { t } = useI18nTyped();
</script>
