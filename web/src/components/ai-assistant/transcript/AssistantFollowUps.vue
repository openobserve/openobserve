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
  <div class="-ms-1.5 flex min-w-0 flex-col" data-test="assistant-follow-ups">
    <OButton
      v-for="item in items"
      :key="item"
      variant="ghost-primary"
      size="sm"
      :class="ROW_CLASS"
      data-test="assistant-follow-up"
      @click="stage(item)"
    >
      <OTruncatedText class="min-w-0 text-start">{{ raw(item) }}</OTruncatedText>
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { inject } from "vue";

import { useAssistantStore } from "@/composables/assistant";
import { assistantTranscriptHostKey } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw } from "@/types/i18n";

const ROW_CLASS =
  "text-text-link hover:text-assistant-link min-h-7 w-full justify-start font-normal max-md:min-h-11 pointer-coarse:min-h-11";

const props = defineProps<{ sid: string; items: string[] }>();

const store = useAssistantStore();
const host = inject(assistantTranscriptHostKey, null);

// A follow-up stages, so the reader can edit it before Send (A28).
function stage(text: string): void {
  store.stage(props.sid, { text, mode: "replace" });
  host?.focusComposer();
}
</script>
