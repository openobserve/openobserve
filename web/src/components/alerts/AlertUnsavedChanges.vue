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
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { changeLabel, changeValueText, type AlertFieldChange } from "@/utils/alerts/alertFormDiff";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";

defineProps<{ changes: AlertFieldChange[]; disabled?: boolean }>();

const emit = defineEmits<{ (e: "discard"): void }>();

const { t } = useI18nTyped();
const open = ref(false);

const discard = () => {
  open.value = false;
  emit("discard");
};
</script>

<template>
  <div v-if="changes.length" class="flex items-center gap-2" data-test="add-alert-unsaved">
    <OPopover v-model:open="open" side="top" align="start">
      <template #trigger>
        <OButton
          variant="ghost-primary"
          size="sm-action"
          :icon-right="open ? 'expand-more' : 'expand-less'"
          data-test="add-alert-unsaved-count"
          >{{
            t("alerts.editMode.unsaved.count", { count: changes.length }, changes.length)
          }}</OButton
        >
      </template>
      <div class="flex max-w-96 min-w-72 flex-col gap-2 p-3" data-test="add-alert-unsaved-list">
        <span class="text-text-heading text-sm font-semibold">{{
          t("alerts.editMode.unsaved.listTitle")
        }}</span>
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          <li
            v-for="change in changes"
            :key="change.path"
            class="flex flex-wrap items-baseline gap-x-1.5 text-sm"
            :data-test="`add-alert-unsaved-change-${change.path}`"
          >
            <span class="text-text-heading font-medium">{{ changeLabel(change.path, t) }}</span>
            <span class="text-text-secondary line-through">{{
              changeValueText(change.before, t, change.path)
            }}</span>
            <span class="text-text-secondary" aria-hidden="true">→</span>
            <span class="text-text-body">{{ changeValueText(change.after, t, change.path) }}</span>
          </li>
        </ul>
      </div>
    </OPopover>
    <OButton
      variant="ghost"
      size="sm-action"
      :disabled="disabled"
      data-test="add-alert-discard-btn"
      @click="discard"
      >{{ t("alerts.editMode.unsaved.discard") }}</OButton
    >
  </div>
</template>
