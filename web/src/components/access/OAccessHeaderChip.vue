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
        :size="compactChip ? 'chip' : 'sm'"
        icon-left="lock"
        :aria-label="chipName"
        data-test="access-header-chip"
      >
        <span v-if="!compactChip">{{ t("accessBoundary.chip.label") }}</span>
        <OBadge variant="error-soft" size="sm">{{ message.count }}</OBadge>
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
  <span role="status" aria-live="polite" class="sr-only" data-test="access-header-chip-announcer">{{
    announcement
  }}</span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OAccessDeniedCard from "@/components/access/OAccessDeniedCard.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { withoutCovered } from "@/components/access/surfaceDenials";
import { accessDeniedMessage, sortDenials, useAccessBoundary } from "@/composables/useAccessStore";
import { useI18nTyped, type I18nText } from "@/types/i18n";

// Screen readers skip text that arrives together with its live region, so the first announcement waits for the region to register.
const ANNOUNCE_DELAY_MS = 150;

const props = withDefaults(
  defineProps<{
    /** Set by a host that knows whether its own row wraps; other hosts follow the viewport. */
    compact?: boolean;
  }>(),
  { compact: undefined },
);

const { t } = useI18nTyped();
const { sectionEntries } = useAccessBoundary();
const { lgUp } = useBreakpoint();
const compactChip = computed(() => props.compact ?? !lgUp.value);

const open = ref(false);
const denials = computed(() => sortDenials(withoutCovered(sectionEntries.value), t));
const message = computed(() => accessDeniedMessage(denials.value, t));
const card = ref<{ focus: () => void } | null>(null);
const chipName = computed(() => t("accessBoundary.chip.ariaLabel", { title: message.value.title }));

// Set only when the name changes, so a re-render with the same denials leaves the region's text, and the reader, alone.
const announcement = ref<I18nText | null>(null);
let announceTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => {
  announceTimer = setTimeout(() => (announcement.value = chipName.value), ANNOUNCE_DELAY_MS);
});
watch(chipName, (name) => {
  if (announcement.value !== null) announcement.value = name;
});
onBeforeUnmount(() => clearTimeout(announceTimer));

// The card takes focus instead of its first button, so a mouse open shows no focus ring.
function focusCard(event: Event): void {
  event.preventDefault();
  card.value?.focus();
}
</script>
