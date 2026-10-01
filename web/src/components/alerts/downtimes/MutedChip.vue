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
  <span v-if="remainingSecs > 0" class="inline-flex shrink-0" :data-test="dataTest">
    <OTag type="downtimeStatus" value="active" :label="label" />
    <OTooltip
      :content="
        t('alerts.downtimes.mute.mutedTooltip', {
          name: downtime.name,
          end: formatWindowTime(downtime.ends_at, viewerZone),
        })
      "
    />
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { ActiveDowntime } from "@/services/downtimes";
import { formatDuration, formatWindowTime } from "@/utils/downtimes/schedule";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const TICK_MS = 30_000;

const props = withDefaults(
  defineProps<{
    downtime: ActiveDowntime;
    dataTest?: string;
  }>(),
  { dataTest: "muted-chip" },
);

const { t } = useI18nTyped();
const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (nowMs.value = Date.now()), TICK_MS);
});
onBeforeUnmount(() => clearInterval(timer));

const remainingSecs = computed(() =>
  Math.floor((props.downtime.ends_at / 1000 - nowMs.value) / 1000),
);

// Rounded up to the minute, so the chip never says "0 min" while it is still muted.
const label = computed(() =>
  t("alerts.downtimes.mute.muted", {
    duration: formatDuration(Math.max(60, Math.ceil(remainingSecs.value / 60) * 60), t),
  }),
);
</script>
