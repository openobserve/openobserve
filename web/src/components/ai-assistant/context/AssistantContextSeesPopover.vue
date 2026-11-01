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
    :content-class="`${widthClass} max-h-[min(32rem,70vh)] overflow-y-auto p-3`"
    @update:open="setOpen"
  >
    <template v-if="$slots.anchor" #anchor>
      <slot name="anchor" />
    </template>
    <template v-else #trigger>
      <slot name="trigger">
        <AssistantIconButton
          :label="t('assistant.context.title')"
          :icon="assistantGlyph.info"
          class="h-7! w-7!"
          data-test="assistant-context-sees"
        />
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
        <OText v-if="group.id === 'not_read'" variant="label" as="h3">{{ group.title }}</OText>
        <dl class="flex flex-col gap-1">
          <div
            v-for="row in group.rows"
            :key="row.id"
            class="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-2 max-md:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]"
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
        disclosure
      }}</OText>
      <OText
        v-if="voice.sentence.value"
        variant="meta"
        as="p"
        data-test="assistant-context-sees-voice"
      >
        {{ t("assistant.voice.seesLine", { engineSentence: voice.sentence.value }) }}
      </OText>
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
  /** Home names no streams: it has no page to read them from. */
  hideStreams?: boolean;
}

const STREAMS_ROW = "selectedStreams";
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useComposerLayout } from "@/components/ai-assistant/composer/composerUi";
import { useVoiceAvailability } from "@/components/ai-assistant/composer/useAssistantVoice";
import { useAssistantContext, useAssistantStore } from "@/composables/assistant";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantContextSeesPopoverProps>(), {
  open: undefined,
  align: "end",
  hideStreams: false,
});

const emit = defineEmits<{ (e: "update:open", open: boolean): void }>();

defineSlots<{ trigger?: () => unknown; anchor?: () => unknown }>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const context = useAssistantContext(() => props.sid, { store });
const voice = useVoiceAvailability();
const layout = useComposerLayout();
const headingId = `assistant-sees-${useId()}`;
const heading = ref<InstanceType<typeof OText> | null>(null);
const ownOpen = ref(false);

const isOpen = computed(() => props.open ?? ownOpen.value);
const disclosure = computed(() =>
  store.state.sessions[props.sid ?? ""]?.share
    ? context.disclosure.value
    : t("assistant.context.seesDisclosure"),
);
const widthClass = computed(() =>
  layout.value.tight ? "w-[calc(20rem-0.375rem)]" : "w-[min(28rem,calc(100vw-1.5rem))]",
);

const groups = computed(() =>
  (["sent", "not_read"] as const)
    .map((id) => ({
      id,
      title: id === "sent" ? t("assistant.context.sent") : t("assistant.context.notRead"),
      rows: context.sees.value.filter(
        (row) => row.group === id && !(props.hideStreams && row.id === STREAMS_ROW),
      ),
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
