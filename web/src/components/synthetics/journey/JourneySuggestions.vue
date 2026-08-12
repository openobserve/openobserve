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

<script setup lang="ts">
/**
 * Everything the journey has to say about itself, collapsed into one toolbar slot.
 *
 * The advice this renders used to be two permanently-expanded cards between the
 * toolbar and the first step. They were dismissible, but dismissal lived in a
 * local ref, so an author closed the same two cards on every visit and still
 * started reading their steps two cards down the page.
 *
 * Three rules hold this together:
 *
 *  - **It never opens by itself.** The count is the ambient signal; the text is
 *    a click away. Anything that pops open unrequested is the thing being fixed.
 *  - **Nothing is dismissible.** The chip costs no vertical space, so hiding it
 *    would buy nothing — and a suggestion that can be waved away is one an
 *    author never has to actually decline (P5.2.4). A suggestion leaves when the
 *    condition behind it is resolved, and only then.
 *  - **It says out loud that it blocks nothing.** A warning colour asks whether
 *    the author is stuck; the footer answers before they have to wonder.
 *
 * It derives nothing — {@link deriveJourneySuggestions} decides what is true and
 * this decides how it looks.
 */
import { computed, ref, watch } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";
import type {
  JourneySuggestion,
  JourneySuggestionActionKind,
} from "@/utils/synthetics/journeySuggestions";

const props = defineProps<{ suggestions: JourneySuggestion[] }>();
const emit = defineEmits<{ action: [kind: JourneySuggestionActionKind] }>();

const { t } = useI18nTyped();

const open = ref(false);

const count = computed(() => props.suggestions.length);

/**
 * One string for the tooltip and the accessible name, so they cannot drift.
 * The chip renders an icon and a number, which reads as "1" to a screen reader
 * — the label is what makes it mean anything.
 */
const label = computed(() =>
  t("synthetics.journey.suggestionCount", { count: count.value }, count.value),
);

// Resolving the last suggestion unmounts the popover but not this component, so
// an open flag would survive and the panel would reappear on its own the next
// time a suggestion shows up. It opens when it is asked to and at no other time.
watch(count, (n) => {
  if (n === 0) open.value = false;
});

function run(kind: JourneySuggestionActionKind) {
  emit("action", kind);
  open.value = false;
}
</script>

<template>
  <OPopover
    v-if="count > 0"
    v-model:open="open"
    side="bottom"
    align="start"
    content-class="w-104 max-w-[calc(100vw-2rem)] p-3"
    :aria-label="label"
  >
    <template #trigger>
      <OBadge
        variant="warning"
        size="sm"
        clickable
        :aria-label="label"
        data-test="synthetics-journey-suggestions-chip"
      >
        <!-- Child-mode tooltip, deliberately the FIRST child: its anchor binds to
             the nearest PREVIOUS sibling, so anything placed before it would
             become the hover target instead of the chip as a whole. Suppressed
             while the panel is open, or hovering the chip you just clicked
             floats a bubble over the panel it opened. -->
        <OTooltip :content="label" :disabled="open" />
        <OIcon name="warning" size="xs" aria-hidden="true" />
        {{ count }}
      </OBadge>
    </template>

    <div class="flex flex-col gap-3" data-test="synthetics-journey-suggestions-panel">
      <template v-for="(suggestion, index) in suggestions" :key="suggestion.id">
        <!-- Between suggestions only. Stacked advice reads as one wall of text
             without a rule to say where one ends. -->
        <OSeparator v-if="index > 0" />
        <div
          class="flex flex-col gap-1"
          :data-test="`synthetics-journey-suggestion-${suggestion.id}`"
        >
          <div class="flex items-center gap-2">
            <OIcon
              name="warning"
              size="sm"
              class="text-status-warning-text shrink-0"
              aria-hidden="true"
            />
            <span class="text-text-heading text-sm font-semibold">{{
              t(suggestion.titleKey)
            }}</span>
          </div>
          <p class="text-text-secondary m-0 text-xs">
            {{ t(suggestion.descriptionKey, suggestion.descriptionParams ?? {}) }}
          </p>
          <div v-if="suggestion.action" class="pt-1">
            <OButton
              variant="primary"
              size="sm"
              :data-test="`synthetics-journey-suggestion-action-${suggestion.id}`"
              @click="suggestion.action && run(suggestion.action.kind)"
            >
              {{ t(suggestion.action.labelKey) }}
            </OButton>
          </div>
        </div>
      </template>

      <!-- The footer's rule was a `border-t`. It is the same hairline as the ones
           above it, so it uses the same component rather than a second mechanism. -->
      <OSeparator />
      <p
        class="text-text-secondary m-0 flex items-center gap-2 text-xs"
        data-test="synthetics-journey-suggestions-nonblocking"
      >
        <OIcon name="info" size="sm" class="shrink-0" aria-hidden="true" />
        {{ t("synthetics.journey.suggestionsNonBlocking") }}
      </p>
    </div>
  </OPopover>
</template>
