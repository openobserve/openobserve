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

<!--
  Header bar for the docked results panel (T4). Title + collapse chevron. Purely
  presentational — emits intents; the dock owns the state.
-->
<template>
  <div
    class="border-border-default bg-surface-base flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5"
  >
    <span class="text-text-body truncate text-sm font-semibold">
      {{ t("workflow.results.title") }}
    </span>
    <div class="flex shrink-0 items-center gap-1">
      <!-- Collapse to just this header strip, or expand back to the full panel. -->
      <OButton
        variant="ghost"
        size="icon"
        data-test="workflows-results-collapse"
        @click="emit('toggle-collapse')"
      >
        <OIcon :name="collapsed ? 'expand-less' : 'expand-more'" size="sm" />
        <OTooltip
          :content="collapsed ? t('workflow.results.expand') : t('workflow.results.collapse')"
          side="top"
        />
      </OButton>
      <!-- Clear the test result and dismiss the dock (also clears canvas badges). -->
      <OButton
        variant="ghost"
        size="icon"
        data-test="workflows-results-close"
        @click="emit('close')"
      >
        <OIcon name="close" size="sm" />
        <OTooltip :content="t('workflow.results.close')" side="top" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: "toggle-collapse"): void; (e: "close"): void }>();
const { t } = useI18nTyped();
</script>
