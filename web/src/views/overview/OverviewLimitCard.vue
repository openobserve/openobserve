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
    :section="showLimit ? 'limit' : 'storage'"
    :title="showLimit ? t('overview.sections.limitAndStorage') : t('overview.sections.storage')"
    :subtitle="showLimit ? t('overview.limit.subtitle') : undefined"
    :view="cardView"
    @retry="emit('retry')"
  >
    <div class="border-border-default flex flex-1 flex-col gap-3 border-t p-3">
      <p
        v-if="limitView === 'unavailable'"
        class="text-text-secondary text-xs"
        data-test="overview-limit-unavailable"
      >
        {{ t("overview.limit.unavailable") }}
      </p>
      <div
        v-else-if="limitView === 'ok'"
        class="flex flex-col gap-3"
        data-test="overview-limit-body"
      >
        <div class="flex flex-col gap-1.5">
          <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span class="flex items-center gap-2">
              <span class="text-text-label text-xs">{{ t("overview.limit.used") }}</span>
              <OTag
                v-if="status"
                type="countChip"
                :value="status.tone"
                data-test="overview-limit-status"
                >{{ status.label }}</OTag
              >
            </span>
            <span class="flex items-baseline gap-1 tabular-nums" data-test="overview-limit-usage">
              <span class="text-text-heading text-sm font-semibold">{{ usage.value }}</span>
              <span v-if="usage.limit" class="text-text-secondary text-xs">{{ usage.limit }}</span>
            </span>
          </div>
          <OProgressBar
            v-if="hasLimit"
            :value="percentToFraction(percent)"
            :variant="limitBarVariant(percent)"
            :aria-label="t('overview.limit.used')"
            data-test="overview-limit-bar"
          />
          <p
            v-if="resetsLabel"
            class="text-text-secondary text-xs"
            data-test="overview-limit-resets"
          >
            {{ resetsLabel }}
          </p>
        </div>
        <div
          class="border-border-default rounded-default flex flex-col gap-0.5 border px-3.5 py-2.5"
          data-test="overview-limit-days-box"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-text-label text-xs">{{ t("overview.limit.daysOver") }}</span>
            <span
              :class="['text-sm font-semibold tabular-nums', daysOver.tone]"
              data-test="overview-limit-days-over"
              >{{ daysOver.label }}</span
            >
          </div>
          <p
            v-if="daysOver.note"
            class="text-text-secondary text-xs"
            data-test="overview-limit-block-note"
          >
            {{ daysOver.note }}
          </p>
        </div>
        <p
          v-if="expired"
          class="text-status-negative text-xs font-semibold"
          data-test="overview-limit-expired"
        >
          {{ t("overview.limit.expiredLine") }}
        </p>
      </div>
      <OSeparator v-if="limitView !== 'hidden'" />
      <OverviewSectionState
        v-if="storageView !== 'ok' && storageView !== 'empty'"
        section="storage"
        :view="storageView"
        @retry="emit('retry')"
      />
      <div v-else class="flex flex-col gap-1.5" data-test="overview-storage-body">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-text-label text-xs">{{ t("overview.storage.used") }}</span>
          <span
            class="text-text-heading text-sm font-semibold tabular-nums"
            data-test="overview-storage-total"
            >{{ raw(formatSizeFromMB(totalMb)) }}</span
          >
        </div>
        <p class="text-text-secondary text-xs">{{ t("overview.storage.splitNote") }}</p>
        <template v-if="totalMb > 0">
          <OSegmentedBar
            gapped
            class="mt-1.5"
            :segments="split.filter((x) => x.sizeMb > 0).map((x) => x.segment)"
            :label="t('overview.storage.bySignal')"
            data-test="overview-storage-bar"
          />
          <ul class="flex justify-between gap-3 text-xs" data-test="overview-storage-legend">
            <li
              v-for="row in split"
              :key="row.signal"
              class="text-text-secondary"
              :data-test="`overview-storage-legend-${row.signal}`"
            >
              {{ t(`overview.signals.${row.signal}`) }}
              <span class="tabular-nums">{{ raw(`${row.percent}%`) }}</span>
            </li>
          </ul>
        </template>
        <OEmptyState
          v-else
          size="slim"
          :title="t('overview.storage.emptyTitle')"
          data-test="overview-storage-empty"
        />
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
import config from "@/aws-exports";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type {
  OverviewLimitsData,
  OverviewSection,
  OverviewStreamsData,
} from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import OverviewSectionState from "./OverviewSectionState.vue";
import {
  limitBarVariant,
  limitStatus,
  percentToFraction,
  sectionView,
  signalSplit,
  signalTotalMb,
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

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
const { formatCountdown } = useOverviewTime();

// cloud has no ingest limit, so the card carries the data size alone
const isCloud = config.isCloud === "true";

// a whole-request state covers the card once; a single section's state stays inside its own part
const cardView = computed<OverviewView>(() => {
  if (props.pending) return "loading";
  if (props.forbidden) return "forbidden";
  if (props.failed || (!props.limits && !props.streams)) return "error";
  return "ok";
});

// a locked limit is an edition gap, not a fault, so the part is left out rather than explained
const limitView = computed<"hidden" | "unavailable" | "ok">(() => {
  if (isCloud) return "hidden";
  const state = sectionView(props.limits, props);
  if (state === "locked") return "hidden";
  return state === "ok" ? "ok" : "unavailable";
});
const showLimit = computed(() => limitView.value !== "hidden");

const byType = computed(() => props.streams?.data?.by_type ?? []);
const totalMb = computed(() => signalTotalMb(byType.value));
const split = computed(() => signalSplit(byType.value));
const storageView = computed(() => sectionView(props.streams, props));

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
const resetsLabel = computed(() => {
  const resetsAt = props.limits?.data?.resets_at;
  if (!resetsAt) return null;
  return t("overview.limit.resets", { countdown: formatCountdown(resetsAt, Date.now()) });
});

const daysOver = computed(() => {
  const days = props.limits?.data?.days_over_limit ?? 0;
  const allowed = props.limits?.data?.allowed_days;
  let tone = "text-text-heading";
  if (typeof allowed === "number" && days > allowed) tone = "text-status-negative";
  else if (days > 0) tone = "text-status-warning-text";
  if (allowed == null) return { label: raw(days), tone, note: undefined };
  return {
    label: t("overview.limit.daysOverOf", { days, allowed }),
    tone,
    note: t("overview.limit.blockNote", { allowed }, allowed),
  };
});

const expired = computed(() => props.limits?.data?.expired === true);
</script>
