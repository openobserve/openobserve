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
    v-if="!stripHoldsSees"
    :sid="sid"
    placement="bottom"
    :label="label"
    data-test="assistant-shell-sees"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

import AssistantContextSeesPopover from "@/components/ai-assistant/context/AssistantContextSeesPopover.vue";
import { useAssistantStore, type Sid } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

import { composerStripHoldsSees } from "./headerSees";

const props = defineProps<{ sid: Sid | null; label?: I18nText }>();

const store = useAssistantStore();

// The time chip is always in the strip, so counting it would leave neither place with the ⓘ (B-shell-1).
const stripHoldsSees = computed(() =>
  composerStripHoldsSees(store.state.sessions[props.sid ?? ""]?.composer ?? null),
);
</script>
