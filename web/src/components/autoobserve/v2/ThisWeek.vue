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
  <SectionCard :count="ranged.length || undefined" data-test="autoobserve2-recent">
    <template #title>
      <h2 class="text-text-heading text-base font-semibold whitespace-nowrap">
        <ODropdown align="start">
          <template #trigger>
            <button
              type="button"
              class="hover:bg-surface-subtle-hover focus-visible:ring-focus-ring-accent rounded-default -ms-2 inline-flex items-center gap-1 px-2 py-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              data-test="autoobserve2-range"
            >
              {{ t(RANGE_LABEL[range]) }}
              <OIcon name="expand-more" size="sm" class="text-text-secondary" />
            </button>
          </template>
          <ODropdownItem
            v-for="option in PROBLEM_RANGES"
            :key="option"
            :data-test="`autoobserve2-range-${option}`"
            @select="selectRange(option)"
          >
            <span class="flex-1">{{ t(RANGE_LABEL[option]) }}</span>
            <template #icon-right>
              <OIcon
                name="check"
                size="sm"
                :class="option === range ? 'text-text-heading' : 'invisible'"
              />
            </template>
          </ODropdownItem>
        </ODropdown>
      </h2>
    </template>
    <template v-if="ranged.length" #actions>
      <OToggleGroup
        :model-value="priority"
        data-test="autoobserve2-priority-filter"
        @update:model-value="(v) => v && select(v as PriorityFilter)"
      >
        <OToggleGroupItem
          v-for="option in FILTERS"
          :key="option"
          :value="option"
          size="xs"
          :disabled="!counts[option]"
          :data-test="`autoobserve2-priority-${option}`"
        >
          {{ option === "all" ? t("autoobserve2.recent.all") : option.toUpperCase() }}
          <span class="ms-1 tabular-nums opacity-70">{{ counts[option] }}</span>
        </OToggleGroupItem>
      </OToggleGroup>
    </template>

    <ul
      v-if="filtered.length"
      class="border-border-subtle divide-border-subtle divide-y border-t"
      data-test="autoobserve2-problems"
    >
      <li v-for="row in visible" :key="row.problem.id">
        <p
          v-if="row.group !== undefined"
          class="bg-surface-subtle text-text-secondary px-5 py-1.5 text-xs font-medium sm:px-6"
          :data-test="`autoobserve2-problems-group-${row.group}`"
        >
          {{ groupLabel(row.group) }}
        </p>
        <ProblemEntry
          :problem="row.problem"
          :request="askFor(row.problem.id)"
          @open="emit('open-problem', row.problem)"
        />
      </li>
    </ul>
    <p
      v-else-if="ranged.length"
      class="text-text-secondary px-5 pb-5 text-sm sm:px-6"
      data-test="autoobserve2-priority-empty"
    >
      {{ t("autoobserve2.recent.none", { priority: priority.toUpperCase(), within: within }) }}
    </p>
    <p
      v-else
      class="text-text-secondary px-5 pb-5 text-sm sm:px-6"
      data-test="autoobserve2-recent-quiet"
    >
      {{ t("autoobserve2.noProblems", { within: within, count: serviceCount }, serviceCount) }}
    </p>

    <template #footer>
      <div class="flex flex-wrap items-center gap-2">
        <OButton
          v-if="remaining"
          variant="ghost-primary"
          size="sm"
          icon-right="expand-more"
          data-test="autoobserve2-problems-show-more"
          @click="shown = visible.length + Math.min(remaining, STEP)"
        >
          {{ t("autoobserve2.showMore", { count: Math.min(remaining, STEP) }) }}
        </OButton>
        <OButton
          v-else-if="filtered.length > base"
          variant="ghost-primary"
          size="sm"
          icon-right="expand-less"
          data-test="autoobserve2-problems-show-fewer"
          @click="shown = 0"
        >
          {{ t("autoobserve2.showFewer") }}
        </OButton>
        <OButton
          variant="ghost-primary"
          size="sm"
          icon-right="arrow-forward"
          class="ms-auto"
          data-test="autoobserve2-all-issues"
          @click="emit('open-issues')"
        >
          {{ t("autoobserve2.recent.allIssues") }}
        </OButton>
      </div>
    </template>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import SectionCard from "./SectionCard.vue";
import ProblemEntry from "./ProblemEntry.vue";
import {
  PRIORITY_FILTERS as FILTERS,
  PROBLEM_RANGES,
  inRange,
  weeksAgo,
  type PriorityFilter,
  type Problem,
  type ProblemRange,
  type Request,
} from "./fixtures";

const props = defineProps<{
  problems: Problem[];
  requests: Request[];
  serviceCount: number;
}>();

const emit = defineEmits<{
  "open-problem": [problem: Problem];
  "open-issues": [];
}>();

const { t } = useI18nTyped();

const STEP = 10;

const RANGE_LABEL: Record<ProblemRange, I18nKey> = {
  "24h": "autoobserve2.recent.ranges.day",
  "7d": "autoobserve2.recent.ranges.week",
  "30d": "autoobserve2.recent.ranges.month",
};

const RANGE_WITHIN: Record<ProblemRange, I18nKey> = {
  "24h": "autoobserve2.recent.within.day",
  "7d": "autoobserve2.recent.within.week",
  "30d": "autoobserve2.recent.within.month",
};

const range = defineModel<ProblemRange>("range", { required: true });
const priority = defineModel<PriorityFilter>("priority", { required: true });
// Rows on screen beyond the default; 0 means the default.
const shown = defineModel<number>("shown", { default: 0 });

const within = computed(() => t(RANGE_WITHIN[range.value]));
const grouped = computed(() => range.value === "30d");
const base = computed(() => (grouped.value ? 6 : 4));

const ranged = computed(() => props.problems.filter((p) => inRange(p, range.value)));

const countIn = (list: Problem[], f: PriorityFilter) =>
  f === "all" ? list.length : list.filter((p) => p.severity === f).length;

const counts = computed(
  () =>
    Object.fromEntries(FILTERS.map((f) => [f, countIn(ranged.value, f)])) as Record<
      PriorityFilter,
      number
    >,
);

// Problems arrive sorted by priority then newest; a stable sort by week keeps that order inside each week.
const filtered = computed(() => {
  const list =
    priority.value === "all"
      ? ranged.value
      : ranged.value.filter((p) => p.severity === priority.value);
  return grouped.value ? [...list].sort((a, b) => weeksAgo(a) - weeksAgo(b)) : list;
});

const visible = computed(() =>
  filtered.value.slice(0, Math.max(shown.value, base.value)).map((problem, i, rows) => {
    const week = weeksAgo(problem);
    const first = grouped.value && (i === 0 || weeksAgo(rows[i - 1]) !== week);
    return { problem, group: first ? week : undefined };
  }),
);

const remaining = computed(() => filtered.value.length - visible.value.length);

const groupLabel = (week: number) =>
  week === 0
    ? t("autoobserve2.recent.groups.thisWeek")
    : week === 1
      ? t("autoobserve2.recent.groups.lastWeek")
      : t("autoobserve2.recent.groups.weeksAgo", { count: week });

const askFor = (id: string) => props.requests.find((r) => r.kind === "fixNow" && r.problem === id);

const select = (value: PriorityFilter) => {
  priority.value = value;
  shown.value = 0;
};

const selectRange = (value: ProblemRange) => {
  range.value = value;
  shown.value = 0;
  const left = props.problems.filter((p) => inRange(p, value));
  if (!countIn(left, priority.value)) priority.value = "all";
};
</script>
