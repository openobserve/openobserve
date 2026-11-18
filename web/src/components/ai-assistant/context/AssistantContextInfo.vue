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
    v-model:open="open"
    side="top"
    align="end"
    :aria-label="title"
    :collision-padding="inset"
    :z-index="zIndex"
    :content-class="`${widthClass} max-h-[min(32rem,70vh)] overflow-y-auto p-3`"
  >
    <template #trigger>
      <AssistantIconButton
        :label="title"
        :icon="assistantGlyph.info"
        class="text-text-secondary!"
        data-test="assistant-context-sees"
      />
    </template>

    <section
      data-test="assistant-context-sees-popover"
      data-dd-privacy="mask"
      data-assistant-surface
      :aria-labelledby="headingId"
      class="flex flex-col gap-2"
    >
      <OText
        :id="headingId"
        ref="heading"
        variant="meta"
        as="h2"
        tabindex="-1"
        class="outline-none"
      >
        {{ title }}
      </OText>
      <OText
        v-if="rows.length === 0"
        variant="meta"
        as="p"
        data-test="assistant-context-sees-empty"
      >
        {{ t("assistant.context.seesEmpty") }}
      </OText>
      <dl
        v-else
        class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1"
        data-test="assistant-context-sees-page"
      >
        <template v-for="line in rows" :key="line.id">
          <dt
            class="text-text-secondary flex min-h-6 items-center text-xs"
            data-test="assistant-context-sees-row"
            :data-field="line.id"
          >
            {{ line.label }}
          </dt>
          <dd class="flex min-h-6 min-w-0 flex-col justify-center">
            <OTruncatedText class="text-text-body max-w-full text-sm">{{
              line.value
            }}</OTruncatedText>
            <OTruncatedText
              v-if="line.secondary"
              class="text-text-secondary max-w-full text-xs leading-tight"
              :data-test="line.secondaryTest"
              >{{ line.secondary }}</OTruncatedText
            >
          </dd>
        </template>
      </dl>
      <slot name="detail" />
    </section>
  </OPopover>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface AssistantContextInfoRow {
  id: string;
  label: I18nText | string;
  value: I18nText | string;
  secondary?: I18nText | string;
  secondaryTest?: string;
}

export interface AssistantContextInfoProps {
  rows: readonly AssistantContextInfoRow[];
}

const PANEL_GAP_PX = 8;
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { usePopoverZIndex } from "@/components/ai-assistant/common/anchoredPopover";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useComposerLayout } from "@/components/ai-assistant/composer/composerUi";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

defineProps<AssistantContextInfoProps>();

defineSlots<{ detail?: () => unknown }>();

const { t } = useI18nTyped();
const layout = useComposerLayout();
const zIndex = usePopoverZIndex();
const headingId = `assistant-context-info-${useId()}`;
const heading = ref<InstanceType<typeof OText> | null>(null);
const open = ref(false);
const inset = ref<{ left: number; right: number } | undefined>(undefined);

const title = computed(() => t("assistant.context.defaultContext"));
// The panel inset can leave less room than the width cap; the popper's available width keeps it inside (T-03-02).
const widthClass = computed(() =>
  layout.value.tight
    ? "w-max max-w-[min(calc(20rem-0.375rem),var(--reka-popper-available-width,100vw))]"
    : "w-max max-w-[min(22rem,calc(100vw-1.5rem),var(--reka-popper-available-width,100vw))]",
);

function measureInset(): void {
  const content = (heading.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>(
    "[data-o-popover-content]",
  );
  const id = content?.id;
  const trigger = id
    ? [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find(
        (el) => el.getAttribute("aria-controls") === id,
      )
    : null;
  const box = trigger?.closest<HTMLElement>("[data-assistant-surface]")?.getBoundingClientRect();
  inset.value = box
    ? {
        left: Math.max(0, box.left + PANEL_GAP_PX),
        right: Math.max(0, window.innerWidth - box.right + PANEL_GAP_PX),
      }
    : undefined;
}

// Focus lands on the heading, after the popover's own first-control focus (CT-04 AC 6).
watch(open, async (shown) => {
  if (!shown) return;
  trackAssistant("ai_context_inspected", { target: "sees" });
  await nextTick();
  measureInset();
  (heading.value?.$el as HTMLElement | undefined)?.focus();
});
</script>
