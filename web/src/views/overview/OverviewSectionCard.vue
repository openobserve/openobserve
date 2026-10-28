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
  <OCard :data-test="`overview-${section}-card`">
    <OCardSection role="header" dense>
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-text-heading text-sm font-medium">{{ title }}</h2>
        <OButton
          v-if="linkLabel && view === 'ok'"
          variant="ghost-primary"
          size="sm"
          :data-test="`overview-${section}-view-all`"
          @click="emit('viewAll')"
        >
          {{ linkLabel }}
        </OButton>
      </div>
    </OCardSection>
    <OCardSection role="body" dense>
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
        :data-test="`overview-${section}-forbidden`"
      />
      <button
        v-else-if="view === 'locked'"
        type="button"
        class="border-border-default bg-surface-subtle rounded-default flex w-full cursor-pointer items-center gap-3 border px-4 py-5 text-left"
        :data-test="`overview-${section}-locked`"
        @click="emit('unlock')"
      >
        <OIcon name="lock" size="md" class="text-warning-600 shrink-0" />
        <span class="text-text-secondary text-sm">{{ t("overview.state.lockedMessage") }}</span>
      </button>
      <slot v-else-if="view === 'empty'" name="empty" />
      <slot v-else />
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { OverviewView } from "./overviewFormat";

defineProps<{
  section: string;
  title: I18nText;
  view: OverviewView;
  linkLabel?: I18nText;
}>();

const emit = defineEmits<{ retry: []; viewAll: []; unlock: [] }>();

const { t } = useI18nTyped();
</script>
