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

<script setup lang="ts">
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { EmptyStateKind } from "@/lib/core/EmptyState/OEmptyState.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{
  title: I18nText;
  description?: I18nText;
  working?: boolean;
  icon?: IconName;
  kind?: EmptyStateKind;
}>();
</script>

<template>
  <OCard>
    <div
      v-if="working"
      class="flex flex-col items-center gap-3 py-10 text-center"
      role="status"
      data-test="slack-link-card-working"
    >
      <OSpinner size="lg" />
      <p class="text-text-heading text-sm font-medium">{{ title }}</p>
      <p v-if="description" class="text-text-secondary text-sm">{{ description }}</p>
    </div>
    <OEmptyState v-else :kind="kind" :icon="icon" :title="title" :text="description">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
      <template v-if="$slots.extra" #extra>
        <slot name="extra" />
      </template>
    </OEmptyState>
  </OCard>
</template>
