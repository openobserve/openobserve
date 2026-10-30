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
    section="limit"
    :title="t('overview.sections.ingestLimit')"
    :view="view"
    :locked-message="t('overview.limit.lockedMessage')"
    @retry="emit('retry')"
    @unlock="emit('unlock')"
  >
    <div class="flex flex-col gap-3" data-test="overview-limit-body">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-text-body text-sm">{{ t("overview.limit.used") }}</span>
        <span class="flex items-center gap-2">
          <OTag
            v-if="status"
            type="countChip"
            :value="status.tone"
            data-test="overview-limit-status"
            >{{ status.label }}</OTag
          >
          <span class="text-text-heading text-sm font-medium" data-test="overview-limit-usage">{{
            usageLabel
          }}</span>
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
      <p v-if="resetsLabel" class="text-text-secondary text-xs" data-test="overview-limit-resets">
        {{ resetsLabel }}
      </p>
      <div class="flex items-center justify-between gap-3">
        <span class="text-text-secondary text-sm">{{ t("overview.limit.daysOver") }}</span>
        <OTag
          type="countChip"
          :value="daysOver > 0 ? 'warning' : 'neutral'"
          data-test="overview-limit-days-over"
          >{{ daysOverLabel }}</OTag
        >
      </div>
      <p class="text-text-secondary text-xs" data-test="overview-limit-block-note">
        {{ t("overview.limit.blockNote") }}
      </p>
      <div class="flex items-center justify-between gap-3">
        <span class="text-text-secondary text-sm">{{ t("overview.limit.license") }}</span>
        <OTag
          type="countChip"
          :value="expired ? 'error' : 'success'"
          data-test="overview-limit-license"
          >{{ expired ? t("overview.limit.expired") : t("overview.limit.valid") }}</OTag
        >
      </div>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type { OverviewLimitsData, OverviewSection } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { limitLevel, percentToFraction, percentVariant, sectionView } from "./overviewFormat";
import { useOverviewTime } from "./useOverviewTime";

const props = defineProps<{
  section?: OverviewSection<OverviewLimitsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; unlock: [] }>();

const { t } = useI18nTyped();
const { formatCountdown } = useOverviewTime();

const view = computed(() => sectionView(props.section, props));
const percent = computed(() => props.section?.data?.ingestion_used_percent ?? 0);
const status = computed(() => {
  const level = limitLevel(percent.value);
  if (level === "over") return { tone: "error", label: t("overview.limit.overLimit") };
  if (level === "critical") return { tone: "error", label: t("overview.limit.nearLimit") };
  if (level === "warning") return { tone: "warning", label: t("overview.limit.approachingLimit") };
  return null;
});
const daysOver = computed(() => props.section?.data?.days_over_limit ?? 0);
const hasLimit = computed(() => props.section?.data?.limit_today_gb != null);

const gb = (value: number) => raw(formatSizeFromMB(value * 1024));

const usageLabel = computed(() => {
  const data = props.section?.data;
  const percentText = raw(`${percent.value.toFixed(1)}%`);
  if (data?.used_today_gb == null) return percentText;
  if (data.limit_today_gb == null) return gb(data.used_today_gb);
  return t("overview.limit.ofLimit", {
    used: gb(data.used_today_gb),
    limit: gb(data.limit_today_gb),
  });
});

// the countdown reads the clock when a new snapshot arrives, so it is as fresh as the data
const resetsLabel = computed(() => {
  const resetsAt = props.section?.data?.resets_at;
  if (!resetsAt) return null;
  return t("overview.limit.resets", { countdown: formatCountdown(resetsAt, Date.now()) });
});

const daysOverLabel = computed(() => {
  const allowed = props.section?.data?.allowed_days;
  if (allowed == null) return raw(daysOver.value);
  return t("overview.limit.daysOverOf", { days: daysOver.value, allowed });
});
const expired = computed(() => props.section?.data?.expired === true);
</script>
