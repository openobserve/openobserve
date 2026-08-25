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
  DbmRefreshButton — the reload control every DBM list table puts in its
  `#toolbar-trailing` slot.

  Nine tables carried a byte-identical copy of this button, differing only in
  their `data-test`. OTable renders `#toolbar` and `#toolbar-trailing` on either
  side of its own column-toggle, so the toolbar's two halves cannot be one
  component without moving the toggle; this owns the trailing half and
  DbmTableToolbar owns the leading one.

  WHY NOT `lib/core/RefreshButton/ORefreshButton.vue`, which already answers
  "how stale is this?": its SHAPE does not survive this slot. It is a ghost
  `size-7` button around a raw inline SVG, and it renders the relative time as
  a PERMANENT text label beside it. Dropping that into nine `#toolbar-trailing`
  slots would swap the outline icon-sm control the tables share (and that 51 of
  the app's 87 refresh sites use) for a differently-shaped one, and would spend
  toolbar width on a text label in a row already competing for it — Table
  health's bare full-width search input has none to give.

  So the AFFORDANCE is adopted and the geometry is kept: same OButton, with the
  staleness dot AND the relative age beside it — always-on, matching what the AI
  Observability pages show left of their refresh control, so "how old is this?"
  is answered at a glance rather than on hover. The reading itself is
  `ORefreshButton`'s, shared through `useDbmLastRefreshed` — same thresholds,
  same copy keys — so the two controls cannot drift into disagreeing about what
  "stale" means.
-->
<template>
  <div class="inline-flex items-center gap-1.5" :class="shrink ? 'shrink-0' : undefined">
    <!-- The dot is the colour half: it answers "should I trust this number?" at
         a glance. Rendered only once a load has succeeded — before that there is
         no staleness to report, and a grey dot on first paint would read as a
         verdict rather than as the absence of one. -->
    <span
      v-if="hasRun"
      class="size-2 shrink-0 rounded-full transition-colors duration-700"
      :class="dotClass"
      :data-test="`${dataTest}-dot`"
    >
      <!-- The dot alone encodes nothing to a reader who has not learned the
           colours, and nothing at all to a screen reader. -->
      <OTooltip side="bottom" :content="dotStatus" />
    </span>

    <!-- The words half: the relative age, always-on beside the dot (the exact
         clock time stays on the dot's hover). Shown only once a load has landed,
         for the same reason the dot is. -->
    <span
      v-if="hasRun"
      class="text-text-secondary text-xs whitespace-nowrap tabular-nums select-none"
      :data-test="`${dataTest}-age`"
    >
      {{ relative }}
    </span>

    <OButton
      variant="outline"
      size="icon-sm"
      icon-left="refresh"
      :loading="loading"
      :class="shrink ? 'shrink-0' : undefined"
      :data-test="dataTest"
      @click="emit('refresh')"
    >
      <OTooltip side="bottom" :content="t('dbm.common.reload')" />
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useDbmLastRefreshed } from "@/composables/dbm/useDbmLastRefreshed";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Spins the button while the page's fetch is in flight. */
    loading?: boolean;
    dataTest: string;
    /**
     * `shrink-0` pins the button's width inside the flex toolbar. Table health
     * puts a bare search input in the slot rather than a flex row, so it never
     * carried the class and opts out here.
     */
    shrink?: boolean;
    /**
     * Epoch milliseconds of the page's last SUCCESSFUL load. Optional: a page
     * that does not track one renders exactly what this button always did, so
     * adopting the timestamp is per-page rather than a flag day.
     */
    lastRunAt?: number | null;
  }>(),
  { loading: false, shrink: true, lastRunAt: null },
);

const emit = defineEmits<{ refresh: [] }>();

const { t } = useI18nTyped();

const { relative, dotClass, dotLabel, exact, hasRun } = useDbmLastRefreshed({
  lastRunAt: toRef(props, "lastRunAt"),
  loading: toRef(props, "loading"),
});

/** The dot's own hover text — the staleness verdict plus the exact clock time. */
const dotStatus = computed<I18nText>(() => raw(`${dotLabel.value} — ${exact.value}`));
</script>
