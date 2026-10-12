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
  <!-- The whole row opens the drawer by mouse; the title button is its keyboard and screen-reader target. -->
  <div
    class="group hover:bg-surface-subtle-hover flex w-full cursor-pointer items-stretch gap-4 px-5 py-4 transition-colors sm:px-6"
    @click="emit('open')"
  >
    <span class="w-1 shrink-0 rounded-full" :class="OUTCOME[problem.outcome].marker" />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        class="text-text-heading focus-visible:ring-focus-ring-accent rounded-default self-start text-start text-base leading-snug font-semibold text-pretty focus-visible:ring-2 focus-visible:outline-none"
        :data-test="`autoobserve2-problem-${problem.id}`"
      >
        {{ t(problem.title) }}
      </button>
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-text-secondary text-sm tabular-nums">
          {{ label }}
          <OTooltip :content="raw(problem.absolute)" />
        </span>
        <OTag
          type="severity"
          :value="problem.severity"
          size="sm"
          :data-test="`autoobserve2-problem-priority-${problem.severity}`"
        />
        <OTag
          :variant="OUTCOME[problem.outcome].tag"
          size="sm"
          :label="outcomeLabel"
          :data-test="`autoobserve2-problem-outcome-${problem.outcome}`"
        />
      </span>
      <span class="text-text-secondary mt-0.5 max-w-[70ch] text-sm leading-relaxed text-pretty">
        {{ t(problem.summary) }}
      </span>
      <AskCard v-if="request" :request="request" inline class="mt-2 cursor-auto" @click.stop />
      <ProblemSpark :chart="problem.chart" :outcome="problem.outcome" class="mt-2 flex sm:hidden" />
    </div>
    <ProblemSpark
      :chart="problem.chart"
      :outcome="problem.outcome"
      class="hidden shrink-0 self-center sm:flex"
    />
    <OIcon
      name="chevron-right"
      size="sm"
      class="text-text-muted group-hover:text-text-secondary shrink-0 self-center transition-transform group-hover:translate-x-0.5"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { problemLabel, type Problem, type Request } from "./fixtures";
import { OUTCOME } from "./outcome";
import ProblemSpark from "./ProblemSpark.vue";
import AskCard from "./AskCard.vue";

const props = defineProps<{ problem: Problem; request?: Request }>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18nTyped();

const label = computed(() => problemLabel(t, props.problem));

const outcomeLabel = computed(() =>
  t(OUTCOME[props.problem.outcome].key, { minutes: props.problem.resolvedIn }),
);
</script>
