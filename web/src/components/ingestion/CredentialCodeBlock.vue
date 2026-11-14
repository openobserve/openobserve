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
import { useRoute } from "vue-router";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { CodeBlockCopyPayload } from "@/lib/core/Code/OCodeBlock.types";
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
    filename?: string;
    wrap?: boolean;
  }>(),
  { lang: undefined, filename: undefined, wrap: true },
);

const { t } = useI18nTyped();
const route = useRoute();
const openTokenPicker = inject(OPEN_TOKEN_PICKER, null);
const snippetCopied = inject(FIRST_EVENT_SNIPPET_COPIED, null);

const { code, codeMasked, needsPasscode, forbidden, tokenName, ready, hasCredential } =
  useCredentialSnippet(toRef(props, "content"));

const dataTest = computed(() => `ingestion-${props.slug}-code-block`);
// an empty passcode substitutes into a valid-looking snippet that answers 401
const awaitingCredential = computed(() => needsPasscode.value && !ready.value);
// a settled read can still carry no token, so readiness alone does not make the snippet usable
const credentialUnavailable = computed(
  () => needsPasscode.value && ready.value && !forbidden.value && !hasCredential.value,
);
const masked = computed(() =>
  needsPasscode.value && codeMasked.value !== code.value ? codeMasked.value : undefined,
);

const onCopy = ({ partial }: CodeBlockCopyPayload) => {
  analytics.track("snippet_copied", { route: route?.name, partial });
  snippetCopied?.();
};
</script>

<template>
  <OSkeleton
    v-if="awaitingCredential"
    shape="block"
    class="my-3 h-20"
    :data-test="`${dataTest}-loading`"
  />
  <OInlineNotice
    v-else-if="forbidden && needsPasscode"
    tone="warn"
    :data-test="`${dataTest}-passcode-forbidden`"
    :message="t('ingestion.passcodeForbiddenMessage')"
  />
  <OInlineNotice
    v-else-if="credentialUnavailable"
    tone="warn"
    :data-test="`${dataTest}-passcode-unavailable`"
    :message="t('ingestion.passcodeUnavailableMessage')"
  />
  <div v-else :data-test="`${dataTest}-container`">
    <OCodeBlock
      :code="code"
      :code-masked="masked"
      :token-name="needsPasscode ? tokenName : undefined"
      :lang="lang"
      :filename="filename"
      :wrap="wrap"
      :data-test="dataTest"
      class="mb-1"
      @copy="onCopy"
      @token-click="openTokenPicker?.()"
    />
    <p v-if="needsPasscode" class="text-text-secondary m-0 text-xs" :data-test="`${dataTest}-hint`">
      {{ t("components.codeBlock.tokenIncludedHint") }}
    </p>
  </div>
</template>
