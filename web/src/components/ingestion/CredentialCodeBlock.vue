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

<script setup lang="ts">
import { computed, inject, toRef } from "vue";
import { useRouter } from "vue-router";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { CodeBlockChrome, CodeBlockCopyPayload } from "@/lib/core/Code/OCodeBlock.types";
import { useI18nTyped } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { OPEN_TOKEN_PICKER, useCredentialSnippet } from "@/composables/useCredentialSnippet";
import { FIRST_EVENT_SNIPPET_COPIED } from "@/composables/firstEvent/firstEventCopied";

const props = withDefaults(
  defineProps<{
    /** Snippet template; [EMAIL], [PASSCODE] and [BASIC_PASSCODE] are filled from the store. */
    content: string;
    /** Names the block in its data-test prefix, `ingestion-<slug>-code-block`. */
    slug: string;
    lang?: string;
    chrome?: CodeBlockChrome;
    filename?: string;
    wrap?: boolean;
  }>(),
  { lang: undefined, chrome: undefined, filename: undefined, wrap: true },
);

const { t } = useI18nTyped();
const router = useRouter();
const openTokenPicker = inject(OPEN_TOKEN_PICKER, null);
const snippetCopied = inject(FIRST_EVENT_SNIPPET_COPIED, null);

const { code, codeMasked, needsPasscode, forbidden, tokenName } = useCredentialSnippet(
  toRef(props, "content"),
);

const dataTest = computed(() => `ingestion-${props.slug}-code-block`);
const masked = computed(() =>
  needsPasscode.value && codeMasked.value !== code.value ? codeMasked.value : undefined,
);

const onCopy = ({ partial }: CodeBlockCopyPayload) => {
  analytics.track("snippet_copied", { route: router?.currentRoute.value.name, partial });
  snippetCopied?.();
};
</script>

<template>
  <!-- an empty passcode would substitute into a valid-looking but non-functional snippet -->
  <OBanner
    v-if="forbidden && needsPasscode"
    variant="warning"
    :data-test="`${dataTest}-passcode-forbidden`"
    :content="t('ingestion.passcodeForbiddenMessage')"
  />
  <div v-else :data-test="`${dataTest}-container`">
    <OCodeBlock
      :code="code"
      :code-masked="masked"
      :token-name="needsPasscode ? tokenName : undefined"
      :lang="lang"
      :chrome="chrome"
      :filename="filename"
      :wrap="wrap"
      :data-test="dataTest"
      inset
      copy-on-click
      class="mb-1"
      @copy="onCopy"
      @token-click="openTokenPicker?.()"
    />
    <p class="text-text-secondary m-0 text-xs" :data-test="`${dataTest}-hint`">
      {{
        needsPasscode
          ? t("components.codeBlock.clickToCopyWithToken")
          : t("components.codeBlock.clickToCopy")
      }}
    </p>
  </div>
</template>
