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
  <component
    :is="variant === 'popover' ? OPopover : OCollapsible"
    v-bind="wrapperProps"
    data-test="assistant-error-details"
  >
    <template v-if="variant === 'popover'" #trigger>
      <OButton variant="ghost" size="sm" class="max-md:min-h-11 pointer-coarse:min-h-11">
        {{ t("assistant.errorDetails.title") }}
      </OButton>
    </template>
    <div :class="['flex flex-col gap-2', variant === 'popover' ? 'w-80 max-w-full p-3' : 'pt-1']">
      <dl
        class="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
        data-test="assistant-error-details-rows"
      >
        <template v-for="row in rows" :key="row.key">
          <dt class="min-w-0 font-medium">{{ row.label }}</dt>
          <dd
            :class="[
              'min-w-0 whitespace-pre-wrap',
              row.id ? 'font-mono break-all' : 'break-words',
              row.mono ? 'font-mono' : '',
            ]"
            :data-test="`assistant-error-details-${row.key}`"
          >
            {{ row.value }}
          </dd>
        </template>
      </dl>
      <OButton
        v-if="statusLink"
        variant="ghost-primary"
        size="sm"
        as="a"
        :href="ASSISTANT_SETUP_DOCS_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-error-details-status"
      >
        {{ t("assistant.docs.setupGuide") }}
        <span class="sr-only">{{ t("assistant.docs.opensInNewTab") }}</span>
        <template #icon-right><OIcon :name="newTabIcon" size="sm" /></template>
      </OButton>
      <div v-if="copyFailed" ref="manualField" class="flex flex-col gap-1">
        <OTextarea
          :model-value="copyText"
          :label="t('assistant.errorDetails.title')"
          readonly
          autogrow
          :rows="3"
          data-test="assistant-error-details-manual"
        />
        <OText variant="meta" as="p" data-test="assistant-error-details-copy-manually">
          {{ t("assistant.client.copyManually") }}
        </OText>
      </div>
      <OButton
        variant="outline"
        size="sm"
        class="self-start max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-error-details-copy"
        @click="copyDetails"
      >
        {{ t("assistant.errorDetails.copy") }}
      </OButton>
    </div>
  </component>
</template>

<script lang="ts">
import type { AssistantError } from "@/composables/assistant/pure";

export interface AssistantErrorDetailsProps {
  error: AssistantError;
  /** When it happened, epoch ms. */
  at: number;
  /** Adds the setup guide link for service errors. */
  isAdmin: boolean;
  variant?: "collapsible" | "popover";
}

export interface AssistantErrorDetailsEmits {
  (e: "copied"): void;
}

/** The setup guide; settings and status actions lead here, labelled as docs, until Settings › Assistant ships (HT-02 AC 6). */
export const ASSISTANT_SETUP_DOCS_URL = "https://openobserve.ai/docs/enterprise-setup/sre-agent/";

// `80` §1.4: only a service failure has a status worth checking.
const SERVICE_CODES: ReadonlySet<string> = new Set([
  "agent_unavailable",
  "provider_error",
  "unknown",
]);

/** Details as plain text; never the prompt, chips or page context (`80` §1.4, SEC-06). */
export function detailsText(rows: { label: string; value: string }[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}

export function showsStatusLink(code: string, isAdmin: boolean): boolean {
  return isAdmin && SERVICE_CODES.has(code);
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { formatOrgTime } from "@/utils/formatters";

const props = withDefaults(defineProps<AssistantErrorDetailsProps>(), { variant: "collapsible" });

const emit = defineEmits<AssistantErrorDetailsEmits>();

const { t } = useI18nTyped();
const open = ref(false);
const copyFailed = ref(false);
const manualField = ref<HTMLElement | null>(null);

const none = raw("—");
const newTabIcon = assistantGlyph.newTab;

// Ids break anywhere; prose rows break only between words.
const rows = computed<
  { key: string; label: I18nText; value: I18nText; id?: boolean; mono?: boolean }[]
>(() => {
  const error = props.error;
  const text = (value: string | number | undefined) =>
    value === undefined || value === "" ? none : raw(String(value));
  return [
    { key: "code", label: t("assistant.errorDetails.code"), value: raw(error.code), id: true },
    { key: "http", label: t("assistant.errorDetails.httpStatus"), value: text(error.httpStatus) },
    { key: "turn", label: t("assistant.errorDetails.turn"), value: text(error.turnId), id: true },
    {
      key: "chat",
      label: t("assistant.errorDetails.chat"),
      value: text(error.sessionId),
      id: true,
    },
    {
      key: "trace",
      label: t("assistant.errorDetails.trace"),
      value: text(error.traceId),
      id: true,
    },
    {
      key: "when",
      label: t("assistant.errorDetails.when"),
      value: raw(formatOrgTime(props.at, { showZone: true })),
    },
    {
      key: "server",
      label: t("assistant.errorDetails.serverMessage"),
      value: text(error.serverMessage),
      mono: true,
    },
  ];
});

const copyText = computed(() =>
  detailsText(rows.value.map((row) => ({ label: row.label, value: row.value }))),
);

const statusLink = computed(() => showsStatusLink(props.error.code, props.isAdmin));

async function copyDetails(): Promise<void> {
  copyFailed.value = false;
  const copied = await copyToClipboard(copyText.value, t, { silent: true });
  if (copied) {
    toast({ variant: "success", message: t("assistant.errorDetails.copied") });
    emit("copied");
    return;
  }
  copyFailed.value = true;
  await nextTick();
  manualField.value?.querySelector("textarea")?.select();
}

const wrapperProps = computed(() =>
  props.variant === "popover"
    ? { ariaLabel: t("assistant.errorDetails.title"), privacy: "mask" }
    : {
        modelValue: open.value,
        "onUpdate:modelValue": (value: boolean) => (open.value = value),
        label: t("assistant.errorDetails.title"),
        triggerClass: "min-h-8 max-md:min-h-11 pointer-coarse:min-h-11",
      },
);

defineExpose({ copyText, open });
</script>
