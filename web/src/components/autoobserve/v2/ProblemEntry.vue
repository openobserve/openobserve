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
  <button
    type="button"
    class="group hover:bg-surface-subtle-hover focus-visible:ring-focus-ring-accent flex w-full items-stretch gap-4 px-5 py-4 text-start transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset sm:px-6"
    :data-test="`autoobserve2-problem-${problem.id}`"
    @click="emit('open')"
  >
    <span class="w-1 shrink-0 rounded-full" :class="OUTCOME[problem.outcome].marker" />
    <span class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="text-text-heading text-base leading-snug font-semibold text-pretty">
        {{ t(problem.title) }}
      </span>
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
    </span>
    <OIcon
      name="chevron-right"
      size="sm"
      class="text-text-muted group-hover:text-text-secondary shrink-0 self-center transition-transform group-hover:translate-x-0.5"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { problemLabel, type Problem } from "./fixtures";
import { OUTCOME } from "./outcome";

const props = defineProps<{ problem: Problem }>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18nTyped();

const label = computed(() => problemLabel(t, props.problem));

const outcomeLabel = computed(() =>
  t(OUTCOME[props.problem.outcome].key, { minutes: props.problem.resolvedIn }),
);
</script>
