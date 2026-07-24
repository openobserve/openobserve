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
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import CopyContent from "@/components/CopyContent.vue";
import useIngestion from "@/composables/useIngestion";
import { b64EncodeStandard } from "@/utils/zincutils";
import { aiCategories } from "./data";
import type { AICategory, AIIntegration } from "./data";
import { getAICardRaw } from "./content";
import { safeHttpUrl, type CardSubstitutions } from "./content/renderMarkdown";
import { getRichCardContent } from "./content/richCard/registry";
import AIIntegrationCard from "./content/AIIntegrationCard.vue";
import AIRichSetupCard from "@/components/ingestion/setupCard/SetupCardRenderer.vue";

const props = defineProps<{
  categorySlug: string;
  integrationSlug: string;
}>();

const { t } = useI18n();
const store = useStore();
const { aiContent, endpoint } = useIngestion();

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
    token: b64EncodeStandard(`${email}:${passcode}`) ?? "",
  };
});

// Rich, stepped setup card for integrations that have it (registry-driven, keyed
// by content slug — e.g. "anthropic"). Falls back to the markdown card otherwise.
const richContent = computed(() =>
  getRichCardContent(
    integration.value?.contentSlug ?? integration.value?.slug,
    subs.value,
  ),
);
</script>

<template>
  <div v-if="integration" class="p-2">
    <AIRichSetupCard
      v-if="richContent"
      :key="integrationSlug"
      :content="richContent"
      :subs="subs"
      :logo-url="integration.logo"
      :logo-url-dark="integration.logoDark"
    />
    <AIIntegrationCard
      v-else-if="cardContent"
      :content="cardContent"
      :doc-url="docURL"
    />
    <div v-else class="text-base">
      <CopyContent :content="aiContent" />
      <div class="font-bold pt-6 pb-2">
        {{ t('ingestion.ai.viewDocsPrefix') }}
        <a
          :href="safeHttpUrl(docURL)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-link hover:text-text-link-hover"
          style="text-decoration: underline"
          >{{ t('ingestion.ai.viewDocsLinkLabel') }}</a
        >
        {{ t('ingestion.ai.viewDocsSuffix') }}
      </div>
    </div>
  </div>
  <div v-else class="p-2">
    <p>{{ t('ingestion.ai.selectIntegrationPrompt') }}</p>
  </div>
</template>
