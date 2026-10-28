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
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
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
  <div class="flex max-w-[61.25rem] flex-col gap-6 py-4" data-test="ai-coding-agent-setup">
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

    <section class="flex flex-col gap-2" data-test="ai-coding-agent-env-step">
      <h3 class="m-0 text-base font-semibold">
        <span class="text-text-secondary me-2 text-sm font-normal">{{
          t("ingestion.ai.codingAgent.step", { n: 1 })
        }}</span>
        {{ t("ingestion.ai.codingAgent.envTitle") }}
      </h3>
      <OBanner
        v-if="passcodeForbidden"
        variant="warning"
        data-test="ai-coding-agent-passcode-forbidden"
        :content="t('ingestion.passcodeForbiddenMessage')"
      />
      <template v-else>
        <p class="text-text-secondary m-0 text-sm">
          {{ t("ingestion.ai.codingAgent.envHelp") }}
        </p>
        <div>
          <OButton
            variant="outline"
            size="sm"
            icon-left="download"
            data-test="ai-coding-agent-env-btn"
            @click="downloadEnv"
          >
            {{ t("ingestion.ai.codingAgent.envButton") }}
          </OButton>
        </div>
      </template>
    </section>

    <section class="flex flex-col gap-2" data-test="ai-coding-agent-prompt-step">
      <h3 class="m-0 text-base font-semibold">
        <span class="text-text-secondary me-2 text-sm font-normal">{{
          t("ingestion.ai.codingAgent.step", { n: 2 })
        }}</span>
        {{ t("ingestion.ai.codingAgent.promptTitle") }}
      </h3>
      <OCodeBlock
        :code="prompt"
        lang="text"
        wrap
        :copy-message="t('ingestion.ai.codingAgent.promptCopied')"
        data-test="ai-coding-agent-prompt"
      />
    </section>

    <FirstEventStatus
      v-if="detect"
      :org="subs.org"
      :signal="detect.streamType"
      :target-stream="effectiveStream"
      :match="detect.match"
      :filter="detect.filter || undefined"
      :guide-name="guideName"
      :doc-url="docUrl ? safeHttpUrl(docUrl) : undefined"
    />
  </div>
</template>
