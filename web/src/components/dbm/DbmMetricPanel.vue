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

<!--
  DbmMetricPanel — one self-querying chart card on the DBM Metrics tab.

  Renders through `PanelSchemaRenderer` — the shared dashboards engine — so the
  card inherits units, axes, legends, tooltips, timezone conversion and theming,
  and fires its own query (the schema carries it; see utils/dbm/metricsPanels).
  The parent keys this component on the scope + window, so a change REMOUNTS it
  and the renderer fetches the new window instead of showing a stale chart.

  The renderer mounts only once the card has scrolled into view: the engine
  fetches on mount, and a page of ~40 catalog panels must not fire 40 queries
  for charts nobody has seen — the metrics explorer's preview queue states the
  same principle ("a 2,000-metric org must never fire 2,000 queries").
-->
<template>
  <section
    ref="rootEl"
    class="card-container border-border-default bg-surface-base rounded-surface flex flex-col border"
    :data-test="`dbm-metric-panel-${panelKey}`"
  >
    <div class="flex min-w-0 items-center gap-1.5 p-3 pb-1">
      <h4
        class="text-text-heading text-compact min-w-0 truncate font-medium"
        :class="identifier ? 'font-mono' : ''"
      >
        {{ title }}
      </h4>
      <OSelect
        v-if="byOptions?.length"
        :model-value="by"
        :options="byOptions"
        size="sm"
        appearance="inline"
        :searchable="false"
        class="shrink-0"
        :data-test="`dbm-metric-panel-by-${panelKey}`"
        @update:model-value="emit('update:by', $event as string)"
      />
      <OTooltip v-if="helpText" side="bottom" :content="helpText" />
      <a
        v-if="exploreUrl"
        :href="exploreUrl"
        target="_blank"
        rel="noopener"
        class="text-text-label hover:text-accent relative ml-auto shrink-0"
        :data-test="`dbm-metric-panel-explore-${panelKey}`"
      >
        <OIcon name="open-in-new" size="xs" />
        <OTooltip side="bottom" :content="t('dbm.metrics.explore')" />
      </a>
    </div>
    <div class="relative h-55 w-full px-2 pb-2">
      <PanelSchemaRenderer
        v-if="seen"
        class="h-full w-full"
        :panel-schema="schema"
        :selected-time-obj="selectedTimeObj"
        :variables-data="{}"
        search-type="ui"
        :allow-alert-creation="true"
        :allow-annotations-add="false"
        :allow-annotations-a-p-i="false"
        @updated:data-zoom="emit('zoom', $event)"
        @error="onPanelError"
      />
      <OSkeleton v-else type="rect" class="rounded-default h-full w-full" />
      <!-- A stream-permission 403 named, instead of the engine's raw
           "Unauthorized Access" body text. Non-403 errors keep the engine's
           own rendering. -->
      <div
        v-if="noAccess"
        class="bg-surface-base absolute inset-0 mx-2 mb-2 flex flex-col items-center justify-center gap-2"
        :data-test="`dbm-metric-panel-no-access-${panelKey}`"
      >
        <OIcon name="lock" class="text-text-muted size-5" />
        <span class="text-text-secondary max-w-full px-4 text-center text-xs">
          {{ t("dbm.metrics.noAccess", { stream: streamName }) }}
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { panelErrorIsForbidden } from "@/utils/dbm/metricsPanels";

// Async: the dashboards engine is heavy and must not ride the DBM shell's
// initial chunk — same reason DbmHistoryPanel defers it.
const PanelSchemaRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/PanelSchemaRenderer.vue"),
);

const props = withDefaults(
  defineProps<{
    panelKey: string;
    title: I18nText;
    /** Exporter help text — server-provided prose, may be empty. */
    help?: string;
    /** A self-querying version-2 panel schema. */
    schema: Record<string, any>;
    /** Window bounds in MICROSECONDS — see selectedTimeObj below. */
    startTime: number;
    endTime: number;
    /** Metric names render mono; translated titles (catalog panels) do not. */
    identifier?: boolean;
    /** The per-panel "by ▾" slicer; omitted = no slicer. */
    byOptions?: SelectOption[];
    by?: string;
    /** Deep link into the Metrics Explorer, for promql-backed panels. */
    exploreUrl?: string;
  }>(),
  { help: "", identifier: true, byOptions: undefined, by: undefined, exploreUrl: undefined },
);

/**
 * `zoom` relays the engine's drag-selection so the page can narrow the window;
 * `update:by` re-slices the panel.
 */
const emit = defineEmits<{
  zoom: [event: { start?: number; end?: number }];
  "update:by": [value: string];
}>();

const { t } = useI18nTyped();

const helpText = computed<I18nText | null>(() => (props.help ? raw(props.help) : null));

const streamName = computed(() => raw(props.schema?.queries?.[0]?.fields?.stream ?? ""));

/** The engine re-emits `{code: ""}` on reset, so recovery clears this too. */
const noAccess = ref(false);
const onPanelError = (event: { message?: string; code?: unknown }) => {
  noAccess.value = panelErrorIsForbidden(event);
};

// The dashboard pipeline carries timestamps as `new Date(microseconds)` so
// `.getTime()` round-trips the µs count the search backend expects. Dividing
// by 1000 here would hand the backend a 1970 window — see LLMSchemaPanel.
const selectedTimeObj = computed(() => ({
  start_time: new Date(props.startTime),
  end_time: new Date(props.endTime),
}));

/* ------------------------- viewport-gated mounting ------------------------ */

const rootEl = ref<HTMLElement | null>(null);
const seen = ref(false);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  const el = rootEl.value;
  // No observer (jsdom, thumbnails) → degrade to eager, never to blank.
  if (!el || typeof IntersectionObserver === "undefined") {
    seen.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.value = true;
        observer?.disconnect();
        observer = null;
      }
    },
    // eslint-disable-next-line local/no-hardcoded-px -- IntersectionObserver rootMargin parses px/% only — a rem value throws SyntaxError
    { rootMargin: "200px 0px" },
  );
  observer.observe(el);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>
