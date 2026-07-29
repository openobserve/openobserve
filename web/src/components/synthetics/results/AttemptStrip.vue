<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<script setup lang="ts">
/**
 * The attempts strip on a run detail.
 *
 * A retried execution is one record carrying every attempt it made. Before
 * this, only the attempt that decided the verdict was visible — so on a flaky
 * run the UI showed the attempt that PASSED and nothing about the failure that
 * caused the retry, which is the only part anyone opens a flaky run to read.
 *
 * Costs no request: `retry_history` is already on the run-detail row, so
 * switching attempts is local state.
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { AttemptView } from "@/composables/synthetics/syntheticResultsSchema";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps<{
  attempts: AttemptView[];
  /** 0-indexed position in `attempts`, not the attempt number. */
  selected: number;
}>();

const emit = defineEmits<{ (e: "select", index: number): void }>();

const { t } = useI18n();

/** A single-attempt run has no strip: there is nothing to switch between. */
const visible = computed(() => props.attempts.length > 1);

const current = computed<AttemptView | undefined>(() => props.attempts[props.selected]);

function fmtDur(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";
}
</script>

<template>
  <div v-if="visible" class="flex flex-col gap-2 px-2" data-test="synthetics-attempt-strip">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-text-secondary text-xs">
        {{ t("synthetics.runDetail.attemptsLabel", { count: attempts.length }) }}
      </span>

      <button
        v-for="(attempt, i) in attempts"
        :key="attempt.attempt"
        type="button"
        class="rounded-default border-border-default flex items-center gap-1.5 border px-2.5 py-1 text-xs"
        :class="[
          i === selected ? 'bg-surface-raised text-text-body' : 'text-text-secondary',
          attempt.status === 'passed'
            ? 'border-status-success-text/40'
            : 'border-status-error-text/40',
        ]"
        :data-test="`synthetics-attempt-${attempt.attempt}`"
        :aria-pressed="i === selected"
        @click="emit('select', i)"
      >
        <OIcon
          :name="attempt.status === 'passed' ? 'check-circle' : 'cancel'"
          size="xs"
          :class="
            attempt.status === 'passed' ? 'text-status-success-text' : 'text-status-error-text'
          "
        />
        <span>{{ t("synthetics.runDetail.attemptN", { n: attempt.attempt + 1 }) }}</span>
        <span class="text-text-secondary">{{ fmtDur(attempt.durationMs) }}</span>
        <!--
          "Decided" is a property of the ATTEMPT, not of the run: on a flaky run
          the deciding attempt passed while the run is reported as a warning.
        -->
        <span
          v-if="attempt.decided"
          class="text-text-secondary border-border-default border-l pl-1.5"
        >
          {{ t("synthetics.runDetail.attemptDecided") }}
        </span>
      </button>
    </div>

    <!--
      A superseded attempt keeps a compact timeline, not the full forensics —
      candidates tried, settle signals and per-step errors are only retained for
      the attempt that decided the run. Saying so beats rendering an empty
      panel that reads like missing data.
    -->
    <p
      v-if="current && current.compact"
      class="text-text-secondary text-xs"
      data-test="synthetics-attempt-reduced-detail"
    >
      {{ t("synthetics.runDetail.attemptReducedDetail") }}
    </p>
  </div>
</template>
