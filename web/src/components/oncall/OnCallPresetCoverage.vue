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

<!--
  The week the values below would build, as one picture.

  A preset is chosen from a name and a paragraph, and until this strip the only
  way to find out what the name meant was to apply it and read the calendar. The
  verdict line is the part that is acted on — "every hour covered" is the claim
  the whole preset exists to make, so it is stated, not implied by green.
-->
<template>
  <div
    class="border-border-default bg-surface-raised rounded-surface flex flex-col gap-3 border p-4"
    data-test="oncall-preset-coverage"
  >
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <OText variant="label">{{ t("oncall.presetCoverageTitle") }}</OText>
      <span
        class="flex items-center gap-1 text-xs font-medium"
        :class="verdict.tone"
        data-test="oncall-preset-coverage-verdict"
      >
        <OIcon :name="verdict.icon" size="xs" />
        {{ verdict.label }}
      </span>
    </div>

    <div class="flex gap-1.5">
      <div v-for="(column, day) in coverage.cells" :key="day" class="flex flex-1 flex-col gap-1">
        <span class="text-text-secondary text-center text-xs">{{ dayName(day) }}</span>
        <span
          v-for="(mark, band) in column"
          :key="band"
          class="h-2 rounded-full"
          :class="fillOf(mark)"
          :data-test="`oncall-preset-coverage-cell-${day}-${band}`"
          :title="cellTitle(day, band, mark)"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span
        v-for="layer in layers"
        :key="layer.key"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
      >
        <span class="size-2 rounded-full" :class="fillOf(layer.tone)" aria-hidden="true" />
        {{ describeLayer(layer) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";

import {
  BAND_HOURS,
  coverageOf,
  dayName,
  describeLayer,
  type CoverageMark,
  type PresetLayer,
} from "./OnCallSchedulePresets.shape";

const props = defineProps<{ layers: PresetLayer[] }>();

const { t } = useI18nTyped();

const coverage = computed(() => coverageOf(props.layers));

/// The decorative ramp OScheduleBand paints with — a cell and a calendar band
/// for the same layer have to be the same colour or the picture teaches nothing.
const FILLS: Record<CoverageMark, string> = {
  1: "bg-schedule-band-1-solid-bg",
  2: "bg-schedule-band-2-solid-bg",
  3: "bg-schedule-band-3-solid-bg",
  4: "bg-schedule-band-4-solid-bg",
  5: "bg-schedule-band-5-solid-bg",
  6: "bg-schedule-band-6-solid-bg",
  rest: "bg-border-strong",
  unstaffed: "bg-status-warning-bg",
  gap: "bg-schedule-gap-bg",
};

function fillOf(mark: CoverageMark): string {
  return FILLS[mark];
}

const verdict = computed<{ label: I18nText; icon: IconName; tone: string }>(() => {
  // Before anybody has been named, "168 hours belong to a layer with nobody in
  // it" is arithmetic about an empty form. Say what is actually missing.
  if (!props.layers.some((layer) => layer.members.length))
    return {
      label: t("oncall.presetCoverageNobody"),
      icon: "warning",
      tone: "text-text-secondary",
    };
  if (coverage.value.gapHours)
    return {
      label: t("oncall.presetCoverageGap", { count: coverage.value.gapHours }),
      icon: "warning",
      tone: "text-status-error-text",
    };
  if (coverage.value.unstaffedHours)
    return {
      label: t("oncall.presetCoverageUnstaffed", { count: coverage.value.unstaffedHours }),
      icon: "warning",
      tone: "text-status-warning-text",
    };
  return {
    label: t("oncall.presetCoverageComplete"),
    icon: "check",
    tone: "text-status-success-text",
  };
});

/// A cell is eight hours wide, so the hover has to name which eight — the
/// picture is otherwise unreadable to anyone counting rows.
function cellTitle(day: number, band: number, mark: CoverageMark): I18nText {
  const holder = props.layers.find((layer) => layer.tone === mark);
  const params = {
    day: String(dayName(day)),
    from: String(band * BAND_HOURS).padStart(2, "0"),
    to: String((band + 1) * BAND_HOURS).padStart(2, "0"),
  };
  return holder
    ? t("oncall.presetCoverageCellHeld", { ...params, name: String(holder.label) })
    : t("oncall.presetCoverageCell", params);
}
</script>
