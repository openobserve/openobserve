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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { DetailsRef } from "./kubernetesUrlState";
import { readActionsFor, writeActionsFor, type K8sAction } from "./k8sActions";

const props = defineProps<{ target: DetailsRef }>();

const emit = defineEmits<{ action: [type: K8sAction, ref: DetailsRef] }>();

const { t } = useI18nTyped();

const ITEMS: Record<Exclude<K8sAction, "explain">, { label: I18nKey; icon: IconName }> = {
  details: { label: "infra.k8s2.menuDetails", icon: "visibility" },
  yaml: { label: "infra.k8s2.menuViewYaml", icon: "data-object" },
  logs: { label: "infra.k8s2.menuViewLogs", icon: "article" },
  traces: { label: "infra.k8s2.menuOpenTraces", icon: "account-tree" },
  metrics: { label: "infra.k8s2.menuOpenMetrics", icon: "show-chart" },
  scale: { label: "infra.k8s2.menuScale", icon: "unfold-more" },
  restart: { label: "infra.k8s2.menuRestart", icon: "restart-alt" },
  delete: { label: "infra.k8s2.menuDelete", icon: "delete" },
};

const reads = computed(() => readActionsFor(props.target.kind));

const writes = computed(() => writeActionsFor(props.target.kind));
</script>

<template>
  <ODropdown side="bottom" align="end">
    <template #trigger>
      <OButton
        icon-left="more-vert"
        variant="ghost"
        size="icon-xs-sq"
        :aria-label="t('infra.k8s2.rowActions')"
        data-test="k8s2-row-menu-trigger"
        @click.stop
      />
    </template>
    <ODropdownItem
      v-for="type in reads"
      :key="type"
      :icon-left="ITEMS[type].icon"
      :data-test="`k8s2-row-menu-${type}`"
      @select="emit('action', type, target)"
    >
      {{ t(ITEMS[type].label) }}
    </ODropdownItem>
    <ODropdownSeparator v-if="writes.length" />
    <ODropdownItem
      v-for="type in writes"
      :key="type"
      disabled
      focusable-unavailable
      :data-test="`k8s2-row-menu-${type}`"
    >
      <template #icon-left>
        <OIcon :name="ITEMS[type].icon" size="sm" />
      </template>
      <span class="min-w-0 flex-1">
        <OTooltip :content="t('infra.k8s2.readOnlyAccess')" side="left" />
        {{ t(ITEMS[type].label) }}
      </span>
      <template #icon-right>
        <OIcon name="lock" size="sm" data-test="k8s2-row-menu-lock" />
      </template>
    </ODropdownItem>
  </ODropdown>
</template>
