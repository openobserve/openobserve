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
  <div class="flex min-w-0 flex-wrap items-center gap-1" :data-test="dataTest">
    <OTag
      v-for="chip in visibleChips"
      :key="chip.key"
      type="downtimeTarget"
      :value="chip.value"
      :label="chip.label"
      class="max-w-full min-w-0"
      :data-test="`${dataTest}-${chip.key}`"
    />
    <OTag
      v-if="hiddenChips.length"
      type="countChip"
      value="neutral"
      class="shrink-0"
      :data-test="`${dataTest}-more`"
    >
      {{ t("alerts.downtimes.summary.moreTargets", { count: hiddenChips.length }) }}
      <OTooltip>
        <template #content>
          <div class="flex flex-col gap-1">
            <span v-for="chip in hiddenChips" :key="chip.key">{{ chip.label }}</span>
          </div>
        </template>
      </OTooltip>
    </OTag>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { AlertGroupRef, DimensionCondition, DowntimeTarget } from "@/services/downtimes";
import {
  alertGroupChips,
  conditionSummary,
  sortedTargets,
  targetSummary,
  type FolderNameFn,
} from "@/utils/downtimes/targetSummary";

interface Chip {
  key: string;
  value: string;
  label: I18nText;
}

const props = withDefaults(
  defineProps<{
    condition?: DimensionCondition | null;
    targets: DowntimeTarget[];
    /** The alert groups a group mute covers; each leads the row as its own chip. */
    alertGroups?: AlertGroupRef[] | null;
    folderName?: FolderNameFn;
    /** At most this many chips, the rest behind "+N"; unset shows every chip. */
    maxChips?: number;
    dataTest?: string;
  }>(),
  {
    condition: null,
    alertGroups: null,
    folderName: undefined,
    maxChips: undefined,
    dataTest: "downtime-targets",
  },
);

const { t } = useI18nTyped();

const hasIdentityTarget = computed(() => props.targets.some((tg) => tg.module !== "synthetics"));

const chips = computed<Chip[]>(() => {
  const condition = hasIdentityTarget.value ? conditionSummary(props.condition, t) : null;
  const targets = sortedTargets(props.targets).map((target) => {
    const chip = targetSummary(target, t, props.folderName);
    return {
      key: chip.module,
      value: chip.module,
      label: t("alerts.downtimes.summary.chip", { module: chip.label, text: chip.text }),
    };
  });
  const groups = alertGroupChips(props.alertGroups, t).map((g) => ({
    key: `group-${g.key}`,
    value: "group",
    label: g.label,
  }));
  return condition
    ? [...groups, { key: "condition", value: "condition", label: condition }, ...targets]
    : [...groups, ...targets];
});

// "+1" saves no room over the chip it hides, so a row that overflows by one shows it.
const visibleChips = computed(() =>
  props.maxChips == null || chips.value.length <= props.maxChips + 1
    ? chips.value
    : chips.value.slice(0, props.maxChips),
);

const hiddenChips = computed(() => chips.value.slice(visibleChips.value.length));
</script>
