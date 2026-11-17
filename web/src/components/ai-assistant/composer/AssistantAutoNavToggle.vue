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
  <span
    :class="[
      'bg-badge-default-soft-bg ring-badge-default-ol-border/30 rounded-default flex h-7 shrink-0 items-center px-2 ring-1 ring-inset',
      SWITCH_HIT_AREA_CLASS,
    ]"
  >
    <OSwitch v-model="enabled" size="sm" data-test="assistant-composer-auto-navigation">
      <template #label>
        <OIcon :name="assistantGlyph.autoNavigation" size="sm" />
        <span class="sr-only">{{ t("assistant.composer.autoNavigation.label") }}</span>
      </template>
    </OSwitch>
  </span>
  <OTooltip
    :content="
      t(
        enabled
          ? 'assistant.composer.autoNavigation.enabledTooltip'
          : 'assistant.composer.autoNavigation.disabledTooltip',
        { product: t('assistant.name') },
      )
    "
  />
</template>

<script setup lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

import { SWITCH_HIT_AREA_CLASS } from "./composerUi";

const enabled = defineModel<boolean>({ required: true });
const { t } = useI18nTyped();
</script>
