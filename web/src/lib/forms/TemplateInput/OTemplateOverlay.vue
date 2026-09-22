<script setup lang="ts" generic="T extends TemplateSuggestion">
// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import OTemplateSuggestList from "./OTemplateSuggestList.vue";
import { tokenFor } from "./useTemplateSuggest";
import type { TemplateSuggestion } from "./OTemplateInput.types";
import type { TemplateOverlayProps, TemplateOverlaySlots } from "./OTemplateOverlay.types";

// The peek and the list are siblings, so there is no single root for a stray attribute to land on.
defineOptions({ inheritAttrs: false });

const props = defineProps<TemplateOverlayProps<T>>();
defineSlots<TemplateOverlaySlots<T>>();
</script>

<template>
  <!-- The list owns the space below the field, so the peek sits above it and yields while the list is open. -->
  <div
    v-if="
      props.suggest.peekName.value !== null &&
      props.suggest.peekValue.value !== null &&
      !props.suggest.listOpen.value
    "
    :data-test="props.dataTest ? `${props.dataTest}-peek` : undefined"
    class="bg-select-content-bg border-select-content-border rounded-default absolute start-0 bottom-full z-10 mb-1 max-w-72 border px-2 py-1.5 shadow-md"
  >
    <span class="text-accent text-2xs font-mono font-semibold">{{
      tokenFor(props.suggest.peekName.value)
    }}</span>
    <span class="text-text-secondary block text-xs wrap-break-word">{{
      props.suggest.peekValue.value
    }}</span>
  </div>

  <OTemplateSuggestList
    :open="props.suggest.listOpen.value"
    :reference="props.suggest.element.value"
    :boundary="props.boundary"
    :matches="props.suggest.matches.value"
    :highlighted-index="props.suggest.highlightedIndex.value"
    :data-test="props.dataTest"
    @select="props.suggest.accept"
    @highlight="props.suggest.highlight"
    @close="props.suggest.close"
  >
    <template v-if="$slots.suggestion" #suggestion="slotProps">
      <slot name="suggestion" v-bind="slotProps" />
    </template>
  </OTemplateSuggestList>
</template>
