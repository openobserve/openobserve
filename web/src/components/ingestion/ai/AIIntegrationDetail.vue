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

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import useIngestion from "@/composables/useIngestion";
import { basicIngestToken } from "@/composables/useCredentialSnippet";
import { aiCategories } from "./data";
import type { AICategory, AIIntegration } from "./data";
import { getAICardRaw } from "./content";
import { safeHttpUrl, type CardSubstitutions } from "./content/renderMarkdown";
import { getRichCardContent } from "./content/richCard/registry";
import AIIntegrationCard from "./content/AIIntegrationCard.vue";
import AIRichSetupCard from "@/components/ingestion/setupCard/SetupCardRenderer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import CodingAgentSetup from "./CodingAgentSetup.vue";
import { CODING_AGENT_TAB, STEP_BY_STEP_TAB } from "./codingAgentPrompt";

const props = defineProps<{
  categorySlug: string;
  integrationSlug: string;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { aiContent, endpoint } = useIngestion();
const route = useRoute();

const category = computed<AICategory | undefined>(() =>
  aiCategories.find((c) => c.slug === props.categorySlug),
);

const integration = computed<AIIntegration | undefined>(() =>
  category.value?.integrations.find((i) => i.slug === props.integrationSlug),
);

const docURL = computed(() => integration.value?.docURL ?? "");
// Rich card markdown sourced from o2-datasource (if this integration has it),
// otherwise fall back to the legacy 3-line snippet + doc link.
const cardContent = computed(() =>
  getAICardRaw(integration.value?.contentSlug ?? integration.value?.slug),
);

// Per-org url/org/token used by the rich card's commands + .env download (mirrors
// AIIntegrationCard.vue's substitutions). `token` is the base64 of
// email:<org ingestion passcode> WITHOUT the "Basic " prefix — the snippets add
// it. Same Basic-auth token as every other Data Sources card, not a login password.
const subs = computed<CardSubstitutions>(() => {
  const email = store.state.userInfo?.email ?? "";
  const passcode = store.state.organizationData?.organizationPasscode ?? "";
  return {
    url: endpoint.value?.url ?? "",
    org: store.state.selectedOrganization?.identifier ?? "",
    token: basicIngestToken(email, passcode),
  };
});

const passcodeForbidden = computed(
  () => !!store.state.organizationData?.organizationPasscodeForbidden,
);

// must test the RAW markdown: richContent has already had {token} substituted away
const richContentNeedsPasscode = computed(() =>
  String(getAICardRaw(integration.value?.contentSlug ?? integration.value?.slug) ?? "").includes(
    "{token}",
  ),
);

// Rich, stepped setup card for integrations that have it (registry-driven, keyed
// by content slug — e.g. "anthropic"). Falls back to the markdown card otherwise.
const richContent = computed(() =>
  getRichCardContent(integration.value?.contentSlug ?? integration.value?.slug, subs.value, t),
);

// "With a coding agent" / "Step by step". `?tab=agent` (e.g. from the LLM
// Insights empty state) opens the coding-agent tab; anything else opens the
// stepped card, which stays the default.
const tabFromQuery = (tab: unknown) =>
  tab === CODING_AGENT_TAB ? CODING_AGENT_TAB : STEP_BY_STEP_TAB;
const activeTab = ref<string | number>(tabFromQuery(route?.query?.tab));
watch(
  () => route?.query?.tab,
  (tab) => {
    activeTab.value = tabFromQuery(tab);
  },
);

// The stream the prompt names: the card's own stream default, else "default".
const agentDefaultStream = computed(
  () =>
    richContent.value?.streamInput?.default || richContent.value?.detect?.streamName || "default",
);
const agentGuideName = computed(
  () => richContent.value?.provider.name ?? String(integration.value?.name ?? ""),
);
</script>

<template>
  <div v-if="integration" class="p-2">
    <OTabs v-model="activeTab" dense bordered data-test="ai-integration-setup-tabs">
      <OTab
        :name="CODING_AGENT_TAB"
        :label="t('ingestion.ai.codingAgent.tabAgent')"
        data-test="ai-integration-tab-coding-agent"
      />
      <OTab
        :name="STEP_BY_STEP_TAB"
        :label="t('ingestion.ai.codingAgent.tabSteps')"
        data-test="ai-integration-tab-step-by-step"
      />
    </OTabs>
    <CodingAgentSetup
      v-if="activeTab === CODING_AGENT_TAB"
      :key="`agent-${integrationSlug}`"
      :subs="subs"
      :default-stream="agentDefaultStream"
      :detect="richContent?.detect"
      :guide-name="agentGuideName"
      :doc-url="richContent?.docUrl ?? docURL"
      :passcode-forbidden="passcodeForbidden"
    />
    <OBanner
      v-else-if="passcodeForbidden && richContent && richContentNeedsPasscode"
      variant="warning"
      data-test="ai-integration-detail-passcode-forbidden"
      :content="t('ingestion.passcodeForbiddenMessage')"
    />
    <AIRichSetupCard
      v-else-if="richContent"
      :key="integrationSlug"
      :content="richContent"
      :subs="subs"
      :logo-url="integration.logo"
      :logo-url-dark="integration.logoDark"
    />
    <AIIntegrationCard v-else-if="cardContent" :content="raw(cardContent)" :doc-url="docURL" />
    <div v-else class="text-base">
      <CredentialCodeBlock slug="ai-integration" :content="aiContent" />
      <div class="pt-6 pb-2 font-bold">
        {{ t("ingestion.ai.viewDocsPrefix") }}
        <a
          :href="safeHttpUrl(docURL)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-link hover:text-text-link-hover"
          style="text-decoration: underline"
          >{{ t("ingestion.ai.viewDocsLinkLabel") }}</a
        >
        {{ t("ingestion.ai.viewDocsSuffix") }}
      </div>
    </div>
  </div>
  <div v-else class="p-2">
    <p>{{ t("ingestion.ai.selectIntegrationPrompt") }}</p>
  </div>
</template>
