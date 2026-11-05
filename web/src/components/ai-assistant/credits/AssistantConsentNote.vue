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
    v-if="note"
    class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    data-test="assistant-consent-note"
  >
    <OIcon
      :name="assistantGlyph.verified"
      size="xs"
      class="text-text-secondary shrink-0"
      aria-hidden="true"
    />
    <OText variant="meta" as="p" class="min-w-0 break-words">{{ line }}</OText>
    <OButton
      v-if="href && !readonly"
      variant="ghost-primary"
      size="xs"
      as="a"
      :href="href"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="t('assistant.consent.manageName')"
      :class="TOUCH_TARGET_CLASS"
      data-test="assistant-consent-note-manage"
    >
      {{ t("assistant.consent.manage") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useRouter } from "vue-router";

import { assistantApprovalsHostKey } from "@/components/ai-assistant/approvals/approvals.types";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import type { ConsentNoteData } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** As a registered renderer: the `consent_note` block of the answer. */
    block?: ContentBlock | null;
    /** Or the note itself. */
    consent?: ConsentNoteData | null;
    readonly?: boolean;
    blockId?: string;
    density?: "compact" | "roomy";
    message?: unknown;
    turn?: unknown;
  }>(),
  {
    block: null,
    consent: null,
    readonly: false,
    blockId: "",
    density: "compact",
  },
);

const { t } = useI18nTyped();
const router = useRouter();
const host = props.readonly ? null : inject(assistantApprovalsHostKey, null);

const note = computed(() => props.consent ?? props.block?.consentNote ?? null);

// A share never names who enabled it; this tab's own user reads "you".
const user = computed(() => {
  const by = note.value?.by ?? "";
  if (props.readonly || !host) return t("assistant.consent.aMember");
  return by && by === host.currentUser() ? t("assistant.consent.you") : raw(by || "");
});

const line = computed(() =>
  note.value
    ? t("assistant.consent.enabledBy", {
        org: raw(note.value.org),
        user: user.value,
        time: raw(formatOrgTime(note.value.at)),
      })
    : raw(""),
);

const href = computed(() => {
  if (!note.value) return null;
  try {
    return router.resolve({ name: "plans", query: { org_identifier: note.value.org } }).href;
  } catch {
    return null;
  }
});
</script>
