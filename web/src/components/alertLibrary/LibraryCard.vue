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
  LibraryCard — one alert in the gallery.

  Colour marks the exception only. There is deliberately no "Ready" pill: it
  would describe ~75 of 86 cards, and a grid where almost everything is tinted
  green says nothing. Only an alert whose streams are missing is labelled, and
  that label is NEUTRAL — the card is already receding (dashed, faded), so a
  saturated chip would make it shout and fade at the same time. The one coloured
  thing here is severity, which is genuinely per-card information.
-->
<template>
  <article
    class="rounded-surface border-border-default bg-surface-base hover:border-border-strong focus-visible:ring-accent/40 flex h-full cursor-pointer flex-col gap-2 border p-3 outline-none focus-visible:ring-2"
    :class="ready ? '' : 'border-dashed opacity-65'"
    role="button"
    tabindex="0"
    :aria-label="t('alert_library.openDetails', { title: entry.title })"
    :data-test="`alert-library-card-${entry.id}`"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <div class="flex items-start gap-2">
      <h3 class="text-text-heading min-w-0 flex-1 text-sm leading-snug font-medium">
        {{ entry.title }}
      </h3>
      <OTag
        type="severity"
        size="xs"
        :value="severityValue"
        :label="severityText"
        class="shrink-0"
        data-test="alert-library-card-severity"
      />
    </div>

    <p v-if="entry.description" class="text-text-secondary line-clamp-3 text-xs">
      {{ entry.description }}
    </p>

    <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
      <OTag
        v-if="!ready"
        variant="default-soft"
        size="xs"
        icon="sensors-off"
        :label="t('alert_library.needsData')"
        data-test="alert-library-card-needs-data"
      />
      <!-- Neutral for the same reason: 69 of 86 alerts are PromQL, so colouring
           the query language would colour the norm. -->
      <OTag
        variant="default-soft"
        size="xs"
        :label="queryTypeLabel"
        data-test="alert-library-card-query-type"
      />
      <span
        class="text-text-secondary text-2xs min-w-0 flex-1 truncate text-right font-mono"
        :title="entry.stream"
        >{{ entry.stream }}</span
      >
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { raw, useI18nTyped } from "@/types/i18n";

import { severityBadgeValue, severityLabel } from "./libraryFacets";

const props = defineProps<{
  entry: AlertLibraryEntry;
  /** Whether every stream this alert queries exists in the org. */
  ready: boolean;
}>();

const emit = defineEmits<{ (e: "open"): void }>();

const { t } = useI18nTyped();

const severityValue = computed(() => severityBadgeValue(props.entry.severity));
const severityText = computed(() => severityLabel(t, props.entry.severity));
// A query language, not prose — one correct form worldwide.
const queryTypeLabel = computed(() => raw(String(props.entry.query_type ?? "").toUpperCase()));
</script>
