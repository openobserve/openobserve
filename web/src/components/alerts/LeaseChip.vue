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
    <OTag tone="neutral" size="sm" class="max-w-full min-w-0">
      <OTruncatedText as="span" class="min-w-0" :tooltip="false">{{ label }}</OTruncatedText>
    </OTag>
    <OTooltip :content="tooltip" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { AlertLeaseView } from "@/ts/interfaces/alert";
import { useCountdown } from "@/composables/downtimes/useCountdown";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { serverNowMs } from "@/composables/useAnnouncementBanners";
import { formatInZone } from "@/utils/oncall";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

const props = withDefaults(
  defineProps<{
    lease: Pick<AlertLeaseView, "kind" | "set_value" | "ends_at_us" | "set_by_name" | "reason">;
    dataTest?: string;
  }>(),
  { dataTest: "lease-chip" },
);

const { t } = useI18nTyped();
const viewerZone = useViewerTimezone();

// Hidden once the end passes, without waiting for the list to refetch.
const { remainingSecs } = useCountdown(() => props.lease.ends_at_us, serverNowMs);

const params = computed(() => ({
  who: raw(props.lease.set_by_name),
  time: raw(formatInZone(props.lease.ends_at_us, viewerZone.value)),
}));

const label = computed(() => {
  if (props.lease.kind === "created") return t("alerts.lease.temporary", params.value);
  return props.lease.set_value
    ? t("alerts.lease.incidentsOn", params.value)
    : t("alerts.lease.incidentsOff", params.value);
});

// The list cell truncates the chip, so the hover repeats it in full with the reason.
const tooltip = computed(() =>
  props.lease.reason
    ? t("alerts.lease.why", { label: raw(label.value), reason: raw(props.lease.reason) })
    : label.value,
);
</script>
