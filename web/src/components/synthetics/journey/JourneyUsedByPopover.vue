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
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { SyntheticsFolder } from "@/types/synthetics";
import { syntheticsEditRoute } from "@/utils/synthetics/routes";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";

const VISIBLE_ROWS = 5;

const props = defineProps<{
  references: { id: string; name: string; folder_id: string }[];
  /** References the user cannot open; counted, never listed. */
  hidden: number;
  folders: SyntheticsFolder[];
  orgIdentifier: string;
}>();

const { t } = useI18nTyped();

const expanded = ref(false);
const count = computed(() => props.references.length + props.hidden);
const shown = computed(() =>
  expanded.value ? props.references : props.references.slice(0, VISIBLE_ROWS),
);

function folderName(folderId: string): string {
  return props.folders.find((f) => f.folderId === folderId)?.name ?? folderId;
}

function editRoute(reference: { id: string; folder_id: string }) {
  return syntheticsEditRoute(
    { orgIdentifier: props.orgIdentifier, folderId: reference.folder_id },
    reference.id,
  );
}
</script>

<template>
  <OPopover
    align="end"
    :aria-label="t('synthetics.journey.usedBy.aria')"
    content-class="w-[min(21rem,calc(100vw-1.5rem))] p-3"
  >
    <template #trigger>
      <OButton
        variant="outline"
        size="sm"
        icon-left="account-tree"
        aria-haspopup="dialog"
        class="max-md:hidden"
        data-test="synthetics-journey-used-by-trigger"
      >
        {{ t("synthetics.save.usedByCount", { count }, count) }}
        <OIcon name="arrow-drop-down" size="sm" aria-hidden="true" />
      </OButton>
    </template>
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <span class="text-text-heading text-sm font-semibold">
          {{ t("synthetics.save.usedByCount", { count }, count) }}
        </span>
        <span class="text-text-secondary text-xs">{{ t("synthetics.journey.usedBy.help") }}</span>
      </div>
      <ul class="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto p-0">
        <li v-for="reference in shown" :key="reference.id">
          <router-link
            :to="editRoute(reference)"
            class="rounded-default hover:bg-surface-subtle flex min-w-0 flex-col px-2 py-1"
            :data-test="`synthetics-journey-used-by-row-${reference.id}`"
          >
            <span class="text-text-body truncate text-sm">{{ reference.name }}</span>
            <span class="text-text-secondary truncate text-xs">{{
              folderName(reference.folder_id)
            }}</span>
          </router-link>
        </li>
      </ul>
      <OButton
        v-if="!expanded && references.length > VISIBLE_ROWS"
        variant="ghost"
        size="sm"
        data-test="synthetics-journey-used-by-view-all"
        @click="expanded = true"
      >
        {{ t("synthetics.journey.usedBy.viewAll", { count: references.length }) }}
      </OButton>
      <p v-if="hidden > 0" class="text-text-secondary m-0 text-xs">
        {{ t("synthetics.delete.hiddenReferences", { count: hidden }) }}
      </p>
    </div>
  </OPopover>
</template>
