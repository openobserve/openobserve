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
      v-if="conditionText"
      type="downtimeTarget"
      value="condition"
      :label="conditionText"
      :data-test="`${dataTest}-condition`"
    />
    <OTag
      v-for="chip in chips"
      :key="chip.module"
      type="downtimeTarget"
      :value="chip.module"
      :label="t('alerts.downtimes.summary.chip', { module: chip.label, text: chip.text })"
      :data-test="`${dataTest}-${chip.module}`"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { DimensionCondition, DowntimeTarget } from "@/services/downtimes";
import {
  conditionSummary,
  sortedTargets,
  targetSummary,
  type FolderNameFn,
} from "@/utils/downtimes/targetSummary";

const props = withDefaults(
  defineProps<{
    condition?: DimensionCondition | null;
    targets: DowntimeTarget[];
    folderName?: FolderNameFn;
    dataTest?: string;
  }>(),
  { condition: null, folderName: undefined, dataTest: "downtime-targets" },
);

const { t } = useI18nTyped();

const hasIdentityTarget = computed(() => props.targets.some((tg) => tg.module !== "synthetics"));

const conditionText = computed(() =>
  hasIdentityTarget.value ? conditionSummary(props.condition, t) : null,
);

const chips = computed(() =>
  sortedTargets(props.targets).map((target) => targetSummary(target, t, props.folderName)),
);
</script>
