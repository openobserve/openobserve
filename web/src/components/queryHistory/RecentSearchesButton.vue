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
  <OButton
    v-if="enabled"
    variant="outline"
    size="icon-toolbar"
    icon-left="manage-search"
    :aria-label="t('recentSearches.title')"
    :data-test="dataTest"
    @click="emit('view-all', null)"
  >
    <OTooltip :content="t('recentSearches.title')" />
  </OButton>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import { useRecentSearches } from "@/composables/queryHistory/useRecentSearches";
import type { HistoryStatus } from "@/services/query_history";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

withDefaults(defineProps<{ dataTest?: string }>(), { dataTest: "recent-searches-btn" });

const emit = defineEmits<{
  "view-all": [status: HistoryStatus | null];
}>();

const { t } = useI18nTyped();
const { enabled } = useRecentSearches();
</script>
