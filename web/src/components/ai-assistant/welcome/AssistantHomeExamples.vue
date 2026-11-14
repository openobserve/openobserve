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

<!-- Main's welcome, one line per card with the description as the tooltip, so the Ask box stays the focus. -->
<template>
  <div class="@container flex w-full min-w-0 flex-col gap-4" data-test="assistant-home-examples">
    <div class="grid grid-cols-1 gap-2 @sm:grid-cols-2 @2xl:grid-cols-4">
      <button
        v-for="card in CAPABILITY_CARDS"
        :key="card.id"
        type="button"
        class="rounded-default border-border-default bg-card-bg hover:border-ai-accent/50 hover:shadow-ai-accent/30 focus-visible:ring-ai-accent/40 flex min-w-0 cursor-pointer items-center gap-2 border px-2.5 py-2 text-left transition-[border-color,box-shadow,translate] duration-150 hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
        :data-test="`assistant-home-capability-${card.id}`"
        @click="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      >
        <span
          class="rounded-default inline-flex size-7 shrink-0 items-center justify-center"
          :class="card.iconBgClass"
        >
          <OIcon :name="card.icon" size="sm" :class="card.iconColorClass" />
        </span>
        <span class="text-text-heading min-w-0 text-sm leading-tight font-medium">
          {{ t(`aiAssistant.capabilities.${card.id}.title`) }}
        </span>
        <OTooltip :content="t(`aiAssistant.capabilities.${card.id}.description`)" />
      </button>
    </div>
    <PromptSuggestions @select="emit('select', $event)" />
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

import PromptSuggestions from "./PromptSuggestions.vue";
import { CAPABILITY_CARDS } from "./welcomeContent";

const { t } = useI18nTyped();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();
</script>
