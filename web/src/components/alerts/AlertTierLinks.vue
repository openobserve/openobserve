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
import { computed } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AlertSectionId } from "./alertFormSections";
import {
  moreLinkLabel,
  type AlertAddRow,
  type AlertSectionTierView,
  type AlertSettingId,
} from "./alertSettingTiers";

const props = defineProps<{
  section: AlertSectionId;
  view: AlertSectionTierView;
}>();

const emit = defineEmits<{
  (e: "add", id: AlertSettingId): void;
  (e: "toggle"): void;
}>();

const { t } = useI18nTyped();

const ROW_LABELS: Record<AlertAddRow, I18nKey> = {
  fires: "alerts.tiers.rowFires",
  message: "alerts.tiers.rowMessage",
};

const rows = computed(() =>
  (Object.keys(ROW_LABELS) as AlertAddRow[])
    .map((row) => ({
      row,
      label: t(ROW_LABELS[row]),
      items: props.view.addLinks.filter((d) => d.row === row),
    }))
    .filter((r) => r.items.length > 0),
);

const moreLabel = computed(() =>
  moreLinkLabel(
    props.view.tucked.map((d) => t(d.nameKey)),
    t,
  ),
);
</script>

<template>
  <div
    v-if="rows.length || view.tucked.length"
    class="flex flex-col gap-1"
    :data-test="`add-alert-section-${section}-tiers`"
  >
    <div
      v-for="r in rows"
      :key="r.row"
      class="flex flex-wrap items-center gap-x-1 gap-y-1"
      :data-test="`add-alert-section-${section}-row-${r.row}`"
    >
      <span class="text-text-secondary w-28 shrink-0 text-sm max-md:w-full">{{ r.label }}</span>
      <OButton
        v-for="item in r.items"
        :key="item.id"
        variant="ghost-primary"
        size="sm"
        icon-left="add"
        :data-test="`add-alert-add-${item.id}`"
        @click="emit('add', item.id)"
      >
        {{ t(item.nameKey) }}
      </OButton>
    </div>
    <div v-if="view.tucked.length">
      <OButton
        variant="ghost-primary"
        size="sm"
        :icon-left="view.expanded ? 'expand-less' : 'add'"
        :aria-expanded="view.expanded"
        :data-test="`add-alert-section-${section}-more`"
        @click="emit('toggle')"
      >
        {{ view.expanded ? t("alerts.tiers.showFewer") : moreLabel }}
      </OButton>
    </div>
  </div>
</template>
