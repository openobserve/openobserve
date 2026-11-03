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
  <section
    class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col border"
    :data-test="`overview-${section}-card`"
  >
    <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 p-3">
      <slot name="lead" />
      <OText variant="card-title" class="min-w-0">{{ title }}</OText>
      <OText
        v-if="subtitle"
        variant="meta"
        class="text-text-secondary min-w-0"
        :data-test="`overview-${section}-subtitle`"
        >{{ subtitle }}</OText
      >
      <OButton
        v-if="linkLabel && (view === 'ok' || view === 'empty')"
        variant="ghost-primary"
        size="sm"
        class="ms-auto shrink-0"
        :aria-label="linkAriaLabel"
        :data-test="`overview-${section}-view-all`"
        @click="emit('viewAll')"
        >{{ linkLabel }}</OButton
      >
    </div>
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- a card stretched beside a taller one centres its one-line empty message instead of leaving a gap under it -->
      <div v-if="view === 'empty'" class="flex flex-1 flex-col justify-center px-3 pb-3">
        <slot name="empty" />
      </div>
      <slot v-else-if="view === 'ok'" />
      <div v-else class="px-3 pb-3">
        <OverviewSectionState
          :section="section"
          :view="view"
          :locked-message="lockedMessage"
          :can-unlock="canUnlock"
          @retry="emit('retry')"
          @unlock="emit('unlock')"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { I18nText } from "@/types/i18n";
import OverviewSectionState from "./OverviewSectionState.vue";
import type { OverviewView } from "./overviewFormat";

withDefaults(
  defineProps<{
    section: string;
    title: I18nText;
    subtitle?: I18nText;
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
