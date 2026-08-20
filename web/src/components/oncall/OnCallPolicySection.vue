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
  One "everything else" card in the policy editor: delivery, and the triage gate.

  Both are settings somebody changes once and then reads at a glance, so both
  are folded away behind a one-line summary of what they currently say. Two
  things deliberately stay OUTSIDE the fold — the status badge and the
  `problems` slot — because a card that hides its own breakage reads as fine.
-->
<template>
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col border"
    :data-test="props.dataTest"
  >
    <OCollapsible v-model="open" trigger-class="px-4 py-3">
      <template #trigger="{ open: isOpen }">
        <span
          class="border-border-default rounded-default flex h-8 w-8 shrink-0 items-center justify-center border"
        >
          <OIcon :name="props.icon" size="sm" class="text-text-secondary" />
        </span>

        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex flex-wrap items-center gap-2">
            <OText variant="panel-title">{{ props.title }}</OText>
            <OTag v-if="props.advanced" variant="default-soft" size="xs">
              {{ t("oncall.policySectionAdvanced") }}
            </OTag>
          </span>
          <!-- Open, the caption says what the card is FOR; closed, it says what
               the card currently holds — the only two questions either state
               can answer without being unfolded. -->
          <OText variant="meta">{{ isOpen ? props.description : props.summary }}</OText>
        </span>

        <slot name="badge" />

        <OIcon
          name="expand-more"
          size="md"
          class="text-text-secondary shrink-0 transition-transform duration-200"
          :class="isOpen ? 'rotate-180' : 'rotate-0'"
        />
      </template>

      <div class="flex flex-col gap-3 px-4 pt-1 pb-4">
        <slot />
      </div>
    </OCollapsible>

    <!-- Outside the fold on purpose: a problem nobody can see until they
         expand the card is a problem the card is hiding. -->
    <slot name="problems" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    icon: string;
    title: I18nText;
    /** Shown while the card is open — what the card is for. */
    description: I18nText;
    /** Shown while the card is closed — what the card currently says. */
    summary: I18nText;
    /** Marks a card most teams never need to open. */
    advanced?: boolean;
    defaultOpen?: boolean;
    dataTest?: string;
  }>(),
  { advanced: false, defaultOpen: false },
);

const { t } = useI18nTyped();

const open = ref(props.defaultOpen);

/// The parent opens this card when it sends somebody here to fix something —
/// a "Fix" button that only scrolls to a fold is a button that does nothing.
defineExpose({ expand: () => (open.value = true) });
</script>
