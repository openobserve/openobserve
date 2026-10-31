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
    v-if="change"
    class="inline-flex flex-wrap items-baseline gap-x-1 tabular-nums"
    :class="end ? 'justify-end text-end' : ''"
    :data-tone="change.lowVolume ? 'low' : direction"
  >
    <span :class="toneClass">{{ label }}</span>
    <span
      v-if="change.lowVolume"
      class="text-text-secondary text-xs"
      data-test="rum-analytics-funnel-low-volume"
      >{{ t("rum.analytics.funnel.lowVolume") }}</span
    >
    <OTooltip :content="tip" />
  </span>
  <span v-else class="text-text-secondary tabular-nums" :class="end ? 'text-end' : ''"
    >{{ dash }}<OTooltip v-if="failed" :content="t('rum.analytics.funnel.previousFailed')"
  /></span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { changeDirection, formatPts, type RateChange } from "@/utils/rum/funnelCompare";

const props = defineProps<{
  change: RateChange | null;
  unitNoun: I18nText;
  failed?: boolean;
  end?: boolean;
}>();
const { t } = useI18nTyped();
const dash = raw("—");
const ARROWS = { up: "▲ ", down: "▼ ", flat: "" } as const;

const direction = computed(() => (props.change ? changeDirection(props.change) : "flat"));

const label = computed<I18nText>(() =>
  props.change
    ? t("rum.analytics.funnel.changePts", {
        arrow: raw(ARROWS[direction.value]),
        value: raw(formatPts(props.change.pts)),
      })
    : dash,
);

// Grey is the low-volume signal, so it outranks the direction's colour.
const toneClass = computed(() => {
  if (!props.change || props.change.lowVolume) return "text-text-secondary";
  if (direction.value === "up") return "text-status-success-text";
  return direction.value === "down" ? "text-status-error-text" : "text-text-body";
});

const tip = computed<I18nText>(() =>
  props.change
    ? t("rum.analytics.funnel.changeTooltip", {
        ci: raw(formatPts(props.change.ci95)),
        cur: addCommasToNumber(props.change.curN),
        prev: addCommasToNumber(props.change.prevN),
        unit: props.unitNoun,
      })
    : dash,
);
</script>
