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
  <div
    v-if="view === 'ok' || view === 'loading'"
    class="grid grid-cols-3 gap-3 max-lg:grid-cols-1"
    data-test="overview-signal-cards"
  >
    <template v-if="view === 'loading'">
      <OverviewSectionCard
        v-for="signal in OVERVIEW_SIGNALS"
        :key="signal"
        :section="`signal-${signal}`"
        :title="t(`overview.signals.${signal}`)"
        view="loading"
      />
    </template>
    <template v-else>
      <OverviewSectionCard
        v-for="card in cards"
        :key="card.signal"
        :section="`signal-${card.signal}`"
        :title="t(`overview.signals.${card.signal}`)"
        :link-label="t('overview.signals.open')"
        :link-aria-label="t(`overview.signals.openAria.${card.signal}`)"
        :view="lockedReasons?.[card.signal] ? 'locked' : 'ok'"
        :locked-message="lockedReasons?.[card.signal]"
        :can-unlock="false"
        @view-all="emit('open', card.signal)"
      >
        <template #lead>
          <span
            :class="['size-2.5 shrink-0', SEGMENT_SWATCH[SIGNAL_VARIANT[card.signal]]]"
            aria-hidden="true"
            :data-test="`overview-signal-${card.signal}-swatch`"
          />
        </template>
        <dl class="flex flex-col" :data-test="`overview-signal-${card.signal}-stats`">
          <div
            v-for="stat in card.stats"
            :key="stat.key"
            class="border-border-default flex items-baseline justify-between gap-3 border-t px-3 py-2"
          >
            <dt class="text-text-label text-xs">{{ stat.label }}</dt>
            <dd
              class="text-text-heading text-sm font-semibold tabular-nums"
              :data-test="`overview-signal-${card.signal}-${stat.key}`"
            >
              {{ stat.value }}
            </dd>
          </div>
        </dl>
      </OverviewSectionCard>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SEGMENT_SWATCH } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatEventCount, formatSizeFromMB } from "@/utils/formatters";
import type { OverviewSection, OverviewStreamsData } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import {
  OVERVIEW_SIGNALS,
  SIGNAL_VARIANT,
  sectionView,
  type OverviewSignal,
} from "./overviewFormat";

const COUNT_LABEL = { logs: "events", metrics: "samples", traces: "spans" } as const;

const props = defineProps<{
  section?: OverviewSection<OverviewStreamsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
  lockedReasons?: Partial<Record<OverviewSignal, I18nText>>;
}>();

const emit = defineEmits<{ open: [signal: OverviewSignal] }>();

const { t } = useI18nTyped();

// only the loading state draws here; the streams card already reports errors for the same section
const view = computed(() => sectionView(props.section, props));

// all three signals always show, so the row keeps three aligned cards and a missing signal reads as zero
const cards = computed(() => {
  const byType = props.section?.data?.by_type ?? [];
  return OVERVIEW_SIGNALS.map((signal) => {
    const summary = byType.find((x) => x.stream_type === signal);
    return {
      signal,
      stats: [
        { key: "streams", label: t("overview.signals.streams"), value: raw(summary?.count ?? 0) },
        {
          key: "events",
          label: t(`overview.signals.${COUNT_LABEL[signal]}`),
          value: raw(formatEventCount(summary?.doc_num ?? 0)),
        },
        {
          key: "stored",
          label: t("overview.signals.stored"),
          value: raw(formatSizeFromMB(summary?.storage_size_mb ?? 0)),
        },
      ],
    };
  });
});
</script>
