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
  Shown on the Monitor pages (Insights, Sessions, Agent Graph, Agent Behavior)
  when they open in Stream mode because the org's LLM spans carry no agent
  identity: says why there is no agent to pick and links to GenAI Agent Mapping,
  where the attribute that names the agent is configured.
-->
<template>
  <div class="px-page-edge pt-2">
    <OBanner
      variant="info"
      icon="info-outline"
      inline-actions
      dense
      :data-test="`${dataTest}-no-agent-identity`"
    >
      <span class="font-medium">{{ t("aiObservability.scope.noAgentIdentity") }}.</span>
      {{ t("aiObservability.scope.noAgentIdentityDescription") }}
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          :data-test="`${dataTest}-no-agent-identity-mapping`"
          @click="openMapping"
        >
          {{ t("aiObservability.scope.noAgentIdentityAction") }}
        </OButton>
      </template>
    </OBanner>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";

defineProps<{
  /** Page prefix; the banner is `${dataTest}-no-agent-identity`. */
  dataTest: string;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

function openMapping() {
  router.push({
    name: "genAiAgentMapping",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
}
</script>
