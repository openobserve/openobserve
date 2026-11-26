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
  <OButton
    variant="ghost"
    size="icon"
    class="-my-1 shrink-0"
    :aria-label="t('traces.redCaption.about')"
    :data-test="`traces-red-caption-info-${panel}`"
  >
    <template #icon-left>
      <OIcon name="info-outline" size="xs" class="text-status-warning-text" />
    </template>
    <OTooltip side="bottom" align="start" max-width="22.5rem">
      <template #content>
        <div class="flex flex-col gap-0.5" :data-test="`traces-red-caption-${panel}`">
          <span v-for="line in lines" :key="line">{{ line }}</span>
        </div>
      </template>
    </OTooltip>
  </OButton>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{
  panel: "rate" | "errors" | "duration";
  lines: string[];
}>();

const { t } = useI18nTyped();
</script>
