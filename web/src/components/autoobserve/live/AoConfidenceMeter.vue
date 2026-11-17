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

<template>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1" data-test="ao-confidence-meter">
    <span class="text-text-secondary text-xs font-medium">{{
      t("autoobserve.issueLive.confidence.label")
    }}</span>
    <span
      class="flex items-center gap-0.5"
      role="meter"
      aria-valuemin="0"
      aria-valuemax="3"
      :aria-valuenow="level"
      :aria-valuetext="bandText"
      :aria-label="t('autoobserve.issueLive.confidence.label')"
    >
      <span
        v-for="i in 3"
        :key="i"
        class="h-1.5 w-6 rounded-full"
        :class="i <= level ? 'bg-accent' : 'bg-surface-tint-neutral'"
        data-test="ao-confidence-segment"
      />
    </span>
    <span class="text-text-heading text-xs font-semibold" data-test="ao-confidence-band">{{
      bandText
    }}</span>
    <span v-if="band && !calibrated" class="text-text-secondary text-xs">{{
      t("autoobserve.issueLive.confidence.uncalibrated")
    }}</span>
    <span
      v-if="reason"
      class="text-text-secondary basis-full text-xs"
      data-test="ao-confidence-reason"
      >{{ reason }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import type { RcaBand } from "@/services/incidents";

const props = withDefaults(
  // A null band is an unscored incident: the meter stays empty and the reason says why.
  defineProps<{ band: RcaBand | null; calibrated?: boolean; reason?: string | null }>(),
  { calibrated: false, reason: null },
);

const { t } = useI18nTyped();

const LEVEL: Record<RcaBand, 1 | 2 | 3> = { low: 1, medium: 2, high: 3 };

const BAND_KEY: Record<RcaBand, I18nKey> = {
  high: "autoobserve.issueLive.confidence.high",
  medium: "autoobserve.issueLive.confidence.medium",
  low: "autoobserve.issueLive.confidence.low",
};

const level = computed(() => (props.band ? LEVEL[props.band] : 0));
const bandText = computed(() =>
  props.band ? t(BAND_KEY[props.band]) : t("autoobserve.issueLive.confidence.none"),
);
</script>
