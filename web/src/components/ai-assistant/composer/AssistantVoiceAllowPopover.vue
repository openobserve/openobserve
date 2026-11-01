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
    side="top"
    align="start"
    :aria-label="t('assistant.voice.allow.title')"
    content-class="flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-2 p-3"
  >
    <template #trigger>
      <OButton
        variant="ghost-primary"
        size="xs"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-dictate-how"
      >
        {{ t("assistant.voice.error.how") }}
      </OButton>
    </template>
    <section class="flex flex-col gap-2" data-test="assistant-dictate-how-popover">
      <OText variant="card-title" as="h2">{{ t("assistant.voice.allow.title") }}</OText>
      <OText variant="meta" as="p">{{ steps }}</OText>
      <OText variant="meta" as="p">{{ t("assistant.voice.allow.headphones") }}</OText>
    </section>
  </OPopover>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface AssistantVoiceAllowPopoverProps {
  /** This browser's site-settings steps (B17). */
  steps: I18nText;
}
</script>

<script setup lang="ts">
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<AssistantVoiceAllowPopoverProps>();

const { t } = useI18nTyped();
</script>
