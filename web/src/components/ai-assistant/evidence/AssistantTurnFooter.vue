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
  <div
    v-if="visible"
    class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs leading-5"
    data-test="assistant-turn-footer"
    :data-variant="notSaved ? 'not_saved' : 'done'"
  >
    <OPopover
      v-if="credits"
      privacy="mask"
      side="top"
      align="start"
      :aria-label="credits"
      content-class="p-2 text-xs"
    >
      <template #trigger>
        <OButton
          variant="ghost"
          size="xs"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-turn-footer-credits"
        >
          {{ credits }}
        </OButton>
      </template>
      <OText v-if="tokensLine" variant="meta" as="p" data-test="assistant-turn-footer-tokens">{{
        tokensLine
      }}</OText>
      <OText v-else variant="meta" as="p">{{ t("assistant.footer.creditsCountedHint") }}</OText>
    </OPopover>
    <template v-if="notSaved">
      <span v-if="credits" aria-hidden="true">·</span>
      <OPopover
        privacy="mask"
        side="top"
        align="start"
        :aria-label="t('assistant.footer.notSaved')"
        content-class="p-2 text-xs"
      >
        <template #trigger>
          <OButton
            variant="ghost"
            size="xs"
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-turn-footer-not-saved"
          >
            {{ t("assistant.footer.notSaved") }}
          </OButton>
        </template>
        <OText variant="meta" as="p">{{ t("assistant.footer.notSavedHint") }}</OText>
      </OPopover>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  footerOf,
  type AssistantTurnView,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    block?: ContentBlock;
    blockId?: string;
    message: ChatMessage;
    readonly?: boolean;
    density?: "compact" | "roomy";
    turn?: AssistantTurnView | null;
  }>(),
  { block: undefined, blockId: "", readonly: false, density: "compact", turn: null },
);

const { t } = useI18nTyped();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const outcome = computed(() => props.turn?.outcome ?? "done");
const footer = computed(() => footerOf(props.message));
const stopped = computed(() => outcome.value === "stopped" || outcome.value === "failed");
const notSaved = computed(
  () => outcome.value === "done_not_saved" || footer.value?.persisted === false,
);
const capability = computed(() => evidence?.capability() ?? null);
const visible = computed(() => outcome.value !== "live" && (!!credits.value || notSaved.value));

// Cloud only, never on a shared page; the flat 1 until the server counts credits.
const credits = computed<I18nText | null>(() => {
  const mode = capability.value?.creditMode;
  if (!mode || props.readonly) return null;
  const count = footer.value?.usage?.credits ?? 1;
  // Only a server count of 0 on a failed or stopped turn is a refund; the flat rule never claims one.
  if (count === 0 && stopped.value) return t("assistant.footer.refunded");
  return mode === "free"
    ? t("assistant.footer.includedCredits", { count: formatCount(count) }, count)
    : t("assistant.footer.credits", { count: formatCount(count) }, count);
});

const tokensLine = computed<I18nText | null>(() => {
  const usage = footer.value?.usage;
  if (usage?.totalTokens === undefined) return null;
  const calls = usage.llmCalls ?? 0;
  return t(
    "assistant.footer.tokens",
    { tokens: formatCount(usage.totalTokens), count: formatCount(calls) },
    calls,
  );
});
</script>
