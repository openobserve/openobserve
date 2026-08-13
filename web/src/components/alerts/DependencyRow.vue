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
  One entity row inside the inline DependencyChainPanel: kind icon + name, an
  optional count badge (destinations' alert counts), unused/broken flags, and
  Open / Delete actions. Delete uses an INLINE confirm (not a modal dialog) so it
  works inside the dependency popover without dismissing it.
-->
<template>
  <div
    class="group hover:bg-interactive-hover-bg rounded-default flex items-center gap-2 px-2 py-1"
    :data-test="`dependency-row-${node.kind}-${node.name}`"
  >
    <OIcon :name="kindIcon" size="sm" class="shrink-0" :class="kindColor" />
    <span class="text-compact min-w-0 flex-1 truncate" :title="node.name">{{ node.name }}</span>

    <OTag v-if="count != null" type="countChip" value="neutral">{{
      t("alert_dependencies.usedBy", { count }, count)
    }}</OTag>
    <OTag v-if="node.orphan" type="countChip" value="warning">{{
      t("alert_dependencies.orphanTag")
    }}</OTag>
    <OTag v-if="node.missing" type="countChip" value="error">{{
      t("alert_dependencies.missingTag")
    }}</OTag>

    <!-- Inline delete confirm — a compact "Delete? ✓ ✕" instead of a modal. -->
    <div
      v-if="confirming"
      class="flex shrink-0 items-center gap-1"
      data-test="dependency-row-confirm"
    >
      <span class="text-text-secondary text-2xs">{{ t("alert_dependencies.confirmDelete") }}</span>
      <OButton
        variant="ghost"
        size="icon-sm"
        :data-test="`dependency-row-confirm-yes-${node.name}`"
        @click="
          confirming = false;
          emit('delete', node);
        "
      >
        <OIcon name="check" size="sm" class="text-status-negative" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        :data-test="`dependency-row-confirm-no-${node.name}`"
        @click="confirming = false"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>

    <div v-else class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
      <OButton
        v-if="!node.missing"
        variant="ghost"
        size="icon-sm"
        :data-test="`dependency-row-open-${node.name}`"
        @click="emit('open', node)"
      >
        <OIcon name="open-in-new" size="sm" />
        <OTooltip side="top" :content="t('alert_dependencies.actionOpen')" />
      </OButton>
      <OButton
        v-if="!node.missing"
        variant="ghost"
        size="icon-sm"
        :data-test="`dependency-row-delete-${node.name}`"
        @click="confirming = true"
      >
        <OIcon name="delete" size="sm" class="text-status-negative" />
        <OTooltip side="top" :content="t('alert_dependencies.actionDelete')" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { DepNode } from "@/composables/alerts/useDependencyGraph";

const props = defineProps<{ node: DepNode; count?: number }>();
const emit = defineEmits<{
  (e: "open", node: DepNode): void;
  (e: "delete", node: DepNode): void;
}>();

const { t } = useI18nTyped();
const confirming = ref(false);

const kindIcon = computed(() =>
  props.node.kind === "template"
    ? "description"
    : props.node.kind === "destination"
      ? "location-on"
      : "shield-alert-outline",
);

// Green alert / blue destination / neutral template — matches the graph's hues.
const kindColor = computed(() => {
  if (props.node.missing) return "text-status-negative";
  if (props.node.orphan) return "text-status-warning";
  return props.node.kind === "destination"
    ? "text-info"
    : props.node.kind === "alert"
      ? "text-status-positive"
      : "text-text-secondary";
});
</script>
