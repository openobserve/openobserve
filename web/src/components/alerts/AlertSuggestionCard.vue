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
  <div ref="rootRef" class="flex min-w-0 flex-1 basis-56" data-test="alert-start-sheet-suggestion">
    <EmptyStateActionCard
      icon="lightbulb"
      :label="
        t('alerts.startSheet.suggestionLabel', {
          intent: t(suggestion.intent.titleKey),
          stream: suggestion.stream.name,
        })
      "
      :sublabel="chip"
      :data-test="`alert-suggestion-${suggestion.key}`"
      @click="emit('choose', suggestion.prefill)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { useSuggestionBacktest } from "@/composables/alerts/useAlertSuggestions";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import type { AlertSuggestion, SuggestionBacktest } from "@/utils/alerts/startSuggestions";

const props = defineProps<{ suggestion: AlertSuggestion }>();
const emit = defineEmits<{ choose: [prefill: AlertPrefill] }>();

const { t } = useI18nTyped();
const { run } = useSuggestionBacktest();

const rootRef = ref<HTMLElement | null>(null);
const checking = ref(false);
const result = ref<SuggestionBacktest | null>(null);
let observer: IntersectionObserver | null = null;
let started = false;

const chip = computed<I18nText | undefined>(() => {
  if (checking.value) return t("alerts.queryConfig.thresholdSuggestion.checking");
  const value = result.value;
  if (!value) return undefined;
  if (value.state === "failed") return t("alerts.queryConfig.thresholdSuggestion.failed");
  if (value.state === "untested") return t("alerts.queryConfig.thresholdSuggestion.notTested");
  return t(
    "alerts.queryConfig.thresholdSuggestion.wouldHaveFired",
    { count: value.episodes },
    value.episodes,
  );
});

const start = async () => {
  if (started) return;
  started = true;
  observer?.disconnect();
  checking.value = true;
  try {
    result.value = await run(props.suggestion);
  } finally {
    checking.value = false;
  }
};

onMounted(() => {
  // Without an observer (old browsers) every card counts as on screen.
  if (typeof IntersectionObserver === "undefined" || !rootRef.value) {
    void start();
    return;
  }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void start();
  });
  observer.observe(rootRef.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>
