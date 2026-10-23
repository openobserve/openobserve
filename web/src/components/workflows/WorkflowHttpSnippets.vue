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

<template>
  <div class="flex flex-col gap-2">
    <OTabs v-model="lang" dense>
      <OTab
        v-for="tab in TABS"
        :key="tab.lang"
        :name="tab.lang"
        :label="tab.label"
        :data-test="`workflow-http-snippet-tab-${tab.lang}`"
      />
    </OTabs>
    <OCodeBlock
      :key="lang"
      :code="code"
      :code-masked="masked"
      :lang="LANG_IDS[lang]"
      padded
      :reveal-tooltip="t('ingestion.setupCard.revealToken')"
      :hide-tooltip="t('ingestion.setupCard.hideToken')"
      wrap
      data-test="workflow-http-snippet"
      data-o2-privacy="mask"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { HttpAuthMode } from "@/services/workflows";
import {
  buildMaskedSnippet,
  buildSnippet,
  type SnippetLang,
} from "@/plugins/workflows/httpSnippets";

const props = defineProps<{
  url: string;
  mode: HttpAuthMode;
  /** Null renders an environment-variable placeholder instead of a value. */
  secret: string | null;
  displayPrefix: string;
  sampleBody: string;
}>();

const { t } = useI18nTyped();

const TABS: { lang: SnippetLang; label: ReturnType<typeof raw> }[] = [
  { lang: "curl", label: raw("curl") },
  { lang: "js", label: raw("JavaScript") },
  { lang: "python", label: raw("Python") },
];
const LANG_IDS: Record<SnippetLang, string> = { curl: "bash", js: "javascript", python: "python" };

const lang = ref<SnippetLang>("curl");
const input = computed(() => ({
  url: props.url,
  mode: props.mode,
  sampleBody: props.sampleBody,
}));
const code = computed(() => buildSnippet(lang.value, { ...input.value, secret: props.secret }));
const masked = computed(() =>
  props.secret
    ? buildMaskedSnippet(lang.value, { ...input.value, displayPrefix: props.displayPrefix })
    : undefined,
);
</script>
