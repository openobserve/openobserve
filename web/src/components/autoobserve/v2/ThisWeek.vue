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
  <SectionCard
    :title="t('autoobserve2.recent.title')"
    :count="problems.length || undefined"
    data-test="autoobserve2-recent"
  >
    <template v-if="problems.length" #actions>
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
      <li v-for="problem in visible" :key="problem.id">
        <ProblemEntry
          :problem="problem"
          :request="askFor(problem.id)"
          @open="emit('open-problem', problem)"
        />
      </li>
    </ul>
    <p
      v-else-if="problems.length"
      class="text-text-secondary px-5 pb-5 text-sm sm:px-6"
      data-test="autoobserve2-priority-empty"
    >
      {{ t("autoobserve2.recent.none", { priority: priority.toUpperCase() }) }}
    </p>
    <p
      v-else-if="data.quiet"
      class="text-text-secondary px-5 pb-5 text-sm sm:px-6"
      data-test="autoobserve2-recent-quiet"
    >
      {{ say(t, data.quiet) }}
    </p>

    <template v-if="filtered.length > LIMIT" #footer>
      <OButton
        variant="ghost-primary"
        size="sm"
        :icon-right="expanded ? 'expand-less' : 'expand-more'"
        data-test="autoobserve2-problems-see-all"
        @click="expanded = !expanded"
      >
        {{
          expanded
            ? t("autoobserve2.showFewer")
            : t("autoobserve2.seeAll", { count: filtered.length })
        }}
      </OButton>
    </template>
  </SectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import SectionCard from "./SectionCard.vue";
import ProblemEntry from "./ProblemEntry.vue";
import {
  PRIORITY_FILTERS as FILTERS,
  say,
  type PriorityFilter,
  type Problem,
  type RecentData,
  type Request,
} from "./fixtures";

const props = defineProps<{
  data: RecentData;
  problems: Problem[];
  requests: Request[];
}>();

const emit = defineEmits<{
  "open-problem": [problem: Problem];
}>();

const { t } = useI18nTyped();

const LIMIT = 4;

const priority = defineModel<PriorityFilter>("priority", { required: true });
const expanded = defineModel<boolean>("expanded", { default: false });

const counts = computed(
  () =>
    Object.fromEntries(
      FILTERS.map((f) => [
        f,
        f === "all" ? props.problems.length : props.problems.filter((p) => p.severity === f).length,
      ]),
    ) as Record<PriorityFilter, number>,
);

const filtered = computed(() =>
  priority.value === "all"
    ? props.problems
    : props.problems.filter((p) => p.severity === priority.value),
);

const visible = computed(() => (expanded.value ? filtered.value : filtered.value.slice(0, LIMIT)));

const askFor = (id: string) => props.requests.find((r) => r.kind === "fixNow" && r.problem === id);

const select = (value: PriorityFilter) => {
  priority.value = value;
  expanded.value = false;
};
</script>
