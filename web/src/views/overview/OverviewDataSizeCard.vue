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
    :title="t('overview.sections.dataSize')"
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
    <div class="flex flex-col gap-3" data-test="overview-streams-body">
      <p class="flex flex-wrap items-baseline gap-x-2">
        <span
          class="text-text-heading text-3xl font-semibold tabular-nums"
          data-test="overview-streams-total"
          >{{ sizeLabel(breakdown.totalMb) }}</span
        >
        <span class="text-text-secondary text-sm">{{ t("overview.dataSize.acrossAll") }}</span>
      </p>
      <template v-if="breakdown.totalMb > 0">
        <OSegmentedBar
          gapped
          size="lg"
          :segments="segments"
          :label="barLabel"
          data-test="overview-streams-bar"
        />
        <ul
          class="-mx-2 grid grid-cols-3 gap-x-6 max-lg:grid-cols-2 max-sm:grid-cols-1"
          data-test="overview-streams-legend"
        >
          <li
            v-for="slice in legend"
            :key="slice.key"
            class="border-border-default min-w-0 border-b"
          >
            <OverviewRowButton
              :data-test="`overview-streams-top-${slice.key}`"
              @click="emit('open')"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  :class="['size-2.5 shrink-0', slice.swatch]"
                  aria-hidden="true"
                  :data-test="`overview-streams-top-swatch-${slice.key}`"
                />
                <OIcon
                  v-if="slice.icon"
                  :name="slice.icon"
                  :label="slice.typeLabel"
                  size="sm"
                  class="text-text-secondary"
                />
                <OTruncatedText class="text-text-heading text-sm">{{
                  raw(slice.name)
                }}</OTruncatedText>
              </span>
              <span
                class="flex shrink-0 items-baseline gap-3 tabular-nums"
                :data-test="`overview-streams-top-size-${slice.key}`"
              >
                <span class="text-text-heading text-sm font-semibold">{{ slice.size }}</span>
                <span class="text-text-secondary w-9 text-end text-xs">{{ slice.share }}</span>
              </span>
            </OverviewRowButton>
          </li>
          <li
            v-if="other"
            class="border-border-default flex min-w-0 items-center justify-between gap-3 border-b px-2 py-1.5"
            data-test="overview-streams-other"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span :class="['size-2.5 shrink-0', other.swatch]" aria-hidden="true" />
              <OTruncatedText class="text-text-secondary text-sm">{{
                t("overview.dataSize.otherStreams")
              }}</OTruncatedText>
            </span>
            <span class="text-text-secondary flex shrink-0 items-baseline gap-3 tabular-nums">
              <span class="text-sm">{{ other.size }}</span>
              <span class="w-9 text-end text-xs">{{ other.share }}</span>
            </span>
          </li>
        </ul>
        <p
          class="text-text-secondary flex flex-wrap items-center gap-x-1.5 text-xs"
          data-test="overview-streams-split"
        >
          <template v-for="(row, index) in split" :key="row.signal">
            <span v-if="index > 0" aria-hidden="true">{{ raw("·") }}</span>
            <span :data-test="`overview-streams-split-${row.signal}`"
              >{{ t(`overview.signals.${row.signal}`) }}
              <span class="text-text-heading font-semibold tabular-nums">{{
                raw(`${row.percent}%`)
              }}</span></span
            >
          </template>
        </p>
      </template>
      <p v-else class="text-text-secondary text-sm" data-test="overview-streams-no-data">
        {{ t("overview.storage.emptyTitle") }}
      </p>
    </div>
    <template v-if="limitView !== 'hidden'" #footer>
      <div class="mt-4 flex flex-col gap-4">
        <OSeparator />
        <p
          v-if="limitView === 'unavailable'"
          class="text-text-secondary text-xs"
          data-test="overview-limit-unavailable"
        >
          {{ t("overview.limit.unavailable") }}
        </p>
        <div
          v-else
          class="grid grid-cols-[2fr_1fr_1fr_1fr] gap-x-8 gap-y-4 max-lg:grid-cols-2 max-md:grid-cols-1"
          data-test="overview-limit-row"
        >
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-text-label text-xs">{{ t("overview.limit.used") }}</span>
              <OTag
                v-if="status"
                type="countChip"
                :value="status.tone"
                data-test="overview-limit-status"
                >{{ status.label }}</OTag
              >
            </div>
            <p class="flex items-baseline gap-1.5 tabular-nums" data-test="overview-limit-usage">
              <span class="text-text-heading text-lg font-semibold">{{ usage.value }}</span>
              <span v-if="usage.limit" class="text-text-secondary text-sm">{{ usage.limit }}</span>
            </p>
            <OProgressBar
              v-if="hasLimit"
              size="xs"
              :value="percentToFraction(percent)"
              :variant="limitBarVariant(percent)"
              :aria-label="t('overview.limit.used')"
              data-test="overview-limit-bar"
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-text-label text-xs">{{ t("overview.limit.resetsIn") }}</span>
            <span
              class="text-text-heading text-lg font-semibold tabular-nums"
              data-test="overview-limit-resets"
              >{{ resetsIn }}</span
            >
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-text-label text-xs">{{ t("overview.limit.daysOver") }}</span>
            <p
              class="flex items-baseline gap-1.5 tabular-nums"
              data-test="overview-limit-days-over"
            >
              <span :class="['text-lg font-semibold', daysOver.tone]">{{ daysOver.days }}</span>
              <span v-if="daysOver.allowed" class="text-text-secondary text-sm">{{
                daysOver.allowed
              }}</span>
            </p>
          </div>
          <div class="flex flex-col items-start gap-1">
            <span class="text-text-label text-xs">{{ t("overview.limit.license") }}</span>
            <OTag
              type="countChip"
              :value="expired ? 'error' : 'success'"
              data-test="overview-limit-license"
              >{{ expired ? t("overview.limit.expired") : t("overview.limit.valid") }}</OTag
            >
          </div>
        </div>
      </div>
    </template>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { resolveBadge, resolveBadgeLabel } from "@/lib/core/Badge/badgeGroups";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import { segmentFill, type SegmentedBarSegment } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import config from "@/aws-exports";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type {
  OverviewLimitsData,
  OverviewSection,
  OverviewStreamsData,
} from "@/ts/interfaces/overview";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import {
  SIGNAL_VARIANT,
  dataSizeBreakdown,
  isUnderOnePercent,
  limitBarVariant,
  limitStatus,
  percentOf,
  percentToFraction,
  sectionView,
  signalSplit,
} from "./overviewFormat";
import { useOverviewTime } from "./useOverviewTime";

const props = defineProps<{
  streams?: OverviewSection<OverviewStreamsData>;
  limits?: OverviewSection<OverviewLimitsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; open: []; startIngesting: [] }>();

const { t } = useI18nTyped();
const { formatCountdown } = useOverviewTime();

// cloud has no ingest limit, so the card carries the data size alone
const isCloud = config.isCloud === "true";

// the remainder is neutral but still needs 3:1 on the card, which the muted grey misses in light mode
const OTHER_SWATCH = segmentFill("contrast");

const view = computed(() => {
  const base = sectionView(props.streams, props);
  return base === "ok" && (props.streams?.data?.total_streams ?? 0) === 0 ? "empty" : base;
});

const byType = computed(() => props.streams?.data?.by_type ?? []);
const breakdown = computed(() => dataSizeBreakdown(byType.value));
const split = computed(() => signalSplit(byType.value));

const sizeLabel = (mb: number) => raw(formatSizeFromMB(mb));

const shareLabel = (mb: number): I18nText => {
  const total = breakdown.value.totalMb;
  return isUnderOnePercent(mb, total) ? raw("<1%") : raw(`${percentOf(mb, total)}%`);
};

const legend = computed(() =>
  breakdown.value.streams.map((slice) => ({
    ...slice,
    swatch: segmentFill(SIGNAL_VARIANT[slice.signal], slice.shade),
    icon: resolveBadge("streamType", slice.signal).icon,
    typeLabel: resolveBadgeLabel("streamType", slice.signal),
    size: sizeLabel(slice.sizeMb),
    share: shareLabel(slice.sizeMb),
  })),
);

const other = computed(() => {
  const { otherMb } = breakdown.value;
  if (otherMb <= 0) return null;
  return { swatch: OTHER_SWATCH, size: sizeLabel(otherMb), share: shareLabel(otherMb) };
});

const segments = computed<SegmentedBarSegment[]>(() => {
  const list: SegmentedBarSegment[] = legend.value.map((slice) => ({
    id: slice.key,
    pct: slice.pct,
    variant: SIGNAL_VARIANT[slice.signal],
    shade: slice.shade,
    title: t("overview.dataSize.segmentTitle", {
      name: slice.name,
      size: slice.size,
      share: slice.share,
    }),
  }));
  if (other.value) {
    list.push({
      id: "other",
      pct: breakdown.value.otherPct,
      variant: "contrast",
      title: t("overview.dataSize.segmentTitle", {
        name: t("overview.dataSize.otherStreams"),
        size: other.value.size,
        share: other.value.share,
      }),
    });
  }
  return list;
});

const barLabel = computed(() => {
  const top = legend.value[0];
  if (!top) return t("overview.sections.dataSize");
  return t("overview.dataSize.barLabel", { name: top.name, share: top.share });
});

// a locked limit is an edition gap, not a fault, so the row is left out rather than explained
const limitView = computed<"hidden" | "unavailable" | "ok">(() => {
  if (isCloud || props.pending || props.failed || props.forbidden) return "hidden";
  const state = sectionView(props.limits, props);
  if (state === "locked") return "hidden";
  return state === "ok" ? "ok" : "unavailable";
});

const percent = computed(() => props.limits?.data?.ingestion_used_percent ?? 0);
const hasLimit = computed(() => props.limits?.data?.limit_today_gb != null);

const status = computed(() => {
  if (!hasLimit.value) return null;
  const level = limitStatus(percent.value);
  if (level === "over") return { tone: "error", label: t("overview.limit.overLimit") };
  if (level === "approaching") {
    return { tone: "warning", label: t("overview.limit.approachingLimit") };
  }
  return null;
});

const gb = (value: number) => raw(formatSizeFromMB(value * 1024));

// the used amount is the value; the limit it is measured against is secondary
const usage = computed<{ value: I18nText; limit?: I18nText }>(() => {
  const data = props.limits?.data;
  if (data?.used_today_gb == null) return { value: raw(`${percent.value.toFixed(1)}%`) };
  if (data.limit_today_gb == null) {
    return { value: gb(data.used_today_gb), limit: t("overview.limit.ofUnlimited") };
  }
  return {
    value: gb(data.used_today_gb),
    limit: t("overview.limit.ofLimit", { limit: gb(data.limit_today_gb) }),
  };
});

// the countdown reads the clock when a new snapshot arrives, so it is as fresh as the data
const resetsIn = computed(() => {
  const resetsAt = props.limits?.data?.resets_at;
  return resetsAt ? formatCountdown(resetsAt, Date.now()) : raw("—");
});

const daysOver = computed(() => {
  const days = props.limits?.data?.days_over_limit ?? 0;
  const allowed = props.limits?.data?.allowed_days;
  let tone = "text-text-heading";
  if (typeof allowed === "number" && days > allowed) tone = "text-status-negative";
  else if (days > 0) tone = "text-status-warning-text";
  return {
    days,
    tone,
    allowed: allowed == null ? undefined : t("overview.limit.ofAllowed", { allowed }),
  };
});

const expired = computed(() => props.limits?.data?.expired === true);
</script>
