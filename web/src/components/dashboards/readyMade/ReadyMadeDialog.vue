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
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OGlyph from "@/lib/forms/EmojiPicker/OGlyph.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { ReadyMadeSourceId } from "@/composables/readyMade/catalog";
import type { ReadyMadeDialogMode, ReadyMadeDialogRow } from "./readyMade.types";

const props = withDefaults(
  defineProps<{
    open: boolean;
    mode: ReadyMadeDialogMode;
    rows: ReadyMadeDialogRow[];
    busy?: boolean;
    /** Rows are still resolving (detection, marked copies, folders). */
    loading?: boolean;
  }>(),
  { busy: false, loading: false },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  /** Ticked sources to add, and the offered ones left unticked. */
  (e: "confirm", selected: ReadyMadeSourceId[], unselected: ReadyMadeSourceId[]): void;
  (e: "open-source", id: ReadyMadeSourceId): void;
  (e: "set-up", id: ReadyMadeSourceId): void;
}>();

const { t } = useI18nTyped();

// Only the user's overrides: rows can still change after opening (Import loads copies late), and their defaults must follow.
const overrides = ref(new Map<ReadyMadeSourceId, boolean>());

watch(
  () => props.open,
  (open) => {
    if (open) overrides.value = new Map();
  },
  { immediate: true },
);

const selectable = (row: ReadyMadeDialogRow) => !row.installedIn;
const isSelected = (row: ReadyMadeDialogRow) =>
  selectable(row) && (overrides.value.get(row.id) ?? row.defaultSelected);

const toggle = (row: ReadyMadeDialogRow, value: unknown) => {
  const next = new Map(overrides.value);
  next.set(row.id, value === true);
  overrides.value = next;
};

const selectedCount = computed(() => props.rows.filter(isSelected).length);

const title = computed(() =>
  props.mode === "choose"
    ? t("dashboard.readyMade.chooseTitle")
    : t("dashboard.readyMade.importTitle"),
);
const intro = computed(() =>
  props.mode === "choose"
    ? t("dashboard.readyMade.chooseIntro")
    : t("dashboard.readyMade.importIntro"),
);

const confirm = () => {
  if (props.loading || selectedCount.value === 0) return;
  const selected = props.rows.filter(isSelected).map((row) => row.id);
  const unselected = props.rows
    .filter((row) => selectable(row) && !isSelected(row))
    .map((row) => row.id);
  emit("confirm", selected, unselected);
};
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="title"
    :persistent="busy"
    :show-close="!busy"
    :primary-button-label="t('dashboard.readyMade.addSelected', { count: selectedCount })"
    :primary-button-disabled="loading || selectedCount === 0"
    :primary-button-loading="busy"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    data-test="dashboards-ready-made-dialog"
    @update:open="(value) => emit('update:open', value)"
    @click:primary="confirm"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary text-sm" data-test="dashboards-ready-made-dialog-intro">
        {{ intro }}
      </p>
      <div
        v-if="loading"
        class="flex justify-center py-6"
        data-test="dashboards-ready-made-dialog-loading"
      >
        <OSpinner size="sm" />
      </div>
      <ul
        v-else
        class="border-border-default divide-border-default rounded-default flex flex-col divide-y border"
      >
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex items-start gap-3 px-3 py-2.5"
          :data-test="`dashboards-ready-made-dialog-row-${row.id}`"
        >
          <!-- Chromium re-clicks a ticked OCheckbox when its svg tick is clicked (label activation), so the cell takes the pointer. -->
          <span
            v-if="selectable(row)"
            class="flex h-5 shrink-0 cursor-pointer items-center"
            :data-test="`dashboards-ready-made-dialog-check-cell-${row.id}`"
            @click="!busy && toggle(row, !isSelected(row))"
          >
            <OCheckbox
              class="pointer-events-none"
              :model-value="isSelected(row)"
              :aria-label="row.name"
              :disabled="busy"
              :data-test="`dashboards-ready-made-dialog-check-${row.id}`"
              @update:model-value="(value) => toggle(row, value)"
            />
          </span>
          <span v-else class="flex h-5 shrink-0 items-center">
            <OIcon name="check-circle" size="sm" class="text-status-positive" />
          </span>
          <span class="flex h-5 shrink-0 items-center">
            <OGlyph :token="row.glyph" size="md" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-text-heading text-sm font-medium">{{ row.name }}</span>
              <OTag
                v-if="!row.installedIn"
                :variant="row.detected ? 'primary-soft' : 'default-soft'"
                size="xs"
                :data-test="`dashboards-ready-made-dialog-data-${row.id}`"
                >{{
                  row.detected
                    ? t("dashboard.readyMade.dataFound")
                    : t("dashboard.readyMade.noData")
                }}</OTag
              >
              <OTag
                v-if="row.installedIn"
                variant="success-soft"
                size="xs"
                :data-test="`dashboards-ready-made-dialog-added-${row.id}`"
                >{{ t("dashboard.readyMade.addedIn", { folder: row.installedIn }) }}</OTag
              >
            </div>
            <span class="text-text-secondary text-xs">{{ row.contents }}</span>
            <span
              v-if="!row.installedIn"
              class="text-text-body text-xs"
              :data-test="`dashboards-ready-made-dialog-destination-${row.id}`"
              >{{ row.destination }}</span
            >
          </div>
          <OButton
            v-if="row.installedIn"
            variant="outline"
            size="xs"
            :data-test="`dashboards-ready-made-dialog-open-${row.id}`"
            @click="emit('open-source', row.id)"
          >
            {{ t("dashboard.readyMade.open") }}
          </OButton>
          <OButton
            v-else-if="mode === 'import' && !row.detected"
            variant="ghost-primary"
            size="xs"
            :data-test="`dashboards-ready-made-dialog-set-up-${row.id}`"
            @click="emit('set-up', row.id)"
          >
            {{ t("dashboard.readyMade.setUp") }}
          </OButton>
        </li>
      </ul>
    </div>
  </ODialog>
</template>
