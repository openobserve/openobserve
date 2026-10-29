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
  query-language chip, reading "Not ingested" at the end of the stream line it
  refers to, so the stream it names is the one printed beside it. The dashed border and
  the opacity dim are both gone — the border only ever meant anything by
  comparison with a solid one, which is precisely what made it unreadable, and
  the dim faded the description people need in order to judge the alert. Neither
  is missed now that the card states its condition in words.

  The chip is warning-toned, not error-toned: an alert with no data yet is not
  broken. It can still be read, previewed and added, and it starts working
  when the stream arrives — which is what the tooltip says.
-->
<template>
  <!-- Not a button any more: a control nested in role="button" is invalid for keyboard and AT. -->
  <article
    class="rounded-default bg-surface-base flex h-full cursor-pointer flex-col gap-2 border p-3"
    :class="
      selected
        ? 'border-accent ring-accent/40 ring-2'
        : 'border-border-default hover:border-border-strong'
    "
    :data-test="`alert-library-card-${entry.id}`"
    :data-selected="selected ? 'true' : 'false'"
    @click="emit('open')"
  >
    <div class="flex items-start gap-2">
      <OCheckbox
        size="sm"
        :model-value="selected"
        :aria-label="t('alert_library.selectAlert', { title: entry.title })"
        class="mt-0.5 shrink-0"
        :data-test="`alert-library-select-${entry.id}`"
        @update:model-value="emit('update:selected', $event === true)"
      />
      <h3 class="min-w-0 flex-1 text-sm leading-snug font-medium">
        <button
          :id="titleId"
          type="button"
          class="text-text-heading focus-visible:ring-accent/40 rounded-default cursor-pointer text-left outline-none focus-visible:ring-2"
          :data-test="`alert-library-card-title-${entry.id}`"
          @click.stop="emit('open')"
        >
          {{ entry.title }}
        </button>
      </h3>
      <OTag
        type="severity"
        :value="severityValue"
        :label="severityText"
        class="shrink-0"
        data-test="alert-library-card-severity"
      />
    </div>

    <OTruncatedText v-if="entry.description" as="p" :lines="3" class="text-text-secondary text-xs">
      {{ entry.description }}
    </OTruncatedText>

    <div
      v-if="entry.stream"
      class="flex min-w-0 items-center gap-1.5"
      data-test="alert-library-card-stream"
    >
      <OIcon name="database" size="xs" class="text-text-secondary shrink-0" />
      <OTruncatedText class="text-text-secondary text-2xs min-w-0 flex-1 font-mono">{{
        entry.stream
      }}</OTruncatedText>
      <!-- The CHIP is neutral and only its icon carries the warning colour: most alerts are not ingested on a typical org. -->
      <OTag
        v-if="!ready"
        variant="warning-quiet"
        class="shrink-0"
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
        {{ t("alert_library.statNeedsData") }}
      </OTag>
    </div>

    <div class="mt-auto flex items-center gap-1.5 pt-1">
      <!-- Neutral because most alerts are PromQL: colouring the query language would colour the norm. -->
      <OTag
        variant="default-soft"
        :label="queryTypeLabelText"
        data-test="alert-library-card-query-type"
      />
      <OTag
        v-if="isAnomaly"
        type="alertType"
        value="anomaly_detection"
        :label="t('alert_library.alertTypeAnomaly')"
        data-test="alert-library-card-anomaly"
      />
      <OTag
        v-if="locked"
        variant="default-soft"
        icon="lock"
        :label="t('alert_library.enterprise')"
        :title="t('alert_library.enterpriseHint')"
        data-test="alert-library-card-enterprise"
      />

      <!-- Locked cards open the upsell instead, so they offer nothing to act on here. -->
      <div v-if="!locked" class="ms-auto flex shrink-0 items-center gap-2">
        <!-- The editor prefill speaks the scheduled alert shape only. -->
        <OButton
          v-if="!isAnomaly"
          variant="outline"
          size="icon-sm"
          icon-left="edit"
          :aria-label="t('alert_library.drawer.customize')"
          :aria-describedby="titleId"
          :data-test="`alert-library-card-customize-${entry.id}`"
          @click.stop="emit('customize')"
        >
          <OTooltip :content="t('alert_library.card.customizeTooltip')" />
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          :title="t('alert_library.drawer.install')"
          :aria-describedby="titleId"
          :data-test="`alert-library-card-add-${entry.id}`"
          @click.stop="emit('install')"
        >
          {{ t("common.add") }}
        </OButton>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { useI18nTyped } from "@/types/i18n";

import { alertTypeOf, queryTypeLabel, severityBadgeValue, severityLabel } from "./libraryFacets";

const props = defineProps<{
  entry: AlertLibraryEntry;
  /** Whether every stream this alert queries exists in the org. */
  ready: boolean;
  /** Selection lives in the gallery; the card only renders and reports it. */
  selected?: boolean;
  /** An anomaly alert this build is not entitled to; the gallery turns its clicks into the upsell. */
  locked?: boolean;
}>();

const emit = defineEmits<{
  (e: "open"): void;
  (e: "update:selected", value: boolean): void;
  (e: "install"): void;
  (e: "customize"): void;
}>();

const { t } = useI18nTyped();

const severityValue = computed(() => severityBadgeValue(props.entry.severity));
const severityText = computed(() => severityLabel(t, props.entry.severity));
// A query language, not prose — one correct form worldwide.
const queryTypeLabelText = computed(() => queryTypeLabel(props.entry.query_type));
const isAnomaly = computed(() => alertTypeOf(props.entry) === "anomaly");
// Every card repeats the same two button labels, so each is described by its own card's title.
const titleId = computed(() => `alert-library-card-title-id-${props.entry.id}`);
</script>
