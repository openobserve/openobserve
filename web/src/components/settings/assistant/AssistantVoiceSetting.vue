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
  <section class="flex flex-col gap-1" data-test="settings-assistant-voice">
    <OText variant="label" as="h3">{{ t("assistant.settings.voice.title") }}</OText>
    <OText variant="meta" as="p">{{ t("assistant.settings.voice.help") }}</OText>
    <OToggleGroup
      :model-value="mode"
      :disabled="readOnly"
      :aria-label="t('assistant.settings.voice.title')"
      :aria-describedby="lineId"
      data-test="settings-assistant-voice-group"
      @update:model-value="choose"
    >
      <OToggleGroupItem
        v-for="option in OPTIONS"
        :key="option.value"
        :value="option.value"
        size="sm"
        :class="TOUCH_TARGET_CLASS"
        :data-test="`settings-assistant-voice-${option.value}`"
        >{{ t(option.labelKey) }}</OToggleGroupItem
      >
    </OToggleGroup>
    <OText :id="lineId" variant="meta" as="p">{{ line }}</OText>
    <OText variant="meta" as="p" data-test="settings-assistant-voice-note">
      {{
        t(
          page.isCloud.value
            ? "assistant.settings.voice.readOnly"
            : "assistant.settings.voice.localOnly",
        )
      }}
    </OText>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  setVoiceOptIn,
  useVoiceStatus,
  type VoiceMode,
} from "@/components/ai-assistant/composer/useAssistantVoice";
import { useAssistantStore } from "@/composables/assistant";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const OPTIONS: { value: VoiceMode; labelKey: I18nKey }[] = [
  { value: "off", labelKey: "assistant.settings.voice.off" },
  { value: "browser", labelKey: "assistant.settings.voice.browser" },
];

const { t } = useI18nTyped();
const page = useAssistantSettingsPage();
const store = useAssistantStore();
const { mode } = useVoiceStatus();
const lineId = useId();

// Cloud is fixed at the browser engine; on self-hosted the admin opts this browser in (PO A5, A30).
const readOnly = computed(() => page.isCloud.value || !page.isAdmin.value);
const line = computed(() =>
  t(
    mode.value === "off"
      ? "assistant.settings.voice.offHelp"
      : "assistant.settings.voice.browserHelp",
  ),
);

function choose(value: unknown): void {
  const key = store.state.userOrgKey;
  if (key && !readOnly.value && (value === "off" || value === "browser"))
    setVoiceOptIn(key, value === "browser");
}
</script>
