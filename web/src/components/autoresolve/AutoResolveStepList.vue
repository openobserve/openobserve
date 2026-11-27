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
  <section
    class="rounded-surface border-border-default bg-surface-base min-w-0 overflow-hidden border"
    data-test="autoresolve-run-steps"
  >
    <OCollapsible v-model="open" trigger-class="px-4 py-2 bg-surface-subtle">
      <template #trigger="{ open: isOpen }">
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span class="text-text-heading min-w-0 text-sm font-semibold wrap-anywhere">
            {{ title }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t("autoresolve.run.stepCount", { count: steps.length }, steps.length) }}
          </span>
          <span class="flex-1" />
          <span v-if="approvedLine" class="text-text-secondary text-xs">
            {{ approvedLine }}
          </span>
          <OIcon
            name="expand-more"
            size="sm"
            class="text-icon-color shrink-0 transition-transform duration-150 motion-reduce:transition-none"
            :class="isOpen ? 'rotate-180' : ''"
          />
        </span>
      </template>
      <!-- The collapsible keeps its content through the closing animation; a folded list drops its cards at once. -->
      <ol
        v-if="open"
        class="divide-border-subtle border-border-default m-0 flex list-none flex-col divide-y border-t p-0"
      >
        <AutoResolveStepCard v-for="step in steps" :key="step.id" :step="step" :now-us="nowUs" />
      </ol>
    </OCollapsible>
  </section>
</template>

<script setup lang="ts">
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AutoResolveStepCard from "@/components/autoresolve/AutoResolveStepCard.vue";
import type { AutoResolveStep } from "@/services/autoresolve";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{
  steps: AutoResolveStep[];
  title: I18nText;
  /** Who approved the steps and when; null before approval. */
  approvedLine: I18nText | null;
  /** The page's ticking clock, for a running step's time. */
  nowUs?: number;
}>();

const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();
</script>
