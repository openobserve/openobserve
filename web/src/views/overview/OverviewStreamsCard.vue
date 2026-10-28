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
    :title="t('overview.sections.streams')"
    :link-label="t('overview.streams.viewStreams')"
    :view="view"
    @retry="emit('retry')"
    @view-all="emit('open')"
  >
    <template #empty>
      <OEmptyState
        size="inline"
        icon="storage"
        :title="t('overview.streams.emptyTitle')"
        :description="t('overview.streams.emptyDesc')"
        data-test="overview-streams-empty"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="overview-streams-start-ingesting-btn"
            @click="emit('startIngesting')"
          >
            {{ t("overview.streams.startIngesting") }}
          </OButton>
        </template>
      </OEmptyState>
    </template>
    <div class="flex flex-col gap-4">
      <ul class="flex flex-col" data-test="overview-streams-types">
        <li v-for="type in byType" :key="type.stream_type">
          <button
            type="button"
            class="hover:bg-table-row-hover-bg rounded-default flex w-full cursor-pointer items-center justify-between gap-3 px-2 py-1.5 text-left"
            :data-test="`overview-streams-type-${type.stream_type}`"
            @click="emit('open')"
          >
            <OTag type="streamType" :value="type.stream_type" />
            <span class="text-text-secondary text-sm">
              {{ t("overview.streams.typeSummary", { count: type.count }, type.count) }}
              {{ raw("·") }}
              {{ raw(formatSizeFromMB(type.storage_size_mb)) }}
            </span>
          </button>
        </li>
      </ul>
      <div v-if="topRows.length > 0" data-test="overview-streams-top">
        <div class="text-text-label mb-1 px-2 text-xs font-medium">
          {{ t("overview.sections.topStreams") }}
        </div>
        <ul class="flex flex-col">
          <li v-for="row in topRows" :key="`${row.stream_type}-${row.name}`">
            <button
              type="button"
              class="hover:bg-table-row-hover-bg rounded-default flex w-full cursor-pointer flex-col gap-1 px-2 py-1.5 text-left"
              :data-test="`overview-streams-top-${row.stream_type}-${row.name}`"
              @click="emit('open')"
            >
              <span class="flex items-center justify-between gap-3">
                <OTruncatedText class="text-text-body text-sm">{{ raw(row.name) }}</OTruncatedText>
                <span class="text-text-secondary shrink-0 text-xs">{{
                  raw(formatSizeFromMB(row.storage_size_mb))
                }}</span>
              </span>
              <OProgressBar :value="sizeShare(row.storage_size_mb, topRows)" size="xs" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type { OverviewSection, OverviewStreamsData } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { mergeTopStreams, sectionView, sizeShare } from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewStreamsData>;
  pending: boolean;
  failed: boolean;
}>();

const emit = defineEmits<{ retry: []; open: []; startIngesting: [] }>();

const { t } = useI18nTyped();

const byType = computed(() => (props.section?.data?.by_type ?? []).filter((x) => x.count > 0));
const topRows = computed(() => mergeTopStreams(props.section?.data?.by_type ?? []));

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && (props.section?.data?.total_streams ?? 0) === 0 ? "empty" : base;
});
</script>
