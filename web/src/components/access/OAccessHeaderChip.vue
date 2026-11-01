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
  <OPopover
    v-model:open="open"
    side="bottom"
    align="end"
    flip-align
    arrow
    :side-offset="-1"
    :collision-padding="8"
    content-class="border-0!"
    :aria-label="t('accessBoundary.chip.popoverLabel')"
    @open-auto-focus="focusCard"
  >
    <template #trigger>
      <OButton
        variant="ghost-destructive"
        size="sm"
        icon-left="lock"
        :aria-label="t('accessBoundary.chip.ariaLabel', { title: message.title })"
        data-test="access-header-chip"
      >
        <span class="max-md:hidden">{{ t("accessBoundary.chip.label") }}</span>
        <OBadge variant="error-soft" size="sm">{{ message.resourceCount }}</OBadge>
      </OButton>
    </template>
    <OAccessDeniedCard
      ref="card"
      :denials="denials"
      role="status"
      data-test="access-header-popover"
    />
    <template #arrow>
      <path class="fill-dropdown-bg" d="M0 0L6 6L12 0Z" />
      <path class="fill-banner-error-soft-bg" d="M0 0L6 6L12 0Z" />
      <path class="stroke-banner-error-soft-border fill-none" d="M0 0L6 6L12 0" />
    </template>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OAccessDeniedCard from "@/components/access/OAccessDeniedCard.vue";
import { accessDeniedMessage, sortDenials, useAccessBoundary } from "@/composables/useAccessStore";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const { sectionEntries } = useAccessBoundary();

const open = ref(false);
const denials = computed(() => sortDenials(sectionEntries.value, t));
const message = computed(() => accessDeniedMessage(denials.value, t));
const card = ref<{ focus: () => void } | null>(null);

// The card takes focus instead of its first button, so a mouse open shows no focus ring.
function focusCard(event: Event): void {
  event.preventDefault();
  card.value?.focus();
}
</script>
