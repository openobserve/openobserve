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
  <span
    v-if="remainingSecs !== null && remainingSecs > 0"
    class="inline-flex min-w-12 shrink-4"
    :data-test="dataTest"
  >
    <OTag type="downtimeStatus" value="active" class="max-w-full min-w-0">
      <span class="truncate">{{ label }}</span>
    </OTag>
    <OTooltip :content="tooltip" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { ActiveDowntime } from "@/services/downtimes";
import { useCountdown } from "@/composables/downtimes/useCountdown";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { serverNowMs } from "@/composables/useAnnouncementBanners";
import { formatDuration, formatWindowTime } from "@/utils/downtimes/schedule";
import { groupRefLabels } from "@/utils/alerts/ackState";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(
  defineProps<{
    downtime: ActiveDowntime;
    dataTest?: string;
  }>(),
  { dataTest: "muted-chip" },
);

const { t } = useI18nTyped();
const viewerZone = useViewerTimezone();

// The banner's skew-corrected clock, so chip and banner end at the same instant.
const { remainingSecs } = useCountdown(() => props.downtime.ends_at, serverNowMs);

const untilClear = computed(() => !!props.downtime.end_on_clear);
const groupCount = computed(() => props.downtime.alert_groups?.length ?? 0);

// Rounded up to the minute, so the chip never says "0 min" while it is still muted.
const label = computed(() => {
  const count = groupCount.value;
  if (untilClear.value) {
    return count
      ? t("alerts.downtimes.mute.mutedUntilClearGroups", { count }, count)
      : t("alerts.downtimes.mute.mutedUntilClear");
  }
  const duration = formatDuration(Math.max(60, Math.ceil((remainingSecs.value ?? 0) / 60) * 60), t);
  return count
    ? t("alerts.downtimes.mute.mutedGroups", { count, duration }, count)
    : t("alerts.downtimes.mute.muted", { duration });
});

// Group labels arrive only from nodes that send them; without them the hover keeps the plain text.
const groupLabels = computed(() =>
  (props.downtime.alert_groups ?? [])
    .map(groupRefLabels)
    .filter((labels): labels is string => !!labels)
    .join("; "),
);

const tooltip = computed(() => {
  const params = {
    name: props.downtime.name,
    end: formatWindowTime(props.downtime.ends_at, viewerZone.value),
  };
  const labels = groupLabels.value;
  if (labels) {
    return untilClear.value
      ? t("alerts.downtimes.mute.mutedUntilClearGroupsTooltip", { ...params, labels })
      : t("alerts.downtimes.mute.mutedGroupsTooltip", { ...params, labels });
  }
  return untilClear.value
    ? t("alerts.downtimes.mute.mutedUntilClearTooltip", params)
    : t("alerts.downtimes.mute.mutedTooltip", params);
});
</script>
