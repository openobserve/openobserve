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
  <div
    v-if="collapsed"
    class="border-border-default flex h-full w-12 shrink-0 flex-col items-center gap-2 border-e py-3"
    data-test="fleet-component-palette-collapsed"
  >
    <OButton
      variant="ghost"
      size="icon-sm"
      icon-left="keyboard-double-arrow-right"
      data-test="fleet-component-palette-expand"
      @click="collapsed = false"
    >
      <OTooltip side="right" :content="t('fleet.editor.components')" />
    </OButton>
  </div>
  <aside
    v-else
    class="border-border-default max-md:bg-surface-base flex h-full w-64 shrink-0 flex-col border-e max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full max-md:border-e-0"
    data-test="fleet-component-palette"
  >
    <div class="flex shrink-0 items-center gap-2 px-3 pt-3">
      <OText variant="panel-title" class="flex-1">{{ t("fleet.editor.components") }}</OText>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="keyboard-double-arrow-left"
        data-test="fleet-component-palette-collapse"
        @click="collapsed = true"
      >
        <OTooltip :content="t('fleet.editor.collapse')" />
      </OButton>
    </div>
    <div class="shrink-0 px-3 py-2">
      <OSearchInput
        v-model="search"
        size="sm"
        clearable
        :placeholder="t('fleet.editor.searchComponents')"
        data-test="fleet-component-palette-search"
      />
    </div>
    <OText variant="meta" class="shrink-0 px-3 pb-2">{{ t("fleet.editor.paletteHint") }}</OText>
    <div class="min-h-0 flex-1 overflow-y-auto pb-3">
      <OCollapsible
        v-for="section in sections"
        :key="section.kind"
        variant="sidebar"
        default-open
        :data-test="`fleet-component-palette-section-${section.kind}`"
      >
        <template #trigger>
          <span class="text-text-heading flex-1 text-sm font-medium">{{ section.label }}</span>
          <span class="text-text-secondary text-xs tabular-nums">{{ section.items.length }}</span>
        </template>
        <div class="flex flex-col gap-1 px-2 pb-2">
          <OButton
            v-for="item in section.items"
            :key="item.kind + item.key"
            variant="ghost"
            size="sm"
            block
            draggable="true"
            class="justify-start! gap-2.5"
            :data-test="`fleet-component-palette-item-${item.kind}-${item.key}`"
            @dragstart="onDragStart($event, item)"
            @click="emit('add', item)"
          >
            <span
              class="rounded-default grid h-6 w-6 shrink-0 place-items-center"
              :class="CHIP[item.kind]"
            >
              <OIcon :name="item.icon" size="xs" />
            </span>
            <span class="truncate">{{ raw(item.name) }}</span>
          </OButton>
        </div>
      </OCollapsible>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { CATALOG, PALETTE_MIME, type CatalogItem, type EditorKind } from "./editorGraph";

const emit = defineEmits<{ add: [item: CatalogItem] }>();
const collapsed = defineModel<boolean>("collapsed", { default: false });

const { t } = useI18nTyped();

const search = ref("");

const CHIP: Record<EditorKind, string> = {
  receiver: "bg-icon-chip-info-bg text-icon-chip-info-text",
  processor: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  exporter: "bg-icon-chip-success-bg text-icon-chip-success-text",
  extension: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
};

const sections = computed(() => {
  const q = search.value.trim().toLowerCase();
  const match = (i: CatalogItem) => !q || i.name.toLowerCase().includes(q) || i.type.includes(q);
  const of = (kind: EditorKind) => CATALOG.filter((i) => i.kind === kind && match(i));
  return [
    { kind: "receiver", label: t("fleet.editor.receivers"), items: of("receiver") },
    { kind: "processor", label: t("fleet.editor.processors"), items: of("processor") },
    { kind: "exporter", label: t("fleet.editor.exporters"), items: of("exporter") },
    { kind: "extension", label: t("fleet.editor.extensions"), items: of("extension") },
  ].filter((s) => s.items.length);
});

function onDragStart(event: DragEvent, item: CatalogItem) {
  event.dataTransfer?.setData(PALETTE_MIME, `${item.kind}|${item.key}`);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}
</script>
