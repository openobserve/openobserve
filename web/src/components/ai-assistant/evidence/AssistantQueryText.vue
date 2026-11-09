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
    v-if="chrome"
    role="group"
    :aria-label="label"
    class="rounded-surface border-border-subtle bg-assistant-syn-bg flex min-w-0 flex-col overflow-hidden border"
    :data-test="`${dataTest}-chrome`"
  >
    <div
      class="border-border-subtle text-text-secondary text-2xs flex h-8 min-w-0 items-center gap-2 border-b ps-3 pe-1 font-medium"
    >
      <span class="shrink-0" :data-test="`${dataTest}-lang`">{{ languageLabel(language) }}</span>
      <OTruncatedText v-if="meta" class="min-w-0 font-normal" :data-test="`${dataTest}-meta`">{{
        meta
      }}</OTruncatedText>
      <AssistantIconButton
        class="ms-auto"
        :label="t('assistant.query.copy')"
        :icon="assistantGlyph.copy"
        :done="copied ? t('common.copied') : undefined"
        confirms
        :data-test="`${dataTest}-copy`"
        @click="copy"
      />
    </div>
    <OCodeBlock
      :code="text"
      class="my-0! rounded-none! border-0!"
      :lang="lang"
      :highlighted-html="highlighted"
      :copyable="false"
      :toolbar="false"
      wrap
      padded
      :max-lines="cap"
      contrast="aa"
      :scroll-label="label"
      :data-test="dataTest"
    />
    <button
      v-if="long"
      type="button"
      class="text-text-link hover:bg-surface-hover focus-visible:outline-border-focus flex min-h-8 w-full items-center justify-center gap-1 text-xs font-medium focus-visible:outline-2"
      :class="chrome ? 'border-border-subtle bg-surface-base border-t' : 'rounded-default'"
      :aria-expanded="expanded"
      :data-test="`${dataTest}-expand`"
      @click="expanded = !expanded"
    >
      {{
        expanded
          ? t("assistant.query.showFewerLines")
          : t("assistant.query.showAllLines", { count: lineCount })
      }}
    </button>
    <div
      v-if="$slots.foot"
      class="border-border-subtle bg-surface-base flex min-w-0 items-center gap-1 border-t px-2 py-1.5"
      :data-test="`${dataTest}-foot`"
    >
      <slot name="foot" />
    </div>
  </div>
  <div v-else class="flex min-w-0 flex-col gap-1">
    <!-- One Monaco per query breaks the transcript budget; wrapped, since overlay scrollbars hide a sideways overflow -->
    <OCodeBlock
      :code="text"
      class="my-0!"
      :lang="lang"
      :highlighted-html="highlighted"
      :copyable="false"
      :toolbar="false"
      wrap
      :max-lines="cap"
      contrast="aa"
      :scroll-label="label"
      :data-test="dataTest"
    />
    <button
      v-if="long"
      type="button"
      class="text-text-link hover:bg-surface-hover focus-visible:outline-border-focus flex min-h-8 w-full items-center justify-center gap-1 text-xs font-medium focus-visible:outline-2"
      :class="chrome ? 'border-border-subtle bg-surface-base border-t' : 'rounded-default'"
      :aria-expanded="expanded"
      :data-test="`${dataTest}-expand`"
      @click="expanded = !expanded"
    >
      {{
        expanded
          ? t("assistant.query.showFewerLines")
          : t("assistant.query.showAllLines", { count: lineCount })
      }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import type { QueryRef } from "@/composables/assistant/pure";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

import AssistantIconButton from "../common/AssistantIconButton.vue";
import { assistantGlyph } from "../common/glyphs";
import { highlightCode } from "../transcript/markdownCore";

import { languageLabel } from "./evidenceText";

const MAX_LINES = 12;

// How long Copy reads "Copied" in place before it turns back.
const COPIED_MS = 2_000;

const props = withDefaults(
  defineProps<{
    text: string;
    language: QueryRef["language"];
    /** The scroll region's name; unique per block, as two regions of one name are one landmark to a reader. */
    label: I18nText;
    /** A head with the language and Copy, and a foot for the card's actions (K1 code block). */
    chrome?: boolean;
    /** What the head says after the language, such as the stream and window. */
    meta?: I18nText;
    dataTest: string;
  }>(),
  { chrome: false, meta: undefined },
);

defineSlots<{ foot?: () => unknown }>();

const { t } = useI18nTyped();

const lang = computed(() => (props.language === "regex" ? "plaintext" : props.language));

const highlighted = computed(() => highlightCode(props.text, lang.value));

const copied = ref(false);

// Code past the cap is reachable only through a nested scroller, so the block says how much is hidden and opens in place.
const expanded = ref(false);
const lineCount = computed(() => props.text.split("\n").length);
const long = computed(() => lineCount.value > MAX_LINES);
const cap = computed(() => (expanded.value ? undefined : MAX_LINES));

let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
  const ok = await copyToClipboard(props.text, t, { silent: true });
  if (!ok) {
    toast({ variant: "error", message: t("assistant.client.copyManually") });
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
}

onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>
