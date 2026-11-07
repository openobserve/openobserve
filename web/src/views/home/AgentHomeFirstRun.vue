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
  <section class="flex min-w-0 flex-col gap-3" data-test="agent-home-first-run" :data-state="state">
    <AssistantLauncher layout="overview" :go-to-only="offReason !== null">
      <template #note>
        <AgentHomeAskNote v-if="offReason" :reason="offReason" :org="org" />
      </template>
    </AssistantLauncher>
    <div class="flex min-w-0 flex-col gap-1">
      <h2 class="text-text-heading text-xl font-semibold" data-test="agent-home-first-run-title">
        {{ t("home.agent.firstRun.title") }}
      </h2>
      <OText variant="meta">{{ t("home.agent.firstRun.note") }}</OText>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import AssistantLauncher from "@/components/ai-assistant/welcome/AssistantLauncher.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";

import AgentHomeAskNote from "./AgentHomeAskNote.vue";
import { useAgentHomeState } from "./useAgentHomeState";

const { t } = useI18nTyped();
const store = useStore();
const { state, offReason } = useAgentHomeState();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
</script>
