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

<!-- No widen-range action: the panel aggregates across the window, so only a precise
     jump to the stream's latest data can help. -->
<template>
  <OEmptyState
    v-if="noTraceStream"
    icon="lan"
    :title="t('emptyState.noServicesCatalog.title')"
    :text="t('emptyState.noServicesCatalog.noTraceStream')"
  />
  <OEmptyState
    v-else-if="jumpTarget"
    kind="filtered"
    :title="t('emptyState.noServicesCatalog.title')"
    :text="t('emptyState.noServicesCatalog.description')"
  >
    <template #actions>
      <OButton
        variant="primary"
        :title="jumpTargetSublabel"
        data-test="services-catalog-no-data-jump-to-data-card"
        @click="emit('jump-to-stream-data', jumpTarget.from, jumpTarget.to)"
      >
        {{ t("traces.noEvents.jumpToData") }}
      </OButton>
    </template>
  </OEmptyState>
  <OEmptyState
    v-else
    kind="filtered"
    :title="t('emptyState.noServicesCatalog.title')"
    :text="t('emptyState.noServicesCatalog.description')"
  />
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useJumpToLatestData from "@/composables/useJumpToLatestData";

// An org with no trace stream gets no advice to widen the range or switch streams; neither can help.
defineProps<{ noTraceStream?: boolean }>();
const { t } = useI18nTyped();
const { jumpTarget, jumpTargetSublabel } = useJumpToLatestData(t);

const emit = defineEmits<{
  "jump-to-stream-data": [fromUs: number, toUs: number];
}>();
</script>
