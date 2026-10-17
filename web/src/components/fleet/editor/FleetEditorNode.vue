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
    class="rounded-default bg-surface-base relative flex h-15 w-52 cursor-pointer items-stretch border shadow-xs transition-colors"
    :class="
      data.selected
        ? 'border-accent ring-accent/30 ring-2'
        : 'border-border-default hover:border-border-strong'
    "
    :data-test="`fleet-editor-node-${id}`"
  >
    <span class="rounded-s-default w-1 shrink-0" :class="KIND_STYLE[data.kind].bar" />
    <div class="flex min-w-0 flex-1 items-center gap-2.5 px-2.5">
      <span
        class="rounded-default grid h-8 w-8 shrink-0 place-items-center"
        :class="KIND_STYLE[data.kind].chip"
      >
        <OIcon :name="data.icon" size="sm" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="text-text-heading truncate text-sm font-semibold">{{ data.name }}</span>
        <span class="text-text-secondary truncate font-mono text-xs">{{ data.componentId }}</span>
        <span
          v-if="data.fromBase || data.sharedCount > 1"
          class="text-2xs flex min-w-0 items-center gap-1.5"
        >
          <span
            v-if="data.fromBase"
            class="text-text-secondary truncate"
            :data-test="`fleet-editor-node-${id}-from-base`"
          >
            {{ t("fleet.editor.fromBase") }}
          </span>
          <span
            v-if="data.sharedCount > 1"
            class="text-text-link inline-flex min-w-0 items-center gap-0.5 truncate"
            :data-test="`fleet-editor-node-${id}-shared`"
          >
            <OIcon name="swap-horiz" size="xs" />
            {{ t("fleet.editor.sharedPipelines", { count: data.sharedCount }) }}
          </span>
        </span>
      </div>
    </div>
    <Handle
      v-if="data.kind !== 'extension'"
      type="target"
      :position="Position.Left"
      :connectable="false"
      class="border-border-strong bg-surface-base h-2.5 w-2.5 rounded-full border"
    />
    <Handle
      v-if="data.kind !== 'extension'"
      type="source"
      :position="Position.Right"
      :connectable="false"
      class="border-border-strong bg-surface-base h-2.5 w-2.5 rounded-full border"
    />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { EditorKind } from "./editorGraph";

export interface EditorNodeData {
  kind: EditorKind;
  name: I18nText;
  componentId: I18nText;
  icon: IconName;
  sharedCount: number;
  selected: boolean;
  fromBase: boolean;
}

defineProps<{ id: string; data: EditorNodeData }>();

const { t } = useI18nTyped();

const KIND_STYLE: Record<EditorKind, { bar: string; chip: string }> = {
  receiver: {
    bar: "bg-icon-chip-info-text",
    chip: "bg-icon-chip-info-bg text-icon-chip-info-text",
  },
  processor: {
    bar: "bg-badge-purple-soft-text",
    chip: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  },
  exporter: {
    bar: "bg-icon-chip-success-text",
    chip: "bg-icon-chip-success-bg text-icon-chip-success-text",
  },
  extension: {
    bar: "bg-icon-chip-warning-text",
    chip: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
  },
};
</script>
