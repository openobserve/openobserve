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
  <AutoObserve v-if="view === 'nerd'" />
  <AutoObserve2 v-else />
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useStore } from "vuex";
import AutoObserve from "@/components/autoobserve/mock/views/AutoObserve.vue";
import AutoObserve2 from "@/components/autoobserve/mock/views/AutoObserve2.vue";
import { useAutoObserveView } from "@/components/autoobserve/v2/useAutoObserveView";
import { resetDecisions, switchDecisionsOrg } from "@/components/autoobserve/mock/v2/useDecisions";
import { useScenario } from "@/components/autoobserve/mock/data/useScenario";
import { isAssistantV2 } from "@/composables/assistant/flags";
import { useAssistantStore } from "@/composables/assistant";

const { view } = useAutoObserveView();
const { scenario } = useScenario();
// Answers belong to one scenario's story, so switching scenario in either view starts fresh.
watch(scenario, () => resetDecisions());

if (isAssistantV2()) {
  const vuex = useStore();
  const assistant = useAssistantStore();
  watch(
    computed(() => assistant.state.userOrgKey ?? vuex.state.selectedOrganization?.identifier ?? ""),
    (key) => switchDecisionsOrg(key),
    { immediate: true },
  );
}
</script>
