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

<!-- The coding agent page: the token goes into the terminal, the prompt into the agent, and the
     status waits for the chosen setup's own data, as its setup guide does. -->
<template>
  <div
    class="grid h-full grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-md:h-auto max-md:min-h-full max-md:grid-cols-1 md:grid-rows-1"
    data-test="onboarding-agent-setup"
  >
    <section class="flex px-13 pt-8 max-md:px-4 max-md:pt-6 md:overflow-y-auto md:max-lg:px-8">
      <div class="mx-auto flex w-full max-w-176 flex-col">
        <div class="mb-2 flex min-h-8.5 min-w-0 items-center gap-3">
          <OButton
            variant="ghost-muted"
            size="sm"
            icon-left="arrow-back"
            data-test="onboarding-agent-setup-back"
            @click="emit('back')"
          >
            {{ t("onboarding.back") }}
          </OButton>
          <OTruncatedText class="text-text-secondary text-compact min-w-0"
            >{{ t("onboarding.othersTitle") }} / {{ t("onboarding.agent.crumb") }}</OTruncatedText
          >
        </div>
        <h1 class="text-text-heading text-2xl leading-tight font-semibold text-balance">
          {{ t("onboarding.agent.title") }}
        </h1>
        <p class="text-text-secondary mt-1.5 text-sm">
          {{ t("onboarding.agent.lead", CODING_AGENTS) }}
        </p>

        <ol class="mt-7">
          <OnboardingSetupStep
            :n="1"
            :title="t('onboarding.agent.tokenTitle')"
            :done="tokenCopied"
            :active="activeStep === 1"
            data-test="onboarding-agent-setup-token"
          >
            <p class="text-text-secondary text-compact mb-2.5">
              {{ t("onboarding.agent.tokenText") }}
            </p>
            <CredentialCodeBlock
              :content="EXPORT_LINE"
              slug="onboarding-agent-token"
              lang="bash"
              chrome="terminal"
            />
            <p
              v-if="!powerShell.forbidden.value"
              class="text-text-secondary mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              data-test="onboarding-agent-setup-powershell"
            >
              <span>{{
                t("onboarding.agent.powerShell", { powerShell: raw("Windows PowerShell") })
              }}</span>
              <OCode truncate :tooltip="false" class="min-w-0">{{
                raw(powerShell.codeMasked.value)
              }}</OCode>
              <OButton
                v-if="!powerShell.keyPending.value"
                variant="ghost-muted"
                size="icon-xs"
                icon-left="content-copy"
                :aria-label="
                  t('onboarding.agent.copyPowerShell', { powerShell: raw('PowerShell') })
                "
                data-test="onboarding-agent-setup-powershell-copy"
                @click="copySnippet(powerShell)"
              />
            </p>
          </OnboardingSetupStep>

          <OnboardingSetupStep
            :n="2"
            :title="t('onboarding.agent.promptTitle')"
            :done="promptCopied"
            :active="activeStep === 2"
            data-test="onboarding-agent-setup-prompt"
          >
            <div class="flex flex-wrap items-end gap-2">
              <OSelect
                v-model="focus"
                :options="focusOptions"
                :label="t('onboarding.agent.focusLabel')"
                size="sm"
                class="min-w-0 flex-1 basis-60"
                data-test="onboarding-agent-setup-focus"
              />
              <div class="flex gap-2 max-md:w-full">
                <OButton
                  variant="primary"
                  size="sm"
                  icon-left="content-copy"
                  class="max-md:flex-1"
                  data-test="onboarding-agent-setup-copy"
                  @click="copyPrompt"
                >
                  {{ t("onboarding.agent.copyPrompt") }}
                </OButton>
                <OButton
                  variant="outline"
                  size="sm"
                  icon-left="download"
                  class="max-md:flex-1"
                  data-test="onboarding-agent-setup-download"
                  @click="download"
                >
                  {{ t("onboarding.agent.download") }}
                </OButton>
              </div>
            </div>
            <div class="border-border-default rounded-default mt-3 border">
              <OCollapsible
                :label="t('onboarding.agent.preview')"
                :caption="t('onboarding.agent.previewLines', { count: lineCount }, lineCount)"
                data-test="onboarding-agent-setup-preview"
              >
                <div class="px-2 pb-2">
                  <OCodeBlock
                    :code="prompt"
                    lang="markdown"
                    :max-lines="18"
                    wrap
                    :copyable="false"
                    data-test="onboarding-agent-setup-preview-code"
                  />
                </div>
              </OCollapsible>
            </div>
          </OnboardingSetupStep>

          <OnboardingSetupStep
            :n="3"
            :title="t('onboarding.agent.pasteTitle')"
            :active="activeStep === 3"
            data-test="onboarding-agent-setup-paste"
          >
            <OToggleGroup v-model="agent" type="single" data-test="onboarding-agent-setup-agent">
              <OToggleGroupItem
                v-for="a in agentTabs"
                :key="a.id"
                :value="a.id"
                size="sm"
                :data-test="`onboarding-agent-setup-agent-${a.id}`"
              >
                {{ a.label }}
              </OToggleGroupItem>
            </OToggleGroup>
            <i18n-t
              :keypath="HINTS[agent].key"
              tag="p"
              class="text-text-body text-compact mt-2.5"
              data-test="onboarding-agent-setup-hint"
            >
              <template #command
                ><OCode>{{ HINTS[agent].command }}</OCode></template
              >
              <template #product>{{ HINTS[agent].product }}</template>
              <template #file
                ><OCode>{{ FILE_NAME }}</OCode></template
              >
            </i18n-t>
            <OButton
              as="a"
              :href="mcpHref"
              target="_blank"
              rel="noopener noreferrer"
              variant="ghost-primary"
              size="sm"
              icon-left="mcp"
              icon-right="open-in-new"
              class="-ms-3 mt-2"
              data-test="onboarding-agent-setup-mcp"
            >
              {{ t("onboarding.agent.mcp", { mcp: raw("MCP") }) }}
            </OButton>
            <div ref="statusEl" class="mt-4">
              <FirstEventStatus
                :key="focus"
                ref="status"
                :org="org"
                :signal="detect.streamType"
                :target-stream="detect.streamName"
                :match="detect.match"
                :filter="detect.filter"
                @state="state = $event"
                @detected="result = $event"
                @copy-command="copySnippet(exportLine)"
              />
            </div>
          </OnboardingSetupStep>
        </ol>

        <!-- The inline status above already shows the wait, so the bar only shows the success. -->
        <OnboardingListenBar
          v-if="result"
          :state="state"
          :copy="barCopy"
          :result="result"
          :success-title="t('onboarding.firstData.title')"
          route="onboarding-agent"
          :status-root="statusEl"
        />
        <OnboardingStepFooter />
      </div>
    </section>

    <aside class="max-md:hidden" :aria-label="t('onboarding.agent.aside.eyebrow')">
      <!-- Pinned at the top of the scroll area: the viewport minus the app header, the content card's
           bottom gap (0.5rem) and its top and bottom border hairlines. -->
      <!-- eslint-disable-next-line local/no-hardcoded-px -- the card's two hairline borders -->
      <div class="sticky top-0 h-[calc(100dvh-var(--navbar-height)-0.5rem-2px)]">
        <OnboardingPreview
          example="agent"
          :preview="{
            eyebrow: t('onboarding.agent.aside.eyebrow'),
            title: t('onboarding.agent.aside.title'),
            lines: [
              t('onboarding.agent.aside.line1'),
              t('onboarding.agent.aside.line2'),
              t('onboarding.agent.aside.line3'),
              t('onboarding.agent.aside.line4', { stream: raw(STREAM) }),
              t('onboarding.agent.aside.line5'),
            ],
          }"
        />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import { kubernetesDetect } from "@/components/ingestion/setupCard/content/kubernetes";
import { hostMetricsDetect } from "@/components/ingestion/setupCard/content/osAgent";
import { otlpTracesDetect } from "@/components/ingestion/setupCard/content/otlpTraces";
import { rumDetect } from "@/components/ingestion/setupCard/content/rum";
import type { RichCardDetect } from "@/components/ingestion/setupCard/types";
import { FIRST_EVENT_SNIPPET_COPIED } from "@/composables/firstEvent/firstEventCopied";
import type {
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import { useCredentialSnippet } from "@/composables/useCredentialSnippet";
import useIngestion from "@/composables/useIngestion";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import analytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { downloadFile } from "@/utils/dom";

import { buildAgentPrompt, buildAgentSetupFile, type AgentFocus } from "./agentSetupFile";
import { CODING_AGENTS } from "./onboardingChoices";
import OnboardingListenBar, { type ListenBarCopy } from "./OnboardingListenBar.vue";
import OnboardingPreview from "./OnboardingPreview.vue";
import OnboardingSetupStep from "./OnboardingSetupStep.vue";
import OnboardingStepFooter from "./OnboardingStepFooter.vue";

const emit = defineEmits<{ back: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { endpoint } = useIngestion();

// The prompt's stream: its test event and its OpenTelemetry and HTTP setups send here.
const STREAM = "default";
const FILE_NAME = raw("openobserve-setup.md");
const EXPORT_LINE = 'export O2_ACCESS_KEY="[BASIC_PASSCODE]"';

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

// The export line's real text, and the same token for a terminal that is PowerShell.
const exportLine = useCredentialSnippet(ref(EXPORT_LINE));
const powerShell = useCredentialSnippet(ref('$env:O2_ACCESS_KEY="[BASIC_PASSCODE]"'));

const focus = ref<AgentFocus>("kubernetes");
const focusOptions = computed(() => [
  {
    value: "kubernetes",
    label: t("onboarding.agent.focus.kubernetes", { k8s: raw("Kubernetes") }),
  },
  {
    value: "host",
    label: t("onboarding.agent.focus.host", {
      linux: raw("Linux"),
      macos: raw("macOS"),
      windows: raw("Windows"),
    }),
  },
  {
    value: "backend",
    label: t("onboarding.agent.focus.backend", { otel: raw("OpenTelemetry") }),
  },
  { value: "llm", label: t("onboarding.agent.focus.llm") },
  { value: "frontend", label: t("onboarding.agent.focus.frontend") },
  { value: "logs", label: t("onboarding.agent.focus.logs") },
]);

// Each setup waits for the same data as its setup guide.
const DETECT: Record<AgentFocus, RichCardDetect> = {
  kubernetes: kubernetesDetect,
  host: hostMetricsDetect,
  backend: otlpTracesDetect,
  // The LLM guides' checks come with the fetched AI catalog, one per provider; any trace counts here.
  llm: otlpTracesDetect,
  frontend: rumDetect,
  // The HTTP logs guide (Curl.vue) watches logs stream default, where the prompt's test event goes.
  logs: { streamType: "logs", streamName: STREAM, filter: "" },
};
const detect = computed(() => DETECT[focus.value]);

const ctx = computed(() => ({
  endpoint: endpoint.value?.url ?? "",
  org: org.value,
  stream: STREAM,
  focus: focus.value,
}));
const prompt = computed(() => buildAgentPrompt(ctx.value));
const lineCount = computed(() => prompt.value.split("\n").length);

type AgentId = "claude-code" | "cursor" | "codex" | "other";
const agent = ref<AgentId>("claude-code");
const agentTabs = computed((): { id: AgentId; label: I18nText }[] => [
  { id: "claude-code", label: CODING_AGENTS.claudeCode },
  { id: "cursor", label: CODING_AGENTS.cursor },
  { id: "codex", label: CODING_AGENTS.codex },
  { id: "other", label: t("onboarding.agent.other") },
]);
const HINTS: Record<AgentId, { key: I18nKey; command?: string; product?: string }> = {
  "claude-code": { key: "onboarding.agent.hint.claudeCode", command: raw("claude") },
  cursor: {
    key: "onboarding.agent.hint.cursor",
    command: raw("cursor ."),
    product: CODING_AGENTS.cursor,
  },
  codex: { key: "onboarding.agent.hint.codex", command: raw("codex") },
  other: { key: "onboarding.agent.hint.other" },
};

// Opens in a new tab, so this page keeps watching for the agent's data.
const mcpHref = computed(
  () => router.resolve({ name: "mcpServer", query: { org_identifier: org.value } }).href,
);

const status = ref<InstanceType<typeof FirstEventStatus> | null>(null);
const statusEl = ref<HTMLElement | null>(null);
// The watch starts on mount, so the bar starts waiting.
const state = ref<FirstEventState>("waiting");
const result = ref<FirstEventResult>();
// A copy restarts the watch's fast checks, as a copy on a setup card does.
const tokenCopied = ref(false);
const promptCopied = ref(false);
// Another setup waits for other data and needs its own prompt, so an earlier success and copy no longer apply.
watch(focus, () => {
  result.value = undefined;
  promptCopied.value = false;
});
const restartWatch = () => status.value?.start("copy");
provide(FIRST_EVENT_SNIPPET_COPIED, () => {
  tokenCopied.value = true;
  restartWatch();
});
const activeStep = computed(() => (!tokenCopied.value ? 1 : !promptCopied.value ? 2 : 3));

// The PowerShell line, and the status's "Copy command", which copies the export line again.
const copySnippet = async (snippet: typeof exportLine) => {
  if (snippet.keyPending.value) return;
  if (await copyToClipboard(snippet.code.value, t)) {
    tokenCopied.value = true;
    restartWatch();
  }
};

const usedPrompt = (action: "copied" | "downloaded") => {
  promptCopied.value = true;
  restartWatch();
  analytics.track(`onboarding_agent_prompt_${action}`, { focus: focus.value });
};

const copyPrompt = async () => {
  const text = prompt.value;
  const copied = await copyToClipboard(text, t, {
    successMessage: t("onboarding.agent.promptCopied"),
  });
  // A focus change during the copy shows another prompt than the one copied.
  if (copied && text === prompt.value) usedPrompt("copied");
};

const download = () => {
  if (downloadFile(FILE_NAME, buildAgentSetupFile(ctx.value), "text/markdown")) {
    usedPrompt("downloaded");
  }
};

const barCopy = computed((): ListenBarCopy => ({
  // Only when the watched stream already has data: the watch holds until a copy.
  idle: {
    title: t("onboarding.agent.bar.idle"),
    hint: t("onboarding.agent.bar.idleHint", { stream: raw(detect.value.streamName ?? STREAM) }),
  },
  waiting: {
    title: t("onboarding.agent.bar.waiting"),
    hint: t("onboarding.agent.bar.waitingHint"),
  },
  stopped: {
    title: t("onboarding.agent.bar.stopped"),
    hint: t("onboarding.agent.bar.stoppedHint"),
  },
  "no-requests": {
    title: t("onboarding.agent.bar.noRequests"),
    hint: t("onboarding.agent.bar.noRequestsHint"),
  },
  rejected: {
    title: t("onboarding.agent.bar.rejected"),
    hint: t("onboarding.agent.bar.rejectedHint"),
  },
}));
</script>
