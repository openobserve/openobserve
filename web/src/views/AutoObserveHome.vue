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
  <div v-if="assistantV2" class="flex h-full flex-col" data-test="autoobserve-home">
    <div class="flex shrink-0 flex-col gap-2 px-4 pt-3">
      <OText as="h1" variant="page-title" data-test="autoobserve-preview-header">{{
        t("autoobserve2.previewHeader")
      }}</OText>
      <OBanner variant="info" bar data-test="autoobserve-preview-strip">
        <span class="break-words">
          <strong>{{ t("autoobserve2.previewLabel") }}</strong>
          {{ t("autoobserve2.previewStrip") }}
        </span>
      </OBanner>
    </div>
    <div class="min-h-0 flex-1">
      <AutoObserve v-if="view === 'nerd'" />
      <AutoObserve2 v-else />
    </div>
  </div>
  <div v-else class="h-full" data-test="autoobserve-home">
    <AutoObserve v-if="view === 'nerd'" />
    <AutoObserve2 v-else />
  </div>
</template>

<script setup lang="ts">
import AutoObserve from "@/views/AutoObserve.vue";
import AutoObserve2 from "@/views/AutoObserve2.vue";
import { computed, watch } from "vue";
import { useStore } from "vuex";
import { isAssistantV2 } from "@/composables/assistant/flags";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";
import { useAutoObserveView } from "@/components/autoobserve/v2/useAutoObserveView";
import { resetDecisions, switchDecisionsOrg } from "@/components/autoobserve/v2/useDecisions";
import { useAssistantStore } from "@/composables/assistant";
import OText from "@/lib/core/Typography/OText.vue";
import { useScenario } from "@/components/autoobserve/data/useScenario";

const { view } = useAutoObserveView();
const { scenario } = useScenario();
// Answers belong to one scenario's story, so switching scenario in either view starts fresh.
watch(scenario, resetDecisions);

const { t } = useI18nTyped();
const vuex = useStore();
const assistantV2 = isAssistantV2();
if (assistantV2) {
  const assistant = useAssistantStore();
  watch(
    computed(() => assistant.state.userOrgKey ?? vuex.state.selectedOrganization?.identifier ?? ""),
    (key) => switchDecisionsOrg(key),
    { immediate: true },
  );
}
</script>
