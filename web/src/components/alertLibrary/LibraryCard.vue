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

  Now ONE signal carries the meaning: a warning-toned chip, shaped like the
  query-language chip beside it, reading "Not ingested: <stream>". It gets a row
  of its own so the stream name survives at card width. The dashed border and
  the opacity dim are both gone — the border only ever meant anything by
  comparison with a solid one, which is precisely what made it unreadable, and
  the dim faded the description people need in order to judge the alert. Neither
  is missed now that the card states its condition in words.

  The chip is warning-toned, not error-toned: an alert with no data yet is not
  broken. It can still be read, previewed and installed, and it starts working
  when the stream arrives — which is what the tooltip says.
-->
<template>
  <article
    class="rounded-surface border-border-default bg-surface-base hover:border-border-strong focus-visible:ring-accent/40 flex h-full cursor-pointer flex-col gap-2 border p-3 outline-none focus-visible:ring-2"
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

      <!-- Unavailable: the same chip shape as the query language, on a row of
           its own — stream names run past 40 characters, and squeezed beside
           the other chip this one would truncate to nothing, naming the very
           thing it exists to name.

           The CHIP is neutral and only its icon carries the warning colour.
           A filled amber chip was right in principle and wrong in practice:
           959 of 1242 alerts are not ingested on a typical org, so twelve amber
           blocks landed on every screen and the colour became the page's
           background rather than a signal — loudest in dark mode, where the
           warning hue sits at full chroma against near-black. One small amber
           mark per card says the same thing and lets the text stay readable. -->
      <OTag
        v-if="!ready"
        variant="warning-quiet"
        size="xs"
        class="max-w-full min-w-0 self-start"
        :title="t('alert_library.notIngestedHint', { stream: entry.stream })"
        data-test="alert-library-card-needs-data"
      >
        <template #icon>
          <OIcon
            name="sensors-off"
            size="xs"
            class="text-badge-warning-soft-text shrink-0"
            data-test="alert-library-card-needs-data-mark"
          />
        </template>
        <span class="truncate">{{ t("alert_library.notIngested", { stream: entry.stream }) }}</span>
      </OTag>
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
