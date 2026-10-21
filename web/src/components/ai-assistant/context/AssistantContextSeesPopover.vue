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
  <OPopover
    :open="isOpen"
    privacy="mask"
    side="top"
    :align="align"
    :aria-label="t('assistant.context.title')"
    content-class="w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(32rem,70vh)] overflow-y-auto p-3"
    @update:open="setOpen"
  >
    <template v-if="$slots.anchor" #anchor>
      <slot name="anchor" />
    </template>
    <template v-else #trigger>
      <slot name="trigger">
        <OButton
          variant="ghost"
          size="sm"
          :icon-left="assistantGlyph.info"
          class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          data-test="assistant-context-sees"
        >
          <span :class="iconOnly ? 'sr-only' : 'max-md:sr-only'">{{
            t("assistant.context.title")
          }}</span>
        </OButton>
      </slot>
    </template>

    <section
      data-test="assistant-context-sees-popover"
      data-dd-privacy="mask"
      :aria-labelledby="headingId"
      class="flex flex-col gap-3"
    >
      <OText
        :id="headingId"
        ref="heading"
        variant="card-title"
        as="h2"
        tabindex="-1"
        class="outline-none"
      >
        {{ t("assistant.context.title") }}
      </OText>

      <div
        v-for="group in groups"
        :key="group.id"
        class="flex flex-col gap-1.5"
        :data-test="`assistant-context-sees-${group.id}`"
      >
        <OText variant="label" as="h3">{{ group.title }}</OText>
        <dl class="flex flex-col gap-1">
          <div
            v-for="row in group.rows"
            :key="row.id"
            class="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-2"
            data-test="assistant-context-sees-row"
            :data-field="row.id"
          >
            <dt class="text-text-secondary min-w-0 text-xs">{{ row.label }}</dt>
            <dd class="text-text-body flex min-w-0 items-center gap-1 text-xs">
              <OTruncatedText class="min-w-0 flex-1">{{ row.value }}</OTruncatedText>
              <AssistantIconButton
                v-if="group.id === 'not_read'"
                :label="t('assistant.context.notReadHint')"
                :icon="assistantGlyph.notReadHelp"
                data-test="assistant-context-sees-not-read-hint"
              />
            </dd>
          </div>
        </dl>
      </div>

      <OText variant="meta" as="p" data-test="assistant-context-sees-disclosure">{{
        context.disclosure.value
      }}</OText>
    </section>
  </OPopover>
</template>

<script lang="ts">
import type { Sid } from "@/composables/assistant";

export interface AssistantContextSeesPopoverProps {
  sid: Sid | null;
  /** Controlled open state; omit to let the trigger own it. */
  open?: boolean;
  align?: "start" | "center" | "end";
  /** Below `md` the label is always for screen readers only; this hides it at every size. */
  iconOnly?: boolean;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useAssistantContext, useAssistantStore } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantContextSeesPopoverProps>(), {
  open: undefined,
  align: "end",
  iconOnly: false,
});

const emit = defineEmits<{ (e: "update:open", open: boolean): void }>();

defineSlots<{ trigger?: () => unknown; anchor?: () => unknown }>();

const { t } = useI18nTyped();
const context = useAssistantContext(() => props.sid, { store: useAssistantStore() });
const headingId = `assistant-sees-${useId()}`;
const heading = ref<InstanceType<typeof OText> | null>(null);
const ownOpen = ref(false);

const isOpen = computed(() => props.open ?? ownOpen.value);

const groups = computed(() =>
  (["sent", "not_read"] as const)
    .map((id) => ({
      id,
      title: id === "sent" ? t("assistant.context.sent") : t("assistant.context.notRead"),
      rows: context.sees.value.filter((row) => row.group === id),
    }))
    .filter((group) => group.rows.length > 0),
);

function setOpen(open: boolean): void {
  ownOpen.value = open;
  emit("update:open", open);
}

// Focus lands on the heading, after the popover's own first-control focus (CT-04 AC 6).
watch(isOpen, async (open) => {
  if (!open) return;
  trackAssistant("ai_context_inspected", { target: "sees" });
  await nextTick();
  (heading.value?.$el as HTMLElement | undefined)?.focus();
});
</script>
