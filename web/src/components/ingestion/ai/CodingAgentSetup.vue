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
  "With a coding agent" setup for an AI integration: download the per-org .env,
  then paste one prompt into Claude Code / Cursor / Codex. The prompt points the
  agent at the openobserve-instrument skill by URL, so nothing has to be
  installed and the token stays in the .env, never in the chat.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import type {
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import CodingAgentDataHealth from "./CodingAgentDataHealth.vue";
import { downloadEnvFile } from "@/components/ingestion/setupCard/envFile";
import { getPath } from "@/utils/zincutils";
import { safeHttpUrl } from "@/components/ingestion/setupCard/subs";
import type { CardSubstitutions, RichCardDetect } from "@/components/ingestion/setupCard/types";
import { STREAM_NAME_RE, buildCodingAgentPrompt } from "./codingAgentPrompt";

const props = defineProps<{
  /** Per-org url/org/token — the same values the stepped card's .env carries. */
  subs: CardSubstitutions;
  /** Stream the prompt names before the user edits it. */
  defaultStream: string;
  /** The integration's first-span check; omitted → no live status bar. */
  detect?: RichCardDetect;
  guideName: string;
  docUrl?: string;
  /** The org forbids showing its ingestion passcode, so there is no .env to hand out. */
  passcodeForbidden: boolean;
}>();

const { t } = useI18nTyped();

const streamName = ref(props.defaultStream);
const streamNameError = computed(() =>
  streamName.value.trim() && !STREAM_NAME_RE.test(streamName.value.trim())
    ? t("ingestion.setupCard.streamNameError")
    : raw(""),
);
const effectiveStream = computed(() => streamName.value.trim() || props.defaultStream);

const prompt = computed(() => buildCodingAgentPrompt(props.subs.org, effectiveStream.value));
const promptTitle = computed(() =>
  t("ingestion.ai.codingAgent.promptTitle", {
    client1: raw("Claude Code"),
    client2: raw("Cursor"),
    client3: raw("Codex"),
  }),
);

const root = ref<HTMLElement | null>(null);
const statusBar = ref<InstanceType<typeof FirstEventStatus> | null>(null);
// Copying the prompt is the go signal, so the first-span check starts then, as on the stepped card.
const onPromptCopy = () => statusBar.value?.start("copy");
// The status bar's copy button re-copies through the prompt block, so the clipboard and toast match.
const copyPrompt = () =>
  root.value?.querySelector<HTMLElement>('[data-test="ai-coding-agent-prompt-copy-btn"]')?.click();

// An agent installs packages and edits code before its first request, so diagnosis waits far longer.
const DIAGNOSIS_AFTER_MS = 15 * 60_000;
// Clock skew and SDK batching can stamp a span a little before the watch started.
const WINDOW_SLACK_MS = 60_000;

// The first span arrived: check the AI data health of what the agent's run sent.
const healthScope = ref<{ stream: string; startUs: number; agent?: string } | null>(null);
const onDetected = (result: FirstEventResult) => {
  const nowMs = Date.now();
  const firstMs = result.firstRecordUs ? result.firstRecordUs / 1000 : nowMs;
  const startMs = Math.min(statusBar.value?.startedAtMs ?? nowMs, firstMs) - WINDOW_SLACK_MS;
  const agent = result.firstRecord?.gen_ai_agent_name;
  healthScope.value = {
    stream: result.streamName,
    startUs: Math.floor(startMs * 1000),
    agent: typeof agent === "string" && agent ? agent : undefined,
  };
};
// A new stream name restarts the watch; the checks belong to the old one.
const onState = (state: FirstEventState) => {
  if (state !== "received") healthScope.value = null;
};

// Beyond the card's three keys: the stream the prompt names (the SDK reads this
// name) and the web UI root (the skill appends /web/…), so its trace and fix
// links open the UI even where the API lives on another host or port.
const downloadEnv = () =>
  downloadEnvFile(props.subs, {
    OPENOBSERVE_TRACES_STREAM_NAME: effectiveStream.value,
    OPENOBSERVE_UI_URL: window.location.origin + getPath().replace(/\/?web\/$/, ""),
  });
</script>

<template>
  <div
    ref="root"
    class="text-text-heading max-w-[61.25rem] px-1 py-4 text-sm"
    data-test="ai-coding-agent-setup"
  >
    <div class="mb-7 [&_.text-input-hint]:whitespace-nowrap [&_label]:mb-0.5">
      <OInput
        v-model="streamName"
        :label="t('ingestion.ai.codingAgent.streamLabel')"
        :placeholder="raw(defaultStream)"
        :help-text="!streamNameError ? t('ingestion.ai.codingAgent.streamHelp') : undefined"
        :error="!!streamNameError"
        :error-message="streamNameError"
        size="sm"
        width="md"
        data-test="ai-coding-agent-stream-input"
      />
    </div>

    <OStepper :model-value="1" orientation="vertical" expanded :animated="false">
      <OStep
        :name="1"
        :title="t('ingestion.ai.codingAgent.envTitle')"
        data-test="ai-coding-agent-env-step"
      >
        <OBanner
          v-if="passcodeForbidden"
          variant="warning"
          data-test="ai-coding-agent-passcode-forbidden"
          :content="t('ingestion.passcodeForbiddenMessage')"
        />
        <template v-else>
          <p class="text-text-secondary text-compact mt-0 mb-2.5 leading-[1.45]">
            {{ t("ingestion.ai.codingAgent.envHelp") }}
          </p>
          <OButton
            variant="outline"
            size="sm"
            icon-left="download"
            data-test="ai-coding-agent-env-btn"
            @click="downloadEnv"
          >
            {{ t("ingestion.ai.codingAgent.envButton") }}
          </OButton>
        </template>
      </OStep>

      <OStep :name="2" :title="promptTitle" data-test="ai-coding-agent-prompt-step">
        <OCodeBlock
          :code="prompt"
          lang="text"
          chrome="editor"
          :filename="t('ingestion.ai.codingAgent.promptLabel')"
          wrap
          :copy-message="t('ingestion.ai.codingAgent.promptCopied')"
          data-test="ai-coding-agent-prompt"
          @copy="onPromptCopy"
        />
        <FirstEventStatus
          v-if="detect"
          ref="statusBar"
          class="mt-3"
          :org="subs.org"
          :signal="detect.streamType"
          :target-stream="effectiveStream"
          :match="detect.match"
          :filter="detect.filter || undefined"
          :guide-name="guideName"
          :doc-url="docUrl ? safeHttpUrl(docUrl) : undefined"
          :diagnosis-after-ms="DIAGNOSIS_AFTER_MS"
          snippet-kind="prompt"
          @copy-command="copyPrompt"
          @detected="onDetected"
          @state="onState"
        />
        <CodingAgentDataHealth
          v-if="healthScope"
          :key="`${healthScope.stream}-${healthScope.startUs}`"
          class="mt-3"
          :org="subs.org"
          :stream="healthScope.stream"
          :start-us="healthScope.startUs"
          :agent="healthScope.agent"
        />
      </OStep>
    </OStepper>
  </div>
</template>
