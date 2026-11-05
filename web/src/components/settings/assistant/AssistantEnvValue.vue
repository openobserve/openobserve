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
    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    :data-test="`settings-assistant-env-${envName}`"
  >
    <span class="text-text-secondary min-w-40 max-md:min-w-0">{{ label }}</span>
    <span class="text-text-body flex flex-wrap items-center gap-x-2">
      <span :data-test="`settings-assistant-env-${envName}-value`">{{ value ?? EMPTY }}</span>
      <span v-if="value === null" class="text-text-secondary text-xs">
        {{ t("assistant.settings.env.notReported") }}
      </span>
    </span>
    <OPopover side="bottom" align="start" content-class="flex max-w-80 flex-col gap-2 p-3">
      <template #trigger>
        <AssistantIconButton
          :label="t('assistant.settings.env.setBy', { env: raw(envName) })"
          :icon="assistantGlyph.info"
          no-tooltip
          :data-test="`settings-assistant-env-${envName}-info`"
        />
      </template>
      <p class="text-text-body text-sm">{{ help ?? t("assistant.settings.env.help") }}</p>
      <OCode>{{ envName }}</OCode>
    </OPopover>
  </div>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface AssistantEnvValueProps {
  label: I18nText;
  /** `null` when this server version does not report the value. */
  value: I18nText | null;
  envName: string;
  help?: I18nText;
}
</script>

<script setup lang="ts">
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OCode from "@/lib/core/Code/OCode.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<AssistantEnvValueProps>(), { help: undefined });

const { t } = useI18nTyped();

const EMPTY = raw("—");
</script>
