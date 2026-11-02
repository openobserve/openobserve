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
    <div class="-mx-2 flex flex-1 flex-col" data-test="overview-streams-top">
      <ul class="flex flex-1 flex-col justify-between">
        <li v-for="row in topRows" :key="`${row.stream_type}-${row.name}`">
          <OverviewRowButton
            :data-test="`overview-streams-top-${row.stream_type}-${row.name}`"
            @click="emit('open')"
          >
            <span class="flex w-full flex-col gap-1 text-start">
              <span class="flex items-center justify-between gap-3">
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    :class="[
                      'size-2 shrink-0 rounded-full',
                      SEGMENT_SWATCH[signalVariant(row.stream_type)],
                    ]"
                    aria-hidden="true"
                    :data-test="`overview-streams-top-swatch-${row.stream_type}-${row.name}`"
                  />
                  <OTag type="streamType" :value="row.stream_type" class="shrink-0" />
                  <OTruncatedText class="text-text-body text-sm">{{
                    raw(row.name)
                  }}</OTruncatedText>
                </span>
                <span
                  class="flex shrink-0 items-baseline gap-1.5"
                  :data-test="`overview-streams-top-size-${row.stream_type}-${row.name}`"
                >
                  <span class="text-text-heading text-sm font-semibold tabular-nums">{{
                    raw(formatSizeFromMB(row.storage_size_mb))
                  }}</span>
                  <span class="text-text-secondary text-xs tabular-nums">{{
                    isUnderOnePercent(row.storage_size_mb, totalMb)
                      ? t("overview.streams.shareUnderOne", { percent: 1 })
                      : t("overview.streams.shareOfTotal", {
                          percent: percentOf(row.storage_size_mb, totalMb),
                        })
                  }}</span>
                </span>
              </span>
              <OProgressBar
                :value="sizeShare(row.storage_size_mb, totalMb)"
                size="xs"
                :aria-label="row.name"
              />
            </span>
          </OverviewRowButton>
        </li>
      </ul>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type { OverviewSection, OverviewStreamsData } from "@/ts/interfaces/overview";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { SEGMENT_SWATCH } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import {
  mergeTopStreams,
  isUnderOnePercent,
  percentOf,
  sectionView,
  signalVariant,
  sizeShare,
} from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewStreamsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; open: []; startIngesting: [] }>();

const { t } = useI18nTyped();

const topRows = computed(() => mergeTopStreams(props.section?.data?.by_type ?? []));

const totalMb = computed(() => props.section?.data?.total_storage_size_mb ?? 0);

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && (props.section?.data?.total_streams ?? 0) === 0 ? "empty" : base;
});
</script>
