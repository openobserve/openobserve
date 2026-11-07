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

<!--
  "Collect from your app" (AIO-40): how an app sends its end users' votes to
  this Score Config, and whether any have arrived. The status line reads the
  newest feedback Scores, so it turns green on the first real vote.
-->
<template>
  <div class="flex flex-col gap-4.5" data-test="score-config-feedback-tab">
    <p class="text-text-secondary m-0 text-xs leading-normal">
      {{ t("endUserFeedback.intro") }}
    </p>

    <section class="flex flex-col gap-2">
      <h4 class="text-compact text-text-heading m-0 leading-normal font-semibold">
        {{ t("endUserFeedback.serverStep") }}
      </h4>
      <p class="text-2xs text-text-secondary m-0">{{ t("endUserFeedback.serverHint") }}</p>
      <OCodeBlock
        :code="snippets.server"
        lang="bash"
        wrap
        data-test="score-config-feedback-server"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h4 class="text-compact text-text-heading m-0 leading-normal font-semibold">
        {{ t("endUserFeedback.browserStep") }}
      </h4>
      <p class="text-2xs text-text-secondary m-0">{{ t("endUserFeedback.browserHint") }}</p>
      <OCodeBlock
        :code="snippets.browser"
        lang="javascript"
        wrap
        data-test="score-config-feedback-browser"
      />
    </section>

    <div
      class="rounded-default border-text-secondary/16 flex flex-wrap items-center gap-2 border p-[0.75rem_0.875rem]"
      data-test="score-config-feedback-status"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :class="status.lastVoteMs ? 'bg-status-success-text' : 'bg-text-secondary/40'"
      />
      <span v-if="loading" class="text-text-secondary text-xs">
        {{ t("endUserFeedback.checking") }}
      </span>
      <span v-else-if="status.lastVoteMs" class="text-text-body text-xs">
        {{ t("endUserFeedback.lastVote", { time: relativeTime(status.lastVoteMs, t) }) }}
        <span class="text-text-secondary">
          ·
          {{ t("endUserFeedback.votes", { n: status.votes }, status.votes) }}
          ·
          {{ t("endUserFeedback.helpful", { pct: status.helpfulPct ?? 0 }) }}
        </span>
      </span>
      <span v-else class="text-text-secondary text-xs">{{ t("endUserFeedback.noVotes") }}</span>
      <OButton
        variant="outline"
        size="sm"
        class="ms-auto"
        :loading="sending"
        data-test="score-config-feedback-test-vote"
        @click="sendTestVote"
      >
        {{ t("endUserFeedback.sendTestVote") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useLlmTraceStreams } from "@/enterprise/composables/useLlmTraceStreams";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import llmAnnotationsService from "@/services/llm-annotations.service";
import type { ScoreConfig } from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { relativeTime, showError } from "../utils/evalFormat";
import {
  buildFeedbackSnippets,
  feedbackStatus,
  feedbackStatusSql,
  type FeedbackStatus,
} from "../utils/feedbackCollect";

const DAY_US = 24 * 60 * 60 * 1_000_000;

const props = defineProps<{ row: ScoreConfig }>();

const { t } = useI18nTyped();
const store = useStore();
const { executeQueryOnce } = useLLMStreamQuery();
// The org's first LLM trace stream, as the other AI pages pick it; empty with none.
const stream = ref("");
const { ensureStreamsLoaded } = useLlmTraceStreams(stream, t);

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");
const snippets = computed(() =>
  buildFeedbackSnippets(store.state.API_ENDPOINT ?? "", org.value, props.row.name, stream.value),
);

const status = ref<FeedbackStatus>(feedbackStatus(undefined));
const loading = ref(false);
const sending = ref(false);

async function loadStatus() {
  loading.value = true;
  try {
    const now = Date.now() * 1000;
    const rows = await executeQueryOnce(
      feedbackStatusSql(entityId(props.row)),
      now - DAY_US,
      now,
      "logs",
    );
    status.value = feedbackStatus(rows?.[0]);
  } catch {
    // No `_llm_scores` stream yet: no votes.
    status.value = feedbackStatus(undefined);
  } finally {
    loading.value = false;
  }
}

async function sendTestVote() {
  sending.value = true;
  try {
    await ensureStreamsLoaded();
    await llmAnnotationsService.sendTestFeedbackVote(
      org.value,
      props.row.name,
      store.state.userInfo?.email ?? "openobserve-test",
      stream.value,
    );
    toast({ variant: "success", message: t("endUserFeedback.testVoteSent") });
    await loadStatus();
  } catch (err) {
    showError(err, t("endUserFeedback.testVoteFailed"));
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  ensureStreamsLoaded();
  loadStatus();
});
</script>
