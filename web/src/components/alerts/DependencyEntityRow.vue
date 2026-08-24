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

<!--
  One entity row inside the impact dialog: an alert shows an enabled/paused status
  dot, everything else its kind icon. Presentational — emits open/delete; the
  dialog opens (new tab) or confirms.
-->
<template>
  <div
    class="group rounded-default flex items-center gap-2 px-2 py-1.5"
    :class="[{ 'hover:bg-interactive-hover-bg': !noHover }, deleting ? 'opacity-50' : '']"
    :data-test="`dependency-impact-row-${node.name}`"
  >
    <OSpinner v-if="deleting" size="xs" class="shrink-0" />
    <span
      v-else-if="node.kind === 'alert'"
      class="size-2 shrink-0 rounded-full"
      :class="node.enabled ? 'bg-status-positive' : 'bg-text-muted'"
    >
      <OTooltip
        side="top"
        :content="node.enabled ? t('alert_dependencies.enabled') : t('alert_dependencies.paused')"
      />
    </span>
    <OIcon
      v-else
      :name="depKindIcon(node.kind)"
      size="sm"
      class="shrink-0"
      :class="depKindColor(node)"
    />

    <span class="text-compact min-w-0 flex-1 truncate">
      {{ node.name }}
      <OTooltip side="top" :content="raw(node.name)" />
    </span>

    <OTag v-if="node.missing" type="countChip" value="error" class="shrink-0">
      {{ t("alert_dependencies.missingTag") }}
    </OTag>
    <OTag v-else-if="count" type="countChip" value="neutral" class="shrink-0">
      {{ t("alert_dependencies.usedBy", { count }, count) }}
    </OTag>

    <div
      v-if="!deleting"
      class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100"
    >
      <OButton
        v-if="!node.missing"
        variant="ghost"
        size="icon-xs"
        :data-test="`dependency-impact-open-${node.name}`"
        @click.stop="emit('open', node)"
      >
        <OIcon name="open-in-new" size="sm" />
        <OTooltip side="top" :content="t('alert_dependencies.actionOpen')" />
      </OButton>
      <OButton
        v-if="!node.missing"
        variant="ghost"
        size="icon-xs"
        :data-test="`dependency-impact-delete-${node.name}`"
        @click.stop="emit('delete', node)"
      >
        <OIcon name="delete" size="sm" class="text-status-negative" />
        <OTooltip side="top" :content="t('alert_dependencies.actionDelete')" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { depKindIcon, depKindColor } from "@/composables/alerts/useDependencyGraph";
import type { DepNode } from "@/composables/alerts/useDependencyGraph";

// noHover: suppress the row's own hover background where a wrapper already
// provides the highlight (the destination cards), so hover and selected read the
// same shade instead of stacking two tints.
// deleting: this row's DELETE is in flight — the only feedback there is, since the
// confirm dialog closes on confirm and the list no longer reloads behind it.
defineProps<{ node: DepNode; count?: number; noHover?: boolean; deleting?: boolean }>();
const emit = defineEmits<{
  (e: "open", node: DepNode): void;
  (e: "delete", node: DepNode): void;
}>();

const { t } = useI18nTyped();
</script>
