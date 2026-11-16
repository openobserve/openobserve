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
import { computed, nextTick, ref, useId, watch } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { menuItemClasses } from "@/lib/overlay/shared/menuItem";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useJumpToDestinations } from "./useJumpToDestinations";
import { useJumpToObjects } from "./useJumpToObjects";
import {
  areaForPath,
  rankDestinations,
  readAreaVisits,
  recordAreaVisit,
  type JumpDestination,
} from "./jumpToDestinations";

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const router = useRouter();
const route = useRoute();
const destinations = useJumpToDestinations();

const query = ref("");
// Null follows the first row; a row the user picked stays picked while results arrive.
const chosenKey = ref<string | null>(null);
const visits = ref(readAreaVisits());
const listRef = ref<HTMLElement | null>(null);
const baseId = useId();
const { groups: objectGroups, searchable } = useJumpToObjects(query, open, destinations);

const groups = computed(() => [
  ...rankDestinations(destinations.value, query.value, visits.value, t("menu.jumpToPages")),
  ...objectGroups.value,
]);
const results = computed(() => groups.value.flatMap((group) => group.items));
const activeKey = computed(() =>
  results.value.some((item) => item.key === chosenKey.value)
    ? chosenKey.value
    : results.value[0]?.key,
);

const listId = `${baseId}-list`;
const optionId = (key: string) => `${baseId}-${key.replace(/[^\w-]/g, "_")}`;
const activeOptionId = computed(() => (activeKey.value ? optionId(activeKey.value) : undefined));
const rowClasses = menuItemClasses("default", false, false);

watch(query, () => (chosenKey.value = null));
watch(open, (isOpen) => {
  if (!isOpen) return;
  query.value = "";
  chosenKey.value = null;
});

const resolvePath = (to: RouteLocationRaw): string | null => {
  try {
    return router.resolve(to).path;
  } catch {
    return null;
  }
};

// Every arrival counts toward its area, so an empty query lists the areas this browser uses most.
watch(
  () => route.path,
  (path) => {
    const area = areaForPath(destinations.value, path, resolvePath);
    if (area) visits.value = recordAreaVisit(visits.value, area);
  },
);

function go(item: JumpDestination) {
  open.value = false;
  Promise.resolve(router.push(item.to)).catch(() => {});
}

function revealActive() {
  listRef.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

// Captured before the field sees it, so Escape closes even with text in the field.
function onKeydown(event: KeyboardEvent) {
  const count = results.value.length;
  const index = results.value.findIndex((item) => item.key === activeKey.value);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!count) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    chosenKey.value = results.value[(index + step + count) % count].key;
    nextTick(revealActive);
  } else if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    const target = results.value[index];
    if (target) go(target);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
  }
}
</script>

<template>
  <ODialog
    v-model:open="open"
    size="md"
    :show-close="false"
    :aria-title="t('menu.jumpToTitle')"
    data-test="jump-to-palette"
  >
    <div class="flex flex-col gap-2" @keydown.capture="onKeydown">
      <OSearchInput
        v-model="query"
        width="full"
        :shortcut="false"
        :placeholder="searchable ? t('menu.jumpToPlaceholder') : t('menu.jumpToPlaceholderPages')"
        :aria-controls="listId"
        :aria-activedescendant="activeOptionId"
        aria-autocomplete="list"
        data-test="jump-to-palette-search"
      />
      <!-- A fixed height, so filtering never resizes the dialog (O4). -->
      <div
        :id="listId"
        ref="listRef"
        role="listbox"
        :aria-label="t('menu.jumpToTitle')"
        class="-mx-1 h-90 overflow-y-auto"
        data-test="jump-to-palette-list"
      >
        <div
          v-for="(group, groupIndex) in groups"
          :key="group.areaKey"
          role="group"
          :aria-labelledby="group.area ? `${baseId}-area-${group.areaKey}` : undefined"
          :class="!group.area && groupIndex > 0 && 'border-dropdown-separator mt-1 border-t pt-1'"
          :data-test="`jump-to-palette-group-${group.areaKey}`"
        >
          <div
            v-if="group.area"
            :id="`${baseId}-area-${group.areaKey}`"
            role="presentation"
            class="text-text-muted text-2xs px-3 pt-2 pb-0.5 font-medium select-none"
          >
            {{ group.area }}
          </div>
          <div
            v-for="item in group.items"
            :id="optionId(item.key)"
            :key="item.key"
            role="option"
            :aria-selected="item.key === activeKey"
            :data-highlighted="item.key === activeKey ? '' : undefined"
            :class="rowClasses"
            :data-test="`jump-to-palette-item-${item.key}`"
            @mousemove="chosenKey = item.key"
            @click="go(item)"
          >
            <OIcon :name="item.icon as IconName" size="sm" class="text-text-secondary shrink-0" />
            <OTruncatedText class="min-w-0 flex-1">{{ item.label }}</OTruncatedText>
            <OTruncatedText
              v-if="item.hint"
              class="text-text-secondary max-w-40 shrink-0 text-xs"
              :data-test="`jump-to-palette-hint-${item.key}`"
              >{{ item.hint }}</OTruncatedText
            >
          </div>
        </div>
        <div v-if="!results.length" class="px-3">
          <OEmptyState
            kind="filtered"
            size="compact"
            :title="t('emptyState.filtered.noMatches')"
            data-test="jump-to-palette-empty"
          />
        </div>
      </div>
    </div>
  </ODialog>
</template>
