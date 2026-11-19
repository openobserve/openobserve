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

<!-- The starter's Create with AI pane: a prompt box and examples from the org's own streams. -->
<template>
  <div ref="rootEl" class="flex flex-col gap-3" data-test="alert-starter-ai-pane">
    <OTextarea
      v-model="prompt"
      :rows="3"
      :placeholder="t('alertStarter.ai.describe')"
      :aria-label="t('alertStarter.ai.describe')"
      data-test="alert-starter-ai-prompt"
      @keydown="onKeydown"
    />
    <div
      v-if="examples.length"
      class="flex flex-wrap items-center gap-1.5"
      data-test="alert-starter-ai-examples"
    >
      <span class="text-text-secondary me-0.5 text-xs">{{ t("alertStarter.ai.try") }}</span>
      <OButton
        v-for="(example, i) in examples"
        :key="i"
        variant="outline"
        size="chip"
        :data-test="`alert-starter-ai-example-${i}`"
        @click="pickExample(example)"
        >{{ example }}</OButton
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useQueries } from "@tanstack/vue-query";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { streamNameListQuery } from "@/services/stream.queries";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";

type ExampleStreamType = "logs" | "metrics" | "traces";

const MAX_EXAMPLES = 3;
const STREAM_TYPES: readonly ExampleStreamType[] = ["logs", "metrics", "traces"];
// Two shapes per stream type; each needs only the stream's name, never a field or metric name.
const EXAMPLE_KEYS: Record<ExampleStreamType, readonly [I18nKey, I18nKey]> = {
  logs: ["alertStarter.ai.example.logsJump", "alertStarter.ai.example.logsSilent"],
  metrics: ["alertStarter.ai.example.metricsJump", "alertStarter.ai.example.metricsSilent"],
  traces: ["alertStarter.ai.example.tracesSlower", "alertStarter.ai.example.tracesSilent"],
};

const prompt = defineModel<string>("prompt", { default: "" });

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const rootEl = ref<HTMLElement | null>(null);

const streamLists = useQueries({
  queries: computed(() =>
    STREAM_TYPES.map((type) => ({ ...streamNameListQuery(org.value, type), enabled: !!org.value })),
  ),
});

// Names starting with "_" are the product's own streams, not the user's data.
const namesOf = (rows: unknown): string[] =>
  ((rows ?? []) as Array<{ name?: unknown }>)
    .map((row) => row?.name)
    .filter((name): name is string => typeof name === "string" && !!name && !name.startsWith("_"));

/** One stream of each type in turn, so three examples cover three kinds of data when the org has them. */
const examples = computed<I18nText[]>(() => {
  const pools = STREAM_TYPES.map((type, i) => ({
    keys: EXAMPLE_KEYS[type],
    names: namesOf(streamLists.value[i]?.data),
  }));
  const picked: I18nText[] = [];
  for (let round = 0; round < 2; round++) {
    for (const { keys, names } of pools) {
      if (names[round] && picked.length < MAX_EXAMPLES) {
        picked.push(t(keys[round], { stream: raw(names[round]) }));
      }
    }
  }
  return picked;
});

const focusPrompt = () => rootEl.value?.querySelector("textarea")?.focus();

const pickExample = (example: I18nText) => {
  prompt.value = example;
  focusPrompt();
};

// Enter will draft once drafting is wired; until then it adds no line either. Shift+Enter is a new line.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) event.preventDefault();
};

onMounted(() => nextTick(focusPrompt));
</script>
