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

<!-- Step 4: a guide inside onboarding, as its setup card or as its Data sources page. A rail on the
     left tracks the setup and holds the page's one first-event status. -->
<template>
  <!-- One card in two parts: on the left Back, the step nav and help; on the right the guide, with
       its own steps and the live data check. On phones the left part folds into the page. -->
  <!-- From the tablet width up the page itself never scrolls: the left part stays put and only the
       guide on the right scrolls, sideways too when a long command needs it. Phones scroll as one. -->
  <div
    class="flex h-full min-h-0 max-md:h-auto max-md:min-h-full max-md:flex-col"
    data-test="onboarding-step-guide"
  >
    <aside
      class="border-border-subtle h-full w-1/4 max-w-96 min-w-64 shrink-0 border-e max-md:contents"
    >
      <div class="h-full max-md:contents">
        <div class="flex h-full flex-col gap-6 overflow-y-auto px-6 pt-8 max-md:contents">
          <!-- The nav's heading names the source, so Back needs no breadcrumb beside it. -->
          <div class="flex min-w-0 max-md:order-first max-md:px-4 max-md:pt-4">
            <OButton
              variant="ghost-muted"
              size="sm"
              icon-left="arrow-back"
              class="-ms-2"
              data-test="onboarding-step-guide-back"
              @click="emit('back')"
            >
              {{ t("onboarding.back") }}
            </OButton>
          </div>

          <OnboardingGuideRail
            :name="sourceName"
            :steps="navSteps"
            class="max-md:hidden"
            @go="goToStep"
          />

          <section
            v-if="agentFocus || canInvite"
            class="border-border-subtle mt-auto flex flex-col gap-4 border-t pt-5 max-md:order-last max-md:mx-4 max-md:mb-6"
            data-test="onboarding-step-guide-help"
          >
            <div v-if="agentFocus" class="flex items-start gap-3">
              <span
                class="rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text inline-flex size-7 shrink-0 items-center justify-center"
              >
                <OIcon name="terminal" size="sm" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="text-text-heading text-compact font-semibold">
                  {{ t("onboarding.guide.agentTitle") }}
                </h2>
                <p class="text-text-secondary mt-0.5 text-xs">
                  {{ t("onboarding.guide.agentSteps", CODING_AGENTS) }}
                </p>
                <!-- The key goes into the terminal, never into the prompt or the file. -->
                <CredentialCodeBlock
                  slug="onboarding-agent-key"
                  :content="EXPORT_LINE"
                  lang="bash"
                  class="mt-2"
                />
                <!-- Two equal halves, so both actions stay on one line in the narrow rail. -->
                <div class="mt-2 grid grid-cols-2 gap-2">
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="content-copy"
                    class="w-full"
                    data-test="onboarding-step-guide-agent-copy"
                    @click="copyPrompt"
                  >
                    {{ t("onboarding.guide.copyPrompt") }}
                  </OButton>
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="download"
                    class="w-full"
                    data-test="onboarding-step-guide-agent-download"
                    @click="downloadSetup"
                  >
                    {{ t("onboarding.guide.downloadFile") }}
                  </OButton>
                </div>
              </div>
            </div>
            <div
              v-if="canInvite"
              class="flex items-start gap-3"
              data-test="onboarding-step-guide-invite-row"
            >
              <span
                class="rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text inline-flex size-7 shrink-0 items-center justify-center"
              >
                <OIcon name="person-add" size="sm" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="text-text-heading text-compact font-semibold">
                  {{ t("onboarding.guide.inviteTitle") }}
                </h2>
                <p class="text-text-secondary mt-0.5 text-xs">
                  {{ t("onboarding.guide.inviteText") }}
                </p>
                <OButton
                  variant="outline"
                  size="sm"
                  class="mt-2"
                  data-test="onboarding-step-guide-invite"
                  @click="emit('invite')"
                >
                  {{ t("onboarding.guide.inviteAction") }}
                </OButton>
              </div>
            </div>
          </section>
          <OnboardingStepFooter class="max-md:order-last max-md:px-4 max-md:pb-4" />
        </div>
      </div>
    </aside>

    <section
      ref="guideEl"
      class="h-full min-w-0 flex-1 overflow-auto px-10 pt-8 pb-12 max-md:h-auto max-md:overflow-visible max-md:px-4 max-md:pt-2 md:max-lg:px-6"
    >
      <div id="setup-step-run" class="flex w-full flex-col">
        <!-- The Data sources page's token picker. It stays out of sight until a snippet's token
             button asks for it, since each snippet already names the token it uses.
             The box sets the width: the select fills whatever holds it. -->
        <div v-if="showTokenPicker" class="ms-auto mb-3 w-60 max-md:ms-0 max-md:w-full">
          <OSelect
            ref="tokenSelectRef"
            v-model="selectedTokenName"
            :options="tokenOptions"
            :label="t('ingestion.mcp.auth.token')"
            label-position="inside"
            size="sm"
            data-test="onboarding-step-guide-token"
          />
        </div>

        <h1
          v-if="!hasOwnTitle"
          class="text-text-heading text-2xl leading-tight font-semibold text-balance"
          data-test="onboarding-step-guide-title"
        >
          {{ sourceName }}
        </h1>

        <!-- The guide pads itself; the negative margin lines it up with the crumbs. -->
        <div class="-mx-3">
          <DataSourceSetupCard
            v-if="guide.cardSlug"
            :slug="slug"
            @received="result = $event"
            @state="onState"
          >
            <!-- A language tile opens the generic OTLP card; this says what to add for that language. -->
            <template v-if="guide.otelDocs" #hero-under-title>
              <p class="text-text-body text-sm" data-test="onboarding-step-guide-language">
                {{
                  t("onboarding.guide.languageText", {
                    language: guide.name,
                    otelSdk: raw("OpenTelemetry SDK"),
                    product: raw("OpenObserve"),
                  })
                }}
              </p>
              <OButton
                as="a"
                :href="`https://opentelemetry.io/docs/languages/${guide.otelDocs.slug}/getting-started/`"
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost-primary"
                size="sm"
                icon-right="open-in-new"
                class="-ms-3 mt-1"
                data-test="onboarding-step-guide-language-docs"
              >
                {{
                  t("onboarding.guide.languageLink", {
                    otel: raw("OpenTelemetry"),
                    language: guide.otelDocs.language,
                  })
                }}
              </OButton>
            </template>
          </DataSourceSetupCard>
          <template v-else>
            <!-- A RUM row's id is its platform tab on the RUM page. -->
            <OnboardingEmbeddedGuide
              :key="`${guide.route}/${guide.id}`"
              :route="guide.route"
              :query="guide.route === 'frontendMonitoring' ? { platform: guide.id } : undefined"
              @received="result = $event"
              @state="onState"
              @status="pageHasStatus = $event"
            />
            <!-- A page with no check of its own: watch the org for any new stream, as the coding agent page does. -->
            <FirstEventStatus
              v-if="pageHasStatus === false"
              :org="org"
              @detected="result = $event"
              @state="onState"
            />
          </template>
        </div>

        <!-- The last step: what to do once data is here. -->
        <section
          v-if="result"
          id="setup-step-explore"
          class="mt-8"
          data-test="onboarding-step-guide-explore"
        >
          <OnboardingFirstData :title="successTitle" :result="result" :route="guide.route" />
          <HeardFromPrompt :org="org" class="mt-3" />
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, provide, ref } from "vue";
import { useStore } from "vuex";

import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import { getDataSourceCard } from "@/components/ingestion/setupCard/registry";
import { SETUP_STEPS_HOST, type SetupStepInfo } from "@/components/ingestion/setupCard/stepsHost";
import { SETUP_CARD_ONBOARDING } from "@/components/ingestion/setupCard/types";
import HeardFromPrompt from "@/components/login/HeardFromPrompt.vue";
import { HEARD_FROM_ASKED_BY_HOST } from "@/components/login/heardFrom";
import { provideBarsCopied } from "@/composables/firstEvent/firstEventCopied";
import type {
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";
import { OPEN_TOKEN_PICKER } from "@/composables/useCredentialSnippet";
import useIngestion from "@/composables/useIngestion";
import { useOrgCredential } from "@/composables/useOrgCredential";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { copyToClipboard } from "@/utils/clipboard";
import { downloadFile } from "@/utils/dom";

import { buildAgentPrompt, buildAgentSetupFile, type AgentFocus } from "./agentSetupFile";
import OnboardingEmbeddedGuide from "./OnboardingEmbeddedGuide.vue";
import OnboardingFirstData from "./OnboardingFirstData.vue";
import OnboardingGuideRail, { type GuideNavStep } from "./OnboardingGuideRail.vue";
import OnboardingStepFooter from "./OnboardingStepFooter.vue";
import {
  CODING_AGENTS,
  guideHasTitle,
  type OnboardingChoice,
  type OnboardingGuide,
  type OnboardingRow,
} from "./onboardingChoices";

const props = defineProps<{
  choice: OnboardingChoice;
  row: OnboardingRow;
  guide: OnboardingGuide;
  /** Admins and root can invite a teammate who has access to the machine. */
  canInvite?: boolean;
}>();
const emit = defineEmits<{ back: []; invite: [] }>();

const { t } = useI18nTyped();
const store = useStore();

// Loads the org passcode, so the guide's commands carry the token, as on the Data sources page.
const credential = useOrgCredential();

// The token picker from the Data sources header, for card and page guides alike. RUM uses its own
// token, so the Data sources page hides the picker there.
const tokenOptions = computed(() =>
  (store.state.organizationData?.orgTokens ?? [])
    .filter((token: { enabled?: boolean }) => token.enabled)
    .map((token: { name: string }) => ({ label: raw(token.name), value: token.name })),
);
const selectedTokenName = computed<string>({
  get: () => credential.pickedName.value,
  set: (name) => credential.pickToken(name),
});
const tokenPickerAsked = ref(false);
const showTokenPicker = computed(
  () =>
    tokenPickerAsked.value &&
    props.guide.route !== "frontendMonitoring" &&
    tokenOptions.value.length > 0,
);
const tokenSelectRef = ref<{ focus: () => void } | null>(null);
provide(OPEN_TOKEN_PICKER, async () => {
  tokenPickerAsked.value = true;
  await nextTick();
  tokenSelectRef.value?.focus();
});

const slug = computed(() => props.guide.cardSlug ?? "");
// The card's own content names the source; the name does not depend on the token or endpoint.
const card = computed(() => getDataSourceCard(slug.value, { url: "", org: "", token: "" }, t));
// Card names are product names, or text the card builder already translated.
const sourceName = computed(() => (card.value ? raw(card.value.provider.name) : props.guide.name));
// A guide that shows no title of its own (a banner in place of its card, a page with none) gets one.
const hasOwnTitle = computed(() =>
  guideHasTitle(props.guide, {
    rumToken: !!store.state.organizationData?.rumToken?.rum_token,
    passcodeForbidden: !!store.state.organizationData?.organizationPasscodeForbidden,
  }),
);

// The card's watch starts on mount, so the nav starts waiting.
const state = ref<FirstEventState>("waiting");
const result = ref<FirstEventResult>();
// A check waits again only for a new target, so the old result no longer applies.
const onState = (next: FirstEventState) => {
  state.value = next;
  if (next === "waiting") result.value = undefined;
};
const successTitle = computed(() => t("onboarding.firstData.title"));
// The question sits under Explore, so the card's or page's own status does not ask it too.
provide(HEARD_FROM_ASKED_BY_HOST, true);

// A setup card reports its steps; a Data sources page has none to report, so the nav uses a
// generic pair for it. Either way "Explore Your Data" ends the list.
const cardSteps = ref<SetupStepInfo[]>([]);
// The card's stream input can move its check off "default"; the agent prompt follows it.
const cardStream = ref<string>();
provide(SETUP_STEPS_HOST, {
  setSteps: (steps) => (cardSteps.value = steps),
  setStream: (stream) => (cardStream.value = stream),
});

const checkStatus = computed((): GuideNavStep["status"] => {
  if (result.value) return { text: t("onboarding.rail.received"), tone: "ok" };
  if (["rejected", "no-requests", "stopped"].includes(state.value))
    return { text: t("onboarding.rail.attention"), tone: "attention" };
  if (state.value === "waiting")
    return { text: t("onboarding.rail.waitingShort"), tone: "waiting" };
  return undefined;
});

const navSteps = computed((): GuideNavStep[] => {
  const received = !!result.value;
  // The step that holds the card's check; a card that names none checks at its last step.
  const anchor = cardSteps.value.findIndex((step) => step.detectionAnchor);
  const check = anchor >= 0 ? anchor : cardSteps.value.length - 1;
  const steps: GuideNavStep[] = cardSteps.value.length
    ? cardSteps.value.map((step, i) =>
        i === check
          ? { ...step, title: raw(step.title), done: received, status: checkStatus.value }
          : {
              ...step,
              title: raw(step.title),
              // Data proves the steps before the check; the optional ones after it keep the card's state.
              done: step.done || (received && i < check && !step.notProvenByDetect),
            },
      )
    : [
        {
          id: "run",
          title: t("onboarding.rail.run"),
          done: state.value !== "idle" || received,
          active: state.value === "idle" && !received,
        },
        {
          id: "check",
          title: t("onboarding.rail.check"),
          done: received,
          active: state.value !== "idle" && !received,
          status: checkStatus.value,
        },
      ];
  return [
    ...steps,
    { id: "explore", title: t("onboarding.rail.explore"), done: false, active: received },
  ];
});

const guideEl = ref<HTMLElement | null>(null);
const goToStep = (id: string) => {
  const target =
    document.getElementById(`setup-step-${id}`) ??
    (id === "check"
      ? guideEl.value?.querySelector<HTMLElement>('[data-test="first-event-status"]')
      : null);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

// Set by a Data sources page once it renders; with no check of its own, the org-wide one runs.
const pageHasStatus = ref<boolean>();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
// The help box's key, prompt and file restart the running check, the card's, the page's or the org-wide one.
const restartCheck = provideBarsCopied();

// An invitee lands on Home, so the inviter sends them this guide's link.
// The coding agent help: the key goes into the terminal, and the prompt or file names it only.
const EXPORT_LINE = 'export O2_ACCESS_KEY="[BASIC_PASSCODE]"';
const { endpoint } = useIngestion();
const tracePresets = inject(SETUP_CARD_ONBOARDING, null);
// A guide with no matching prompt section (databases, cloud accounts) offers no prompt.
const agentFocus = computed((): AgentFocus | undefined => {
  if (props.guide.cardSlug === "kubernetes") return "kubernetes";
  if (props.row.id === "linux-windows-or-macos-host") return "host";
  // The frontend prompt installs the browser SDK and the backend one sets up traces only.
  if (["react-native", "android", "ios", "continuous-profiling"].includes(props.row.id))
    return undefined;
  const byChoice: Partial<Record<string, AgentFocus>> = {
    backend: "backend",
    llm: "llm",
    frontend: "frontend",
    logs: "logs",
  };
  return byChoice[props.choice.id];
});
const agentCtx = (focus: AgentFocus) => ({
  endpoint: endpoint.value?.url ?? "",
  org: org.value,
  stream: cardStream.value ?? "default",
  focus,
  traces: tracePresets?.value,
});
const copyPrompt = async () => {
  if (!agentFocus.value) return;
  if (
    await copyToClipboard(buildAgentPrompt(agentCtx(agentFocus.value)), t, {
      successMessage: t("onboarding.agent.promptCopied"),
    })
  ) {
    analytics.track("onboarding_agent_prompt_copied", { focus: agentFocus.value, from: "guide" });
    restartCheck();
  }
};
const downloadSetup = () => {
  if (!agentFocus.value) return;
  const file = buildAgentSetupFile(agentCtx(agentFocus.value));
  if (downloadFile("openobserve-setup.md", file, "text/markdown")) {
    analytics.track("onboarding_agent_prompt_downloaded", {
      focus: agentFocus.value,
      from: "guide",
    });
    restartCheck();
  }
};
</script>
