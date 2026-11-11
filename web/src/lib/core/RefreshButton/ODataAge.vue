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
import { computed } from "vue";
import OIcon from "../Icon/OIcon.vue";
import OTooltip from "../../overlay/Tooltip/OTooltip.vue";
import OFailedPill from "../../feedback/FailedPill/OFailedPill.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatDataAge, formatRefreshFailed } from "@/utils/formatters";
import { DATA_AGE_MARKER_CLASS } from "./dataAgeMarker";

const props = withDefaults(
  defineProps<{
    /** Epoch ms the shown data was fetched; it never advances on a failed run. */
    at?: number | null;
    /** IANA zone for the times; the app's selected zone when absent. */
    timeZone?: string;
    /** Epoch ms of the failed refresh; set, the label turns into the red failed-refresh notice. */
    failedAt?: number | null;
    /** Charts that failed, for the page-level summary of several charts. */
    failedCount?: number;
    /** Charts refreshed in total, for the page-level summary. */
    failedTotal?: number;
    /** Tight space: a short "Refresh failed" marker whose tooltip holds the full sentence. */
    short?: boolean;
    /** Tighter still: the failed marker or the age is its icon alone, with the sentence in its tooltip. */
    iconOnly?: boolean;
    /** The failure's own words under the short marker's sentence; set, the marker is a button that emits `activate`. */
    detail?: string;
    /** A failed pill too narrow for the sentence: the short marker's words, the sentence in its tooltip, Retry kept. */
    compact?: boolean;
    dataTest?: string;
  }>(),
  {
    at: null,
    timeZone: undefined,
    failedAt: null,
    failedCount: undefined,
    failedTotal: undefined,
    short: false,
    iconOnly: false,
    detail: undefined,
    compact: false,
    dataTest: "data-age",
  },
);

const emit = defineEmits<{ retry: [event: MouseEvent]; activate: [event: MouseEvent] }>();

const { t } = useI18nTyped();

const age = computed(() =>
  props.at ? formatDataAge(t, { at: props.at, timeZone: props.timeZone }) : null,
);
const markerClass = DATA_AGE_MARKER_CLASS;
const failedText = computed(() =>
  props.failedAt && props.at
    ? formatRefreshFailed(t, {
        failedAt: props.failedAt,
        dataFrom: props.at,
        timeZone: props.timeZone,
        count: props.failedCount,
        total: props.failedTotal,
      })
    : null,
);
</script>

<template>
  <button
    v-if="failedText && short && detail"
    type="button"
    :class="[markerClass, 'cursor-pointer']"
    data-state="failed"
    :data-test="dataTest"
    @click="emit('activate', $event)"
  >
    <!-- First child, so the tooltip binds to this button, not to its hidden text. -->
    <OTooltip
      :content="raw(`${failedText}\n\n${detail}`)"
      content-class="whitespace-pre-line"
      max-width="22.5rem"
    />
    <OIcon name="error-outline" size="xs" />
    <span v-if="!iconOnly" aria-hidden="true">{{ t("dataAge.refreshFailedShort") }}</span>
    <span class="sr-only">{{ failedText }}</span>
  </button>
  <!-- Focusable so the full sentence in the tooltip is reachable from the keyboard. -->
  <span
    v-else-if="failedText && short"
    tabindex="0"
    :class="markerClass"
    data-state="failed"
    :data-test="dataTest"
  >
    <!-- First child, so the tooltip binds to this focusable marker, not to its hidden text. -->
    <OTooltip :content="failedText" />
    <OIcon name="error-outline" size="xs" />
    <span v-if="!iconOnly" aria-hidden="true">{{ t("dataAge.refreshFailedShort") }}</span>
    <span class="sr-only">{{ failedText }}</span>
  </span>
  <OFailedPill
    v-else-if="failedText"
    :sentence="failedText"
    :marker="compact ? t('dataAge.refreshFailedShort') : undefined"
    data-state="failed"
    :data-test="dataTest"
    @retry="emit('retry', $event)"
  />
  <!-- Focusable so the age in the tooltip is reachable from the keyboard. -->
  <span
    v-else-if="age && iconOnly"
    tabindex="0"
    class="text-text-secondary rounded-default focus-visible:outline-focus-ring-accent inline-flex items-center outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
    data-state="age"
    :data-test="dataTest"
  >
    <!-- First child, so the tooltip binds to this focusable marker, not to its hidden text. -->
    <OTooltip :content="age.full" />
    <OIcon name="schedule" size="xs" />
    <span class="sr-only">{{ age.full }}</span>
  </span>
  <span
    v-else-if="age"
    class="text-text-secondary text-xs whitespace-nowrap tabular-nums"
    data-state="age"
    :data-test="dataTest"
  >
    <!-- First child, so the tooltip binds to the label, not to its hidden text. -->
    <OTooltip :content="age.full" />
    <span aria-hidden="true">{{ age.text }}</span>
    <span class="sr-only">{{ age.full }}</span>
  </span>
</template>
