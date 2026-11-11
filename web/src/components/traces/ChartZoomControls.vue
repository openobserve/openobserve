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
    class="rounded-default border-border-default bg-surface-panel absolute right-3 bottom-3 z-10 flex flex-col overflow-hidden border"
    :data-test="`${dataTestPrefix}-zoom-controls`"
  >
    <OButton
      variant="ghost"
      size="icon-sm"
      icon-left="add"
      class="rounded-none"
      :data-test="`${dataTestPrefix}-zoom-in`"
      @click="emit('zoom-in')"
    >
      <OTooltip side="left" :content="t('traces.serviceGraph.zoomIn')" />
    </OButton>
    <OSeparator />
    <OButton
      variant="ghost"
      size="icon-sm"
      icon-left="remove"
      class="rounded-none"
      :data-test="`${dataTestPrefix}-zoom-out`"
      @click="emit('zoom-out')"
    >
      <OTooltip side="left" :content="t('traces.serviceGraph.zoomOut')" />
    </OButton>
    <OSeparator />
    <OButton
      variant="ghost"
      size="icon-sm"
      icon-left="fullscreen"
      class="rounded-none"
      :data-test="`${dataTestPrefix}-fit-screen`"
      @click="emit('fit')"
    >
      <OTooltip side="left" :content="t('traces.serviceGraph.fitToScreen')" />
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{ dataTestPrefix: string }>();

const emit = defineEmits<{
  "zoom-in": [];
  "zoom-out": [];
  fit: [];
}>();

const { t } = useI18nTyped();
</script>
