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
  <!-- Single stable root so the IntersectionObserver has one element to watch
       across all display states. -->
  <div ref="rootEl" class="min-h-4">
    <small
      v-if="isBounce"
      class="italic text-text-muted"
      data-test="rum-session-activity-bounced"
      >{{ t("rum.noActivityBounced") }}</small
    >

    <div
      v-else-if="activity"
      class="flex flex-col gap-0.5"
      data-test="rum-session-activity-sparkline"
    >
      <div
        class="flex items-end gap-[0.0938rem] h-7"
        role="img"
        :aria-label="ariaLabel"
        :title="ariaLabel"
      >
        <div
          v-for="bucket in activity.buckets"
          :key="bucket.index"
          class="flex flex-col items-center justify-end h-full w-1.5"
        >
          <span
            v-if="bucket.errors > 0 || bucket.frustrations > 0"
            class="w-1 h-1 rounded-full shrink-0 mb-[0.0938rem]"
            :class="bucket.errors > 0 ? 'bg-severity-error-color' : 'bg-severity-warning-color'"
            :data-test="`rum-session-activity-dot-${bucket.index}`"
          />
          <span
            class="rounded-default w-full"
            :class="bucket.events > 0 ? 'bg-accent opacity-40' : 'bg-card-glass-border opacity-60'"
            :style="{ height: barHeight(bucket.events) }"
          />
        </div>
      </div>
      <small class="text-text-secondary" data-test="rum-session-activity-events-text">{{
        t("rum.eventsCount", { count: activity.totalEvents })
      }}</small>
    </div>

    <!-- Pre-intersection cells also show the skeleton — "—" would read as
       "no data" for rows that simply haven't been fetched yet. -->
    <div
      v-else-if="loading || !started"
      class="flex items-end gap-[0.0938rem] h-7 animate-pulse"
      data-test="rum-session-activity-loading"
      :aria-label="t('rum.loadingMsg')"
    >
      <span
        v-for="index in 24"
        :key="index"
        class="rounded-default bg-card-glass-border opacity-60 w-1.5"
        :style="{ height: `${20 + ((index * 7) % 60)}%` }"
      />
    </div>

    <span v-else class="text-text-muted" data-test="rum-session-activity-empty">—</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import useSessionActivity, { type SessionActivity } from "@/composables/useSessionActivity";

const props = defineProps<{
  sessionId: string;
  /** Session start/end, epoch milliseconds (from the replay row). */
  startTime?: number;
  endTime?: number;
  isBounce?: boolean;
  /** Whether the stream schema has action_frustration_type. */
  hasFrustrationField?: boolean;
}>();

const { t } = useI18n();
const { fetchActivity } = useSessionActivity();

const activity = ref<SessionActivity | null>(null);
const loading = ref(false);
const started = ref(false);
const rootEl = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const startFetch = () => {
  if (started.value) return;
  started.value = true;
  if (props.isBounce || !props.startTime || !props.endTime) return;
  loading.value = true;
  fetchActivity(props.sessionId, props.startTime, props.endTime, props.hasFrustrationField ?? false)
    .then((result) => {
      activity.value = result;
    })
    .finally(() => {
      loading.value = false;
    });
};

// True lazy loading: the table's virtualizer over-renders far beyond the
// viewport (overscan 100), so mounting is NOT visibility — only fetch when
// the cell actually scrolls into view. Disconnect after the first trigger;
// the composable's cache makes re-entering rows instant.
onMounted(() => {
  if (props.isBounce || !props.startTime || !props.endTime) return;
  if (typeof IntersectionObserver === "undefined" || !rootEl.value) {
    startFetch();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startFetch();
        observer?.disconnect();
        observer = null;
      }
    },
    // Prefetch slightly ahead of the fold so scrolling feels instant.
    { rootMargin: "200px 0px" },
  );
  observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

const barHeight = (events: number) => {
  if (!activity.value || events <= 0) return "0.125rem";
  const pct = (events / activity.value.maxEvents) * 100;
  // Keep single-event buckets visible.
  return `${Math.max(15, pct)}%`;
};

const ariaLabel = computed(() => {
  if (!activity.value) return "";
  return t("rum.activityAriaLabel", {
    events: activity.value.totalEvents,
    errors: activity.value.totalErrors,
    frustrations: activity.value.totalFrustrations,
  });
});
</script>
