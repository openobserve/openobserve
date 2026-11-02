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
    :section="isCloud ? 'storage' : 'limit'"
    :title="isCloud ? t('overview.sections.storage') : t('overview.sections.limitAndStorage')"
    :view="cardView"
    @retry="emit('retry')"
  >
    <div class="flex flex-col gap-4">
      <template v-if="!isCloud">
        <OverviewSectionState
          v-if="limitView !== 'ok'"
          section="limit"
          :view="limitView"
          :locked-message="t('overview.limit.lockedMessage')"
          @retry="emit('retry')"
          @unlock="emit('unlock')"
        />
        <div v-else class="flex flex-col gap-3" data-test="overview-limit-body">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-text-label text-xs">{{ t("overview.limit.used") }}</span>
            <span class="flex items-center gap-2">
              <OTag
                v-if="status"
                type="countChip"
                :value="status.tone"
                data-test="overview-limit-status"
                >{{ status.label }}</OTag
              >
              <span class="flex items-baseline gap-1 tabular-nums" data-test="overview-limit-usage">
                <span class="text-text-heading text-sm font-semibold">{{ usage.value }}</span>
                <span v-if="usage.limit" class="text-text-secondary text-xs">{{
                  usage.limit
                }}</span>
              </span>
            </span>
          </div>
          <p class="text-text-secondary text-xs" data-test="overview-limit-scope">
            {{ t("overview.limit.scope") }}
          </p>
          <OProgressBar
            v-if="hasLimit"
            :value="percentToFraction(percent)"
            :variant="percentVariant(percent)"
            :aria-label="t('overview.limit.used')"
            data-test="overview-limit-bar"
          />
          <p v-else class="text-text-secondary text-xs" data-test="overview-limit-no-limit">
            {{ t("overview.limit.noLimit") }}
          </p>
          <p
            v-if="resetsLabel"
            class="text-text-secondary text-xs"
            data-test="overview-limit-resets"
          >
            {{ resetsLabel }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <span class="text-text-label text-xs">{{ t("overview.limit.daysOver") }}</span>
            <OTag type="countChip" :value="daysOverTone" data-test="overview-limit-days-over">{{
              daysOverLabel
            }}</OTag>
          </div>
          <p class="text-text-secondary text-xs" data-test="overview-limit-block-note">
            {{ t("overview.limit.blockNote") }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <span class="text-text-label text-xs">{{ t("overview.limit.license") }}</span>
            <OTag
              type="countChip"
              :value="expired ? 'error' : 'success'"
              data-test="overview-limit-license"
              >{{ expired ? t("overview.limit.expired") : t("overview.limit.valid") }}</OTag
            >
          </div>
        </div>
        <OSeparator />
      </template>
      <OEmptyState
        v-if="storageView === 'empty'"
        size="slim"
        :title="t('overview.storage.emptyTitle')"
        data-test="overview-storage-empty"
      />
      <OverviewSectionState
        v-else-if="storageView !== 'ok'"
        section="storage"
        :view="storageView"
        @retry="emit('retry')"
      />
      <div v-else class="flex flex-col gap-3" data-test="overview-storage-body">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-text-label text-xs">{{ t("overview.storage.used") }}</span>
          <span
            class="text-text-heading text-base font-semibold tabular-nums"
            data-test="overview-storage-total"
            >{{ raw(formatSizeFromMB(totalMb)) }}</span
          >
        </div>
        <OSegmentedBar
          :segments="split.map((x) => x.segment)"
          size="md"
          :label="t('overview.storage.bySignal')"
          data-test="overview-storage-bar"
        />
        <ul class="flex flex-wrap gap-x-4 gap-y-1" data-test="overview-storage-legend">
          <li
            v-for="row in split"
            :key="row.signal"
            class="flex items-center gap-1.5 text-xs"
            :data-test="`overview-storage-legend-${row.signal}`"
          >
            <span
              :class="['size-2 shrink-0 rounded-full', SEGMENT_SWATCH[SIGNAL_VARIANT[row.signal]]]"
              aria-hidden="true"
            />
            <span class="text-text-label">{{ t(`overview.signals.${row.signal}`) }}</span>
            <span class="text-text-heading font-semibold tabular-nums">{{
              raw(`${row.percent}%`)
            }}</span>
          </li>
        </ul>
        <p class="text-text-secondary text-xs">{{ t("overview.storage.splitNote") }}</p>
      </div>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import { SEGMENT_SWATCH } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import config from "@/aws-exports";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type {
  OverviewLimitsData,
  OverviewSection,
  OverviewStreamsData,
} from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import OverviewSectionState from "./OverviewSectionState.vue";
import {
  SIGNAL_VARIANT,
  limitLevel,
  percentToFraction,
  percentVariant,
  sectionView,
  signalSplit,
  type OverviewView,
} from "./overviewFormat";
import { useOverviewTime } from "./useOverviewTime";

const props = defineProps<{
  limits?: OverviewSection<OverviewLimitsData>;
  streams?: OverviewSection<OverviewStreamsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; unlock: [] }>();

const { t } = useI18nTyped();
const { formatCountdown } = useOverviewTime();

// cloud has no ingest limit to show, so the card carries the data size alone
const isCloud = config.isCloud === "true";

// a whole-request state covers the card once; a single section's state stays inside its own part
const cardView = computed<OverviewView>(() => {
  if (props.pending) return "loading";
  if (props.forbidden) return "forbidden";
  if (props.failed || (!props.limits && !props.streams)) return "error";
  return "ok";
});

const limitView = computed(() => sectionView(props.limits, props));
const totalMb = computed(() => props.streams?.data?.total_storage_size_mb ?? 0);
const split = computed(() => signalSplit(props.streams?.data?.by_type ?? []));
const storageView = computed(() => {
  const base = sectionView(props.streams, props);
  return base === "ok" && totalMb.value <= 0 ? "empty" : base;
});

const percent = computed(() => props.limits?.data?.ingestion_used_percent ?? 0);
const status = computed(() => {
  const level = limitLevel(percent.value);
  if (level === "over") return { tone: "error", label: t("overview.limit.overLimit") };
  if (level === "critical") return { tone: "error", label: t("overview.limit.nearLimit") };
  if (level === "warning") return { tone: "warning", label: t("overview.limit.approachingLimit") };
  return null;
});
const daysOver = computed(() => props.limits?.data?.days_over_limit ?? 0);
const hasLimit = computed(() => props.limits?.data?.limit_today_gb != null);

const gb = (value: number) => raw(formatSizeFromMB(value * 1024));

// the used amount is the value; the limit it is measured against is secondary
const usage = computed(() => {
  const data = props.limits?.data;
  if (data?.used_today_gb == null) return { value: raw(`${percent.value.toFixed(1)}%`) };
  if (data.limit_today_gb == null) return { value: gb(data.used_today_gb) };
  return {
    value: gb(data.used_today_gb),
    limit: t("overview.limit.ofLimit", { limit: gb(data.limit_today_gb) }),
  };
});

// the countdown reads the clock when a new snapshot arrives, so it is as fresh as the data
const resetsLabel = computed(() => {
  const resetsAt = props.limits?.data?.resets_at;
  if (!resetsAt) return null;
  return t("overview.limit.resets", { countdown: formatCountdown(resetsAt, Date.now()) });
});

const daysOverLabel = computed(() => {
  const allowed = props.limits?.data?.allowed_days;
  if (allowed == null) return raw(daysOver.value);
  return t("overview.limit.daysOverOf", { days: daysOver.value, allowed });
});
const daysOverTone = computed(() => {
  const allowed = props.limits?.data?.allowed_days;
  if (typeof allowed === "number" && daysOver.value > allowed) return "error";
  return daysOver.value > 0 ? "warning" : "neutral";
});
const expired = computed(() => props.limits?.data?.expired === true);
</script>
