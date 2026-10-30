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
    v-if="visible"
    class="bg-surface-overlay/80 absolute inset-0 z-10 flex items-center justify-center p-3 text-center"
    :data-test="`replay-overlay-${state}`"
  >
    <div class="flex flex-col items-center gap-1.5 text-sm">
      <template v-if="state === 'error'">
        <span data-test="replay-overlay-message">{{ t("rum.sessionReplayLoadFailed") }}</span>
        <OButton size="sm" data-test="replay-overlay-retry" @click="emit('retry')">
          {{ t("rum.sessionReplayRetry") }}
        </OButton>
      </template>
      <span v-else-if="state === 'empty'" data-test="replay-overlay-message">
        {{ t("rum.noSessionReplay") }}
      </span>
      <template v-else-if="state === 'failed'">
        <span data-test="replay-overlay-message">
          {{ t("rum.sessionReplayLoadFailedRange", { from: failedFromLabel, to: failedToLabel }) }}
        </span>
        <OButton size="sm" data-test="replay-overlay-retry" @click="emit('retry')">
          {{ t("rum.sessionReplayRetry") }}
        </OButton>
      </template>
      <template v-else-if="pendingSeekMs !== null">
        <OSpinner size="sm" />
        <span data-test="replay-overlay-message">
          {{ t("rum.sessionReplayLoadingUpTo", { time: targetLabel }) }}
        </span>
        <div class="bg-surface-subtle h-1 w-56 overflow-hidden rounded-full">
          <div
            class="bg-button-primary h-full"
            data-test="replay-overlay-progress"
            :style="{ width: `${seekProgress}%` }"
          />
        </div>
        <span v-if="singleSnapshot" class="text-text-secondary text-xs">
          {{ t("rum.sessionReplaySinglePageHint", { time: targetLabel }) }}
        </span>
        <span
          v-else-if="multiTabHint"
          class="text-text-secondary text-xs"
          data-test="replay-overlay-multi-tab-hint"
        >
          {{ t("rum.sessionReplayMultiTabHint") }}
        </span>
      </template>
      <template v-else>
        <OSpinner size="sm" />
        <span data-test="replay-overlay-message">{{ t("rum.sessionReplayNextPart") }}</span>
        <span class="text-text-secondary text-xs">{{ t("rum.sessionReplayResumesOnItsOwn") }}</span>
      </template>
      <span
        v-if="retryAttempt > 1"
        class="text-text-secondary text-xs"
        data-test="replay-overlay-retrying"
      >
        {{ t("rum.sessionReplayRetrying", { attempt: retryAttempt, total: MAX_ATTEMPTS }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { MAX_ATTEMPTS } from "@/utils/rum/sessionReplayLoader";
import { formatReplayTime, toPercent, type PlaybackState } from "@/utils/rum/sessionReplayTimeline";

const props = defineProps({
  state: { type: String as PropType<PlaybackState>, required: true },
  pendingSeekMs: { type: Number as PropType<number | null>, default: null },
  loadedEndMs: { type: Number, default: 0 },
  failedFromMs: { type: Number as PropType<number | null>, default: null },
  timelineMs: { type: Number, default: 0 },
  singleSnapshot: { type: Boolean, default: false },
  multiTabHint: { type: Boolean, default: false },
  retryAttempt: { type: Number, default: 0 },
});

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();

const visible = computed(() =>
  ["buffering", "waiting", "failed", "error", "empty"].includes(props.state),
);

const targetLabel = computed(() => formatReplayTime(props.pendingSeekMs ?? 0));

const seekProgress = computed(() => toPercent(props.loadedEndMs, props.pendingSeekMs ?? 0));

const failedFromLabel = computed(() => formatReplayTime(props.failedFromMs ?? props.loadedEndMs));

const failedToLabel = computed(() => formatReplayTime(props.timelineMs));
</script>
