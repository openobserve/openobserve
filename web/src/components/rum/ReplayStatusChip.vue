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
    v-if="loadState === 'failed'"
    variant="ghost-destructive"
    size="xs"
    data-test="replay-status-chip-failed"
    @click="emit('retry')"
  >
    {{ t("rum.sessionReplayLoadFailedChip") }}{{ skippedSuffix }}
  </OButton>
  <span
    v-else-if="label"
    class="border-border-default bg-surface-subtle text-text-secondary inline-flex items-center gap-1.5 rounded-full border px-2 text-xs whitespace-nowrap"
    data-test="replay-status-chip"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="dotClass" />
    {{ label }}{{ skippedSuffix }}
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { LoadState } from "@/utils/rum/sessionReplayTimeline";

const FULLY_LOADED_VISIBLE_MS = 3000;

const props = defineProps({
  loadState: { type: String as PropType<LoadState>, required: true },
  loadPercent: { type: Number, default: 0 },
  skippedParts: { type: Number, default: 0 },
});

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();

const showFullyLoaded = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const label = computed(() => {
  if (props.loadState === "loading") {
    return t("rum.sessionReplayLoadingPercent", { percent: Math.floor(props.loadPercent) });
  }
  // Live never reads "Fully loaded": more of the session is still being recorded.
  if (props.loadState === "live") return t("rum.sessionReplayLiveChip");
  if (props.loadState === "complete" && showFullyLoaded.value) {
    return t("rum.sessionReplayFullyLoaded");
  }
  return "";
});

const dotClass = computed(() => {
  if (props.loadState === "live") return "bg-badge-error-solid-bg";
  return props.loadState === "complete" ? "bg-badge-teal-solid-bg" : "bg-button-primary";
});

const skippedSuffix = computed(() =>
  props.skippedParts > 0
    ? ` ${t("rum.sessionReplaySkippedParts", { n: props.skippedParts }, props.skippedParts)}`
    : "",
);

// Only a load that finished while the user watched announces it; a session opened already complete does not.
watch(
  () => props.loadState,
  (state, previous) => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    showFullyLoaded.value = state === "complete" && previous === "loading";
    if (!showFullyLoaded.value) return;
    hideTimer = setTimeout(() => {
      showFullyLoaded.value = false;
    }, FULLY_LOADED_VISIBLE_MS);
  },
);

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer);
});
</script>
