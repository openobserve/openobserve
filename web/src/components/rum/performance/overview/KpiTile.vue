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
  <KpiCard
    as="router-link"
    :to="to"
    :label="label"
    :aria-label="ariaLabel"
    :data-test="dataTest"
    class="no-underline"
  >
    <template #value>
      <span class="text-text-heading text-2xl font-bold" :data-test="`${dataTest}-value`">
        {{ value }}
      </span>
      <span class="text-text-secondary text-xs lg:hidden" :data-test="`${dataTest}-compact`">
        {{ label }} ·
        <span :class="TONE[delta?.tone ?? 'flat']">{{ deltaText }}</span>
      </span>
    </template>
    <template #trend>
      <span
        class="text-xs font-semibold"
        :class="TONE[delta?.tone ?? 'flat']"
        :data-test="`${dataTest}-delta`"
      >
        {{ deltaText }}
      </span>
    </template>
    <template #footer>
      <OSparkline
        :points="spark"
        :tone="sparkTone"
        size="sm"
        :aria-label="t('rum.overviewPage.sparkAria', { label })"
        :data-test="`${dataTest}-trend`"
      />
    </template>
  </KpiCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import KpiCard from "@/components/common/KpiCard.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { SparklineTone } from "@/lib/data/Sparkline/OSparkline.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { deltaSentenceKey, type KpiDelta } from "@/utils/rum/performanceOverview";

const props = defineProps<{
  label: I18nText;
  value: I18nText;
  delta: KpiDelta | null;
  /** The change is in percentage points, not percent. */
  points?: boolean;
  spark: number[];
  sparkTone: SparklineTone;
  to: RouteLocationRaw;
  dataTest: string;
  ariaLabel: I18nText;
}>();
const { t } = useI18nTyped();

const TONE = {
  good: "text-status-success-text",
  bad: "text-status-error-text",
  flat: "text-text-secondary",
} as const;

const deltaText = computed(() =>
  props.delta
    ? t(deltaSentenceKey(props.delta, !!props.points), { delta: raw(props.delta.text) })
    : t("rum.overviewPage.deltaNoPrev"),
);
</script>
