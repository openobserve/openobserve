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
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { QueryAnnotationMarker } from "@/ts/interfaces/dashboard";
import { formatTimestampInTimezone } from "@/utils/date";
import { useI18nTyped } from "@/types/i18n";
import { chartMarkerColor } from "@/utils/chartTheme";
import { placeMenu } from "@/utils/dashboard/menuPlacement";

const props = defineProps<{
  marker: QueryAnnotationMarker;
  timezone: string;
  /** Pointer position in the viewport, in CSS pixels. */
  x: number;
  y: number;
}>();

const { t } = useI18nTyped();

const TIME_FORMAT = "YYYY-MM-DD HH:mm";

const timeLabel = computed(() => {
  const start = formatTimestampInTimezone(props.marker.start_time, TIME_FORMAT, props.timezone);
  // A reversed or equal end_time draws as a line, not a range — same guard annotationRowsToMarkers applies to the marker itself.
  if (!props.marker.end_time || props.marker.end_time <= props.marker.start_time) return start;
  const end = formatTimestampInTimezone(props.marker.end_time, TIME_FORMAT, props.timezone);
  return t("dashboard.annotationSources.timeRange", { start, end });
});

const rootEl = ref<HTMLElement | null>(null);
const tooltipSize = ref({ width: 0, height: 0 });

const measure = async () => {
  await nextTick();
  tooltipSize.value = {
    width: rootEl.value?.offsetWidth ?? 0,
    height: rootEl.value?.offsetHeight ?? 0,
  };
};

onMounted(measure);
watch(() => [props.marker, props.timezone], measure);

// Opens beside the pointer, flipped and clamped against the tooltip's own measured size — same util AlertContextMenu uses.
const position = computed(() => {
  const { left, top } = placeMenu({ x: props.x, y: props.y }, tooltipSize.value, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return { left: `${left}px`, top: `${top}px` };
});

// Lightened the same way the chart mark itself is, so the dot stays visible on this same dark canvas.
const sourceDotColor = computed(() => chartMarkerColor(props.marker.source.color));
</script>

<template>
  <!-- Teleported because panel cards clip their overflow. -->
  <Teleport to="body">
    <div
      ref="rootEl"
      class="border-border-default rounded-default bg-surface-base pointer-events-none fixed z-9999999 flex max-w-72 flex-col gap-1 border px-2.5 py-2 shadow-md"
      :style="position"
      data-test="dashboard-query-annotation-tooltip"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span
          class="size-2 shrink-0 rounded-full"
          :style="{ backgroundColor: sourceDotColor }"
          data-test="dashboard-query-annotation-tooltip-dot"
        ></span>
        <span
          class="text-text-secondary min-w-0 text-xs wrap-break-word"
          data-test="dashboard-query-annotation-tooltip-source"
          >{{ marker.source.name }}</span
        >
      </div>
      <div
        v-if="marker.title"
        class="text-text-heading text-sm font-medium wrap-break-word"
        data-test="dashboard-query-annotation-tooltip-title"
      >
        {{ marker.title }}
      </div>
      <div
        v-if="marker.text"
        class="text-text-body text-xs wrap-break-word whitespace-pre-wrap"
        data-test="dashboard-query-annotation-tooltip-description"
      >
        {{ marker.text }}
      </div>
      <div class="text-text-secondary text-xs" data-test="dashboard-query-annotation-tooltip-time">
        {{ timeLabel }}
      </div>
    </div>
  </Teleport>
</template>
