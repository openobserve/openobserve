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
  <div
    class="bg-surface-base border-border-default rounded-surface flex w-full max-w-140 flex-col gap-3.5 border p-6 shadow-md max-md:p-4"
    data-test="query-plan-analyze-running"
  >
    <h3 class="text-text-heading m-0 flex items-center gap-2.5 text-lg font-semibold">
      <OSpinner size="sm" />
      {{
        rerun
          ? t("search.queryProfile.rerunningTitle", { command })
          : t("search.queryProfile.runningTitle", { command })
      }}
    </h3>
    <div class="flex flex-wrap items-baseline gap-2.5">
      <span
        class="text-text-heading font-mono text-3xl font-semibold tabular-nums"
        data-test="query-plan-analyze-elapsed"
        >{{ elapsed }}</span
      >
      <span class="text-text-secondary text-xs">{{ elapsedNote }}</span>
    </div>
    <div
      class="bg-surface-subtle relative h-1 overflow-hidden rounded-full"
      role="progressbar"
      :aria-label="t('search.queryProfile.runningAria')"
    >
      <span class="analyze-indeterminate bg-accent absolute inset-y-0 w-[35%] rounded-full" />
    </div>
    <p class="text-text-secondary m-0 text-sm leading-relaxed">
      {{ rerun ? t("search.queryProfile.rerunNote") : t("search.queryProfile.runningNote") }}
    </p>
    <div>
      <OButton
        variant="outline-destructive"
        size="sm"
        icon-left="stop-circle"
        data-test="query-plan-analyze-cancel"
        @click="emit('cancel')"
        >{{ t("common.cancel") }}</OButton
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  elapsed: string;
  rerun: boolean;
  reference: string | null;
}>();

const emit = defineEmits<{ cancel: [] }>();

const { t } = useI18nTyped();

const command = raw("EXPLAIN ANALYZE");

const elapsedNote = computed<I18nText>(() => {
  if (!props.reference) return t("search.queryProfile.elapsed");
  return props.rerun
    ? t("search.queryProfile.elapsedPrevious", { took: props.reference })
    : t("search.queryProfile.elapsedLast", { took: props.reference });
});
</script>

<style scoped>
/* keep(keyframes): an indeterminate progress bar has no utility or library component */
.analyze-indeterminate {
  animation: analyze-slide 1.3s ease-in-out infinite;
}

@keyframes analyze-slide {
  from {
    left: -35%;
  }
  to {
    left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .analyze-indeterminate {
    animation: none;
    left: 0;
    width: 100%;
    opacity: 0.4;
  }
}
</style>
