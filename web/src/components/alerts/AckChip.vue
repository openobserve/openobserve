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
  <span class="inline-flex min-w-12 shrink-4" :data-test="dataTest">
    <OTag type="alertState" value="acknowledged" class="max-w-full min-w-0">
      <OTruncatedText as="span" class="min-w-0" :tooltip="false">
        {{ t("alerts.ack.chip", { who: shortName, source: sourceLabel, time: ackedTime }) }}
      </OTruncatedText>
    </OTag>
    <OTooltip
      :content="
        t('alerts.ack.chipTooltip', {
          who: raw(ack.acked_by),
          source: sourceLabel,
          time: ackedTime,
        })
      "
    />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { AckView } from "@/ts/interfaces/alert";
import { ackShortName, ackSourceLabel } from "@/utils/alerts/ackState";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { formatInZone } from "@/utils/oncall";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

const props = withDefaults(
  defineProps<{
    ack: Pick<AckView, "acked_by" | "acked_at" | "ack_source">;
    dataTest?: string;
  }>(),
  { dataTest: "ack-chip" },
);

const { t } = useI18nTyped();
const viewerZone = useViewerTimezone();

const shortName = computed(() => raw(ackShortName(props.ack.acked_by)));

const ackedTime = computed(() =>
  raw(formatInZone(props.ack.acked_at, viewerZone.value, { timeStyle: "short" })),
);

const sourceLabel = computed(() => ackSourceLabel(props.ack.ack_source, t));
</script>
