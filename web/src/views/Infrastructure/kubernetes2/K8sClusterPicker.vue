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
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { ClusterTone } from "./k8sTree";

export interface PickerCluster {
  name: string;
  tone: ClusterTone;
}

const props = defineProps<{ clusters: PickerCluster[]; active: string | null }>();
const emit = defineEmits<{ select: [name: string] }>();

const { t } = useI18nTyped();

const DOT_CLASS: Record<ClusterTone, string> = {
  success: "bg-status-success-text",
  warning: "bg-status-warning-text",
  error: "bg-status-error-text",
  neutral: "bg-status-neutral-text",
};

const HEALTH_KEY: Record<ClusterTone, I18nKey> = {
  success: "infra.k8s2.healthHealthy",
  warning: "infra.k8s2.healthWarning",
  error: "infra.k8s2.healthCritical",
  neutral: "infra.k8s2.healthSilent",
};

const open = ref(false);
const query = ref("");

const current = computed(() => props.clusters.find((c) => c.name === props.active) ?? null);

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return needle
    ? props.clusters.filter((c) => c.name.toLowerCase().includes(needle))
    : props.clusters;
});

watch(open, (isOpen) => {
  if (!isOpen) query.value = "";
});

const choose = (name: string) => {
  open.value = false;
  if (name !== props.active) emit("select", name);
};
</script>

<template>
  <OPopover
    v-model:open="open"
    align="start"
    content-class="w-(--reka-popover-trigger-width) min-w-56 p-0"
    :aria-label="t('infra.k8s2.clusterPickerLabel')"
  >
    <template #trigger>
      <button
        type="button"
        class="border-border-default bg-surface-base hover:bg-dropdown-item-hover-bg focus-visible:ring-accent rounded-default flex h-9 w-full items-center gap-2 border px-2.5 text-start text-sm outline-none focus-visible:ring-2"
        :aria-label="t('infra.k8s2.clusterPickerLabel')"
        data-test="k8s2-cluster-picker"
      >
        <span
          v-if="current"
          class="size-2.5 shrink-0 rounded-full"
          :class="DOT_CLASS[current.tone]"
          aria-hidden="true"
        />
        <OTruncatedText class="min-w-0 flex-1 font-semibold">{{
          raw(current?.name ?? "")
        }}</OTruncatedText>
        <OIcon
          name="unfold-more"
          size="sm"
          class="text-text-secondary shrink-0"
          aria-hidden="true"
        />
      </button>
    </template>

    <div class="border-border-default border-b p-2">
      <OSearchInput
        v-model="query"
        size="sm"
        :placeholder="t('infra.k8s2.clusterPickerSearch')"
        data-test="k8s2-cluster-picker-search"
      />
    </div>
    <ul
      class="max-h-72 overflow-y-auto p-1.5"
      role="listbox"
      :aria-label="t('infra.k8s2.clusterPickerLabel')"
      data-test="k8s2-cluster-picker-list"
    >
      <li v-for="cluster in visible" :key="cluster.name" role="presentation">
        <button
          type="button"
          role="option"
          class="hover:bg-select-item-hover-bg focus-visible:ring-accent rounded-default flex w-full items-center gap-2 px-2 py-1.5 text-start text-sm outline-none focus-visible:ring-2"
          :class="cluster.name === active ? 'bg-select-item-selected-bg font-semibold' : ''"
          :aria-selected="cluster.name === active"
          :aria-label="
            t('infra.k8s2.hotbarTileLabel', {
              name: raw(cluster.name),
              health: t(HEALTH_KEY[cluster.tone]),
            })
          "
          :data-test="`k8s2-cluster-option-${cluster.name}`"
          @click="choose(cluster.name)"
        >
          <span
            class="size-2.5 shrink-0 rounded-full"
            :class="DOT_CLASS[cluster.tone]"
            :data-test="`k8s2-cluster-dot-${cluster.name}`"
            aria-hidden="true"
          />
          <OTruncatedText class="min-w-0 flex-1">{{ raw(cluster.name) }}</OTruncatedText>
        </button>
      </li>
      <li
        v-if="!visible.length"
        class="text-text-secondary px-2 py-3 text-center text-xs"
        data-test="k8s2-cluster-picker-empty"
      >
        {{ t("infra.k8s2.clusterPickerEmpty") }}
      </li>
    </ul>
  </OPopover>
</template>
