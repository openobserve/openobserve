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

<!-- Reads with the user's session: the agent's .env token can only ingest. -->
<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import LLMDataHealthCheckCard from "@/plugins/traces/LLMDataHealthCheckCard.vue";
import { useLLMDataHealth } from "@/plugins/traces/composables/useLLMDataHealth";
import { shownChecks } from "@/plugins/traces/llmDataTrust.utils";

const props = defineProps<{
  org: string;
  stream: string;
  /** Window start, epoch microseconds; the window runs to the time of each check. */
  startUs: number;
  /** The first span's `gen_ai_agent_name`; scopes the checks to that agent when set. */
  agent?: string;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { health, checkedWindow, loading, error, unsupported, samples, fetchHealth } =
  useLLMDataHealth();

// refresh: the server caches answers for a minute, and a re-check follows a code change
const check = () =>
  fetchHealth(props.org, {
    stream_name: props.stream,
    start_time: props.startUs,
    end_time: Date.now() * 1000,
    agent: props.agent || undefined,
    refresh: true,
    include_samples: true,
  });
onMounted(check);

const checks = computed(() =>
  shownChecks(health.value?.checks ?? [], !!store.state.zoConfig?.model_pricing_enabled),
);
// every check counts LLM spans, so none counted means only non-GenAI spans landed
const noGenAiSpans = computed(
  () => !!health.value?.checks.length && health.value.checks.every((c) => c.total === 0),
);
const scopeText = computed(() =>
  props.agent
    ? t("ingestion.ai.codingAgent.health.scopeAgent", {
        agent: raw(props.agent),
        stream: raw(props.stream),
      })
    : t("ingestion.ai.codingAgent.health.scopeStream", { stream: raw(props.stream) }),
);

const viewTrace = (traceId: string) => {
  router
    .push({
      name: "traceDetails",
      query: {
        stream: props.stream,
        trace_id: traceId,
        from: checkedWindow.value?.start ?? props.startUs,
        to: checkedWindow.value?.end ?? Date.now() * 1000,
        org_identifier: props.org,
      },
    })
    .catch(() => {});
};
</script>

<template>
  <div
    class="flex flex-col gap-2 text-sm"
    data-test="ai-coding-agent-health"
    :data-state="
      unsupported
        ? 'unsupported'
        : error
          ? 'error'
          : noGenAiSpans
            ? 'no-genai'
            : health
              ? 'ready'
              : 'loading'
    "
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="text-text-heading inline-flex items-center gap-1.5 font-semibold">
        <OIcon name="monitor-heart" size="sm" />
        {{ t("ingestion.ai.codingAgent.health.title") }}
      </span>
      <OText variant="meta" data-test="ai-coding-agent-health-scope">{{ scopeText }}</OText>
      <OButton
        v-if="!unsupported"
        class="ms-auto"
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        :loading="loading"
        data-test="ai-coding-agent-health-recheck-btn"
        @click="check"
      >
        {{ t("ingestion.ai.codingAgent.health.checkAgain") }}
      </OButton>
    </div>

    <OText v-if="unsupported" variant="meta" data-test="ai-coding-agent-health-unsupported">{{
      t("ingestion.ai.codingAgent.health.unsupported")
    }}</OText>
    <OText v-else-if="error" variant="meta" data-test="ai-coding-agent-health-error">{{
      t("ingestion.ai.codingAgent.health.error")
    }}</OText>
    <OText v-else-if="!health" variant="meta" data-test="ai-coding-agent-health-loading">{{
      t("ingestion.ai.codingAgent.health.checking")
    }}</OText>
    <OBanner
      v-else-if="noGenAiSpans"
      variant="warning"
      dense
      data-test="ai-coding-agent-health-no-genai"
      :content="t('ingestion.ai.codingAgent.health.noGenAiSpans')"
    />
    <template v-else>
      <div class="grid gap-2 md:grid-cols-2" data-test="ai-coding-agent-health-checks">
        <LLMDataHealthCheckCard
          v-for="c in checks"
          :key="c.id"
          :check="c"
          :stream="stream"
          :checked-window="checkedWindow"
          :samples="samples?.[c.id]"
          @view-trace="viewTrace"
        />
      </div>
      <OText variant="meta">{{ t("ingestion.ai.codingAgent.health.checkAgainHint") }}</OText>
    </template>
  </div>
</template>
