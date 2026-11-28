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

<!-- A graded band: three bars, "<band> confidence", and why the band is what it is. -->
<template>
  <span
    class="text-text-heading inline-flex items-center gap-1.5 font-semibold"
    :class="compact ? 'text-xs' : 'text-sm'"
  >
    <span class="inline-flex h-3 items-end gap-0.5" aria-hidden="true">
      <span
        v-for="bar in 3"
        :key="bar"
        class="w-1 rounded-xs"
        :class="[
          BAR_HEIGHT[bar - 1],
          bar <= rcaBandLevel(band ?? undefined) ? 'bg-accent' : 'bg-border-default',
        ]"
      />
    </span>
    <span data-test="rca-verdict-band" :data-band="band ?? 'none'">{{ bandText }}</span>
    <OPopover
      v-if="breakdown"
      side="bottom"
      align="start"
      :aria-label="t('alerts.incidents.rcaLight.whyConfidence')"
    >
      <template #trigger>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="info-outline"
          data-test="rca-verdict-band-info"
          :aria-label="t('alerts.incidents.rcaLight.whyConfidence')"
        />
      </template>
      <div
        data-test="rca-verdict-confidence-why"
        class="flex w-96 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
      >
        <span class="text-text-heading text-sm font-semibold">
          {{ t("alerts.incidents.rcaLight.whyBand", { band: bandWord(band) }) }}
        </span>
        <dl class="text-compact m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt class="text-text-secondary">
            {{ t("alerts.incidents.rcaSummary.confidenceClaimed") }}
          </dt>
          <dd data-test="rca-confidence-claimed" class="text-text-heading m-0 font-semibold">
            {{ bandWord(breakdown.claimed) }}
          </dd>
          <dt class="text-text-secondary">
            {{ t("alerts.incidents.rcaSummary.confidenceEvidence") }}
          </dt>
          <dd data-test="rca-confidence-evidence" class="text-text-body m-0">
            <span class="text-text-heading font-semibold">{{ bandWord(breakdown.evidence) }}</span>
            · {{ breakdown.evidence_reason }}
          </dd>
          <template v-if="breakdown.next_level">
            <dt class="text-text-secondary">{{ t("alerts.incidents.rcaLight.nextLevel") }}</dt>
            <dd class="text-text-body m-0">{{ breakdown.next_level }}</dd>
          </template>
          <template v-if="breakdown.caps.length > 0">
            <dt class="text-text-secondary">
              {{ t("alerts.incidents.rcaSummary.confidenceCapped", { band: bandWord("medium") }) }}
            </dt>
            <dd data-test="rca-confidence-caps" class="text-text-body m-0">
              {{ listOf(breakdown.caps) }}
            </dd>
          </template>
        </dl>
      </div>
    </OPopover>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { getIntlLocale } from "@/locales";
import type { RcaBand, RcaConfidenceBreakdown } from "@/services/incidents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { rcaBandLevel } from "@/utils/incidents/rcaSummary";

const props = withDefaults(
  defineProps<{
    band?: RcaBand | null;
    /** Why the band is what it is; without it there is no info button. */
    breakdown?: RcaConfidenceBreakdown | null;
    /** Caption-sized, for a card that already has a title. */
    compact?: boolean;
  }>(),
  { band: null, breakdown: null, compact: false },
);

const { t } = useI18nTyped();

/** Heights of the three band bars. */
const BAR_HEIGHT = ["h-1.5", "h-2.25", "h-3"] as const;

const BAND_WORD: Record<RcaBand, I18nText> = {
  high: t("alerts.incidents.aiAnalysis.band.high"),
  medium: t("alerts.incidents.aiAnalysis.band.medium"),
  low: t("alerts.incidents.aiAnalysis.band.low"),
};
const bandWord = (band: RcaBand | null | undefined) => (band ? BAND_WORD[band] : raw("—"));
const listOf = (items: string[]) => new Intl.ListFormat(getIntlLocale()).format(items);
const bandText = computed(() =>
  t("alerts.incidents.rcaLight.bandConfidence", { band: bandWord(props.band) }),
);
</script>
