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
  AiAgentsLoadError — what an AI page shows in Agent mode when the agents list
  failed to load (useAgentScope's `agentsError`): the shared no-access state for
  a 403, else the shared load-error state with a Retry that emits `retry`. A
  failed load is not "no agents", so it never shows the no-agents or the
  "No agent identity found" states.
-->
<template>
  <OEmptyState
    v-if="error === 'forbidden'"
    :size="size"
    preset="no-access"
    :data-test="`${dataTest}-agents-forbidden`"
  />
  <OEmptyState
    v-else
    :size="size"
    preset="load-error"
    :data-test="`${dataTest}-agents-error`"
    @action="$emit('retry')"
  />
</template>

<script setup lang="ts">
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { AgentsLoadError } from "@/enterprise/composables/useAgentScope";

withDefaults(
  defineProps<{
    error: AgentsLoadError;
    /** data-test prefix; each page passes its own. */
    dataTest: string;
    size?: "hero" | "block";
  }>(),
  { size: "hero" },
);

defineEmits<{
  (e: "retry"): void;
}>();
</script>
