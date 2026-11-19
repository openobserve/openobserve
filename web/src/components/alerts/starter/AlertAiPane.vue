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

<!-- The starter's Create with AI pane: a prompt, then the drafting loop and the alert's read-back. -->
<template>
  <div ref="rootEl" data-test="alert-starter-ai-pane">
    <AiDraftPane :draft="controller.ai" @edit-prompt="editPrompt" @open-saved="openSaved">
      <template #compose>
        <div class="flex flex-col gap-3">
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

      <template #readback>
        <section
          class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
          data-test="alert-starter-ai-readback"
        >
          <p
            class="text-text-heading m-0 text-sm font-medium"
            data-test="alert-starter-ai-condition"
          >
            {{ controller.condition.value }}
          </p>
          <p
            v-if="dayLine"
            class="m-0 flex items-center gap-2 text-sm"
            :class="DAY_VERDICT_TONE_CLASS[dayLine.tone]"
            data-test="alert-starter-ai-day-test"
          >
            <OIcon name="notifications" size="xs" class="shrink-0" />
            <OTruncatedText class="min-w-0">{{ dayLine.text }}</OTruncatedText>
          </p>
          <!-- Read-only: Create runs the proposal as it stands, so a change goes through Edit in form. -->
          <p
            class="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            data-test="alert-starter-ai-who"
          >
            <span class="text-text-heading me-2 font-medium">{{
              t("alertStarter.whoToTell.label")
            }}</span>
            <span v-if="!whoShown.length" class="text-text-heading">{{
              t("alertStarter.whoToTell.noOne")
            }}</span>
            <OBadge
              v-for="name in whoShown"
              :key="name"
              variant="default-outline"
              shape="rounded"
              data-test="alert-starter-ai-who-chip"
              >{{ name }}</OBadge
            >
            <span v-if="whoHidden > 0" class="text-text-secondary text-xs">{{
              t("alertStarter.whoToTell.more", { count: whoHidden }, whoHidden)
            }}</span>
          </p>
        </section>
      </template>
    </AiDraftPane>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useQueries } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import AiDraftPane from "@/components/ai-draft/AiDraftPane.vue";
import type { AlertAiDraft } from "@/components/alerts/starter/useAlertAiDraft";
import { streamNameListQuery } from "@/services/stream.queries";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { DAY_VERDICT_TONE_CLASS, dayVerdictLine } from "@/utils/alerts/alertTestRun";

type ExampleStreamType = "logs" | "metrics" | "traces";

const MAX_EXAMPLES = 3;
const MAX_WHO = 3;
const STREAM_TYPES: readonly ExampleStreamType[] = ["logs", "metrics", "traces"];
// Two shapes per stream type; each needs only the stream's name, never a field or metric name.
const EXAMPLE_KEYS: Record<ExampleStreamType, readonly [I18nKey, I18nKey]> = {
  logs: ["alertStarter.ai.example.logsJump", "alertStarter.ai.example.logsSilent"],
  metrics: ["alertStarter.ai.example.metricsJump", "alertStarter.ai.example.metricsSilent"],
  traces: ["alertStarter.ai.example.tracesSlower", "alertStarter.ai.example.tracesSilent"],
};

const props = defineProps<{ controller: AlertAiDraft }>();
const emit = defineEmits<{ opened: [] }>();
const prompt = defineModel<string>("prompt", { default: "" });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
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

// After two failed checks the failure line already carries the dry run's reason.
const dayLine = computed(() => {
  if (props.controller.ai.failure.value?.kind === "invalid") return null;
  const verdict = props.controller.verdict.value;
  return verdict ? dayVerdictLine(verdict, t) : null;
});

const whoShown = computed(() => props.controller.destinations.value.slice(0, MAX_WHO));
const whoHidden = computed(
  () => props.controller.destinations.value.length - whoShown.value.length,
);

const focusPrompt = () => rootEl.value?.querySelector("textarea")?.focus();

const pickExample = (example: I18nText) => {
  prompt.value = example;
  focusPrompt();
};

const draft = () => {
  if (prompt.value.trim()) void props.controller.ai.start(prompt.value);
};

// Enter drafts; Shift+Enter is a new line.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  draft();
};

const editPrompt = async () => {
  props.controller.ai.reset();
  await nextTick();
  focusPrompt();
};

const openSaved = () => {
  const route = props.controller.ai.createdRoute.value;
  if (!route) return;
  void router.push(route);
  emit("opened");
};

onMounted(() => nextTick(focusPrompt));

defineExpose({ draft });
</script>
