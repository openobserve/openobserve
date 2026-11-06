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
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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

const current = computed(() => props.clusters.find((c) => c.name === props.active) ?? null);

const options = computed(() =>
  props.clusters.map((c) => ({ label: raw(c.name), value: c.name, tone: c.tone })),
);

const toneOf = (name: unknown) => props.clusters.find((c) => c.name === name)?.tone;

const onSelect = (value: unknown) => {
  if (typeof value === "string" && value !== props.active) emit("select", value);
};
</script>

<template>
  <OSelect
    class="w-full"
    size="md"
    searchable
    :model-value="active"
    :options="options"
    :search-placeholder="t('infra.k8s2.clusterPickerSearch')"
    :aria-label="
      current
        ? t('infra.k8s2.clusterPickerTrigger', { name: raw(current.name) })
        : t('infra.k8s2.clusterPickerLabel')
    "
    data-test="k8s2-cluster-picker"
    @update:model-value="onSelect"
  >
    <template #trigger>
      <span class="flex min-w-0 items-center gap-2">
        <span
          v-if="current"
          class="size-2.5 shrink-0 rounded-full"
          :class="DOT_CLASS[current.tone]"
          aria-hidden="true"
        />
        <OTruncatedText class="min-w-0 flex-1 font-semibold">{{
          current ? raw(current.name) : t("infra.k8s2.clusterPickerLabel")
        }}</OTruncatedText>
      </span>
    </template>
    <template #option="{ option }">
      <span
        v-if="toneOf(option.value)"
        class="flex min-w-0 flex-1 items-center gap-2"
        :aria-label="
          t('infra.k8s2.hotbarTileLabel', {
            name: raw(String(option.value)),
            health: t(HEALTH_KEY[toneOf(option.value)!]),
          })
        "
        :data-test="`k8s2-cluster-option-${option.value}`"
      >
        <span
          class="size-2.5 shrink-0 rounded-full"
          :class="DOT_CLASS[toneOf(option.value)!]"
          :data-test="`k8s2-cluster-dot-${option.value}`"
          aria-hidden="true"
        />
        <OTruncatedText class="min-w-0 flex-1">{{ raw(String(option.value)) }}</OTruncatedText>
      </span>
    </template>
    <template #empty>
      <span data-test="k8s2-cluster-picker-empty">{{ t("infra.k8s2.clusterPickerEmpty") }}</span>
    </template>
  </OSelect>
</template>
