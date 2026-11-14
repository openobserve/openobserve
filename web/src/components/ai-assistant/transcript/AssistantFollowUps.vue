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
  <section
    class="flex min-w-0 flex-col gap-1"
    :aria-label="t('assistant.transcript.followUps')"
    data-test="assistant-follow-ups"
  >
    <OText as="span" variant="meta" aria-hidden="true">
      {{ t("assistant.transcript.followUps") }}
    </OText>
    <div class="divide-border-subtle flex min-w-0 flex-col divide-y">
      <button
        v-for="item in items"
        :key="item"
        type="button"
        :class="ROW_CLASS"
        data-test="assistant-follow-up"
        @click="stage(item)"
      >
        <OIcon
          :name="assistantGlyph.handoff"
          size="xs"
          class="text-text-link shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <OTruncatedText class="min-w-0 text-start">{{ raw(item) }}</OTruncatedText>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { inject } from "vue";

import { assistantTranscriptHostKey } from "@/composables/assistant/pure";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const ROW_CLASS =
  "group text-text-body hover:text-text-heading focus-visible:ring-border-strong rounded-default flex min-h-8 w-full cursor-pointer items-center gap-2 py-1.5 text-sm outline-none focus-visible:ring-2 max-md:min-h-11 pointer-coarse:min-h-11";

const { t } = useI18nTyped();

const props = defineProps<{ sid: string; items: string[] }>();

// Through the host, so the public shared page never pulls in the assistant store.
const host = inject(assistantTranscriptHostKey, null);

function stage(text: string): void {
  host?.stageFollowUp(props.sid, text);
  host?.focusComposer();
}
</script>
