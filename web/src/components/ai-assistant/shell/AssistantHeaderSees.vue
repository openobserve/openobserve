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
  <AssistantContextSeesPopover
    v-if="!hasChips"
    :sid="sid"
    placement="bottom"
    data-test="assistant-shell-sees"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

import AssistantContextSeesPopover from "@/components/ai-assistant/context/AssistantContextSeesPopover.vue";
import { useAssistantContext, useAssistantStore, type Sid } from "@/composables/assistant";

const props = defineProps<{ sid: Sid | null }>();

const store = useAssistantStore();
const context = useAssistantContext(() => props.sid, { store });

// The composer's strip holds the ⓘ beside its chips; with no chip to sit beside, the header holds it.
const hasChips = computed(() => context.chips.value.some(Boolean));
</script>
