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
  <OverviewSectionCard
    section="streams"
    :title="t('overview.sections.topStreams')"
    :subtitle="t('overview.streams.subtitle')"
    :link-label="
      view === 'empty' ? t('overview.streams.startIngesting') : t('overview.streams.allStreams')
    "
    :view="view"
    @retry="emit('retry')"
    @view-all="view === 'empty' ? emit('startIngesting') : emit('open')"
  >
    <template #empty>
      <OEmptyState
        size="slim"
        :title="t('overview.streams.emptyTitle')"
        :description="t('overview.streams.emptyDesc')"
        data-test="overview-streams-empty"
      />
    </template>
    <ul class="flex flex-col" data-test="overview-streams-top">
      <li
        v-for="row in rows"
        :key="`${row.stream_type}-${row.name}`"
        class="border-border-default border-t"
      >
        <OverviewRowButton
          :data-test="`overview-streams-top-${row.stream_type}-${row.name}`"
          @click="emit('open')"
        >
          <span
            class="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,15rem)_5rem] items-center gap-4 max-sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <span class="flex min-w-0 flex-col text-start">
              <OTruncatedText class="text-text-body text-sm font-medium">{{
                raw(row.name)
              }}</OTruncatedText>
              <span
                class="text-text-secondary text-xs"
                :data-test="`overview-streams-top-share-${row.stream_type}-${row.name}`"
                >{{ row.sub }}</span
              >
            </span>
            <OSegmentedBar
              size="md"
              class="max-sm:hidden"
              :segments="[{ id: 'share', pct: row.barPct, variant: row.variant }]"
              :data-test="`overview-streams-top-bar-${row.stream_type}-${row.name}`"
            />
            <span
              class="text-text-heading text-end text-sm font-semibold tabular-nums"
              :data-test="`overview-streams-top-size-${row.stream_type}-${row.name}`"
              >{{ raw(formatSizeFromMB(row.storage_size_mb)) }}</span
            >
          </span>
        </OverviewRowButton>
      </li>
    </ul>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { resolveBadgeLabel } from "@/lib/core/Badge/badgeGroups";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type { OverviewSection, OverviewStreamsData } from "@/ts/interfaces/overview";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { SIGNAL_VARIANT, isSignal, sectionView, topStreamShares } from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewStreamsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; open: []; startIngesting: [] }>();

const { t } = useI18nTyped();

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && (props.section?.data?.total_streams ?? 0) === 0 ? "empty" : base;
});

const rows = computed(() => {
  const data = props.section?.data;
  return topStreamShares(data?.by_type ?? [], data?.total_storage_size_mb ?? 0).map((row) => ({
    ...row,
    variant: isSignal(row.stream_type) ? SIGNAL_VARIANT[row.stream_type] : ("muted" as const),
    sub: t("overview.streams.typeShare", {
      type: resolveBadgeLabel("streamType", row.stream_type),
      share: row.underOne
        ? t("overview.streams.shareUnderOne")
        : t("overview.streams.shareOfTotal", { percent: row.percent }),
    }),
  }));
});
</script>
