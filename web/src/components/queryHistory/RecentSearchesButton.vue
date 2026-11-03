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
  <OPopover
    v-if="enabled"
    v-model:open="open"
    side="bottom"
    align="end"
    :aria-label="t('recentSearches.title')"
    @open-auto-focus="focusList"
    @pointer-down-outside="keepForDetails"
    @focus-outside="keepForDetails"
  >
    <template #trigger>
      <OButton
        variant="outline"
        size="icon-toolbar"
        icon-left="history"
        v-bind="$attrs"
        :aria-label="t('recentSearches.title')"
        :data-test="dataTest"
        @keydown="onTriggerKeydown"
      >
        <OTooltip :content="t('recentSearches.title')" />
      </OButton>
    </template>
    <RecentSearchesPopover
      ref="popoverRef"
      :source="source"
      :active="open"
      :examples="examples"
      @run="(entry, when) => close(() => emit('run', entry, when))"
      @load="(entry, when) => close(() => emit('load', entry, when))"
      @view-all="(status) => close(() => emit('view-all', status))"
      @example="(query) => close(() => emit('example', query))"
      @close="open = false"
    />
  </OPopover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useRecentSearches } from "@/composables/queryHistory/useRecentSearches";
import type { HistorySource, HistoryStatus, QueryHistoryEntry } from "@/services/query_history";
import type { RestoreTime } from "@/utils/queryHistory/recentSearches";
import RecentSearchesPopover from "./RecentSearchesPopover.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

// OPopover renders no element of its own, so a caller's class and attributes go on the trigger.
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    source: HistorySource;
    examples?: string[];
    dataTest?: string;
  }>(),
  { examples: () => [], dataTest: "recent-searches-btn" },
);

const emit = defineEmits<{
  run: [entry: QueryHistoryEntry, when: RestoreTime];
  load: [entry: QueryHistoryEntry, when: RestoreTime];
  "view-all": [status: HistoryStatus | null];
  example: [query: string];
}>();

const { t } = useI18nTyped();
const { enabled } = useRecentSearches();
const open = ref(false);
const popoverRef = ref<InstanceType<typeof RecentSearchesPopover> | null>(null);

// Focus can stay on the clock button after opening, and the list's keys must still reach the rows.
const onTriggerKeydown = (event: KeyboardEvent) => {
  if (open.value && popoverRef.value?.handleOutsideKey(event)) event.preventDefault();
};

// The details pane is teleported outside the popover's content, so reka counts a click in it as outside.
const keepForDetails = (event: Event) => {
  const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  const target = (original?.target ?? event.target) as Node | null;
  if (popoverRef.value?.ownsNode(target)) event.preventDefault();
};

// OPopover would focus the info button, where Enter opens nothing and the hovered row never runs.
const focusList = (event: Event) => {
  event.preventDefault();
  popoverRef.value?.focusRoot();
};

const close = (then: () => void) => {
  open.value = false;
  then();
};
</script>
