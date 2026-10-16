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
import { nextTick, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ExemplarPoint } from "@/ts/interfaces/exemplars";

const props = withDefaults(
  defineProps<{
    points: ExemplarPoint[];
    timezone?: string;
    formatValue?: (point: ExemplarPoint) => string;
  }>(),
  { timezone: "UTC", formatValue: (point: ExemplarPoint) => String(point.marker.value) },
);

const emit = defineEmits<{
  (e: "focus-marker", point: ExemplarPoint): void;
  (e: "activate-marker", point: ExemplarPoint): void;
}>();

const { t } = useI18nTyped();
const current = ref(0);
const listRef = ref<HTMLElement | null>(null);

watch(
  () => props.points.length,
  (length) => {
    if (current.value >= length) current.value = Math.max(0, length - 1);
  },
);

const labelFor = (point: ExemplarPoint) =>
  t("dashboard.exemplars.markerAria", {
    value: props.formatValue(point),
    time: formatTimestampInTimezone(
      point.marker.tsMs * 1000,
      "yyyy-MM-dd HH:mm:ss",
      props.timezone,
    ),
  });

const focusAt = async (index: number) => {
  current.value = index;
  await nextTick();
  const items = listRef.value?.querySelectorAll<HTMLElement>("[data-exemplar-index]");
  items?.[index]?.focus();
};

// Roving tabindex: the list is one Tab stop and arrow keys walk the markers.
const onKeydown = (event: KeyboardEvent, index: number) => {
  const last = props.points.length - 1;
  const moves: Record<string, number> = {
    ArrowRight: Math.min(last, index + 1),
    ArrowDown: Math.min(last, index + 1),
    ArrowLeft: Math.max(0, index - 1),
    ArrowUp: Math.max(0, index - 1),
    Home: 0,
    End: last,
  };
  if (event.key in moves) {
    event.preventDefault();
    void focusAt(moves[event.key]);
  }
};

const onFocus = (point: ExemplarPoint, index: number) => {
  current.value = index;
  emit("focus-marker", point);
};
</script>

<template>
  <div
    ref="listRef"
    class="sr-only"
    role="list"
    :aria-label="t('dashboard.exemplars.markersAria')"
    data-test="dashboard-panel-exemplar-points"
    :data-count="points.length"
  >
    <OButton
      v-for="(point, index) in points"
      :key="point.marker.id"
      role="listitem"
      variant="ghost"
      size="xs"
      :tabindex="index === current ? 0 : -1"
      :aria-label="labelFor(point)"
      data-test="dashboard-panel-exemplar-point"
      :data-exemplar-index="index"
      :data-x-px="Math.round(point.xPx)"
      :data-y-px="Math.round(point.yPx)"
      :data-trace-id="point.marker.traceId"
      :data-span-id="point.marker.spanId"
      :data-query-index="point.marker.queryIndexes.join(',')"
      :data-clamped="point.clamped || undefined"
      :data-placement="point.placement"
      @focus="onFocus(point, index)"
      @keydown="onKeydown($event, index)"
      @click="emit('activate-marker', point)"
    >
      {{ labelFor(point) }}
    </OButton>
  </div>
</template>
