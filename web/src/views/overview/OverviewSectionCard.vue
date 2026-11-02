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
  <OCard variant="outlined" :data-test="`overview-${section}-card`">
    <OCardSection role="header" dense>
      <div class="flex min-h-8 w-full items-center justify-between gap-2">
        <h2 class="text-text-heading text-sm font-medium">{{ title }}</h2>
        <OButton
          v-if="linkLabel && (view === 'ok' || view === 'empty')"
          variant="ghost-primary"
          size="sm"
          :aria-label="linkAriaLabel"
          :data-test="`overview-${section}-view-all`"
          @click="emit('viewAll')"
        >
          {{ linkLabel }}
        </OButton>
      </div>
    </OCardSection>
    <OCardSection role="body" dense class="flex flex-col">
      <!-- a card stretched beside a taller one centres its one-line empty message instead of leaving a gap under it -->
      <div v-if="view === 'empty'" class="flex flex-1 flex-col justify-center">
        <slot name="empty" />
      </div>
      <slot v-else-if="view === 'ok'" />
      <OverviewSectionState
        v-else
        :section="section"
        :view="view"
        :locked-message="lockedMessage"
        :can-unlock="canUnlock"
        @retry="emit('retry')"
        @unlock="emit('unlock')"
      />
      <!-- a footer reads a different source than the body, so it renders whatever state the body is in -->
      <slot name="footer" />
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import type { I18nText } from "@/types/i18n";
import OverviewSectionState from "./OverviewSectionState.vue";
import type { OverviewView } from "./overviewFormat";

withDefaults(
  defineProps<{
    section: string;
    title: I18nText;
    view: OverviewView;
    linkLabel?: I18nText;
    linkAriaLabel?: I18nText;
    lockedMessage?: I18nText;
    // clicking the locked row only does something when the parent handles unlock
    canUnlock?: boolean;
  }>(),
  { canUnlock: true },
);

const emit = defineEmits<{ retry: []; viewAll: []; unlock: [] }>();
</script>
