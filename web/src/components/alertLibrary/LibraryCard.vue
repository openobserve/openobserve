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
  would describe most cards, and a grid where almost everything is tinted green
  says nothing. The one coloured thing here is severity, which is genuinely
  per-card information.

  UNAVAILABLE CARDS SAY WHY. The earlier treatment stacked three signals —
  dashed border, 65% opacity, and a chip reading "Needs data" — none of which
  named the missing stream, even though the stream was printed on the same card
  with no stated relationship to it. The card posed a question ("why is this one
  different?") and answered it nowhere, so the difference read as arbitrary.

  Now one signal carries the meaning: the stream becomes the message, marked
  with a sensors-off icon, captioned "Not ingested", and given a row of its own
  so the name survives at card width. The dashed border stays as a quiet
  grouping cue for scanning; the opacity dim is gone — it faded the description
  text people need in order to judge the alert, and overstated the state (an
  unavailable alert can still be read, previewed and installed).
-->
<template>
  <article
    class="rounded-surface border-border-default bg-surface-base hover:border-border-strong focus-visible:ring-accent/40 flex h-full cursor-pointer flex-col gap-2 border p-3 outline-none focus-visible:ring-2"
    :class="ready ? '' : 'border-dashed'"
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

    <div class="mt-auto flex flex-col gap-1 pt-1">
      <div class="flex items-center gap-1.5">
        <!-- Neutral because most alerts are PromQL: colouring the query language
             would colour the norm. -->
        <OTag
          variant="default-soft"
          size="xs"
          :label="queryTypeLabel"
          data-test="alert-library-card-query-type"
        />

        <!-- Available: the stream is quiet provenance, tucked opposite the tag. -->
        <span
          v-if="ready"
          class="text-text-secondary text-2xs min-w-0 flex-1 truncate text-right font-mono"
          :title="entry.stream"
          >{{ entry.stream }}</span
        >
      </div>

      <!-- Unavailable: the stream becomes the message, and gets the full card
           width — stream names run long, and squeezed beside the tag it would
           truncate to a few characters, naming nothing. -->
      <span
        v-if="!ready"
        class="text-text-secondary text-2xs flex items-center gap-1"
        :title="t('alert_library.notIngestedHint', { stream: entry.stream })"
        data-test="alert-library-card-needs-data"
      >
        <OIcon name="sensors-off" size="xs" class="shrink-0" />
        <span class="shrink-0">{{ t("alert_library.notIngested") }}</span>
        <span class="min-w-0 truncate font-mono">{{ entry.stream }}</span>
      </span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
