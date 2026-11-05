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
  <div
    v-if="view === 'loading'"
    class="flex flex-col gap-2"
    :data-test="`overview-${section}-loading`"
  >
    <OSkeleton v-for="i in 3" :key="i" class="h-4 w-full" />
  </div>
  <OEmptyState
    v-else-if="view === 'error'"
    size="inline"
    preset="load-error"
    :data-test="`overview-${section}-error`"
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="refresh"
        :data-test="`overview-${section}-retry-btn`"
        @click="emit('retry')"
      >
        {{ t("emptyState.loadError.action") }}
      </OButton>
    </template>
  </OEmptyState>
  <OEmptyState
    v-else-if="view === 'forbidden'"
    size="inline"
    preset="no-access"
    :description="t('overview.state.sectionForbidden')"
    :data-test="`overview-${section}-forbidden`"
  />
  <OEmptyState
    v-else-if="view === 'locked' && !canUnlock"
    size="inline"
    icon="lock"
    :title="lockedMessage ?? t('overview.state.sectionLocked')"
    :data-test="`overview-${section}-locked`"
  />
  <OButton
    v-else-if="view === 'locked'"
    variant="locked-body"
    block
    icon-left="lock"
    :data-test="`overview-${section}-locked`"
    @click="emit('unlock')"
  >
    {{ lockedMessage ?? t("overview.state.sectionLocked") }}
  </OButton>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { OverviewView } from "./overviewFormat";

withDefaults(
  defineProps<{
    section: string;
    view: OverviewView;
    lockedMessage?: I18nText;
    // clicking the locked row only does something when the parent handles unlock
    canUnlock?: boolean;
  }>(),
  { canUnlock: true },
);

const emit = defineEmits<{ retry: []; unlock: [] }>();

const { t } = useI18nTyped();
</script>
