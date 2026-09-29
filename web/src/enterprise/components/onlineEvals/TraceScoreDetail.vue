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

<!-- Shared by the hover tooltip and the overflow panel; border-only fills (no bg) since each parent surface uses a different token. -->
<template>
  <div class="flex flex-col gap-1.75 text-xs">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-1.5">
        <OIcon name="task-alt" size="xs" class="text-status-success-text shrink-0" />
        <span class="text-text-heading truncate font-bold">{{ chip.label }}</span>
      </div>
      <span
        class="border-border-default text-text-body rounded-default shrink-0 border px-1.5 py-0.25 font-semibold tabular-nums"
      >
        {{ chip.value }}
      </span>
    </div>

    <p v-if="chip.description" class="text-text-secondary text-3xs leading-relaxed">
      {{ chip.description }}
    </p>

    <div
      v-if="chip.reasoning"
      class="border-border-default rounded-default flex gap-1.5 border p-1.75"
    >
      <OIcon name="lightbulb-outline" size="xs" class="text-text-secondary mt-0.5 shrink-0" />
      <div class="min-w-0">
        <div class="text-text-secondary text-3xs mb-0.25 font-bold tracking-[0.05em]">
          {{ t("onlineEvals.traceScoreChip.reasoning") }}
        </div>
        <p class="text-text-body text-3xs leading-relaxed">{{ chip.reasoning }}</p>
      </div>
    </div>

    <div v-if="scoredAtLabel" class="text-text-secondary text-3xs flex items-center gap-1">
      <OIcon name="schedule" size="xs" />
      {{ t("onlineEvals.traceScoreChip.scoredAt", { time: scoredAtLabel }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";
import type { TraceScoreChip } from "./composables/useTraceScoreChips";

const { t } = useI18nTyped();

const props = defineProps<{ chip: TraceScoreChip }>();

const scoredAtLabel = computed(() =>
  props.chip.scoredAtMs ? new Date(props.chip.scoredAtMs).toLocaleString() : "",
);
</script>
