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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{
  icon: IconName;
  title: I18nText;
  hint?: I18nText;
  recommended?: boolean;
}>();
const emit = defineEmits<{ open: [] }>();

const { t } = useI18nTyped();
</script>

<template>
  <!-- No O2 component is a clickable card, so a native button carries the card look. -->
  <button
    type="button"
    :class="[
      'rounded-default flex w-full items-center gap-3 border px-3 py-2.5 text-start',
      'hover:bg-surface-subtle focus-visible:ring-focus-ring-accent outline-none focus-visible:ring-2',
      recommended ? 'border-accent' : 'border-border-default',
    ]"
    @click="emit('open')"
  >
    <span
      class="rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text flex size-8 shrink-0 items-center justify-center"
    >
      <OIcon :name="icon" size="sm" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-2">
        <span class="text-text-heading truncate text-sm font-medium">{{ title }}</span>
        <OBadge v-if="recommended" variant="primary-soft" size="sm" class="shrink-0">{{
          t("starterPacks.ready.recommended")
        }}</OBadge>
      </span>
      <OText v-if="hint" variant="meta" class="truncate">{{ hint }}</OText>
    </span>
    <OIcon name="chevron-right" size="sm" class="text-text-secondary shrink-0" />
  </button>
</template>
